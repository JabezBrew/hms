"""
Inventory Views for HMS.

Provides ViewSets for inventory management including:
- Storage locations (multi-location support)
- Location stock management
- Stock transfers
- Inventory items, categories, suppliers
- Stock movements, expiry tracking
- Inventory audits
"""
from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from django.db import models, transaction
from django.db.models import Sum, F, Q, Prefetch, Case, When, IntegerField, Count
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.contrib.auth import get_user_model

from .models import (
    InventoryCategory, Supplier, InventoryItem, StockMovement,
    ExpiryTracker, InventoryAudit, InventoryAuditItem,
    StorageLocation, LocationStock,
    # Phase 3: Procurement
    PurchaseRequisition, PurchaseRequisitionItem,
    PurchaseOrder, PurchaseOrderItem,
    GoodsReceivedNote, GoodsReceivedNoteItem,
    # Phase 4: Internal Logistics
    InternalRequisition, InternalRequisitionItem,
    StandingOrder, StandingOrderItem,
    StockTransferRequest, StockTransferItem,
    # Phase 5: Controlled Substances
    ControlledSubstanceRegister, ControlledSubstanceEntry,
    ControlledSubstanceDiscrepancy,
)
from .serializers import (
    InventoryCategorySerializer, InventoryCategoryListSerializer,
    SupplierSerializer, SupplierListSerializer,
    InventoryItemSerializer, InventoryItemListSerializer,
    StockMovementSerializer, StockMovementListSerializer,
    ExpiryTrackerSerializer, ExpiryTrackerListSerializer,
    InventoryAuditSerializer, InventoryAuditListSerializer,
    InventoryAuditItemSerializer, InventoryAuditCreateSerializer,
    StorageLocationSerializer, StorageLocationListSerializer,
    LocationStockSerializer, LocationStockListSerializer,
    SimpleStockTransferSerializer, StockAvailabilitySerializer,
    # Phase 3: Procurement
    PurchaseRequisitionSerializer, PurchaseRequisitionListSerializer,
    PurchaseRequisitionCreateSerializer, PurchaseRequisitionItemSerializer,
    PurchaseOrderSerializer, PurchaseOrderListSerializer,
    PurchaseOrderCreateSerializer, PurchaseOrderItemSerializer,
    GoodsReceivedNoteSerializer, GoodsReceivedNoteListSerializer,
    GoodsReceivedNoteCreateSerializer, GoodsReceivedNoteItemSerializer,
    # Phase 4: Internal Logistics
    InternalRequisitionSerializer, InternalRequisitionListSerializer,
    InternalRequisitionCreateSerializer, InternalRequisitionItemSerializer,
    StandingOrderSerializer, StandingOrderListSerializer,
    StandingOrderCreateSerializer, StandingOrderItemSerializer,
    StockTransferRequestSerializer, StockTransferRequestListSerializer,
    StockTransferRequestCreateSerializer, StockTransferItemSerializer,
    # Phase 5: Controlled Substances
    ControlledSubstanceRegisterSerializer, ControlledSubstanceRegisterListSerializer,
    ControlledSubstanceEntrySerializer, ControlledSubstanceEntryListSerializer,
    ControlledSubstanceDispenseSerializer, ControlledSubstanceWastageSerializer,
    ControlledSubstanceCountSerializer,
    ControlledSubstanceDiscrepancySerializer, ControlledSubstanceDiscrepancyListSerializer,
    # Phase 6: Analytics
    ConsumptionAnalyticsRequestSerializer, ABCAnalysisRequestSerializer,
    SupplierPerformanceRequestSerializer, ExpiryForecastRequestSerializer,
    StockValuationRequestSerializer, ControlledSubstanceReportRequestSerializer,
)
from .services import (
    StockService, BatchSelectionService, InsufficientStockError,
    ProcurementService, InternalLogisticsService,
    ControlledSubstanceService, WitnessRequiredError,
)
from .analytics import InventoryAnalyticsService
from ..users.permissions import IsAdminOrOwner
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, get_user_facility


# =============================================================================
# Storage Location ViewSets (Phase 1: Multi-Location)
# =============================================================================


class StorageLocationViewSet(viewsets.ModelViewSet):
    """
    API endpoint for storage locations.

    Supports hierarchical organization of storage areas:
    - Warehouse, Pharmacy, Satellite pharmacy
    - Ward stores, Department stores
    - Operating theatre, Emergency, Laboratory
    """
    queryset = StorageLocation.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'building', 'floor']
    ordering_fields = ['name', 'code', 'location_type', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return StorageLocation.objects.none()
        return StorageLocation.objects.filter(
            facility=facility
        ).select_related('parent', 'ward', 'department')

    def get_serializer_class(self):
        if self.action == 'list':
            return StorageLocationListSerializer
        return StorageLocationSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['get'])
    def stock(self, request, pk=None):
        """
        Get all stock items at this location.
        """
        location = self.get_object()
        stocks = LocationStock.objects.filter(
            location=location
        ).select_related('item', 'item__category')

        # Filter by low stock if requested
        if request.query_params.get('low_stock') == 'true':
            stocks = [s for s in stocks if s.is_below_reorder]
            serializer = LocationStockListSerializer(stocks, many=True)
        else:
            serializer = LocationStockListSerializer(stocks, many=True)

        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def by_type(self, request):
        """
        Get locations grouped by type.
        """
        facility = get_user_facility(request)
        if not facility:
            return Response({})

        locations = StorageLocation.objects.filter(
            facility=facility, is_active=True
        ).values('location_type').annotate(count=Count('id'))

        return Response({loc['location_type']: loc['count'] for loc in locations})


class LocationStockViewSet(viewsets.ModelViewSet):
    """
    API endpoint for location stock records.

    Provides stock levels per item per location.
    """
    queryset = LocationStock.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['item__name', 'item__sku', 'location__name', 'location__code']
    ordering_fields = ['quantity', 'last_movement_at', 'item__name']
    ordering = ['item__name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return LocationStock.objects.none()

        queryset = LocationStock.objects.filter(
            location__facility=facility
        ).select_related('item', 'location')

        # Filter by location
        location_id = self.request.query_params.get('location')
        if location_id:
            queryset = queryset.filter(location_id=location_id)

        # Filter by item
        item_id = self.request.query_params.get('item')
        if item_id:
            queryset = queryset.filter(item_id=item_id)

        # Filter by low stock
        if self.request.query_params.get('low_stock') == 'true':
            # This requires post-filtering since is_below_reorder is a property
            queryset = queryset.annotate(
                effective_reorder=Case(
                    When(reorder_level__isnull=False, then=F('reorder_level')),
                    default=F('item__reorder_level'),
                    output_field=IntegerField()
                )
            ).filter(
                quantity__lte=F('effective_reorder')
            )

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return LocationStockListSerializer
        return LocationStockSerializer

    @action(detail=False, methods=['get'], url_path='item/(?P<item_id>[^/.]+)/by-location')
    def by_location(self, request, item_id=None):
        """
        Get stock for a specific item across all locations.
        """
        facility = get_user_facility(request)
        if not facility:
            return Response([])

        stocks = LocationStock.objects.filter(
            item_id=item_id,
            location__facility=facility
        ).select_related('location')

        serializer = LocationStockListSerializer(stocks, many=True)
        return Response(serializer.data)


# =============================================================================
# Stock Transfer ViewSet
# =============================================================================


class StockTransferViewSet(viewsets.ViewSet):
    """
    API endpoint for stock transfers between locations.

    POST /api/inventory/transfers/ - Create a new transfer
    GET /api/inventory/transfers/ - List recent transfers (via movements)
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    def create(self, request):
        """
        Transfer stock between locations.
        """
        serializer = SimpleStockTransferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        # Fetch objects
        try:
            item = InventoryItem.objects.get(id=data['item'], facility=facility)
            from_location = StorageLocation.objects.get(
                id=data['from_location'], facility=facility
            )
            to_location = StorageLocation.objects.get(
                id=data['to_location'], facility=facility
            )
        except (InventoryItem.DoesNotExist, StorageLocation.DoesNotExist) as e:
            return Response(
                {'error': f'Object not found: {str(e)}'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Get batch if specified
        batch = None
        if data.get('batch_id'):
            try:
                batch = ExpiryTracker.objects.get(
                    id=data['batch_id'],
                    item=item,
                    location=from_location,
                    status='active'
                )
            except ExpiryTracker.DoesNotExist:
                return Response(
                    {'error': 'Batch not found at source location'},
                    status=status.HTTP_404_NOT_FOUND
                )

        # Perform transfer
        try:
            out_movement, in_movement = StockService.transfer_stock(
                item=item,
                from_location=from_location,
                to_location=to_location,
                quantity=data['quantity'],
                user=request.user,
                notes=data.get('notes', ''),
                batch_number=batch.batch_number if batch else None,
                expiry_tracker=batch,
            )
        except InsufficientStockError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

        return Response({
            'message': f'Successfully transferred {data["quantity"]} units',
            'outbound_movement_id': str(out_movement.id),
            'inbound_movement_id': str(in_movement.id),
        }, status=status.HTTP_201_CREATED)

    def list(self, request):
        """
        List recent transfer movements.
        """
        facility = get_user_facility(request)
        if not facility:
            return Response([])

        movements = StockMovement.objects.filter(
            facility=facility,
            movement_type__in=['transfer_out', 'transfer_in']
        ).select_related(
            'item', 'source_location', 'destination_location'
        ).order_by('-timestamp')[:100]

        serializer = StockMovementListSerializer(movements, many=True)
        return Response(serializer.data)


# =============================================================================
# Stock Availability ViewSet
# =============================================================================


class StockAvailabilityViewSet(viewsets.ViewSet):
    """
    API endpoint for checking stock availability.
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    @action(detail=False, methods=['get'], url_path='check')
    def check(self, request):
        """
        Check stock availability for an item at a location.

        Query params:
            item: Item UUID
            location: Location UUID
            quantity: Quantity needed
        """
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        item_id = request.query_params.get('item')
        location_id = request.query_params.get('location')
        quantity = int(request.query_params.get('quantity', 1))

        if not item_id or not location_id:
            return Response(
                {'error': 'item and location parameters are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            item = InventoryItem.objects.get(id=item_id, facility=facility)
            location = StorageLocation.objects.get(id=location_id, facility=facility)
        except (InventoryItem.DoesNotExist, StorageLocation.DoesNotExist):
            return Response(
                {'error': 'Item or location not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        result = StockService.check_availability(item, location, quantity)
        serializer = StockAvailabilitySerializer(result)
        return Response(serializer.data)


# =============================================================================
# Batch Recommendation ViewSet
# =============================================================================


class BatchRecommendationViewSet(viewsets.ViewSet):
    """
    API endpoint for batch selection recommendations (FEFO).
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    @action(detail=False, methods=['get'], url_path='item/(?P<item_id>[^/.]+)')
    def recommendations(self, request, item_id=None):
        """
        Get batch recommendations for an item at a location.

        Query params:
            location: Location UUID
            quantity: Quantity needed
        """
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        location_id = request.query_params.get('location')
        quantity = int(request.query_params.get('quantity', 1))

        if not location_id:
            return Response(
                {'error': 'location parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            item = InventoryItem.objects.get(id=item_id, facility=facility)
            location = StorageLocation.objects.get(id=location_id, facility=facility)
        except (InventoryItem.DoesNotExist, StorageLocation.DoesNotExist):
            return Response(
                {'error': 'Item or location not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        result = BatchSelectionService.get_batch_recommendations(
            item, location, quantity
        )
        return Response(result)


# =============================================================================
# Original ViewSets (updated with list serializers)
# =============================================================================


class InventoryCategoryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for inventory categories.
    """
    queryset = InventoryCategory.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InventoryCategory.objects.none()
        return InventoryCategory.objects.filter(
            facility=facility
        ).select_related('parent')

    def get_serializer_class(self):
        if self.action == 'list':
            return InventoryCategoryListSerializer
        return InventoryCategorySerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            facility=facility
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class SupplierViewSet(viewsets.ModelViewSet):
    """
    API endpoint for suppliers.
    """
    queryset = Supplier.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'contact_person', 'email', 'phone']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return Supplier.objects.none()
        return Supplier.objects.filter(facility=facility)

    def get_serializer_class(self):
        if self.action == 'list':
            return SupplierListSerializer
        return SupplierSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            facility=facility
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class InventoryItemViewSet(viewsets.ModelViewSet):
    """
    API endpoint for inventory items.
    """
    queryset = InventoryItem.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'sku', 'barcode', 'category__name', 'supplier__name']
    ordering_fields = ['name', 'current_stock', 'unit_cost', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InventoryItem.objects.none()

        queryset = InventoryItem.objects.filter(
            facility=facility
        ).select_related('category', 'supplier')

        # Filter by item type
        item_type = self.request.query_params.get('item_type')
        if item_type:
            queryset = queryset.filter(item_type=item_type)

        # Filter by category
        category_id = self.request.query_params.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        # Filter by controlled substances
        if self.request.query_params.get('controlled') == 'true':
            queryset = queryset.filter(is_controlled_substance=True)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return InventoryItemListSerializer
        return InventoryItemSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        category = serializer.validated_data.get('category')
        if category and category.facility_id != facility.id:
            raise PermissionDenied("Category does not belong to the active facility.")
        supplier = serializer.validated_data.get('supplier')
        if supplier and supplier.facility_id != facility.id:
            raise PermissionDenied("Supplier does not belong to the active facility.")
        serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            facility=facility,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def low_stock(self, request):
        """
        Get items that are low on stock.
        """
        facility = get_user_facility(request)
        if not facility:
            return Response([], status=status.HTTP_200_OK)

        items = InventoryItem.objects.filter(
            facility=facility,
            current_stock__lte=F('reorder_level')
        )
        serializer = InventoryItemListSerializer(items, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def expiring_soon(self, request):
        """
        Get items that are expiring soon.
        """
        days = int(request.query_params.get('days', 30))
        expiry_date = timezone.now().date() + timezone.timedelta(days=days)

        facility = get_user_facility(request)
        if not facility:
            return Response([], status=status.HTTP_200_OK)

        trackers = ExpiryTracker.objects.filter(
            item__facility=facility,
            expiry_date__lte=expiry_date,
            expiry_date__gte=timezone.now().date(),
            status='active',
            remaining_quantity__gt=0
        )

        item_ids = trackers.values_list('item_id', flat=True).distinct()
        items = InventoryItem.objects.filter(id__in=item_ids, facility=facility)

        serializer = InventoryItemListSerializer(items, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def movements(self, request, pk=None):
        """
        Get all stock movements for an item.
        """
        item = self.get_object()
        movements = item.movements.select_related(
            'source_location', 'destination_location', 'created_by'
        )

        # Filter by date range
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')

        if start_date:
            movements = movements.filter(timestamp__gte=start_date)
        if end_date:
            movements = movements.filter(timestamp__lte=end_date)

        # Filter by movement type
        movement_type = request.query_params.get('movement_type')
        if movement_type:
            movements = movements.filter(movement_type=movement_type)

        serializer = StockMovementListSerializer(movements[:100], many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def expiry_trackers(self, request, pk=None):
        """
        Get all expiry trackers for an item.
        """
        item = self.get_object()
        trackers = item.expiry_trackers.select_related('location')

        # Filter by status
        status_filter = request.query_params.get('status')
        if status_filter:
            trackers = trackers.filter(status=status_filter)

        # Filter by location
        location_id = request.query_params.get('location')
        if location_id:
            trackers = trackers.filter(location_id=location_id)

        serializer = ExpiryTrackerListSerializer(trackers, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def stock_by_location(self, request, pk=None):
        """
        Get stock levels for an item across all locations.
        """
        item = self.get_object()
        stocks = LocationStock.objects.filter(
            item=item
        ).select_related('location')

        serializer = LocationStockListSerializer(stocks, many=True)
        return Response(serializer.data)


class StockMovementViewSet(viewsets.ModelViewSet):
    """
    API endpoint for stock movements.
    """
    queryset = StockMovement.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['item__name', 'reference_number', 'batch_number', 'notes']
    ordering_fields = ['timestamp', 'item__name', 'quantity', 'unit_cost']
    ordering = ['-timestamp']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return StockMovement.objects.none()

        queryset = StockMovement.objects.filter(
            facility=facility
        ).select_related(
            'item', 'source_location', 'destination_location', 'created_by'
        )

        # Filter by movement type
        movement_type = self.request.query_params.get('movement_type')
        if movement_type:
            queryset = queryset.filter(movement_type=movement_type)

        # Filter by location
        location_id = self.request.query_params.get('location')
        if location_id:
            queryset = queryset.filter(
                Q(source_location_id=location_id) | Q(destination_location_id=location_id)
            )

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return StockMovementListSerializer
        return StockMovementSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        item = serializer.validated_data.get('item')
        if item and item.facility_id != facility.id:
            raise PermissionDenied("Item does not belong to the active facility.")
        serializer.save(created_by=self.request.user, facility=facility)

    @action(detail=False, methods=['post'])
    def bulk_create(self, request):
        """
        Create multiple stock movements at once.
        """
        movements_data = request.data.get('movements', [])
        if not movements_data:
            return Response(
                {"error": "No movements provided."},
                status=status.HTTP_400_BAD_REQUEST
            )

        created_movements = []
        errors = []

        facility = get_user_facility(request)
        if not facility:
            return Response(
                {"error": "Facility context is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            for idx, movement_data in enumerate(movements_data):
                serializer = StockMovementSerializer(data=movement_data)
                if serializer.is_valid():
                    item = serializer.validated_data.get('item')
                    if item and item.facility_id != facility.id:
                        errors.append({
                            "index": idx,
                            "errors": {"item": ["Item does not belong to the active facility."]}
                        })
                        continue
                    movement = serializer.save(created_by=request.user, facility=facility)
                    created_movements.append(movement)
                else:
                    errors.append({
                        "index": idx,
                        "errors": serializer.errors
                    })

            if errors:
                transaction.set_rollback(True)
                return Response(
                    {"errors": errors},
                    status=status.HTTP_400_BAD_REQUEST
                )

        return Response(
            {"message": f"Successfully created {len(created_movements)} movements."},
            status=status.HTTP_201_CREATED
        )


class ExpiryTrackerViewSet(viewsets.ModelViewSet):
    """
    API endpoint for expiry trackers.
    """
    queryset = ExpiryTracker.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['item__name', 'batch_number']
    ordering_fields = ['expiry_date', 'item__name', 'status']
    ordering = ['expiry_date']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ExpiryTracker.objects.none()

        queryset = ExpiryTracker.objects.filter(
            item__facility=facility
        ).select_related('item', 'location')

        # Filter by location
        location_id = self.request.query_params.get('location')
        if location_id:
            queryset = queryset.filter(location_id=location_id)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return ExpiryTrackerListSerializer
        return ExpiryTrackerSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        item = serializer.validated_data.get('item')
        if item and item.facility_id != facility.id:
            raise PermissionDenied("Item does not belong to the active facility.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def expired(self, request):
        """
        Get expired items.
        """
        facility = get_user_facility(request)
        if not facility:
            return Response([], status=status.HTTP_200_OK)

        trackers = ExpiryTracker.objects.filter(
            item__facility=facility,
            expiry_date__lt=timezone.now().date(),
            status='active'
        ).select_related('item', 'location')

        serializer = ExpiryTrackerListSerializer(trackers, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def expiring_soon(self, request):
        """
        Get items expiring soon.
        """
        days = int(request.query_params.get('days', 30))
        expiry_date = timezone.now().date() + timezone.timedelta(days=days)

        facility = get_user_facility(request)
        if not facility:
            return Response([], status=status.HTTP_200_OK)

        trackers = ExpiryTracker.objects.filter(
            item__facility=facility,
            expiry_date__lte=expiry_date,
            expiry_date__gte=timezone.now().date(),
            status='active'
        ).select_related('item', 'location')

        serializer = ExpiryTrackerListSerializer(trackers, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def mark_as_consumed(self, request, pk=None):
        """
        Mark an expiry tracker as consumed.
        """
        tracker = self.get_object()

        if tracker.status != 'active':
            return Response(
                {"error": f"Cannot mark as consumed. Current status: {tracker.get_status_display()}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        tracker.status = 'consumed'
        tracker.updated_by = request.user
        tracker.save()

        serializer = ExpiryTrackerSerializer(tracker)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def mark_as_disposed(self, request, pk=None):
        """
        Mark an expiry tracker as disposed and create a disposal stock movement.
        """
        tracker = self.get_object()

        if tracker.status not in ['active', 'expired']:
            return Response(
                {"error": f"Cannot mark as disposed. Current status: {tracker.get_status_display()}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            # Use StockService for location-aware disposal
            if tracker.location:
                StockService.adjust_stock(
                    item=tracker.item,
                    location=tracker.location,
                    quantity_change=-tracker.remaining_quantity,
                    movement_type='disposal',
                    user=request.user,
                    reference_number=f"Disposal of expired batch {tracker.batch_number}",
                    batch_number=tracker.batch_number,
                    expiry_tracker=tracker,
                    notes=f"Expired batch disposal"
                )
            else:
                # Legacy: no location, use old method
                StockMovement.objects.create(
                    item=tracker.item,
                    facility=tracker.item.facility,
                    movement_type='disposal',
                    quantity=tracker.remaining_quantity,
                    reference_number=f"Disposal of expired batch {tracker.batch_number}",
                    batch_number=tracker.batch_number,
                    expiry_date=tracker.expiry_date,
                    unit_cost=tracker.movement.unit_cost,
                    created_by=request.user
                )

            tracker.status = 'disposed'
            tracker.remaining_quantity = 0
            tracker.updated_by = request.user
            tracker.save()

        serializer = ExpiryTrackerSerializer(tracker)
        return Response(serializer.data)


class InventoryAuditViewSet(viewsets.ModelViewSet):
    """
    API endpoint for inventory audits.
    """
    queryset = InventoryAudit.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['notes', 'status']
    ordering_fields = ['audit_date', 'status', 'created_at']
    ordering = ['-audit_date']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InventoryAudit.objects.none()
        return InventoryAudit.objects.filter(
            facility=facility
        ).prefetch_related('items')

    def get_serializer_class(self):
        if self.action == 'list':
            return InventoryAuditListSerializer
        if self.action in ['create', 'update', 'partial_update']:
            return InventoryAuditCreateSerializer
        return InventoryAuditSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            facility=facility,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def complete_audit(self, request, pk=None):
        """
        Complete an audit and optionally create stock adjustments.
        """
        audit = self.get_object()

        if audit.status != 'in_progress':
            return Response(
                {"error": f"Cannot complete audit. Current status: {audit.get_status_display()}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        create_adjustments = request.data.get('create_adjustments', False)

        with transaction.atomic():
            if create_adjustments:
                for audit_item in audit.items.all():
                    if audit_item.discrepancy != 0:
                        StockMovement.objects.create(
                            item=audit_item.item,
                            facility=audit.facility,
                            movement_type='adjustment',
                            quantity=abs(audit_item.discrepancy),
                            reference_number=f"Audit adjustment from audit {audit.id}",
                            notes=f"Stock adjustment from audit on {audit.audit_date}. {audit_item.notes or ''}",
                            unit_cost=audit_item.item.unit_cost,
                            new_stock=audit_item.actual_quantity,
                            created_by=request.user
                        )

            audit.status = 'completed'
            audit.updated_by = request.user
            audit.save()

        serializer = InventoryAuditSerializer(audit)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def cancel_audit(self, request, pk=None):
        """
        Cancel an audit.
        """
        audit = self.get_object()

        if audit.status not in ['pending', 'in_progress']:
            return Response(
                {"error": f"Cannot cancel audit. Current status: {audit.get_status_display()}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        audit.status = 'cancelled'
        audit.updated_by = request.user
        audit.save()

        serializer = InventoryAuditSerializer(audit)
        return Response(serializer.data)


class InventoryAuditItemViewSet(viewsets.ModelViewSet):
    """
    API endpoint for inventory audit items.
    """
    queryset = InventoryAuditItem.objects.all()
    serializer_class = InventoryAuditItemSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['item__name', 'notes']
    ordering_fields = ['item__name', 'expected_quantity', 'actual_quantity', 'discrepancy']
    ordering = ['item__name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InventoryAuditItem.objects.none()
        return InventoryAuditItem.objects.filter(
            audit__facility=facility
        ).select_related('item')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        audit = serializer.validated_data.get('audit')
        item = serializer.validated_data.get('item')
        if audit and audit.facility_id != facility.id:
            raise PermissionDenied("Audit does not belong to the active facility.")
        if item and item.facility_id != facility.id:
            raise PermissionDenied("Item does not belong to the active facility.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


# =============================================================================
# Procurement ViewSets (Phase 3: Procurement Workflow)
# =============================================================================


class PurchaseRequisitionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for purchase requisitions.

    Supports workflow actions:
    - POST /requisitions/{id}/submit/ - Submit for approval
    - POST /requisitions/{id}/approve/ - Approve requisition
    - POST /requisitions/{id}/reject/ - Reject requisition
    - POST /requisitions/{id}/convert-to-po/ - Convert to purchase order
    """
    queryset = PurchaseRequisition.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['requisition_number', 'justification', 'notes']
    ordering_fields = ['created_at', 'date_required', 'priority', 'status']
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PurchaseRequisition.objects.none()

        queryset = PurchaseRequisition.objects.filter(
            facility=facility
        ).select_related(
            'requested_by', 'approved_by', 'requesting_location'
        ).prefetch_related('items__item')

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return PurchaseRequisitionListSerializer
        if self.action in ['create']:
            return PurchaseRequisitionCreateSerializer
        return PurchaseRequisitionSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            requested_by=self.request.user,
            requisition_number=ProcurementService.generate_requisition_number(facility),
        )

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """Submit requisition for approval."""
        requisition = self.get_object()
        try:
            requisition = ProcurementService.submit_requisition(requisition)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PurchaseRequisitionSerializer(requisition).data)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve requisition."""
        requisition = self.get_object()
        try:
            requisition = ProcurementService.approve_requisition(requisition, request.user)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PurchaseRequisitionSerializer(requisition).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Reject requisition."""
        requisition = self.get_object()
        reason = request.data.get('reason', '')
        if not reason:
            return Response(
                {'error': 'Rejection reason is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            requisition = ProcurementService.reject_requisition(
                requisition, request.user, reason
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PurchaseRequisitionSerializer(requisition).data)

    @action(detail=True, methods=['post'], url_path='convert-to-po')
    def convert_to_po(self, request, pk=None):
        """Convert approved requisition to purchase order."""
        requisition = self.get_object()
        facility = get_user_facility(request)

        supplier_id = request.data.get('supplier_id')
        location_id = request.data.get('delivery_location_id')
        expected_date = request.data.get('expected_delivery_date')

        if not supplier_id or not location_id:
            return Response(
                {'error': 'supplier_id and delivery_location_id are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            supplier = Supplier.objects.get(id=supplier_id, facility=facility)
            location = StorageLocation.objects.get(id=location_id, facility=facility)
        except (Supplier.DoesNotExist, StorageLocation.DoesNotExist):
            return Response(
                {'error': 'Supplier or location not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        try:
            po = ProcurementService.convert_requisition_to_po(
                requisition=requisition,
                supplier=supplier,
                delivery_location=location,
                user=request.user,
                expected_delivery_date=expected_date,
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PurchaseOrderSerializer(po).data, status=status.HTTP_201_CREATED)


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    """
    API endpoint for purchase orders.

    Supports workflow actions:
    - POST /purchase-orders/{id}/approve/ - Approve PO
    - POST /purchase-orders/{id}/send/ - Mark PO as sent to supplier
    """
    queryset = PurchaseOrder.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['po_number', 'supplier__name', 'notes']
    ordering_fields = ['created_at', 'expected_delivery_date', 'status', 'total_amount']
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PurchaseOrder.objects.none()

        queryset = PurchaseOrder.objects.filter(
            facility=facility
        ).select_related(
            'supplier', 'requisition', 'delivery_location',
            'created_by', 'approved_by'
        ).prefetch_related('items__item')

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by supplier
        supplier_id = self.request.query_params.get('supplier')
        if supplier_id:
            queryset = queryset.filter(supplier_id=supplier_id)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return PurchaseOrderListSerializer
        if self.action == 'create':
            return PurchaseOrderCreateSerializer
        return PurchaseOrderSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            created_by=self.request.user,
            po_number=ProcurementService.generate_po_number(facility),
        )

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve purchase order."""
        po = self.get_object()
        try:
            po = ProcurementService.approve_po(po, request.user)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PurchaseOrderSerializer(po).data)

    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        """Mark PO as sent to supplier."""
        po = self.get_object()
        try:
            po = ProcurementService.send_po(po)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PurchaseOrderSerializer(po).data)


class GoodsReceivedNoteViewSet(viewsets.ModelViewSet):
    """
    API endpoint for goods received notes.

    Supports workflow actions:
    - POST /grns/{id}/inspect/ - Mark as inspected
    - POST /grns/{id}/accept/ - Accept goods and update inventory
    """
    queryset = GoodsReceivedNote.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['grn_number', 'purchase_order__po_number', 'supplier_delivery_note']
    ordering_fields = ['received_at', 'status']
    ordering = ['-received_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return GoodsReceivedNote.objects.none()

        queryset = GoodsReceivedNote.objects.filter(
            facility=facility
        ).select_related(
            'purchase_order', 'purchase_order__supplier',
            'received_by', 'receiving_location', 'inspected_by'
        ).prefetch_related('items__item', 'items__po_item')

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by PO
        po_id = self.request.query_params.get('purchase_order')
        if po_id:
            queryset = queryset.filter(purchase_order_id=po_id)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return GoodsReceivedNoteListSerializer
        if self.action == 'create':
            return GoodsReceivedNoteCreateSerializer
        return GoodsReceivedNoteSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            received_by=self.request.user,
            grn_number=ProcurementService.generate_grn_number(facility),
        )

    @action(detail=True, methods=['post'])
    def inspect(self, request, pk=None):
        """Mark GRN as inspected."""
        grn = self.get_object()

        if grn.status not in ('draft', 'pending_inspection'):
            return Response(
                {'error': f'Cannot inspect GRN in {grn.status} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        grn.status = 'inspected'
        grn.inspected_by = request.user
        grn.inspected_at = timezone.now()
        grn.inspection_notes = request.data.get('inspection_notes', '')
        grn.has_quality_issues = request.data.get('has_quality_issues', False)
        grn.quality_issue_notes = request.data.get('quality_issue_notes', '')
        grn.save()

        return Response(GoodsReceivedNoteSerializer(grn).data)

    @action(detail=True, methods=['post'])
    def accept(self, request, pk=None):
        """Accept GRN and update inventory."""
        grn = self.get_object()
        try:
            grn = ProcurementService.accept_grn(grn, request.user)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(GoodsReceivedNoteSerializer(grn).data)

    @action(detail=True, methods=['put'], url_path='items/(?P<item_id>[^/.]+)')
    def update_item(self, request, pk=None, item_id=None):
        """Update a GRN item (quantities, batch info)."""
        grn = self.get_object()

        if grn.status in ('accepted', 'partially_accepted', 'rejected'):
            return Response(
                {'error': 'Cannot modify accepted/rejected GRN'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            grn_item = grn.items.get(id=item_id)
        except GoodsReceivedNoteItem.DoesNotExist:
            return Response(
                {'error': 'GRN item not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        serializer = GoodsReceivedNoteItemSerializer(grn_item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(serializer.data)


# =============================================================================
# Internal Logistics ViewSets (Phase 4)
# =============================================================================


class InternalRequisitionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for internal requisitions.

    Supports workflow actions:
    - POST /internal-requisitions/{id}/submit/ - Submit for approval
    - POST /internal-requisitions/{id}/approve/ - Approve requisition
    - POST /internal-requisitions/{id}/reject/ - Reject requisition
    - POST /internal-requisitions/{id}/fulfill/ - Fulfill requisition (issue stock)
    """
    queryset = InternalRequisition.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['requisition_number', 'justification', 'notes']
    ordering_fields = ['created_at', 'date_required', 'priority', 'status']
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InternalRequisition.objects.none()

        queryset = InternalRequisition.objects.filter(
            facility=facility
        ).select_related(
            'requested_by', 'approved_by', 'fulfilled_by',
            'requesting_location', 'fulfilling_location', 'standing_order'
        ).prefetch_related('items__item')

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by requesting location
        location_id = self.request.query_params.get('requesting_location')
        if location_id:
            queryset = queryset.filter(requesting_location_id=location_id)

        # Filter by fulfilling location
        fulfilling_id = self.request.query_params.get('fulfilling_location')
        if fulfilling_id:
            queryset = queryset.filter(fulfilling_location_id=fulfilling_id)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return InternalRequisitionListSerializer
        if self.action == 'create':
            return InternalRequisitionCreateSerializer
        return InternalRequisitionSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            requested_by=self.request.user,
            requisition_number=InternalLogisticsService.generate_internal_requisition_number(facility),
        )

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """Submit internal requisition for approval."""
        requisition = self.get_object()
        try:
            requisition = InternalLogisticsService.submit_internal_requisition(requisition)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(InternalRequisitionSerializer(requisition).data)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve internal requisition."""
        requisition = self.get_object()
        approved_quantities = request.data.get('approved_quantities')
        try:
            requisition = InternalLogisticsService.approve_internal_requisition(
                requisition, request.user, approved_quantities
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(InternalRequisitionSerializer(requisition).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Reject internal requisition."""
        requisition = self.get_object()
        reason = request.data.get('reason', '')
        if not reason:
            return Response(
                {'error': 'Rejection reason is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        try:
            requisition = InternalLogisticsService.reject_internal_requisition(
                requisition, request.user, reason
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(InternalRequisitionSerializer(requisition).data)

    @action(detail=True, methods=['post'])
    def fulfill(self, request, pk=None):
        """Fulfill internal requisition by issuing stock."""
        requisition = self.get_object()
        issue_data = request.data.get('issue_data')
        try:
            requisition = InternalLogisticsService.fulfill_internal_requisition(
                requisition, request.user, issue_data
            )
        except InsufficientStockError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(InternalRequisitionSerializer(requisition).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Cancel internal requisition."""
        requisition = self.get_object()
        if requisition.status in ('fulfilled', 'partially_fulfilled', 'cancelled'):
            return Response(
                {'error': f'Cannot cancel requisition in {requisition.status} status'},
                status=status.HTTP_400_BAD_REQUEST
            )
        requisition.status = 'cancelled'
        requisition.save()
        return Response(InternalRequisitionSerializer(requisition).data)


class StandingOrderViewSet(viewsets.ModelViewSet):
    """
    API endpoint for standing orders.

    Standing orders automatically generate internal requisitions on schedule.

    Supports actions:
    - POST /standing-orders/{id}/generate/ - Manually generate a requisition
    """
    queryset = StandingOrder.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'notes']
    ordering_fields = ['name', 'frequency', 'next_due', 'is_active']
    ordering = ['name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return StandingOrder.objects.none()

        queryset = StandingOrder.objects.filter(
            facility=facility
        ).select_related(
            'requesting_location', 'fulfilling_location', 'created_by'
        ).prefetch_related('items__item')

        # Filter by active status
        if self.request.query_params.get('active') == 'true':
            queryset = queryset.filter(is_active=True)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return StandingOrderListSerializer
        if self.action == 'create':
            return StandingOrderCreateSerializer
        return StandingOrderSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            created_by=self.request.user,
        )

    @action(detail=True, methods=['post'])
    def generate(self, request, pk=None):
        """Manually generate a requisition from this standing order."""
        standing_order = self.get_object()
        try:
            requisition = InternalLogisticsService.generate_from_standing_order(
                standing_order, request.user
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            InternalRequisitionSerializer(requisition).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=['get'])
    def due(self, request):
        """Get standing orders due for generation."""
        facility = get_user_facility(request)
        if not facility:
            return Response([])

        due_orders = InternalLogisticsService.get_due_standing_orders(facility)
        serializer = StandingOrderListSerializer(due_orders, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='process-due')
    def process_due(self, request):
        """Process all due standing orders and generate requisitions."""
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        requisitions = InternalLogisticsService.process_due_standing_orders(
            facility, request.user
        )
        return Response({
            'message': f'Generated {len(requisitions)} requisitions',
            'requisition_ids': [str(r.id) for r in requisitions],
        })


class StockTransferRequestViewSet(viewsets.ModelViewSet):
    """
    API endpoint for stock transfer requests.

    Supports workflow actions:
    - POST /transfer-requests/{id}/approve/ - Approve transfer
    - POST /transfer-requests/{id}/dispatch/ - Dispatch items
    - POST /transfer-requests/{id}/receive/ - Receive items at destination
    - POST /transfer-requests/{id}/cancel/ - Cancel transfer
    """
    queryset = StockTransferRequest.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['transfer_number', 'reason', 'notes']
    ordering_fields = ['created_at', 'status']
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return StockTransferRequest.objects.none()

        queryset = StockTransferRequest.objects.filter(
            facility=facility
        ).select_related(
            'from_location', 'to_location',
            'requested_by', 'approved_by', 'dispatched_by', 'received_by'
        ).prefetch_related('items__item', 'items__batch')

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by from location
        from_id = self.request.query_params.get('from_location')
        if from_id:
            queryset = queryset.filter(from_location_id=from_id)

        # Filter by to location
        to_id = self.request.query_params.get('to_location')
        if to_id:
            queryset = queryset.filter(to_location_id=to_id)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return StockTransferRequestListSerializer
        if self.action == 'create':
            return StockTransferRequestCreateSerializer
        return StockTransferRequestSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            requested_by=self.request.user,
            transfer_number=InternalLogisticsService.generate_transfer_number(facility),
        )

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve transfer request."""
        transfer = self.get_object()
        try:
            transfer = InternalLogisticsService.approve_transfer_request(
                transfer, request.user
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(StockTransferRequestSerializer(transfer).data)

    @action(detail=True, methods=['post'], url_path='dispatch')
    def dispatch_transfer(self, request, pk=None):
        """Dispatch items from source location."""
        transfer = self.get_object()
        dispatch_quantities = request.data.get('dispatch_quantities')
        try:
            transfer = InternalLogisticsService.dispatch_transfer(
                transfer, request.user, dispatch_quantities
            )
        except InsufficientStockError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(StockTransferRequestSerializer(transfer).data)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        """Receive items at destination location."""
        transfer = self.get_object()
        received_quantities = request.data.get('received_quantities')
        try:
            transfer = InternalLogisticsService.receive_transfer(
                transfer, request.user, received_quantities
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(StockTransferRequestSerializer(transfer).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Cancel transfer request."""
        transfer = self.get_object()
        reason = request.data.get('reason')
        try:
            transfer = InternalLogisticsService.cancel_transfer_request(transfer, reason)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(StockTransferRequestSerializer(transfer).data)


# =============================================================================
# Controlled Substance ViewSets (Phase 5)
# =============================================================================


class ControlledSubstanceRegisterViewSet(viewsets.ModelViewSet):
    """
    API endpoint for controlled substance registers.

    Each register tracks a controlled substance at a specific location.
    """
    queryset = ControlledSubstanceRegister.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['item__name', 'item__sku', 'location__name']
    ordering_fields = ['item__name', 'location__name', 'running_balance', 'last_entry_at']
    ordering = ['item__name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ControlledSubstanceRegister.objects.none()

        queryset = ControlledSubstanceRegister.objects.filter(
            facility=facility
        ).select_related('item', 'location', 'created_by')

        # Filter by location
        location_id = self.request.query_params.get('location')
        if location_id:
            queryset = queryset.filter(location_id=location_id)

        # Filter by item
        item_id = self.request.query_params.get('item')
        if item_id:
            queryset = queryset.filter(item_id=item_id)

        # Filter active only
        if self.request.query_params.get('active') == 'true':
            queryset = queryset.filter(is_active=True)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return ControlledSubstanceRegisterListSerializer
        return ControlledSubstanceRegisterSerializer

    @action(detail=True, methods=['get'])
    def entries(self, request, pk=None):
        """Get entry history for a register."""
        register = self.get_object()
        limit = int(request.query_params.get('limit', 100))
        entry_type = request.query_params.get('entry_type')

        entries = ControlledSubstanceService.get_register_history(
            register, entry_type=entry_type, limit=limit
        )
        serializer = ControlledSubstanceEntryListSerializer(entries, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def validate_balance(self, request, pk=None):
        """Validate register balance against entries."""
        register = self.get_object()
        is_valid, calculated, discrepancy = register.validate_balance()

        return Response({
            'is_valid': is_valid,
            'running_balance': register.running_balance,
            'calculated_balance': calculated,
            'discrepancy': discrepancy,
        })


class ControlledSubstanceEntryViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for controlled substance entries (read-only).

    Entries are created through specific operations (dispense, wastage, etc.)
    not through direct POST.
    """
    queryset = ControlledSubstanceEntry.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['register__item__name', 'notes']
    ordering_fields = ['timestamp', 'entry_number', 'quantity']
    ordering = ['-timestamp']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ControlledSubstanceEntry.objects.none()

        queryset = ControlledSubstanceEntry.objects.filter(
            register__facility=facility
        ).select_related(
            'register__item', 'register__location',
            'performed_by', 'witness', 'patient', 'batch'
        )

        # Filter by register
        register_id = self.request.query_params.get('register')
        if register_id:
            queryset = queryset.filter(register_id=register_id)

        # Filter by entry type
        entry_type = self.request.query_params.get('entry_type')
        if entry_type:
            queryset = queryset.filter(entry_type=entry_type)

        # Filter by performer
        performer_id = self.request.query_params.get('performed_by')
        if performer_id:
            queryset = queryset.filter(performed_by_id=performer_id)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return ControlledSubstanceEntryListSerializer
        return ControlledSubstanceEntrySerializer


class ControlledSubstanceOperationsViewSet(viewsets.ViewSet):
    """
    API endpoint for controlled substance operations.

    POST /controlled/dispense/ - Dispense controlled substance
    POST /controlled/wastage/ - Record wastage
    POST /controlled/count/ - Perform physical count
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    @action(detail=False, methods=['post'])
    def dispense(self, request):
        """Dispense controlled substance to patient."""
        serializer = ControlledSubstanceDispenseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        try:
            location = StorageLocation.objects.get(id=data['location'], facility=facility)
            item = InventoryItem.objects.get(id=data['item'], facility=facility)
            witness = get_object_or_404(
                get_user_model(), id=data['witness']
            )
            from apps.users.models import PatientProfile
            patient = get_object_or_404(PatientProfile, id=data['patient'])
        except (StorageLocation.DoesNotExist, InventoryItem.DoesNotExist):
            return Response(
                {'error': 'Location or item not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Get optional batch
        batch = None
        if data.get('batch_id'):
            batch = ExpiryTracker.objects.filter(id=data['batch_id']).first()

        # Get optional prescription
        prescription = None
        if data.get('prescription'):
            from apps.clinical_notes.models import Prescription
            prescription = Prescription.objects.filter(id=data['prescription']).first()

        try:
            entry = ControlledSubstanceService.dispense_controlled(
                facility=facility,
                location=location,
                item=item,
                quantity=data['quantity'],
                performer=request.user,
                witness=witness,
                patient=patient,
                prescription=prescription,
                batch=batch,
                wastage_amount=data.get('wastage_amount'),
                wastage_reason=data.get('wastage_reason'),
                notes=data.get('notes'),
            )
        except WitnessRequiredError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except InsufficientStockError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            ControlledSubstanceEntrySerializer(entry).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=['post'])
    def wastage(self, request):
        """Record controlled substance wastage."""
        serializer = ControlledSubstanceWastageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        try:
            location = StorageLocation.objects.get(id=data['location'], facility=facility)
            item = InventoryItem.objects.get(id=data['item'], facility=facility)
            witness = get_object_or_404(
                get_user_model(), id=data['witness']
            )
        except (StorageLocation.DoesNotExist, InventoryItem.DoesNotExist):
            return Response(
                {'error': 'Location or item not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Get optional batch
        batch = None
        if data.get('batch_id'):
            batch = ExpiryTracker.objects.filter(id=data['batch_id']).first()

        try:
            entry = ControlledSubstanceService.record_wastage(
                facility=facility,
                location=location,
                item=item,
                quantity=data['quantity'],
                performer=request.user,
                witness=witness,
                wastage_reason=data['wastage_reason'],
                batch=batch,
                notes=data.get('notes'),
            )
        except WitnessRequiredError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except InsufficientStockError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            ControlledSubstanceEntrySerializer(entry).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=['post'])
    def count(self, request):
        """Perform physical count of controlled substance."""
        serializer = ControlledSubstanceCountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        try:
            location = StorageLocation.objects.get(id=data['location'], facility=facility)
            item = InventoryItem.objects.get(id=data['item'], facility=facility)
            witness = get_object_or_404(
                get_user_model(), id=data['witness']
            )
        except (StorageLocation.DoesNotExist, InventoryItem.DoesNotExist):
            return Response(
                {'error': 'Location or item not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        try:
            result = ControlledSubstanceService.perform_count(
                facility=facility,
                location=location,
                item=item,
                actual_count=data['actual_count'],
                performer=request.user,
                witness=witness,
                notes=data.get('notes'),
            )
        except WitnessRequiredError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(result)


class ControlledSubstanceDiscrepancyViewSet(viewsets.ModelViewSet):
    """
    API endpoint for controlled substance discrepancies.

    Discrepancies are created automatically when physical count doesn't match.
    """
    queryset = ControlledSubstanceDiscrepancy.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['register__item__name', 'investigation_notes', 'resolution_notes']
    ordering_fields = ['discovered_at', 'status', 'discrepancy']
    ordering = ['-discovered_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ControlledSubstanceDiscrepancy.objects.none()

        queryset = ControlledSubstanceDiscrepancy.objects.filter(
            register__facility=facility
        ).select_related(
            'register__item', 'register__location',
            'discovered_by', 'resolved_by'
        )

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by location
        location_id = self.request.query_params.get('location')
        if location_id:
            queryset = queryset.filter(register__location_id=location_id)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return ControlledSubstanceDiscrepancyListSerializer
        return ControlledSubstanceDiscrepancySerializer

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        """Resolve a discrepancy."""
        discrepancy = self.get_object()
        resolution_notes = request.data.get('resolution_notes')
        adjust_balance = request.data.get('adjust_balance', False)

        if not resolution_notes:
            return Response(
                {'error': 'Resolution notes are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            discrepancy = ControlledSubstanceService.resolve_discrepancy(
                discrepancy, request.user, resolution_notes, adjust_balance
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(ControlledSubstanceDiscrepancySerializer(discrepancy).data)

    @action(detail=True, methods=['post'])
    def escalate(self, request, pk=None):
        """Escalate a discrepancy."""
        discrepancy = self.get_object()

        if discrepancy.status == 'escalated':
            return Response(
                {'error': 'Discrepancy is already escalated'},
                status=status.HTTP_400_BAD_REQUEST
            )

        discrepancy.status = 'escalated'
        discrepancy.investigation_notes = (
            f"{discrepancy.investigation_notes or ''}\n\n"
            f"Escalated by {request.user.get_full_name()} at {timezone.now()}"
        ).strip()
        discrepancy.save()

        return Response(ControlledSubstanceDiscrepancySerializer(discrepancy).data)

    @action(detail=False, methods=['get'])
    def pending(self, request):
        """Get pending discrepancies."""
        facility = get_user_facility(request)
        if not facility:
            return Response([])

        location_id = request.query_params.get('location')
        location = None
        if location_id:
            location = StorageLocation.objects.filter(
                id=location_id, facility=facility
            ).first()

        discrepancies = ControlledSubstanceService.get_pending_discrepancies(
            facility, location
        )
        serializer = ControlledSubstanceDiscrepancyListSerializer(
            discrepancies, many=True
        )
        return Response(serializer.data)


# =============================================================================
# Analytics ViewSets (Phase 6)
# =============================================================================


class InventoryAnalyticsViewSet(viewsets.ViewSet):
    """
    API endpoint for inventory analytics.

    GET /analytics/consumption/ - Consumption analytics
    GET /analytics/abc-analysis/ - ABC classification
    GET /analytics/supplier-performance/ - Supplier metrics
    GET /analytics/expiry-forecast/ - Expiry forecasting
    GET /analytics/stock-valuation/ - Stock value report
    GET /analytics/controlled-substances/ - Controlled substance report
    GET /analytics/dashboard/ - Dashboard KPIs
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    @action(detail=False, methods=['get'])
    def consumption(self, request):
        """Get consumption analytics."""
        serializer = ConsumptionAnalyticsRequestSerializer(
            data=request.query_params
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        # Get optional filters
        item = None
        if data.get('item_id'):
            item = InventoryItem.objects.filter(
                id=data['item_id'], facility=facility
            ).first()

        location = None
        if data.get('location_id'):
            location = StorageLocation.objects.filter(
                id=data['location_id'], facility=facility
            ).first()

        result = InventoryAnalyticsService.get_consumption_analytics(
            facility=facility,
            start_date=data.get('start_date'),
            end_date=data.get('end_date'),
            item=item,
            location=location,
            category_id=data.get('category_id'),
            group_by=data.get('group_by', 'day'),
        )

        return Response(result)

    @action(detail=False, methods=['get'], url_path='abc-analysis')
    def abc_analysis(self, request):
        """Get ABC analysis."""
        serializer = ABCAnalysisRequestSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        result = InventoryAnalyticsService.get_abc_analysis(
            facility=facility,
            analysis_period_days=data.get('analysis_period_days', 365),
        )

        return Response(result)

    @action(detail=False, methods=['get'], url_path='supplier-performance')
    def supplier_performance(self, request):
        """Get supplier performance metrics."""
        serializer = SupplierPerformanceRequestSerializer(
            data=request.query_params
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        result = InventoryAnalyticsService.get_supplier_performance(
            facility=facility,
            start_date=data.get('start_date'),
            end_date=data.get('end_date'),
            supplier_id=data.get('supplier_id'),
        )

        return Response(result)

    @action(detail=False, methods=['get'], url_path='expiry-forecast')
    def expiry_forecast(self, request):
        """Get expiry forecast."""
        serializer = ExpiryForecastRequestSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        location = None
        if data.get('location_id'):
            location = StorageLocation.objects.filter(
                id=data['location_id'], facility=facility
            ).first()

        result = InventoryAnalyticsService.get_expiry_forecast(
            facility=facility,
            days_ahead=data.get('days_ahead', 90),
            location=location,
            category_id=data.get('category_id'),
        )

        return Response(result)

    @action(detail=False, methods=['get'], url_path='stock-valuation')
    def stock_valuation(self, request):
        """Get stock valuation report."""
        serializer = StockValuationRequestSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        location = None
        if data.get('location_id'):
            location = StorageLocation.objects.filter(
                id=data['location_id'], facility=facility
            ).first()

        result = InventoryAnalyticsService.get_stock_valuation(
            facility=facility,
            location=location,
            category_id=data.get('category_id'),
        )

        return Response(result)

    @action(detail=False, methods=['get'], url_path='controlled-substances')
    def controlled_substances(self, request):
        """Get controlled substance activity report."""
        serializer = ControlledSubstanceReportRequestSerializer(
            data=request.query_params
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        location = None
        if data.get('location_id'):
            location = StorageLocation.objects.filter(
                id=data['location_id'], facility=facility
            ).first()

        item = None
        if data.get('item_id'):
            item = InventoryItem.objects.filter(
                id=data['item_id'], facility=facility
            ).first()

        result = InventoryAnalyticsService.get_controlled_substance_report(
            facility=facility,
            start_date=data.get('start_date'),
            end_date=data.get('end_date'),
            location=location,
            item=item,
        )

        return Response(result)

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        """Get dashboard KPIs."""
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        result = InventoryAnalyticsService.get_inventory_dashboard_kpis(facility)
        return Response(result)
