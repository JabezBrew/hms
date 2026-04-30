from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db.models import Q, Prefetch, Count, Exists, OuterRef
import logging

from ..core.pagination import StandardResultsSetPagination

from .models import (
    LabTestCatalog, LabPanel, LabOrder, LabOrderTest,
    LabSpecimen, LabResult, LabOrderStatus
)
from .serializers import (
    LabTestCatalogSerializer, LabTestCatalogCreateSerializer,
    LabTestCatalogListSerializer, LabTestFacilityCustomizeSerializer,
    LabTestResetSerializer,
    LabPanelSerializer, LabPanelListSerializer,
    LabPanelFacilityCustomizeSerializer,
    LabOrderSerializer, LabOrderCreateSerializer,
    LabOrderSubmitSerializer, LabOrderCancelSerializer,
    LabOrderListSerializer,
    LabOrderTestSerializer,
    LabSpecimenSerializer, LabSpecimenCollectionSerializer,
    LabSpecimenReceiptSerializer, LabSpecimenListSerializer,
    LabResultSerializer, LabResultCreateSerializer,
    LabResultVerifySerializer, LabResultListSerializer,
    BulkLabResultCreateSerializer,
    LabOrderSearchSerializer
)
from ..users.permissions import IsAdminOrDoctor, IsAdminOrNurse
from ..users.rbac import IsAdmin, IsLabTechnician
from ..users.models import PatientProfile
from ..core.security import (
    FacilityScopedPermission,
    FeatureRequiredPermission,
    check_lab_access,
    get_accessible_patients_for_clinician,
    get_user_facility,
)
from ..audit.services import AuditService
from ..audit.models import AuditCategory, AuditAction

logger = logging.getLogger(__name__)

LAB_RESULT_SELF_VERIFICATION_ERROR = (
    'Results must be verified by a different staff member.'
)

LAB_TECH_VISIBLE_ORDER_STATUSES = [
    LabOrderStatus.ORDERED,
    LabOrderStatus.COLLECTED,
    LabOrderStatus.RECEIVED,
    LabOrderStatus.PROCESSING,
    LabOrderStatus.COMPLETED,
]


def _feature_permissions(*permission_classes):
    return [
        permission()
        for permission in (FeatureRequiredPermission, *permission_classes)
    ]


def _build_name_search_query(first_name_lookup, last_name_lookup, raw_search):
    """Build a simple full-name-aware search query."""
    search = (raw_search or '').strip()
    if not search:
        return Q()

    parts = [part for part in search.split() if part]
    query = (
        Q(**{f'{first_name_lookup}__icontains': search})
        | Q(**{f'{last_name_lookup}__icontains': search})
    )

    if len(parts) >= 2:
        query |= Q(
            **{
                f'{first_name_lookup}__icontains': parts[0],
                f'{last_name_lookup}__icontains': ' '.join(parts[1:]),
            }
        )
        query |= Q(
            **{
                f'{first_name_lookup}__icontains': parts[-1],
                f'{last_name_lookup}__icontains': ' '.join(parts[:-1]),
            }
        )

    return query


def _scope_lab_queryset_for_user(queryset, *, user, patient_lookup, order_status_lookup=None):
    """Apply lab-domain authorization at the queryset level."""
    user_type = getattr(user, 'user_type', None)

    if user_type == 'admin':
        return queryset

    if user_type == 'patient':
        return queryset.filter(**{f'{patient_lookup}__user': user})

    if user_type in ['doctor', 'nurse']:
        if not getattr(settings, 'TEAM_ACCESS_STRICT', False):
            return queryset
        accessible_patients = get_accessible_patients_for_clinician(user, scope='clinical')
        return queryset.filter(**{f'{patient_lookup}__in': accessible_patients})

    if user_type == 'lab_technician':
        if order_status_lookup:
            return queryset.filter(**{f'{order_status_lookup}__in': LAB_TECH_VISIBLE_ORDER_STATUSES})
        return queryset

    return queryset.none()


def _lab_result_performed_by_staff_filter(staff, user):
    return Q(performed_by_id=staff.id) | Q(performed_by__user_id=user.id)


class LabTestCatalogViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab test catalog.
    Read-only for most users, write access for admins.

    Supports facility customization:
    - POST /tests/{id}/customize/ - Customize price, reference ranges, TAT
    - POST /tests/{id}/reset_to_defaults/ - Reset to system defaults
    - DELETE /tests/{id}/ - Only allowed for custom (non-system) tests
    """
    queryset = LabTestCatalog.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return LabTestCatalogCreateSerializer
        elif self.action == 'list':
            return LabTestCatalogListSerializer
        elif self.action == 'customize':
            return LabTestFacilityCustomizeSerializer
        elif self.action == 'reset_to_defaults':
            return LabTestResetSerializer
        return LabTestCatalogSerializer

    def get_queryset(self):
        """Filter tests by category, active status, and customization flags."""
        facility = get_user_facility(self.request)
        if not facility:
            return LabTestCatalog.objects.none()
        queryset = LabTestCatalog.objects.filter(facility=facility)

        # Filter by category
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        # Filter by system default status
        is_system = self.request.query_params.get('is_system_default')
        if is_system is not None:
            queryset = queryset.filter(is_system_default=is_system.lower() == 'true')

        # Filter by facility modified status
        is_modified = self.request.query_params.get('is_facility_modified')
        if is_modified is not None:
            queryset = queryset.filter(is_facility_modified=is_modified.lower() == 'true')

        # Full-text search across all relevant fields
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(short_name__icontains=search) |
                Q(code__icontains=search) |
                Q(loinc_code__icontains=search) |
                Q(description__icontains=search) |
                Q(category__icontains=search) |
                Q(specimen_type__icontains=search)
            )

        return queryset.order_by('category', 'short_name')

    def get_permissions(self):
        """Admin-only for create/update/delete/customize."""
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'customize', 'reset_to_defaults']:
            return _feature_permissions(
                permissions.IsAuthenticated,
                permissions.IsAdminUser,
                FacilityScopedPermission,
            )
        return _feature_permissions(permissions.IsAuthenticated, FacilityScopedPermission)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(facility=facility)

    def destroy(self, request, *args, **kwargs):
        """Only allow deletion of custom (non-system) tests."""
        instance = self.get_object()
        if instance.is_system_default:
            return Response(
                {'error': 'Cannot delete system tests. Use is_active=False to disable instead.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def customize(self, request, pk=None):
        """
        Customize a test's facility-specific values (price, reference_ranges, tat_hours).
        Marks the test as facility-modified if it's a system default.

        POST /api/laboratory/tests/{id}/customize/
        {
            "price": 25.00,
            "reference_ranges": {"adult": {"low": 4.0, "high": 10.0, "unit": "K/uL"}},
            "tat_hours": 4,
            "is_active": true
        }
        """
        test = self.get_object()
        serializer = LabTestFacilityCustomizeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data

        # Update the customizable fields
        if 'price' in data:
            test.price = data['price']
        if 'reference_ranges' in data:
            test.reference_ranges = data['reference_ranges']
        if 'tat_hours' in data:
            test.tat_hours = data['tat_hours']
        if 'is_active' in data:
            test.is_active = data['is_active']

        # Mark as facility-modified if it's a system test
        if test.is_system_default:
            test.is_facility_modified = True

        test.save()

        return Response(
            LabTestCatalogSerializer(test).data,
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['post'])
    def reset_to_defaults(self, request, pk=None):
        """
        Reset a test to its system default values.
        Only works for system tests that have been facility-modified.

        POST /api/laboratory/tests/{id}/reset_to_defaults/
        {"confirm": true}
        """
        test = self.get_object()
        serializer = LabTestResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if not test.is_system_default:
            return Response(
                {'error': 'Cannot reset custom tests. Only system tests can be reset.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not test.is_facility_modified:
            return Response(
                {'error': 'Test has not been modified. Nothing to reset.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if test.reset_to_system_defaults():
            return Response(
                LabTestCatalogSerializer(test).data,
                status=status.HTTP_200_OK
            )
        else:
            return Response(
                {'error': 'Failed to reset test. System defaults may be missing.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class LabPanelViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab panels.
    Read-only for most users, write access for admins.

    Supports facility customization:
    - POST /panels/{id}/customize/ - Customize price
    - POST /panels/{id}/reset_to_defaults/ - Reset to system defaults
    - DELETE /panels/{id}/ - Only allowed for custom (non-system) panels
    """
    queryset = LabPanel.objects.prefetch_related('tests').all()
    serializer_class = LabPanelSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return LabPanelListSerializer
        elif self.action == 'customize':
            return LabPanelFacilityCustomizeSerializer
        elif self.action == 'reset_to_defaults':
            return LabTestResetSerializer  # Same serializer works
        return LabPanelSerializer

    def get_queryset(self):
        """Filter panels by active status and customization flags."""
        facility = get_user_facility(self.request)
        if not facility:
            return LabPanel.objects.none()
        queryset = LabPanel.objects.prefetch_related('tests').filter(facility=facility)

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        # Filter by system default status
        is_system = self.request.query_params.get('is_system_default')
        if is_system is not None:
            queryset = queryset.filter(is_system_default=is_system.lower() == 'true')

        # Filter by facility modified status
        is_modified = self.request.query_params.get('is_facility_modified')
        if is_modified is not None:
            queryset = queryset.filter(is_facility_modified=is_modified.lower() == 'true')

        # Full-text search across all relevant fields
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(code__icontains=search) |
                Q(description__icontains=search)
            )

        return queryset.order_by('name')

    def get_permissions(self):
        """Admin-only for create/update/delete/customize."""
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'customize', 'reset_to_defaults']:
            return _feature_permissions(
                permissions.IsAuthenticated,
                permissions.IsAdminUser,
                FacilityScopedPermission,
            )
        return _feature_permissions(permissions.IsAuthenticated, FacilityScopedPermission)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(facility=facility)

    def destroy(self, request, *args, **kwargs):
        """Only allow deletion of custom (non-system) panels."""
        instance = self.get_object()
        if instance.is_system_default:
            return Response(
                {'error': 'Cannot delete system panels. Use is_active=False to disable instead.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def customize(self, request, pk=None):
        """
        Customize a panel's facility-specific values (price).
        Marks the panel as facility-modified if it's a system default.

        POST /api/laboratory/panels/{id}/customize/
        {
            "price": 95.00,
            "is_active": true
        }
        """
        panel = self.get_object()
        serializer = LabPanelFacilityCustomizeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data

        if 'price' in data:
            panel.price = data['price']
        if 'is_active' in data:
            panel.is_active = data['is_active']

        # Mark as facility-modified if it's a system panel
        if panel.is_system_default:
            panel.is_facility_modified = True

        panel.save()

        return Response(
            LabPanelSerializer(panel).data,
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['post'])
    def reset_to_defaults(self, request, pk=None):
        """
        Reset a panel to its system default values.
        Only works for system panels that have been facility-modified.

        POST /api/laboratory/panels/{id}/reset_to_defaults/
        {"confirm": true}
        """
        panel = self.get_object()
        serializer = LabTestResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if not panel.is_system_default:
            return Response(
                {'error': 'Cannot reset custom panels. Only system panels can be reset.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not panel.is_facility_modified:
            return Response(
                {'error': 'Panel has not been modified. Nothing to reset.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if panel.reset_to_system_defaults():
            return Response(
                LabPanelSerializer(panel).data,
                status=status.HTTP_200_OK
            )
        else:
            return Response(
                {'error': 'Failed to reset panel. System defaults may be missing.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class LabOrderViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab orders with lifecycle management.
    """
    queryset = LabOrder.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return LabOrderCreateSerializer
        elif self.action == 'submit':
            return LabOrderSubmitSerializer
        elif self.action == 'cancel':
            return LabOrderCancelSerializer
        elif self.action == 'list':
            return LabOrderListSerializer
        return LabOrderSerializer

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'submit', 'cancel']:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrDoctor]
        elif self.action in ['collect', 'receive', 'start_processing', 'complete']:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin | IsLabTechnician]
        else:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
        return _feature_permissions(*permission_classes)

    def get_serializer_context(self):
        """
        Add expand flags to serializer context based on query parameters.
        Supports:
        - expand=tests - Include full order_tests and panels
        - expand=specimens - Include full specimens
        - expand=all - Include everything
        """
        context = super().get_serializer_context()
        expand = self.request.query_params.get('expand', '')
        expand_list = [e.strip() for e in expand.split(',')]

        if 'tests' in expand_list or 'all' in expand_list:
            context['expand_tests'] = True
        if 'specimens' in expand_list or 'all' in expand_list:
            context['expand_specimens'] = True

        return context

    def get_queryset(self):
        """
        Filter orders with optimized queries.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return LabOrder.objects.none()

        queryset = LabOrder.objects.select_related(
            'patient__user',
            'ordering_provider__staff__user',
            'encounter'
        ).filter(facility=facility)

        expand = self.request.query_params.get('expand', '')
        expand_list = [e.strip() for e in expand.split(',') if e.strip()]
        expand_tests = 'tests' in expand_list or 'all' in expand_list
        expand_specimens = 'specimens' in expand_list or 'all' in expand_list

        if self.action != 'list' or expand_tests or expand_specimens:
            queryset = queryset.prefetch_related(
                Prefetch('order_tests', queryset=LabOrderTest.objects.select_related('test')),
                'panels__tests',
                Prefetch('specimens', queryset=LabSpecimen.objects.select_related('collected_by__user'))
            )

        if self.action == 'list':
            critical_tests = LabOrderTest.objects.filter(
                order_id=OuterRef('pk'),
                result__flag__in=['critical_low', 'critical_high']
            )
            queryset = queryset.annotate(
                test_count=Count('order_tests', distinct=True),
                has_critical_results=Exists(critical_tests)
            )

        queryset = _scope_lab_queryset_for_user(
            queryset,
            user=self.request.user,
            patient_lookup='patient',
            order_status_lookup='status',
        )

        # Filter by patient
        patient_id = self.request.query_params.get('patient')
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return queryset.none()
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_lab_access(self.request.user, patient)
            queryset = queryset.filter(patient=patient)

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

        # Filter by specific ordering provider (practitioner ID)
        ordering_provider = self.request.query_params.get('ordering_provider')
        if ordering_provider:
            queryset = queryset.filter(ordering_provider_id=ordering_provider)

        # Filter for current user's orders only (for doctors viewing their own orders)
        my_orders = self.request.query_params.get('my_orders')
        if my_orders and my_orders.lower() == 'true':
            try:
                practitioner = self.request.user.staff_profile.practitioner_profile
                queryset = queryset.filter(ordering_provider=practitioner)
            except AttributeError:
                # User is not a practitioner, return empty queryset
                queryset = queryset.none()

        search = (self.request.query_params.get('search') or '').strip()
        if search:
            normalized_search = search.lstrip('#')
            queryset = queryset.filter(
                Q(order_number__icontains=normalized_search)
                | Q(patient__medical_record_number__icontains=normalized_search)
                | _build_name_search_query(
                    'patient__user__first_name',
                    'patient__user__last_name',
                    normalized_search,
                )
            )

        return queryset.order_by('-created_at')

    def get_object(self):
        order = super().get_object()
        check_lab_access(self.request.user, order.patient)
        return order

    @transaction.atomic
    def perform_create(self, serializer):
        """Create order with ordering provider set to current user."""
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_lab_access(self.request.user, patient)

        # If ordering_provider not specified, use current user
        if not serializer.validated_data.get('ordering_provider'):
            try:
                practitioner = self.request.user.staff_profile.practitioner_profile
                if practitioner and practitioner.staff.primary_facility_id != facility.id:
                    raise PermissionDenied("Ordering provider does not belong to the active facility.")
                serializer.save(ordering_provider=practitioner, facility=facility)
            except AttributeError:
                # Current user is not a practitioner
                serializer.save(facility=facility)
        else:
            ordering_provider = serializer.validated_data.get('ordering_provider')
            if ordering_provider and ordering_provider.staff.primary_facility_id != facility.id:
                raise PermissionDenied("Ordering provider does not belong to the active facility.")
            serializer.save(facility=facility)

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

        # Audit log - lab order submitted
        AuditService.log(
            request=request,
            action=AuditAction.LAB_ORDER_SUBMIT,
            category=AuditCategory.LABORATORY,
            resource_type='LabOrder',
            resource_id=order.id,
            resource_name=f"Lab Order {order.order_number}",
            description=f"Lab order {order.order_number} submitted with {order.order_tests.count()} tests",
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

        # Audit log - lab order completed
        AuditService.log(
            request=request,
            action=AuditAction.LAB_ORDER_COMPLETE,
            category=AuditCategory.LABORATORY,
            resource_type='LabOrder',
            resource_id=order.id,
            resource_name=f"Lab Order {order.order_number}",
            description=f"Lab order {order.order_number} completed with all results verified",
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

        # Audit log - lab order cancelled
        AuditService.log(
            request=request,
            action=AuditAction.LAB_ORDER_CANCEL,
            category=AuditCategory.LABORATORY,
            resource_type='LabOrder',
            resource_id=order.id,
            resource_name=f"Lab Order {order.order_number}",
            description=f"Lab order {order.order_number} cancelled. Reason: {order.cancellation_reason}",
        )

        serializer = self.get_serializer(order)
        return Response(serializer.data)


class LabSpecimenViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab specimens.
    """
    queryset = LabSpecimen.objects.all()
    serializer_class = LabSpecimenSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return LabSpecimenCollectionSerializer
        elif self.action == 'receive':
            return LabSpecimenReceiptSerializer
        elif self.action == 'list':
            return LabSpecimenListSerializer
        return LabSpecimenSerializer

    def get_permissions(self):
        if self.action == 'create':
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrNurse | IsLabTechnician]
        elif self.action in ['receive', 'update', 'partial_update', 'destroy']:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin | IsLabTechnician]
        else:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
        return _feature_permissions(*permission_classes)

    def get_queryset(self):
        """Filter specimens with optimized queries."""
        facility = get_user_facility(self.request)
        if not facility:
            return LabSpecimen.objects.none()

        queryset = LabSpecimen.objects.select_related(
            'order__patient__user',
            'collected_by__user',
            'received_by__user'
        ).filter(facility=facility)

        queryset = _scope_lab_queryset_for_user(
            queryset,
            user=self.request.user,
            patient_lookup='order__patient',
            order_status_lookup='order__status',
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

    def get_object(self):
        specimen = super().get_object()
        check_lab_access(self.request.user, specimen.order.patient)
        return specimen

    @transaction.atomic
    def perform_create(self, serializer):
        """
        Create specimen and set collected_by to current user.
        Auto-generate barcode if not provided.
        """
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        order = serializer.validated_data.get('order')
        if order and order.patient and order.patient.facility_id != facility.id:
            raise PermissionDenied("Order does not belong to the active facility.")
        if order and order.patient:
            check_lab_access(self.request.user, order.patient)
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
                staff = self.request.user.staff_profile
                specimen = serializer.save(collected_by=staff, facility=facility)
            except AttributeError:
                specimen = serializer.save(facility=facility)
        else:
            specimen = serializer.save(facility=facility)

        # Audit log - specimen collected
        AuditService.log(
            request=self.request,
            action=AuditAction.LAB_SPECIMEN_COLLECT,
            category=AuditCategory.LABORATORY,
            resource_type='LabSpecimen',
            resource_id=specimen.id,
            resource_name=f"Specimen {specimen.barcode}",
            description=f"Specimen {specimen.barcode} collected for order {specimen.order.order_number}",
        )

        logger.info(
            f"Specimen {specimen.barcode} collected by {self.request.user.get_full_name()}"
        )

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

        # Get staff profile
        try:
            staff = request.user.staff_profile
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
        specimen.received_by = staff
        specimen.received_at = timezone.now()
        specimen.save()

        logger.info(
            f"Specimen {specimen.barcode} {'rejected' if specimen.is_rejected else 'received'} "
            f"by {request.user.get_full_name()}"
        )

        # Audit log - specimen received/rejected
        AuditService.log(
            request=request,
            action=AuditAction.LAB_SPECIMEN_RECEIVE,
            category=AuditCategory.LABORATORY,
            resource_type='LabSpecimen',
            resource_id=specimen.id,
            resource_name=f"Specimen {specimen.barcode}",
            description=f"Specimen {specimen.barcode} {'rejected' if specimen.is_rejected else 'received'}"
                       + (f". Reason: {specimen.rejection_reason}" if specimen.is_rejected else ""),
        )

        serializer = self.get_serializer(specimen)
        return Response(serializer.data)


class LabResultViewSet(viewsets.ModelViewSet):
    """
    API endpoint for lab results.
    """
    queryset = LabResult.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return LabResultCreateSerializer
        elif self.action == 'verify':
            return LabResultVerifySerializer
        elif self.action == 'list':
            return LabResultListSerializer
        return LabResultSerializer

    def get_permissions(self):
        if self.action in ['create', 'bulk_create', 'update', 'partial_update', 'destroy']:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin | IsLabTechnician]
        elif self.action in ['verify', 'bulk_verify']:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrDoctor | IsLabTechnician]
        else:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
        return _feature_permissions(*permission_classes)

    def get_queryset(self):
        """Filter results with optimized queries."""
        facility = get_user_facility(self.request)
        if not facility:
            return LabResult.objects.none()

        queryset = LabResult.objects.select_related(
            'order_test__test',
            'order_test__order__patient__user',
            'order_test__order__ordering_provider',
            'specimen',
            'performed_by__user',
            'verified_by__user'
        ).prefetch_related(
            'order_test__order__panels'  # M2M field
        ).filter(facility=facility)

        queryset = _scope_lab_queryset_for_user(
            queryset,
            user=self.request.user,
            patient_lookup='order_test__order__patient',
            order_status_lookup='order_test__order__status',
        )

        # Filter by order
        order_id = self.request.query_params.get('order')
        if order_id:
            queryset = queryset.filter(order_test__order_id=order_id)

        # Filter by patient
        patient_id = self.request.query_params.get('patient')
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return queryset.none()
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_lab_access(self.request.user, patient)
            queryset = queryset.filter(order_test__order__patient=patient)

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

        search = (self.request.query_params.get('search') or '').strip()
        if search:
            normalized_search = search.lstrip('#')
            queryset = queryset.filter(
                Q(order_test__order__order_number__icontains=normalized_search)
                | Q(order_test__order__patient__medical_record_number__icontains=normalized_search)
                | Q(order_test__test__short_name__icontains=normalized_search)
                | Q(order_test__test__name__icontains=normalized_search)
                | Q(order_test__test__code__icontains=normalized_search)
                | _build_name_search_query(
                    'order_test__order__patient__user__first_name',
                    'order_test__order__patient__user__last_name',
                    normalized_search,
                )
            )

        return queryset.order_by('-performed_at')

    def get_object(self):
        result = super().get_object()
        check_lab_access(self.request.user, result.order_test.order.patient)
        return result

    def _get_locked_result_for_verification(self, pk):
        queryset = (
            self.filter_queryset(self.get_queryset())
            .select_related(None)
            .prefetch_related(None)
            .select_for_update()
        )
        result = get_object_or_404(queryset, pk=pk)
        self.check_object_permissions(self.request, result)
        check_lab_access(self.request.user, result.order_test.order.patient)
        return result

    def _get_verifying_staff(self, user):
        try:
            return user.staff_profile
        except AttributeError:
            return None

    def _result_was_performed_by_verifier(self, result, staff, user):
        if result.performed_by_id == staff.id:
            return True
        performed_by = getattr(result, 'performed_by', None)
        return bool(performed_by and performed_by.user_id == user.id)

    @transaction.atomic
    def perform_create(self, serializer):
        """Create result and set performed_by to current user."""
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        order_test = serializer.validated_data.get('order_test')
        order = getattr(order_test, 'order', None)
        if order and order.patient and order.patient.facility_id != facility.id:
            raise PermissionDenied("Order does not belong to the active facility.")
        if order and order.patient:
            check_lab_access(self.request.user, order.patient)
        try:
            staff = self.request.user.staff_profile
            serializer.save(performed_by=staff, facility=facility)
        except AttributeError:
            serializer.save(facility=facility)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor | IsLabTechnician])
    @transaction.atomic
    def verify(self, request, pk=None):
        """
        Verify a lab result (lab technicians, doctors, or admins).
        """
        result = self._get_locked_result_for_verification(pk)

        if result.is_verified:
            return Response(
                {'error': 'Result is already verified'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get staff profile (lab technicians can verify results)
        staff = self._get_verifying_staff(request.user)
        if not staff:
            return Response(
                {'error': 'Only lab staff can verify results'},
                status=status.HTTP_403_FORBIDDEN
            )

        if self._result_was_performed_by_verifier(result, staff, request.user):
            return Response(
                {'error': LAB_RESULT_SELF_VERIFICATION_ERROR},
                status=status.HTTP_403_FORBIDDEN
            )

        # Validate verification data
        verify_serializer = LabResultVerifySerializer(data=request.data)
        verify_serializer.is_valid(raise_exception=True)

        # Update result
        result.is_verified = True
        result.verified_by = staff
        now = timezone.now()
        result.verified_at = now
        result.save()

        logger.info(
            f"Lab result for {result.order_test.test.short_name} verified by {request.user.get_full_name()}"
        )

        # Check if all results for the order are now verified - if so, mark order as completed
        order = result.order_test.order
        all_results = LabResult.objects.filter(order_test__order=order)
        unverified_count = all_results.filter(is_verified=False).count()

        if unverified_count == 0 and all_results.exists():
            # All results verified - mark order as completed
            order.status = LabOrderStatus.COMPLETED
            order.completed_at = now
            order.save(update_fields=['status', 'completed_at'])
            logger.info(
                f"Order {order.order_number} marked as completed - all results verified"
            )

        # Audit log - lab result verified
        AuditService.log(
            request=request,
            action=AuditAction.LAB_RESULT_VERIFY,
            category=AuditCategory.LABORATORY,
            resource_type='LabResult',
            resource_id=result.id,
            resource_name=f"Result for {result.order_test.test.short_name}",
            description=f"Lab result for {result.order_test.test.short_name} verified. Value: {result.value} {result.unit or ''}",
        )

        serializer = self.get_serializer(result)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='bulk')
    @transaction.atomic
    def bulk_create(self, request):
        """
        Create multiple lab results in a single request.

        Payload:
        {
            "order_id": "uuid",
            "specimen_id": "uuid",
            "performed_at": "2024-01-15T10:30:00Z",  # optional
            "results": [
                {
                    "order_test_id": "uuid",
                    "value": "7.5",
                    "unit": "K/uL",
                    "reference_low": 4.5,
                    "reference_high": 11.0,
                    "flag": "normal",
                    "interpretation": ""  # optional
                },
                ...
            ]
        }
        """
        serializer = BulkLabResultCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_data = serializer.validated_data
        order = validated_data['_order']
        specimen = validated_data['_specimen']
        performed_at = validated_data.get('performed_at', timezone.now())

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if order.facility_id != facility.id or specimen.facility_id != facility.id:
            raise PermissionDenied("Lab data does not belong to the active facility.")
        check_lab_access(request.user, order.patient)

        # Get staff profile for performed_by
        staff = None
        try:
            staff = request.user.staff_profile
        except AttributeError:
            pass

        # Create all results
        created_results = []
        for result_item in validated_data['results']:
            order_test = LabOrderTest.objects.get(id=result_item['order_test_id'])

            result = LabResult.objects.create(
                order_test=order_test,
                specimen=specimen,
                value=result_item['value'],
                unit=result_item.get('unit', order_test.test.unit or ''),
                reference_low=result_item.get('reference_low'),
                reference_high=result_item.get('reference_high'),
                flag=result_item.get('flag', 'normal'),
                interpretation=result_item.get('interpretation', ''),
                performed_by=staff,
                performed_at=performed_at
            )
            created_results.append(result)

            # Update order_test status
            order_test.status = LabOrderStatus.COMPLETED
            order_test.save(update_fields=['status'])

        # Update order status to processing if not already
        if order.status == LabOrderStatus.RECEIVED:
            order.status = LabOrderStatus.PROCESSING
            order.save(update_fields=['status'])

        # Check if all tests have results - if so, mark order as completed
        all_tests_count = order.order_tests.count()
        results_count = LabResult.objects.filter(order_test__order=order).count()

        if results_count >= all_tests_count:
            # All results entered - mark order as completed
            order.status = LabOrderStatus.COMPLETED
            order.completed_at = timezone.now()
            order.save(update_fields=['status', 'completed_at'])
            logger.info(
                f"All {results_count} results entered for order {order.order_number}. "
                f"Order auto-completed."
            )

        logger.info(
            f"Bulk created {len(created_results)} lab results for order {order.order_number} "
            f"by {request.user.get_full_name()}"
        )

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.CREATE,
            category=AuditCategory.LABORATORY,
            resource_type='LabResult',
            resource_id=order.id,
            resource_name=f"Bulk results for {order.order_number}",
            description=f"Recorded {len(created_results)} lab results for order {order.order_number}",
        )

        # Return created results
        result_serializer = LabResultSerializer(created_results, many=True)
        return Response({
            'created_count': len(created_results),
            'results': result_serializer.data
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='bulk-verify', permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor | IsLabTechnician])
    @transaction.atomic
    def bulk_verify(self, request):
        """
        Verify multiple lab results in a single request.

        Payload:
        {
            "result_ids": ["uuid1", "uuid2", ...],
            "verification_notes": "Optional notes"  # optional
        }

        Can also verify by order:
        {
            "order_id": "uuid",
            "verification_notes": "Optional notes"
        }
        """
        result_ids = request.data.get('result_ids', [])
        order_id = request.data.get('order_id')
        verification_notes = request.data.get('verification_notes', '')

        # Get staff profile (lab technicians can verify results)
        staff = self._get_verifying_staff(request.user)
        if not staff:
            return Response(
                {'error': 'Only lab staff can verify lab results'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Get results to verify
        queryset = self.get_queryset()
        if order_id:
            # Verify all unverified results for an order
            results = queryset.filter(
                order_test__order_id=order_id,
                is_verified=False
            )
        elif result_ids:
            # Verify specific results
            results = queryset.filter(
                id__in=result_ids,
                is_verified=False
            )
        else:
            return Response(
                {'error': 'Provide either result_ids or order_id'},
                status=status.HTTP_400_BAD_REQUEST
            )

        result_ids_to_verify = list(
            results
            .select_related(None)
            .prefetch_related(None)
            .select_for_update()
            .values_list('id', flat=True)
        )

        if not result_ids_to_verify:
            return Response(
                {'error': 'No unverified results found'},
                status=status.HTTP_404_NOT_FOUND
            )

        locked_results = LabResult.objects.filter(id__in=result_ids_to_verify)
        if locked_results.filter(
            _lab_result_performed_by_staff_filter(staff, request.user)
        ).exists():
            return Response(
                {'error': LAB_RESULT_SELF_VERIFICATION_ERROR},
                status=status.HTTP_403_FORBIDDEN
            )

        # Verify all results
        verified_count = len(result_ids_to_verify)
        now = timezone.now()
        locked_results.update(
            is_verified=True,
            verified_by=staff,
            verified_at=now
        )

        # Get order info for logging and check if order should be completed
        order_info = ""
        order = None
        if order_id:
            order = LabOrder.objects.filter(id=order_id).first()
            if order:
                order_info = f" for order {order.order_number}"

        # Check if all results for the order are now verified - if so, mark order as completed
        if order:
            all_results = LabResult.objects.filter(order_test__order=order)
            unverified_count = all_results.filter(is_verified=False).count()

            if unverified_count == 0 and all_results.exists():
                # All results verified - mark order as completed
                order.status = LabOrderStatus.COMPLETED
                order.completed_at = now
                order.save(update_fields=['status', 'completed_at'])
                logger.info(
                    f"Order {order.order_number} marked as completed - all results verified"
                )

        logger.info(
            f"Bulk verified {verified_count} lab results{order_info} by {request.user.get_full_name()}"
        )

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.LAB_RESULT_VERIFY,
            category=AuditCategory.LABORATORY,
            resource_type='LabResult',
            resource_id=order_id or str(result_ids[0]) if result_ids else None,
            resource_name=f"Bulk verification{order_info}",
            description=f"Verified {verified_count} lab results{order_info}",
        )

        return Response({
            'verified_count': verified_count,
            'message': f'Successfully verified {verified_count} result(s)'
        })


from apps.core.features import bind_required_feature

bind_required_feature(globals(), 'laboratory')
