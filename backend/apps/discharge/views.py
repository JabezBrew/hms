from django.db.models import Prefetch
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.billing.models import Invoice
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, get_user_facility, scope_queryset_to_clinical_access
from apps.discharge.models import DischargeCase, DischargeTask
from apps.discharge.serializers import (
    BillingCutoffSerializer,
    DischargeCancelSerializer,
    DischargeCaseDetailSerializer,
    DischargeCaseListSerializer,
    DischargeFinalizeSerializer,
    DischargeTaskCreateSerializer,
    DischargeTaskSerializer,
    DischargeTaskUpdateSerializer,
)
from apps.discharge.services import (
    BILLING_ROLES,
    CLINICAL_SUBMITTER_ROLES,
    NURSING_FINALIZER_ROLES,
    acknowledge_task,
    add_advisory_task,
    cancel_discharge_case,
    clear_billing,
    complete_advisory_task,
    finalize_discharge,
    reopen_discharge_case,
    update_billing_cutoff,
)


def _require_role(request, allowed_roles, message):
    user_type = getattr(request.user, 'user_type', None)
    if user_type not in allowed_roles:
        raise PermissionDenied(message)


class DischargeCaseViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return DischargeCaseDetailSerializer
        return DischargeCaseListSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return DischargeCase.objects.none()

        queryset = DischargeCase.objects.filter(
            facility=facility,
        ).select_related(
            'patient__user',
            'admission__bed__ward',
            'encounter',
            'discharge_note',
            'workflow',
            'nursing_task',
        ).prefetch_related(
            Prefetch(
                'tasks',
                queryset=DischargeTask.objects.all().order_by('blocking', 'task_type'),
                to_attr='prefetched_tasks',
            ),
            Prefetch(
                'admission__invoices',
                queryset=Invoice.objects.prefetch_related('payments').order_by('created_at'),
            ),
        )

        status_filter = self.request.query_params.get('status')
        patient_id = self.request.query_params.get('patient')
        admission_id = self.request.query_params.get('admission')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        elif not patient_id and not admission_id:
            queryset = queryset.exclude(status=DischargeCase.Status.FINALIZED)
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)
        if admission_id:
            queryset = queryset.filter(admission_id=admission_id)

        user_type = getattr(self.request.user, 'user_type', None)
        if user_type in BILLING_ROLES:
            return queryset.order_by('-medical_ready_at')
        if user_type in {'pharmacist', 'lab_technician'}:
            return queryset.filter(
                tasks__assigned_role=user_type,
            ).distinct().order_by('-medical_ready_at')
        if user_type in CLINICAL_SUBMITTER_ROLES | NURSING_FINALIZER_ROLES:
            queryset = scope_queryset_to_clinical_access(
                queryset,
                self.request.user,
                patient_lookup='patient',
            )
            return queryset.order_by('-medical_ready_at')
        return queryset.none()

    @action(detail=True, methods=['post'], url_path='billing-cutoff')
    def billing_cutoff(self, request, pk=None):
        _require_role(request, BILLING_ROLES, 'Billing role is required to update the billing cutoff.')
        case = self.get_object()
        serializer = BillingCutoffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = update_billing_cutoff(
            case=case,
            actor=request.user,
            billing_cutoff_at=serializer.validated_data['billing_cutoff_at'],
        )
        return Response(DischargeCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='billing-clear')
    def billing_clear(self, request, pk=None):
        _require_role(request, BILLING_ROLES, 'Billing role is required to clear billing.')
        case = clear_billing(case=self.get_object(), actor=request.user)
        return Response(DischargeCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='advisory-tasks')
    def advisory_tasks(self, request, pk=None):
        _require_role(request, CLINICAL_SUBMITTER_ROLES | NURSING_FINALIZER_ROLES | BILLING_ROLES, 'You do not have permission to add advisory discharge tasks.')
        case = self.get_object()
        serializer = DischargeTaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = add_advisory_task(
            case=case,
            actor=request.user,
            task_type=serializer.validated_data['task_type'],
            assigned_role=serializer.validated_data.get('assigned_role'),
            notes=serializer.validated_data.get('notes', ''),
            snapshot=serializer.validated_data.get('snapshot', {}),
        )
        return Response(DischargeTaskSerializer(task).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='finalize')
    def finalize(self, request, pk=None):
        _require_role(request, NURSING_FINALIZER_ROLES, 'Nursing finalization requires a nursing role.')
        case = self.get_object()
        serializer = DischargeFinalizeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = finalize_discharge(
            case=case,
            actor=request.user,
            finalized_at=serializer.validated_data.get('finalized_at'),
            acknowledge_task_ids=serializer.validated_data.get('acknowledge_task_ids', []),
        )
        return Response(DischargeCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        _require_role(request, CLINICAL_SUBMITTER_ROLES, 'Only clinicians can cancel submitted medical discharges.')
        serializer = DischargeCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = cancel_discharge_case(
            case=self.get_object(),
            actor=request.user,
            reason=serializer.validated_data.get('reason', ''),
        )
        return Response(DischargeCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='reopen')
    def reopen(self, request, pk=None):
        _require_role(request, CLINICAL_SUBMITTER_ROLES, 'Only clinicians can reopen submitted medical discharges.')
        case = reopen_discharge_case(case=self.get_object(), actor=request.user)
        return Response(DischargeCaseDetailSerializer(case, context={'request': request}).data)


class DischargeTaskViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DischargeTaskSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return DischargeTask.objects.none()

        queryset = DischargeTask.objects.filter(
            case__facility=facility,
        ).select_related(
            'case',
            'case__patient__user',
            'case__admission__bed__ward',
        )

        assigned_role = self.request.query_params.get('assigned_role')
        if assigned_role:
            queryset = queryset.filter(assigned_role=assigned_role)

        blocking = self.request.query_params.get('blocking')
        if blocking is not None:
            queryset = queryset.filter(blocking=str(blocking).lower() == 'true')

        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)

        user_type = getattr(self.request.user, 'user_type', None)
        if user_type in BILLING_ROLES:
            return queryset
        if user_type in {'pharmacist', 'lab_technician'}:
            return queryset.filter(assigned_role=user_type)
        if user_type in CLINICAL_SUBMITTER_ROLES | NURSING_FINALIZER_ROLES:
            return scope_queryset_to_clinical_access(
                queryset,
                self.request.user,
                patient_lookup='case__patient',
            )
        return queryset.none()

    @action(detail=True, methods=['post'], url_path='complete')
    def complete(self, request, pk=None):
        task = self.get_object()
        allowed_roles = {task.assigned_role, 'admin'}
        _require_role(request, allowed_roles, 'You do not have permission to complete this discharge task.')
        serializer = DischargeTaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = complete_advisory_task(
            task=task,
            actor=request.user,
            notes=serializer.validated_data.get('notes', ''),
        )
        return Response(DischargeCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='acknowledge')
    def acknowledge(self, request, pk=None):
        task = self.get_object()
        allowed_roles = {task.assigned_role, 'admin'} if task.assigned_role else {'admin'}
        _require_role(request, allowed_roles, 'You do not have permission to acknowledge this discharge task.')
        serializer = DischargeTaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = acknowledge_task(
            task=task,
            actor=request.user,
            notes=serializer.validated_data.get('notes', ''),
        )
        return Response(DischargeCaseDetailSerializer(case, context={'request': request}).data)


from apps.core.features import bind_required_feature

bind_required_feature(globals(), 'discharge_workflows')
