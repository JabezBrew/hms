from django.db.models import Prefetch
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.admissions.models import AdmissionCase, AdmissionTask, BedReservation
from apps.admissions.serializers import (
    AdmissionCaseActivateSerializer,
    AdmissionCaseDetailSerializer,
    AdmissionCaseListSerializer,
    AdmissionCaseNotesSerializer,
    AdmissionCaseStartSerializer,
    AdmissionTaskCreateSerializer,
    AdmissionTaskSerializer,
    AdmissionTaskUpdateSerializer,
    BedReservationUpdateSerializer,
)
from apps.admissions.services import (
    CLINICAL_REQUESTER_ROLES,
    FINANCIAL_ROLES,
    NURSING_ROLES,
    PLACEMENT_ROLES,
    REGISTRATION_ROLES,
    acknowledge_admission_task,
    activate_admission_case,
    add_advisory_task,
    cancel_admission_case,
    clear_financial,
    complete_admission_task,
    complete_intake,
    complete_registration,
    reserve_bed_for_case,
    start_admission_case,
)
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, get_user_facility, scope_queryset_to_clinical_access


CLINICAL_CASE_ROLES = CLINICAL_REQUESTER_ROLES | NURSING_ROLES | PLACEMENT_ROLES
CASE_STARTER_ROLES = CLINICAL_REQUESTER_ROLES | REGISTRATION_ROLES | PLACEMENT_ROLES
CASE_VISIBLE_SUPPORT_ROLES = REGISTRATION_ROLES | FINANCIAL_ROLES | {'admin'}
ADVISORY_ROLES = {'pharmacist', 'lab_technician'}


def _require_role(request, allowed_roles, message):
    if getattr(request.user, 'user_type', None) not in allowed_roles:
        raise PermissionDenied(message)


class AdmissionCaseViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return AdmissionCaseDetailSerializer
        return AdmissionCaseListSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return AdmissionCase.objects.none()

        queryset = AdmissionCase.objects.filter(
            facility=facility,
        ).select_related(
            'patient__user',
            'source_encounter',
            'admission__bed__ward',
            'requested_ward',
            'requested_bed__ward',
            'requested_by',
            'admitting_practitioner__staff__user',
            'primary_team',
        ).prefetch_related(
            Prefetch(
                'tasks',
                queryset=AdmissionTask.objects.all().order_by('phase', '-blocking', 'created_at'),
                to_attr='prefetched_tasks',
            ),
            Prefetch(
                'bed_reservations',
                queryset=BedReservation.objects.select_related('bed__ward').order_by('-reserved_at'),
                to_attr='prefetched_reservations',
            ),
        )

        status_filter = self.request.query_params.get('status')
        patient_id = self.request.query_params.get('patient')
        admission_id = self.request.query_params.get('admission')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        elif not patient_id and not admission_id:
            queryset = queryset.exclude(status__in=[AdmissionCase.Status.COMPLETED, AdmissionCase.Status.CANCELLED])
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)
        if admission_id:
            queryset = queryset.filter(admission_id=admission_id)

        user_type = getattr(self.request.user, 'user_type', None)
        if user_type in CASE_VISIBLE_SUPPORT_ROLES:
            return queryset.order_by('-requested_at')
        if user_type in ADVISORY_ROLES:
            return queryset.filter(tasks__assigned_role=user_type).distinct().order_by('-requested_at')
        if user_type in CLINICAL_CASE_ROLES:
            queryset = scope_queryset_to_clinical_access(queryset, self.request.user, patient_lookup='patient')
            return queryset.order_by('-requested_at')
        return queryset.none()

    @action(detail=False, methods=['post'], url_path='start')
    def start(self, request):
        _require_role(request, CASE_STARTER_ROLES | {'admin'}, 'You do not have permission to start admission cases.')
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied('Facility context is required.')

        serializer = AdmissionCaseStartSerializer(data=request.data, context={'request': request, 'facility': facility})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        case = start_admission_case(
            patient=data['patient'],
            facility=facility,
            actor=request.user,
            payload=data.get('payload', {}),
            source_encounter=data.get('source_encounter'),
            requested_ward=data.get('requested_ward'),
            requested_bed=data.get('requested_bed'),
            requested_for_at=data.get('requested_for_at'),
            admission_source=data.get('admission_source', ''),
            urgency=data.get('urgency', ''),
            requested_admission_type=data.get('requested_admission_type', ''),
            admitting_practitioner=data.get('admitting_practitioner'),
        )
        return Response(
            AdmissionCaseDetailSerializer(case, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], url_path='registration-clear')
    def registration_clear(self, request, pk=None):
        _require_role(request, REGISTRATION_ROLES | {'admin'}, 'Registration clearance requires an admissions role.')
        serializer = AdmissionCaseNotesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = complete_registration(self.get_object(), actor=request.user, notes=serializer.validated_data.get('notes', ''))
        return Response(AdmissionCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='financial-clear')
    def financial_clear(self, request, pk=None):
        _require_role(request, FINANCIAL_ROLES | {'admin'}, 'Financial clearance requires a billing role.')
        serializer = AdmissionCaseNotesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = clear_financial(self.get_object(), actor=request.user, notes=serializer.validated_data.get('notes', ''))
        return Response(AdmissionCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='reserve-bed')
    def reserve_bed(self, request, pk=None):
        _require_role(request, PLACEMENT_ROLES | {'admin'}, 'Bed reservation requires a placement role.')
        case = self.get_object()
        serializer = BedReservationUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        bed = serializer.validated_data['bed']
        if bed.facility_id != case.facility_id:
            raise PermissionDenied('Bed does not belong to the active facility.')
        case = reserve_bed_for_case(
            case=case,
            actor=request.user,
            bed=bed,
            expires_at=serializer.validated_data.get('expires_at'),
        )
        return Response(AdmissionCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='advisory-tasks')
    def advisory_tasks(self, request, pk=None):
        _require_role(
            request,
            CASE_STARTER_ROLES | NURSING_ROLES | FINANCIAL_ROLES | {'admin'},
            'You do not have permission to add advisory admission tasks.',
        )
        case = self.get_object()
        serializer = AdmissionTaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = add_advisory_task(
            case=case,
            actor=request.user,
            task_type=serializer.validated_data['task_type'],
            assigned_role=serializer.validated_data.get('assigned_role'),
            notes=serializer.validated_data.get('notes', ''),
            snapshot=serializer.validated_data.get('snapshot', {}),
        )
        return Response(AdmissionTaskSerializer(task).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='activate')
    def activate(self, request, pk=None):
        _require_role(request, NURSING_ROLES | PLACEMENT_ROLES | {'admin'}, 'Admission activation requires a nursing or placement role.')
        case = self.get_object()
        serializer = AdmissionCaseActivateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = activate_admission_case(
            case=case,
            actor=request.user,
            activated_at=serializer.validated_data.get('activated_at'),
        )
        return Response(AdmissionCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='complete-intake')
    def complete_case_intake(self, request, pk=None):
        _require_role(request, NURSING_ROLES | {'admin'}, 'Admission intake completion requires a nursing role.')
        case = complete_intake(self.get_object(), actor=request.user)
        return Response(AdmissionCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        _require_role(
            request,
            CASE_STARTER_ROLES | REGISTRATION_ROLES | {'admin'},
            'You do not have permission to cancel admission cases.',
        )
        serializer = AdmissionCaseNotesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = cancel_admission_case(
            self.get_object(),
            actor=request.user,
            reason=serializer.validated_data.get('notes', ''),
        )
        return Response(AdmissionCaseDetailSerializer(case, context={'request': request}).data)


class AdmissionTaskViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AdmissionTaskSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return AdmissionTask.objects.none()

        queryset = AdmissionTask.objects.filter(
            case__facility=facility,
        ).select_related(
            'case',
            'case__patient__user',
            'case__requested_bed__ward',
            'case__admission__bed__ward',
        )

        assigned_role = self.request.query_params.get('assigned_role')
        if assigned_role:
            queryset = queryset.filter(assigned_role=assigned_role)

        phase = self.request.query_params.get('phase')
        if phase:
            queryset = queryset.filter(phase=phase)

        blocking = self.request.query_params.get('blocking')
        if blocking is not None:
            queryset = queryset.filter(blocking=str(blocking).lower() == 'true')

        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)

        user_type = getattr(self.request.user, 'user_type', None)
        if user_type in CASE_VISIBLE_SUPPORT_ROLES:
            return queryset
        if user_type in ADVISORY_ROLES:
            return queryset.filter(assigned_role=user_type)
        if user_type in CLINICAL_CASE_ROLES:
            return scope_queryset_to_clinical_access(queryset, self.request.user, patient_lookup='case__patient')
        return queryset.none()

    @action(detail=True, methods=['post'], url_path='complete')
    def complete(self, request, pk=None):
        task = self.get_object()
        allowed_roles = {task.assigned_role, 'admin'} if task.assigned_role else {'admin'}
        _require_role(request, allowed_roles, 'You do not have permission to complete this admission task.')
        serializer = AdmissionTaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if task.phase == AdmissionTask.Phase.PRE_ACTIVATION and task.blocking:
            if task.task_type == AdmissionTask.TaskType.REGISTRATION_COMPLETION:
                case = complete_registration(task.case, actor=request.user, notes=serializer.validated_data.get('notes', ''))
            elif task.task_type == AdmissionTask.TaskType.FINANCIAL_CLEARANCE:
                case = clear_financial(task.case, actor=request.user, notes=serializer.validated_data.get('notes', ''))
            else:
                return Response(
                    {'detail': 'Use case-specific actions for system-managed pre-activation blockers.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            case = complete_admission_task(
                task=task,
                actor=request.user,
                notes=serializer.validated_data.get('notes', ''),
            )
        return Response(AdmissionCaseDetailSerializer(case, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='acknowledge')
    def acknowledge(self, request, pk=None):
        task = self.get_object()
        allowed_roles = {task.assigned_role, 'admin'} if task.assigned_role else {'admin'}
        _require_role(request, allowed_roles, 'You do not have permission to acknowledge this admission task.')
        serializer = AdmissionTaskUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = acknowledge_admission_task(
            task=task,
            actor=request.user,
            notes=serializer.validated_data.get('notes', ''),
        )
        return Response(AdmissionCaseDetailSerializer(case, context={'request': request}).data)
