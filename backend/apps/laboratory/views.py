from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db.models import Q, Prefetch
import logging

from .models import (
    LabTestCatalog, LabPanel, LabOrder, LabOrderTest,
    LabSpecimen, LabResult, LabOrderStatus
)
from .serializers import (
    LabTestCatalogSerializer, LabTestCatalogCreateSerializer,
    LabPanelSerializer,
    LabOrderSerializer, LabOrderCreateSerializer,
    LabOrderSubmitSerializer, LabOrderCancelSerializer,
    LabOrderTestSerializer,
    LabSpecimenSerializer, LabSpecimenCollectionSerializer,
    LabSpecimenReceiptSerializer,
    LabResultSerializer, LabResultCreateSerializer,
    LabResultVerifySerializer,
    LabOrderSearchSerializer
)
from ..users.permissions import IsAdminOrDoctor, IsAdminOrNurse

logger = logging.getLogger(__name__)


class LabTestCatalogViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab test catalog.
    Read-only for most users, write access for admins.
    """
    queryset = LabTestCatalog.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return LabTestCatalogCreateSerializer
        return LabTestCatalogSerializer

    def get_queryset(self):
        """Filter tests by category and active status."""
        queryset = LabTestCatalog.objects.all()

        # Filter by category
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        # Search by name or code
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(short_name__icontains=search) |
                Q(code__icontains=search)
            )

        return queryset.order_by('category', 'short_name')

    def get_permissions(self):
        """Admin-only for create/update/delete."""
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]


class LabPanelViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab panels.
    Read-only for most users, write access for admins.
    """
    queryset = LabPanel.objects.prefetch_related('tests').all()
    serializer_class = LabPanelSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """Filter panels by active status."""
        queryset = LabPanel.objects.prefetch_related('tests').all()

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        # Search by name or code
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(code__icontains=search)
            )

        return queryset.order_by('name')

    def get_permissions(self):
        """Admin-only for create/update/delete."""
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]


class LabOrderViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab orders with lifecycle management.
    """
    queryset = LabOrder.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return LabOrderCreateSerializer
        elif self.action == 'submit':
            return LabOrderSubmitSerializer
        elif self.action == 'cancel':
            return LabOrderCancelSerializer
        return LabOrderSerializer

    def get_queryset(self):
        """
        Filter orders with optimized queries.
        """
        queryset = LabOrder.objects.select_related(
            'patient__user',
            'ordering_provider__staff__user',
            'encounter'
        ).prefetch_related(
            Prefetch('order_tests', queryset=LabOrderTest.objects.select_related('test')),
            'panels__tests',
            Prefetch('specimens', queryset=LabSpecimen.objects.select_related('collected_by__staff__user'))
        )

        # Filter by patient
        patient_id = self.request.query_params.get('patient')
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by priority
        priority = self.request.query_params.get('priority')
        if priority:
            queryset = queryset.filter(priority=priority)

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(created_at__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(created_at__lte=date_to)

        # Filter for pending results (ordered but not completed)
        pending_only = self.request.query_params.get('pending_only')
        if pending_only and pending_only.lower() == 'true':
            queryset = queryset.filter(
                status__in=[
                    LabOrderStatus.ORDERED,
                    LabOrderStatus.COLLECTED,
                    LabOrderStatus.RECEIVED,
                    LabOrderStatus.PROCESSING
                ]
            )

        return queryset.order_by('-created_at')

    @transaction.atomic
    def perform_create(self, serializer):
        """Create order with ordering provider set to current user."""
        # If ordering_provider not specified, use current user
        if not serializer.validated_data.get('ordering_provider'):
            try:
                practitioner = self.request.user.staff.practitioner_profile
                serializer.save(ordering_provider=practitioner)
            except AttributeError:
                # Current user is not a practitioner
                serializer.save()
        else:
            serializer.save()

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def submit(self, request, pk=None):
        """
        Submit order (transition from draft to ordered).
        Sets ordered_at timestamp.
        """
        order = self.get_object()

        if order.status != LabOrderStatus.DRAFT:
            return Response(
                {'error': f'Cannot submit order in {order.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate order has tests
        if not order.order_tests.exists():
            return Response(
                {'error': 'Order must have at least one test'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Update status
        order.status = LabOrderStatus.ORDERED
        order.ordered_at = timezone.now()
        order.save()

        # Update all order tests to ordered status
        order.order_tests.update(status=LabOrderStatus.ORDERED)

        logger.info(
            f"Lab order {order.order_number} submitted by {request.user.get_full_name()}"
        )

        serializer = self.get_serializer(order)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    @transaction.atomic
    def collect(self, request, pk=None):
        """
        Mark order as collected (specimen collected).
        Requires specimen to be created separately.
        """
        order = self.get_object()

        if order.status not in [LabOrderStatus.ORDERED]:
            return Response(
                {'error': f'Cannot collect specimens for order in {order.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if specimens exist
        if not order.specimens.exists():
            return Response(
                {'error': 'At least one specimen must be collected first'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Update status
        order.status = LabOrderStatus.COLLECTED
        order.collected_at = timezone.now()
        order.save()

        logger.info(
            f"Lab order {order.order_number} marked as collected"
        )

        serializer = self.get_serializer(order)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    @transaction.atomic
    def receive(self, request, pk=None):
        """
        Mark order as received in lab.
        """
        order = self.get_object()

        if order.status != LabOrderStatus.COLLECTED:
            return Response(
                {'error': f'Cannot receive order in {order.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Update status
        order.status = LabOrderStatus.RECEIVED
        order.received_at = timezone.now()
        order.save()

        # Update specimens to received
        order.specimens.filter(status='in_transit').update(
            status='received',
            received_at=timezone.now()
        )

        logger.info(
            f"Lab order {order.order_number} received in lab"
        )

        serializer = self.get_serializer(order)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    @transaction.atomic
    def start_processing(self, request, pk=None):
        """
        Mark order as processing.
        """
        order = self.get_object()

        if order.status != LabOrderStatus.RECEIVED:
            return Response(
                {'error': f'Cannot start processing order in {order.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Update status
        order.status = LabOrderStatus.PROCESSING
        order.save()

        logger.info(
            f"Lab order {order.order_number} started processing"
        )

        serializer = self.get_serializer(order)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    @transaction.atomic
    def complete(self, request, pk=None):
        """
        Mark order as completed.
        Requires all results to be verified.
        """
        order = self.get_object()

        if order.status != LabOrderStatus.PROCESSING:
            return Response(
                {'error': f'Cannot complete order in {order.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if all tests have verified results
        order_tests = order.order_tests.all()
        for ot in order_tests:
            if not hasattr(ot, 'result'):
                return Response(
                    {'error': f'Test {ot.test.short_name} does not have a result'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if not ot.result.is_verified:
                return Response(
                    {'error': f'Result for {ot.test.short_name} is not verified'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Update status
        order.status = LabOrderStatus.COMPLETED
        order.completed_at = timezone.now()
        order.save()

        # Update all order tests to completed
        order.order_tests.update(status=LabOrderStatus.COMPLETED)

        logger.info(
            f"Lab order {order.order_number} completed"
        )

        serializer = self.get_serializer(order)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def cancel(self, request, pk=None):
        """
        Cancel a lab order with reason.
        """
        order = self.get_object()

        if order.status in [LabOrderStatus.COMPLETED, LabOrderStatus.CANCELLED]:
            return Response(
                {'error': f'Cannot cancel order in {order.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate cancellation request
        cancel_serializer = LabOrderCancelSerializer(data=request.data)
        cancel_serializer.is_valid(raise_exception=True)

        # Update status
        order.status = LabOrderStatus.CANCELLED
        order.cancelled_at = timezone.now()
        order.cancellation_reason = cancel_serializer.validated_data['cancellation_reason']
        order.save()

        logger.info(
            f"Lab order {order.order_number} cancelled by {request.user.get_full_name()}. "
            f"Reason: {order.cancellation_reason}"
        )

        serializer = self.get_serializer(order)
        return Response(serializer.data)


class LabSpecimenViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab specimens.
    """
    queryset = LabSpecimen.objects.all()
    serializer_class = LabSpecimenSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return LabSpecimenCollectionSerializer
        elif self.action == 'receive':
            return LabSpecimenReceiptSerializer
        return LabSpecimenSerializer

    def get_queryset(self):
        """Filter specimens with optimized queries."""
        queryset = LabSpecimen.objects.select_related(
            'order__patient__user',
            'collected_by__staff__user',
            'received_by__staff__user'
        )

        # Filter by order
        order_id = self.request.query_params.get('order')
        if order_id:
            queryset = queryset.filter(order_id=order_id)

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by rejection status
        is_rejected = self.request.query_params.get('is_rejected')
        if is_rejected is not None:
            queryset = queryset.filter(is_rejected=is_rejected.lower() == 'true')

        return queryset.order_by('-collected_at')

    @transaction.atomic
    def perform_create(self, serializer):
        """
        Create specimen and set collected_by to current user.
        Auto-generate barcode if not provided.
        """
        # Generate barcode if not provided
        if not serializer.validated_data.get('barcode'):
            # Simple barcode generation: SPEC-YYYYMMDD-UUID
            from uuid import uuid4
            today = timezone.now().strftime('%Y%m%d')
            barcode = f"SPEC-{today}-{str(uuid4())[:8].upper()}"
            serializer.validated_data['barcode'] = barcode

        # Set collected_by if not specified
        if not serializer.validated_data.get('collected_by'):
            try:
                practitioner = self.request.user.staff.practitioner_profile
                serializer.save(collected_by=practitioner)
            except AttributeError:
                serializer.save()
        else:
            serializer.save()

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    @transaction.atomic
    def receive(self, request, pk=None):
        """
        Receive specimen in lab with optional rejection.
        """
        specimen = self.get_object()

        if specimen.status not in ['collected', 'in_transit']:
            return Response(
                {'error': f'Cannot receive specimen in {specimen.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate receipt data
        receipt_serializer = LabSpecimenReceiptSerializer(data=request.data)
        receipt_serializer.is_valid(raise_exception=True)

        # Get practitioner profile
        try:
            practitioner = request.user.staff.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only lab staff can receive specimens'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Update specimen
        specimen.status = 'rejected' if receipt_serializer.validated_data.get('is_rejected') else 'received'
        specimen.is_rejected = receipt_serializer.validated_data.get('is_rejected', False)
        specimen.rejection_reason = receipt_serializer.validated_data.get('rejection_reason', '')
        specimen.storage_location = receipt_serializer.validated_data.get('storage_location', '')
        specimen.received_by = practitioner
        specimen.received_at = timezone.now()
        specimen.save()

        logger.info(
            f"Specimen {specimen.barcode} {'rejected' if specimen.is_rejected else 'received'} "
            f"by {request.user.get_full_name()}"
        )

        serializer = self.get_serializer(specimen)
        return Response(serializer.data)


class LabResultViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab results.
    """
    queryset = LabResult.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return LabResultCreateSerializer
        elif self.action == 'verify':
            return LabResultVerifySerializer
        return LabResultSerializer

    def get_queryset(self):
        """Filter results with optimized queries."""
        queryset = LabResult.objects.select_related(
            'order_test__test',
            'order_test__order__patient__user',
            'specimen',
            'performed_by__staff__user',
            'verified_by__staff__user'
        )

        # Filter by order
        order_id = self.request.query_params.get('order')
        if order_id:
            queryset = queryset.filter(order_test__order_id=order_id)

        # Filter by patient
        patient_id = self.request.query_params.get('patient')
        if patient_id:
            queryset = queryset.filter(order_test__order__patient_id=patient_id)

        # Filter by verification status
        is_verified = self.request.query_params.get('is_verified')
        if is_verified is not None:
            queryset = queryset.filter(is_verified=is_verified.lower() == 'true')

        # Filter by flag (critical results)
        flag = self.request.query_params.get('flag')
        if flag:
            queryset = queryset.filter(flag=flag)

        # Filter for critical results
        critical_only = self.request.query_params.get('critical_only')
        if critical_only and critical_only.lower() == 'true':
            queryset = queryset.filter(flag__in=['critical_low', 'critical_high'])

        return queryset.order_by('-performed_at')

    @transaction.atomic
    def perform_create(self, serializer):
        """Create result and set performed_by to current user."""
        try:
            practitioner = self.request.user.staff.practitioner_profile
            serializer.save(performed_by=practitioner)
        except AttributeError:
            serializer.save()

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def verify(self, request, pk=None):
        """
        Verify a lab result (supervisor/pathologist only).
        """
        result = self.get_object()

        if result.is_verified:
            return Response(
                {'error': 'Result is already verified'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get practitioner profile
        try:
            practitioner = request.user.staff.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners can verify results'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Validate verification data
        verify_serializer = LabResultVerifySerializer(data=request.data)
        verify_serializer.is_valid(raise_exception=True)

        # Update result
        result.is_verified = True
        result.verified_by = practitioner
        result.verified_at = timezone.now()
        result.save()

        logger.info(
            f"Lab result for {result.order_test.test.short_name} verified by {request.user.get_full_name()}"
        )

        serializer = self.get_serializer(result)
        return Response(serializer.data)
