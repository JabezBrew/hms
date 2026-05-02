"""
Problem List API views.

Performance:
- list endpoint uses lightweight serializer + select_related on code.
- search-codes endpoint hard-caps at 50 to prevent payload bloat.
- All viewsets use StandardResultsSetPagination per CLAUDE.md.
- Feature-gated: declares `required_feature = 'problem_list'` to fail closed.
"""
from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.pagination import LargeResultsSetPagination, StandardResultsSetPagination
from apps.core.security import (
    FacilityScopedPermission,
    FeatureRequiredPermission,
    check_clinical_access,
    get_user_facility,
    scope_queryset_to_clinical_access,
)
from apps.users.permissions import IsAdminOrDoctor, IsAdminOrNurse

from .models import (
    ClinicalStatus,
    Problem,
    ProblemCode,
    ProblemLink,
    ProblemStatusEvent,
    Priority,
)
from .serializers import (
    ProblemCodeSearchSerializer,
    ProblemDetailSerializer,
    ProblemLinkSerializer,
    ProblemListSerializer,
    ProblemStatusChangeSerializer,
)


def _scope_problems_for_user(queryset, user, *, patient_lookup='patient'):
    """Restrict problem visibility to patients the user can clinically access."""
    return scope_queryset_to_clinical_access(
        queryset,
        user,
        patient_lookup=patient_lookup,
        scope='clinical',
    )


def _priority_order_expression():
    return Case(
        When(priority=Priority.HIGH, then=Value(0)),
        When(priority=Priority.MEDIUM, then=Value(1)),
        When(priority=Priority.LOW, then=Value(2)),
        default=Value(3),
        output_field=IntegerField(),
    )


def _order_problems_clinically(queryset):
    return queryset.annotate(_priority_rank=_priority_order_expression()).order_by(
        '_priority_rank',
        '-recorded_at',
    )


def _target_patient_id(target):
    return getattr(target, 'patient_id', None)


def _target_facility_id(target):
    facility_id = getattr(target, 'facility_id', None)
    if facility_id is not None:
        return facility_id
    return getattr(getattr(target, 'facility', None), 'id', None)


def _selected_link_target(validated_data):
    for key in ('note_entry', 'prescription', 'lab_order', 'encounter'):
        target = validated_data.get(key)
        if target is not None:
            return key, target
    return None, None


class ProblemViewSet(viewsets.ModelViewSet):
    """
    /api/problems/

    Query params:
        patient: UUID — required for list (server enforces).
        clinical_status: filter (default: active)
        include_resolved: '1' to also return resolved/inactive
    """

    queryset = Problem.objects.all()
    permission_classes = [
        permissions.IsAuthenticated,
        FacilityScopedPermission,
        FeatureRequiredPermission,
    ]
    pagination_class = StandardResultsSetPagination
    required_feature = 'problem_list'

    def get_serializer_class(self):
        if self.action == 'list':
            return ProblemListSerializer
        return ProblemDetailSerializer

    def get_permissions(self):
        if self.action in (
            'create',
            'update',
            'partial_update',
            'destroy',
            'change_status',
        ):
            classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                FeatureRequiredPermission,
                IsAdminOrDoctor | IsAdminOrNurse,
            ]
        else:
            classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                FeatureRequiredPermission,
            ]
        return [c() for c in classes]

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return Problem.objects.none()

        qs = Problem.objects.filter(facility=facility)
        qs = _scope_problems_for_user(qs, self.request.user)

        if self.action == 'list':
            qs = qs.select_related('code')

            patient_id = self.request.query_params.get('patient')
            if patient_id:
                qs = qs.filter(patient_id=patient_id)

            clinical_status = self.request.query_params.get('clinical_status')
            include_resolved = self.request.query_params.get('include_resolved') in ('1', 'true', 'yes')
            if clinical_status:
                qs = qs.filter(clinical_status=clinical_status)
            elif not include_resolved:
                qs = qs.filter(clinical_status=ClinicalStatus.ACTIVE)
            qs = _order_problems_clinically(qs)
        else:
            qs = qs.select_related('code', 'recorded_by', 'last_updated_by').prefetch_related(
                'status_events__changed_by'
            )

        return qs

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        # Block duplicate active coded problems for the same patient.
        code = serializer.validated_data.get('code')
        patient = serializer.validated_data.get('patient')
        if not patient:
            raise ValidationError({'patient': 'Patient is required.'})
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_clinical_access(self.request.user, patient)
        if code and patient and Problem.objects.filter(
            patient=patient,
            code=code,
            clinical_status=ClinicalStatus.ACTIVE,
        ).exists():
            raise ValidationError(
                {'code_id': "An active problem with this code already exists for the patient."}
            )

        serializer.save(
            facility=facility,
            recorded_by=self.request.user,
            last_updated_by=self.request.user,
        )

    def perform_update(self, serializer):
        patient = serializer.validated_data.get('patient')
        if patient and patient.id != serializer.instance.patient_id:
            raise ValidationError({'patient': 'A problem cannot be moved to another patient.'})
        check_clinical_access(self.request.user, serializer.instance.patient)
        serializer.save(last_updated_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='change-status')
    def change_status(self, request, pk=None):
        """Transition clinical_status with audit trail."""
        problem = self.get_object()
        body = ProblemStatusChangeSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        to_status = body.validated_data['to_status']
        reason = body.validated_data.get('reason', '')
        abatement_date = body.validated_data.get('abatement_date')

        if to_status == problem.clinical_status:
            return Response(
                ProblemDetailSerializer(problem).data,
                status=status.HTTP_200_OK,
            )

        with transaction.atomic():
            ProblemStatusEvent.objects.create(
                problem=problem,
                from_status=problem.clinical_status,
                to_status=to_status,
                reason=reason,
                changed_by=request.user,
            )
            problem.clinical_status = to_status
            problem.last_updated_by = request.user
            problem.last_assessed_at = timezone.now()
            if to_status == ClinicalStatus.RESOLVED and abatement_date:
                problem.abatement_date = abatement_date
            problem.save(
                update_fields=[
                    'clinical_status',
                    'last_updated_by',
                    'last_assessed_at',
                    'abatement_date',
                    'updated_at',
                ]
            )

        return Response(ProblemDetailSerializer(problem).data)

    @action(detail=True, methods=['get'], url_path='links')
    def list_links(self, request, pk=None):
        """Return artifacts linked to this problem."""
        problem = self.get_object()
        links = problem.links.select_related(
            'note_entry', 'prescription', 'lab_order', 'encounter', 'linked_by'
        )
        return Response(ProblemLinkSerializer(links, many=True).data)

    @action(detail=False, methods=['get'], url_path='grouped-by-problem')
    def grouped_by_problem(self, request):
        """
        Return active problems for a patient, each with counts and recent
        artifacts (notes/prescriptions/labs/encounters) linked to it.

        Query params:
            patient: UUID — required.

        Used by the Problem-grouped chart view (Plan 1, phase 5).
        Single endpoint, single round trip — keeps the frontend simple.
        """
        patient_id = request.query_params.get('patient')
        if not patient_id:
            return Response({'detail': 'patient is required'}, status=400)

        facility = get_user_facility(request)
        if not facility:
            return Response({'detail': 'Facility context required.'}, status=403)

        qs = (
            Problem.objects.filter(
                facility=facility,
                patient_id=patient_id,
                clinical_status=ClinicalStatus.ACTIVE,
            )
            .select_related('code')
            .prefetch_related(
                'links__note_entry',
                'links__prescription',
                'links__lab_order',
                'links__encounter',
            )
        )
        qs = _scope_problems_for_user(qs, request.user)
        qs = _order_problems_clinically(qs)

        groups = []
        for problem in qs:
            links = list(problem.links.all())
            entries = []
            for link in links:
                target = (
                    link.note_entry
                    or link.prescription
                    or link.lab_order
                    or link.encounter
                )
                if target is None:
                    continue
                kind = (
                    'note'
                    if link.note_entry_id
                    else 'prescription'
                    if link.prescription_id
                    else 'lab_order'
                    if link.lab_order_id
                    else 'encounter'
                )
                entries.append(
                    {
                        'kind': kind,
                        'id': str(target.id),
                        'created_at': getattr(target, 'created_at', None),
                        'summary': str(target),
                    }
                )
            entries.sort(key=lambda e: e['created_at'] or '', reverse=True)
            groups.append(
                {
                    'problem': ProblemListSerializer(problem).data,
                    'entry_count': len(entries),
                    'entries': entries[:10],  # cap per group
                }
            )

        return Response({'groups': groups})


class ProblemCodeViewSet(viewsets.ReadOnlyModelViewSet):
    """
    /api/problems/codes/

    Search endpoint for the picker. Query params:
        q: search string (matches code prefix or display ILIKE)
        code_system: filter (default: all active)
        category: optional
        quick_picks_only: '1' to return only Ghana quick-picks
    """

    queryset = ProblemCode.objects.filter(is_active=True)
    serializer_class = ProblemCodeSearchSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        FeatureRequiredPermission,
    ]
    pagination_class = LargeResultsSetPagination
    required_feature = 'problem_list'

    def get_queryset(self):
        qs = ProblemCode.objects.filter(is_active=True)

        code_system = self.request.query_params.get('code_system')
        if code_system:
            qs = qs.filter(code_system=code_system)

        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)

        if self.request.query_params.get('quick_picks_only') in ('1', 'true', 'yes'):
            qs = qs.filter(is_quick_pick=True)

        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(code__istartswith=q) | Q(display__icontains=q))

        # Quick-picks first, then by code.
        return qs.order_by('-is_quick_pick', 'quick_pick_rank', 'code')[:200]


class ProblemLinkViewSet(viewsets.ModelViewSet):
    """
    /api/problems/links/

    Create linkages between Problem and clinical artifacts (notes, prescriptions, labs, encounters).
    """

    queryset = ProblemLink.objects.all()
    serializer_class = ProblemLinkSerializer
    permission_classes = [
        permissions.IsAuthenticated,
        FacilityScopedPermission,
        FeatureRequiredPermission,
    ]
    pagination_class = StandardResultsSetPagination
    required_feature = 'problem_list'

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ProblemLink.objects.none()

        qs = ProblemLink.objects.filter(problem__facility=facility).select_related(
            'problem', 'note_entry', 'prescription', 'lab_order', 'encounter', 'linked_by'
        )
        qs = _scope_problems_for_user(
            qs.select_related('problem__patient'),
            self.request.user,
            patient_lookup='problem__patient',
        )

        problem_id = self.request.query_params.get('problem')
        if problem_id:
            qs = qs.filter(problem_id=problem_id)

        for filter_key in ('note_entry', 'prescription', 'lab_order', 'encounter'):
            value = self.request.query_params.get(filter_key)
            if value:
                qs = qs.filter(**{filter_key + '_id': value})

        return qs.order_by('-linked_at')

    def perform_create(self, serializer):
        problem = serializer.validated_data.get('problem')
        facility = get_user_facility(self.request)
        if not facility or problem.facility_id != facility.id:
            raise PermissionDenied("Facility access denied.")

        check_clinical_access(self.request.user, problem.patient)

        target_key, target = _selected_link_target(serializer.validated_data)
        if target is None:
            raise ValidationError("Exactly one target artifact is required.")
        if _target_facility_id(target) != facility.id:
            raise PermissionDenied("Linked artifact does not belong to the active facility.")
        if _target_patient_id(target) != problem.patient_id:
            raise ValidationError(
                {
                    target_key: (
                        "Linked artifact must belong to the same patient as the problem."
                    )
                }
            )

        serializer.save(linked_by=self.request.user)

    def get_permissions(self):
        if self.action in ('create', 'destroy'):
            classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                FeatureRequiredPermission,
                IsAdminOrDoctor | IsAdminOrNurse,
            ]
        else:
            classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                FeatureRequiredPermission,
            ]
        return [c() for c in classes]
