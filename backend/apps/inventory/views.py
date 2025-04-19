from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from django.db.models import Sum, F, Q

from .models import (
    InventoryCategory, Supplier, InventoryItem, StockMovement,
    ExpiryTracker, InventoryAudit, InventoryAuditItem
)
from .serializers import (
    InventoryCategorySerializer, SupplierSerializer, InventoryItemSerializer,
    StockMovementSerializer, ExpiryTrackerSerializer, InventoryAuditSerializer,
    InventoryAuditItemSerializer, InventoryAuditCreateSerializer
)
from ..users.permissions import IsAdminOrOwner


class InventoryCategoryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for inventory categories.
    """
    queryset = InventoryCategory.objects.all()
    serializer_class = InventoryCategorySerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class SupplierViewSet(viewsets.ModelViewSet):
    """
    API endpoint for suppliers.
    """
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'contact_person', 'email', 'phone']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class InventoryItemViewSet(viewsets.ModelViewSet):
    """
    API endpoint for inventory items.
    """
    queryset = InventoryItem.objects.all()
    serializer_class = InventoryItemSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'sku', 'barcode', 'category__name', 'supplier__name']
    ordering_fields = ['name', 'current_stock', 'unit_cost', 'created_at']
    ordering = ['name']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
    
    @action(detail=False, methods=['get'])
    def low_stock(self, request):
        """
        Get items that are low on stock.
        """
        items = InventoryItem.objects.filter(current_stock__lte=F('reorder_level'))
        serializer = self.get_serializer(items, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def expiring_soon(self, request):
        """
        Get items that are expiring soon.
        """
        days = int(request.query_params.get('days', 30))
        expiry_date = timezone.now().date() + timezone.timedelta(days=days)
        
        # Get expiry trackers that are expiring soon
        trackers = ExpiryTracker.objects.filter(
            expiry_date__lte=expiry_date,
            expiry_date__gte=timezone.now().date(),
            status='active',
            remaining_quantity__gt=0
        )
        
        # Get unique items from these trackers
        item_ids = trackers.values_list('item_id', flat=True).distinct()
        items = InventoryItem.objects.filter(id__in=item_ids)
        
        serializer = self.get_serializer(items, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def movements(self, request, pk=None):
        """
        Get all stock movements for an item.
        """
        item = self.get_object()
        movements = item.movements.all()
        
        # Filter by date range if provided
        start_date = request.query_params.get('start_date', None)
        end_date = request.query_params.get('end_date', None)
        
        if start_date:
            movements = movements.filter(timestamp__gte=start_date)
        if end_date:
            movements = movements.filter(timestamp__lte=end_date)
        
        # Filter by movement type if provided
        movement_type = request.query_params.get('movement_type', None)
        if movement_type:
            movements = movements.filter(movement_type=movement_type)
        
        serializer = StockMovementSerializer(movements, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def expiry_trackers(self, request, pk=None):
        """
        Get all expiry trackers for an item.
        """
        item = self.get_object()
        trackers = item.expiry_trackers.all()
        
        # Filter by status if provided
        status_filter = request.query_params.get('status', None)
        if status_filter:
            trackers = trackers.filter(status=status_filter)
        
        serializer = ExpiryTrackerSerializer(trackers, many=True)
        return Response(serializer.data)


class StockMovementViewSet(viewsets.ModelViewSet):
    """
    API endpoint for stock movements.
    """
    queryset = StockMovement.objects.all()
    serializer_class = StockMovementSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['item__name', 'reference_number', 'batch_number', 'notes']
    ordering_fields = ['timestamp', 'item__name', 'quantity', 'unit_cost']
    ordering = ['-timestamp']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
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
        
        with transaction.atomic():
            for idx, movement_data in enumerate(movements_data):
                serializer = self.get_serializer(data=movement_data)
                if serializer.is_valid():
                    movement = serializer.save(created_by=request.user)
                    created_movements.append(movement)
                else:
                    errors.append({
                        "index": idx,
                        "errors": serializer.errors
                    })
            
            if errors:
                # Rollback transaction if there are any errors
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
    serializer_class = ExpiryTrackerSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['item__name', 'batch_number']
    ordering_fields = ['expiry_date', 'item__name', 'status']
    ordering = ['expiry_date']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
    
    @action(detail=False, methods=['get'])
    def expired(self, request):
        """
        Get expired items.
        """
        trackers = ExpiryTracker.objects.filter(
            expiry_date__lt=timezone.now().date(),
            status='active'
        )
        serializer = self.get_serializer(trackers, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def expiring_soon(self, request):
        """
        Get items expiring soon.
        """
        days = int(request.query_params.get('days', 30))
        expiry_date = timezone.now().date() + timezone.timedelta(days=days)
        
        trackers = ExpiryTracker.objects.filter(
            expiry_date__lte=expiry_date,
            expiry_date__gte=timezone.now().date(),
            status='active'
        )
        serializer = self.get_serializer(trackers, many=True)
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
        
        serializer = self.get_serializer(tracker)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def mark_as_disposed(self, request, pk=None):
        """
        Mark an expiry tracker as disposed and create a disposal stock movement.
        """
        tracker = self.get_object()
        
        if tracker.status != 'active' and tracker.status != 'expired':
            return Response(
                {"error": f"Cannot mark as disposed. Current status: {tracker.get_status_display()}"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        with transaction.atomic():
            # Create a disposal stock movement
            StockMovement.objects.create(
                item=tracker.item,
                movement_type='disposal',
                quantity=tracker.remaining_quantity,
                reference_number=f"Disposal of expired batch {tracker.batch_number}",
                batch_number=tracker.batch_number,
                expiry_date=tracker.expiry_date,
                unit_cost=tracker.movement.unit_cost,
                created_by=request.user
            )
            
            # Update the tracker
            tracker.status = 'disposed'
            tracker.remaining_quantity = 0
            tracker.updated_by = request.user
            tracker.save()
        
        serializer = self.get_serializer(tracker)
        return Response(serializer.data)


class InventoryAuditViewSet(viewsets.ModelViewSet):
    """
    API endpoint for inventory audits.
    """
    queryset = InventoryAudit.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['notes', 'status']
    ordering_fields = ['audit_date', 'status', 'created_at']
    ordering = ['-audit_date']
    
    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return InventoryAuditCreateSerializer
        return InventoryAuditSerializer
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
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
            # If requested, create stock adjustments for discrepancies
            if create_adjustments:
                for audit_item in audit.items.all():
                    if audit_item.discrepancy != 0:
                        # Create a stock adjustment
                        StockMovement.objects.create(
                            item=audit_item.item,
                            movement_type='adjustment',
                            quantity=abs(audit_item.discrepancy),
                            reference_number=f"Audit adjustment from audit {audit.id}",
                            notes=f"Stock adjustment from audit on {audit.audit_date}. {audit_item.notes or ''}",
                            unit_cost=audit_item.item.unit_cost,
                            new_stock=audit_item.actual_quantity,
                            created_by=request.user
                        )
            
            # Update audit status
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
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['item__name', 'notes']
    ordering_fields = ['item__name', 'expected_quantity', 'actual_quantity', 'discrepancy']
    ordering = ['item__name']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)