from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import GenericAPIView
from rest_framework.response import Response

from apps.core.features import require_feature
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, check_clinical_access, get_user_facility
from apps.users.models import PatientProfile
from apps.ward_board.models import WardBoardTask
from apps.ward_board.serializers import (
    WardBoardAcknowledgementSerializer,
    WardBoardPatientDetailSerializer,
    WardBoardPatientRowSerializer,
    WardBoardTaskActionSerializer,
    WardBoardTaskCancelSerializer,
    WardBoardTaskCreateSerializer,
    WardBoardTaskDetailSerializer,
    WardBoardTaskEscalateSerializer,
    WardBoardTaskEventListSerializer,
    WardBoardTaskListSerializer,
    WardBoardTaskUpdateSerializer,
)
from apps.ward_board.services import (
    BOARD_USER_TYPES,
    acknowledge_task,
    active_admission_queryset,
    base_task_queryset,
    build_board_patient_rows,
    build_patient_snapshot,
    cancel_task,
    complete_task,
    create_task,
    escalate_task,
    update_task,
)
from apps.wards.models import Ward


def _require_ward_board_features(request):
    facility = get_user_facility(request)
    require_feature('wards', facility=facility, request=request)
    require_feature('inpatient_admissions', facility=facility, request=request)


def _get_facility(request):
    facility = get_user_facility(request)
    if not facility:
        raise PermissionDenied('Facility context is required.')
    _require_ward_board_features(request)
    return facility


class WardBoardClinicalPermission(permissions.BasePermission):
    message = 'Ward board access requires a clinical role.'

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(
            user
            and getattr(user, 'is_authenticated', False)
            and getattr(user, 'user_type', None) in BOARD_USER_TYPES
        )


class WardBoardTaskViewSet(viewsets.ModelViewSet):
    permission_classes = [
        permissions.IsAuthenticated,
        FacilityScopedPermission,
        WardBoardClinicalPermission,
    ]
    pagination_class = StandardResultsSetPagination
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']

    def get_serializer_class(self):
        if self.action == 'list':
            return WardBoardTaskListSerializer
        if self.action == 'create':
            return WardBoardTaskCreateSerializer
        if self.action in {'update', 'partial_update'}:
            return WardBoardTaskUpdateSerializer
        return WardBoardTaskDetailSerializer

    def get_queryset(self):
        facility = _get_facility(self.request)
        queryset = base_task_queryset(facility, self.request.user).annotate(
            acknowledgement_count=Count('acknowledgements'),
        )

        patient_id = self.request.query_params.get('patient') or self.request.query_params.get('patient_id')
        if patient_id:
            patient = get_object_or_404(PatientProfile.objects.select_related('user'), id=patient_id)
            if patient.facility_id != facility.id:
                raise PermissionDenied('Patient does not belong to the active facility.')
            check_clinical_access(self.request.user, patient)
            queryset = queryset.filter(patient=patient)

        ward_id = self.request.query_params.get('ward') or self.request.query_params.get('ward_id')
        if ward_id:
            ward = get_object_or_404(Ward.objects.select_related('department'), id=ward_id)
            if not ward.department_id or ward.department.facility_id != facility.id:
                raise PermissionDenied('Ward does not belong to the active facility.')
            queryset = queryset.filter(ward=ward)

        admission_id = self.request.query_params.get('admission') or self.request.query_params.get('admission_id')
        if admission_id:
            queryset = queryset.filter(admission_id=admission_id)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        elif self.action == 'list':
            queryset = queryset.exclude(status__in=WardBoardTask.TERMINAL_STATUSES)

        for field in ('category', 'priority', 'owner_role', 'source_type'):
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{field: value})

        due_before = self.request.query_params.get('due_before')
        if due_before:
            queryset = queryset.filter(due_at__lt=due_before)

        due_after = self.request.query_params.get('due_after')
        if due_after:
            queryset = queryset.filter(due_at__gte=due_after)

        mine = self.request.query_params.get('mine')
        if mine and mine.lower() == 'true':
            queryset = queryset.filter(owner_user=self.request.user)

        return queryset.order_by('status', 'due_at', '-priority', '-created_at')

    def create(self, request, *args, **kwargs):
        facility = _get_facility(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = create_task(
            facility=facility,
            actor=request.user,
            **serializer.validated_data,
        )
        response_task = self.get_queryset().get(pk=task.pk)
        return Response(
            WardBoardTaskDetailSerializer(response_task, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        task = self.get_object()
        facility = _get_facility(request)
        serializer = self.get_serializer(task, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        task = update_task(
            task,
            actor=request.user,
            facility=facility,
            **serializer.validated_data,
        )
        response_task = self.get_queryset().get(pk=task.pk)
        return Response(WardBoardTaskDetailSerializer(response_task, context={'request': request}).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    @action(detail=True, methods=['post'], url_path='acknowledge')
    def acknowledge(self, request, pk=None):
        task = self.get_object()
        serializer = WardBoardTaskActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        acknowledgement = acknowledge_task(
            task,
            actor=request.user,
            note=serializer.validated_data.get('note', ''),
        )
        return Response(WardBoardAcknowledgementSerializer(acknowledgement).data)

    @action(detail=True, methods=['post'], url_path='complete')
    def complete(self, request, pk=None):
        task = self.get_object()
        serializer = WardBoardTaskActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = complete_task(
            task,
            actor=request.user,
            note=serializer.validated_data.get('note', ''),
        )
        response_task = self.get_queryset().get(pk=task.pk)
        return Response(WardBoardTaskDetailSerializer(response_task, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        task = self.get_object()
        serializer = WardBoardTaskCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = cancel_task(
            task,
            actor=request.user,
            reason=serializer.validated_data['reason'],
        )
        response_task = self.get_queryset().get(pk=task.pk)
        return Response(WardBoardTaskDetailSerializer(response_task, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='escalate')
    def escalate(self, request, pk=None):
        task = self.get_object()
        serializer = WardBoardTaskEscalateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = escalate_task(
            task,
            actor=request.user,
            priority=serializer.validated_data.get('priority'),
            owner_user=serializer.validated_data.get('owner_user'),
            owner_role=serializer.validated_data.get('owner_role'),
            due_at=serializer.validated_data.get('due_at'),
            note=serializer.validated_data.get('note', ''),
        )
        response_task = self.get_queryset().get(pk=task.pk)
        return Response(WardBoardTaskDetailSerializer(response_task, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='events')
    def events(self, request, pk=None):
        task = self.get_object()
        events = task.events.select_related('actor').order_by('created_at')
        page = self.paginate_queryset(events)
        if page is not None:
            serializer = WardBoardTaskEventListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = WardBoardTaskEventListSerializer(events, many=True)
        return Response(serializer.data)


class WardBoardAPIView(GenericAPIView):
    permission_classes = [
        permissions.IsAuthenticated,
        FacilityScopedPermission,
        WardBoardClinicalPermission,
    ]
    pagination_class = StandardResultsSetPagination
    serializer_class = WardBoardPatientRowSerializer

    def get(self, request):
        facility = _get_facility(request)
        ward_id = request.query_params.get('ward') or request.query_params.get('ward_id')
        if ward_id:
            ward = get_object_or_404(Ward.objects.select_related('department'), id=ward_id)
            if not ward.department_id or ward.department.facility_id != facility.id:
                raise PermissionDenied('Ward does not belong to the active facility.')

        admissions = active_admission_queryset(facility, request.user, ward_id=ward_id)
        page = self.paginate_queryset(admissions)
        rows = build_board_patient_rows(page if page is not None else admissions, facility)
        serializer = self.get_serializer(rows, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)


class WardBoardPatientAPIView(GenericAPIView):
    permission_classes = [
        permissions.IsAuthenticated,
        FacilityScopedPermission,
        WardBoardClinicalPermission,
    ]
    serializer_class = WardBoardPatientDetailSerializer

    def get(self, request, patient_id):
        facility = _get_facility(request)
        patient = get_object_or_404(PatientProfile.objects.select_related('user'), id=patient_id)
        snapshot = build_patient_snapshot(patient, facility, request.user)
        serializer = self.get_serializer(snapshot)
        return Response(serializer.data)
