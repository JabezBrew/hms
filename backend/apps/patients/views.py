from rest_framework import viewsets, permissions, status, filters
from rest_framework.exceptions import PermissionDenied, ValidationError
import time
import logging
import hashlib
import json
from datetime import datetime, timedelta
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Prefetch, Exists, OuterRef, Subquery, Q, Value, CharField
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_date

from .models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from .serializers import (
    PatientFHIRMappingSerializer, PatientFHIRMappingListSerializer, PatientSearchSerializer,
    RecentPatientListSerializer, RecentPatientSerializer,
    PatientRegistrationValidationSerializer, PatientNoteSerializer,
    PatientRegistrationSerializer
)
from apps.users.models import PatientProfile
from apps.users.serializers import (
    PatientDemographicsSerializer,
    PatientDemographicsUpdateSerializer,
    PatientDirectorySearchListSerializer,
    PatientProfileListSerializer,
    PatientProfileSerializer,
    PatientSearchListSerializer,
)
from apps.users.permissions import IsAdminOrOwner
from apps.users.rbac import IsAdmin, IsDoctor, IsNurse
from apps.core.metrics import (
    inc_counter,
    measure_duration,
    observe_histogram,
    track_query_count,
)
from apps.core.pagination import StandardResultsSetPagination, PatientSearchPagination
from apps.core.security import (
    ACTIVE_ADMISSION_STATUSES,
    CLINICAL_PATIENT_ACCESS_USER_TYPES,
    FacilityScopedPermission,
    FeatureRequiredPermission,
    check_demographics_access,
    check_clinical_access,
    get_access_flags,
    get_user_facility,
    is_cross_facility_admin,
    scope_patient_queryset_for_search_access,
)
from apps.core.features import attach_required_feature
from apps.core.models import BreakGlassEvent
from apps.core.serializers import BreakGlassRequestSerializer, BreakGlassEventSerializer
from apps.core.cache_utils import facility_cache_key
from apps.audit.services import AuditService
from apps.audit.models import AuditAction, AuditCategory
from .search_index import apply_search_index_filter
from .tasks import (
    sync_patient_with_fhir,
    log_patient_search,
    search_patients_in_fhir,
    update_patient_in_fhir,
    delete_patient_in_fhir,
    enqueue_patient_search_index_rebuild,
    rebuild_patient_search_index_task,
)

logger = logging.getLogger(__name__)


PATIENT_REGISTRATION_FEATURE = 'patient_registration'
PATIENT_CHRONICLE_FEATURE = 'patient_chronicle'


def _patient_search_serializer_class(user):
    user_type = getattr(user, 'user_type', None)
    if user_type == 'patient' or user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES:
        return PatientSearchListSerializer
    return PatientDirectorySearchListSerializer


def _build_operational_active_encounter_q(start_of_day, end_of_day):
    outpatient_active = (
        Q(encounter_type='outpatient') &
        Q(start_time__gte=start_of_day, start_time__lt=end_of_day) &
        (
            Q(status='in-progress') |
            Q(
                status='planned',
                outpatient_visit__visit_status__in=[
                    'checked_in',
                    'waiting',
                    'called',
                    'in_progress',
                    'on_hold',
                    'ready_checkout',
                ],
            )
        )
    )
    non_outpatient_active = (
        ~Q(encounter_type='outpatient') &
        Q(status__in=['planned', 'in-progress'])
    )
    return outpatient_active | non_outpatient_active


def _build_patient_text_query(query):
    normalized_query = " ".join(str(query or "").split())
    if not normalized_query:
        return Q()

    query_terms = normalized_query.split(" ")
    name_query = None
    for term in query_terms:
        term_query = Q(user__first_name__icontains=term) | Q(user__last_name__icontains=term)
        name_query = term_query if name_query is None else name_query & term_query

    return (
        name_query
        | Q(medical_record_number__icontains=normalized_query)
        | Q(nhis_id__icontains=normalized_query)
    )


def _build_safe_patient_search_summary(
    *,
    query=None,
    ward_id=None,
    admission_start=None,
    admission_end=None,
    department_id=None,
    admission_status=None,
    admission_type=None,
    encounter_type=None,
    attending_id=None,
    age_min_value=None,
    age_max_value=None,
    my_patients=False,
    registry_scope='all',
    ordering='-created_at',
    requested_page=1,
    requested_page_size=None,
):
    """Build a non-PHI search-history summary for analytics and audits."""
    active_filters = []
    if query:
        active_filters.append('query')
    if ward_id:
        active_filters.append('ward')
    if admission_start:
        active_filters.append('admission_start')
    if admission_end:
        active_filters.append('admission_end')
    if department_id:
        active_filters.append('department')
    if admission_status:
        active_filters.append('admission_status')
    if admission_type:
        active_filters.append('admission_type')
    if encounter_type:
        active_filters.append('encounter_type')
    if attending_id:
        active_filters.append('attending')
    if age_min_value is not None:
        active_filters.append('age_min')
    if age_max_value is not None:
        active_filters.append('age_max')

    summary_parts = [f"patient-search filters={'+'.join(active_filters) if active_filters else 'none'}"]
    if my_patients:
        summary_parts.append('my_patients=true')
    if registry_scope and registry_scope != 'all':
        summary_parts.append(f"registry_scope={registry_scope}")
    summary_parts.append(f"ordering={ordering}")
    summary_parts.append(f"page={requested_page}")
    if requested_page_size:
        summary_parts.append(f"page_size={requested_page_size}")
    return " ".join(summary_parts)[:255]


def _patient_registration_history_entry():
    """Return the non-PHI patient-search history marker for registrations."""
    return "patient-registration action=create"


class PatientFHIRMappingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient FHIR mappings.
    """
    queryset = PatientFHIRMapping.objects.select_related('patient_profile', 'patient_profile__user').all()
    serializer_class = PatientFHIRMappingSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return PatientFHIRMappingListSerializer
        return super().get_serializer_class()

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PatientFHIRMapping.objects.none()
        return PatientFHIRMapping.objects.select_related(
            'patient_profile',
            'patient_profile__user'
        ).filter(patient_profile__facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient_profile = serializer.validated_data.get('patient_profile')
        if patient_profile and patient_profile.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def sync_with_fhir(self, request, pk=None):
        """
        Queue a background task to sync the local patient data with the FHIR resource.
        """
        mapping = self.get_object()

        # Queue the sync task
        task = sync_patient_with_fhir.delay(
            str(mapping.id),
            facility_code=request.facility_code
        )

        return Response({
            "message": "FHIR sync has been queued for background processing.",
            "task_id": task.id,
            "patient_id": str(mapping.patient_profile.id)
        }, status=status.HTTP_202_ACCEPTED)


class PatientSearchViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient searches.
    """
    queryset = PatientSearch.objects.all()
    serializer_class = PatientSearchSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter searches to only show the current user's searches.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return PatientSearch.objects.none()
        return PatientSearch.objects.filter(user=self.request.user, facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(user=self.request.user, facility=facility)


class RecentPatientViewSet(viewsets.ModelViewSet):
    """
    API endpoint for recent patients.
    """
    queryset = RecentPatient.objects.all()
    serializer_class = RecentPatientSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter recent patients to only show the current user's recent patients.
        Limited to 10 most recent for performance.
        """
        from apps.wards.models import Admission

        limit = int(self.request.query_params.get('limit', 10))
        # Cap at 20 to prevent abuse
        limit = min(limit, 20)
        facility = get_user_facility(self.request)
        if not facility:
            return RecentPatient.objects.none()

        return RecentPatient.objects.filter(
            user=self.request.user,
            facility=facility
        ).select_related(
            'patient_profile',
            'patient_profile__user'
        ).prefetch_related(
            Prefetch(
                'patient_profile__admissions',
                queryset=Admission.objects.filter(
                    status__in=ACTIVE_ADMISSION_STATUSES
                ).select_related('bed', 'bed__ward').order_by('-admission_date'),
                to_attr='active_admissions_list'
            )
        )[:limit]

    def get_serializer_class(self):
        if self.action in ['list', 'add_recent']:
            return RecentPatientListSerializer
        return super().get_serializer_class()

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient_profile = serializer.validated_data.get('patient_profile')
        if patient_profile and patient_profile.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        serializer.save(user=self.request.user, facility=facility)

    @action(detail=False, methods=['post'])
    def add_recent(self, request):
        """
        Add a patient to the user's recent patients list.
        """
        patient_profile_id = request.data.get('patient_profile')
        if not patient_profile_id:
            return Response(
                {"error": "patient_profile is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            from apps.wards.models import Admission

            patient_profile = PatientProfile.objects.get(id=patient_profile_id)
            facility = get_user_facility(request)
            if not facility or patient_profile.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")

            # SECURITY: Check if user has permission to access this patient
            check_demographics_access(request.user, patient_profile)

            # Check if already exists
            recent, created = RecentPatient.objects.get_or_create(
                user=request.user,
                patient_profile=patient_profile,
                defaults={'facility': facility}
            )
            if not created and recent.facility_id != facility.id:
                raise PermissionDenied("Recent patient entry does not match facility context.")

            # If it exists, update the access_date
            if not created:
                recent.save()  # This will update the auto_now field

            recent = RecentPatient.objects.filter(id=recent.id).select_related(
                'patient_profile',
                'patient_profile__user'
            ).prefetch_related(
                Prefetch(
                    'patient_profile__admissions',
                    queryset=Admission.objects.filter(
                        status__in=ACTIVE_ADMISSION_STATUSES
                    ).select_related('bed', 'bed__ward').order_by('-admission_date'),
                    to_attr='active_admissions_list'
                )
            ).first()

            return Response({
                "message": "Patient added to recent list.",
                "recent_patient": self.get_serializer(recent).data
            })

        except PatientProfile.DoesNotExist:
            return Response(
                {"error": "Patient profile not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        except PermissionDenied:
            raise
        except Exception as e:
            logger.error(f"Failed to add recent patient: {str(e)}")
            return Response(
                {"error": "Failed to add recent patient."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PatientRegistrationValidationViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient registration validation rules.
    """
    queryset = PatientRegistrationValidation.objects.all()
    serializer_class = PatientRegistrationValidationSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PatientNoteViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient notes.
    """
    queryset = PatientNote.objects.all()
    serializer_class = PatientNoteSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter notes based on permissions.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return PatientNote.objects.none()

        base_qs = PatientNote.objects.filter(facility=facility)
        if getattr(self.request.user, 'user_type', None) == 'admin' or getattr(self.request.user, 'is_staff', False):
            return base_qs

        # Regular users can only see their own notes and non-private notes
        return base_qs.filter(created_by=self.request.user) | base_qs.filter(is_private=False)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient_profile = serializer.validated_data.get('patient_profile')
        if patient_profile and patient_profile.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient_profile:
            check_demographics_access(self.request.user, patient_profile)
        serializer.save(created_by=self.request.user, updated_by=self.request.user, facility=facility)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PatientViewSet(viewsets.ViewSet):
    """
    API endpoint for patient management.
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = PatientSearchPagination
    ACTION_REQUIRED_FEATURES = {
        'register': PATIENT_REGISTRATION_FEATURE,
        'search': PATIENT_CHRONICLE_FEATURE,
        'reindex_search_index': PATIENT_CHRONICLE_FEATURE,
        'get_patient': PATIENT_CHRONICLE_FEATURE,
        'get_demographics': PATIENT_CHRONICLE_FEATURE,
        'break_glass': PATIENT_CHRONICLE_FEATURE,
        'update_patient': PATIENT_CHRONICLE_FEATURE,
        'delete_patient': PATIENT_CHRONICLE_FEATURE,
    }

    def _feature_permission_classes(self, permission_classes):
        self.required_feature = self.ACTION_REQUIRED_FEATURES.get(self.action)
        if self.required_feature and FeatureRequiredPermission not in permission_classes:
            return [FeatureRequiredPermission, *permission_classes]
        return permission_classes

    def get_permissions(self):
        if self.action == 'break_glass':
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin | IsDoctor | IsNurse]
        elif self.action == 'update_patient':
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
        elif self.action == 'delete_patient':
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
        else:
            permission_classes = self.permission_classes
        permission_classes = self._feature_permission_classes(permission_classes)
        return [permission() for permission in permission_classes]

    def _get_facility_patient(self, request, pk):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        return get_object_or_404(
            PatientProfile.objects.select_related('user', 'facility'),
            id=pk,
            facility=facility,
        )

    @action(detail=False, methods=['post'])
    def register(self, request):
        """
        Register a new patient.
        Only admin and receptionist roles can register patients.
        """
        # Restrict patient registration to admin and receptionist only
        if request.user.user_type not in ['admin', 'receptionist']:
            raise PermissionDenied("Only admin and receptionist staff can register patients.")

        if not get_user_facility(request):
            raise PermissionDenied("Facility context is required.")

        serializer = PatientRegistrationSerializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            try:
                with transaction.atomic():
                    patient_profile = serializer.save()

                    # Log the search
                    PatientSearch.objects.create(
                        user=request.user,
                        facility=patient_profile.facility,
                        search_query=_patient_registration_history_entry(),
                    )

                    # Add to recent patients
                    RecentPatient.objects.create(
                        user=request.user,
                        patient_profile=patient_profile,
                        facility=patient_profile.facility
                    )

                    return Response(
                        PatientProfileSerializer(patient_profile).data,
                        status=status.HTTP_201_CREATED
                    )
            except ValidationError as e:
                logger.warning(f"Patient registration validation failed: {str(e)}")
                detail = e.detail if hasattr(e, 'detail') else {"error": str(e)}
                return Response(detail, status=status.HTTP_400_BAD_REQUEST)
            except Exception as e:
                logger.error(f"Failed to register patient: {str(e)}")
                return Response(
                    {"error": "Failed to register patient. Please try again."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def search(self, request):
        """
        Search for patients with advanced filters.
        Supports empty-query browsing with deterministic ordering.

        Performance optimizations:
        - Uses lightweight serializer (PatientSearchListSerializer)
        - Caches results for 30 seconds
        - Logs searches to PatientSearch history
        - FHIR calls are opt-in via include_fhir=true query param
        """
        query = request.query_params.get('query', '').strip()
        ward_id = request.query_params.get('ward', '').strip()
        admission_start = request.query_params.get('admission_start', '').strip()
        admission_end = request.query_params.get('admission_end', '').strip()
        admission_date = request.query_params.get('admission_date', '').strip()
        department_id = request.query_params.get('department_id', '').strip()
        admission_status = request.query_params.get('admission_status', '').strip()
        admission_type = request.query_params.get('admission_type', '').strip()
        encounter_type = request.query_params.get('encounter_type', '').strip()
        attending_id = request.query_params.get('attending_id', '').strip()
        age_min = request.query_params.get('age_min', '').strip()
        age_max = request.query_params.get('age_max', '').strip()
        ordering = request.query_params.get('ordering', '-created_at').strip() or '-created_at'
        requested_page = request.query_params.get('page', '').strip() or '1'
        requested_page_size = request.query_params.get('page_size', '').strip()
        include_total = request.query_params.get('include_total', '').lower() == 'true'
        my_patients = request.query_params.get('my_patients', '').lower() == 'true'
        include_fhir = request.query_params.get('include_fhir', '').lower() == 'true'
        registry_scope = request.query_params.get('registry_scope', 'all').strip().lower() or 'all'

        ordering_field_map = {
            'created_at': ('created_at',),
            'name': ('user__last_name', 'user__first_name'),
            'medical_record_number': ('medical_record_number',),
            'date_of_birth': ('user__date_of_birth', 'user__last_name', 'user__first_name'),
            'gender': ('user__gender', 'user__last_name', 'user__first_name'),
            'current_ward': ('sort_patient_location', 'user__last_name', 'user__first_name'),
            'patient_location': ('sort_patient_location', 'user__last_name', 'user__first_name'),
            'admission_status': ('sort_admission_status', 'user__last_name', 'user__first_name'),
            'registry_status': ('sort_registry_status', 'user__last_name', 'user__first_name'),
            'admission_date': ('sort_admission_date', 'user__last_name', 'user__first_name'),
        }
        ordering_desc = ordering.startswith('-')
        ordering_key = ordering[1:] if ordering_desc else ordering
        if not ordering_key or ordering_key.startswith('-') or ordering_key not in ordering_field_map:
            return Response(
                {"error": "Invalid ordering field."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Backward compatibility: treat legacy admission_date as a single-day range.
        if admission_date:
            if not admission_start:
                admission_start = admission_date
            if not admission_end:
                admission_end = admission_date

        allowed_admission_statuses = {'admitted', 'pending_discharge', 'waiting', 'discharged', 'transferred', 'deceased'}
        allowed_admission_types = {'emergency', 'elective', 'maternity', 'newborn'}
        allowed_encounter_types = {'inpatient', 'outpatient', 'emergency'}
        allowed_registry_scopes = {'active', 'discharged', 'deceased', 'all'}

        if registry_scope not in allowed_registry_scopes:
            return Response(
                {"error": "Invalid registry_scope value."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if admission_status and admission_status not in allowed_admission_statuses:
            return Response(
                {"error": "Invalid admission_status value."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if admission_type and admission_type not in allowed_admission_types:
            return Response(
                {"error": "Invalid admission_type value."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if encounter_type and encounter_type not in allowed_encounter_types:
            return Response(
                {"error": "Invalid encounter_type value."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            age_min_value = int(age_min) if age_min else None
            age_max_value = int(age_max) if age_max else None
            if age_min_value is not None and age_min_value < 0:
                raise ValueError("age_min must be non-negative")
            if age_max_value is not None and age_max_value < 0:
                raise ValueError("age_max must be non-negative")
            if age_min_value is not None and age_max_value is not None and age_min_value > age_max_value:
                raise ValueError("age_min cannot be greater than age_max")
        except (TypeError, ValueError):
            return Response(
                {"error": "Invalid age range. Use non-negative integers."},
                status=status.HTTP_400_BAD_REQUEST
            )

        has_other_filters = bool(
            ward_id or admission_start or admission_end or department_id or admission_status or
            admission_type or encounter_type or attending_id or age_min_value is not None or
            age_max_value is not None or my_patients or registry_scope != 'all'
        )

        user_type = request.user.user_type
        if (
            not query
            and not has_other_filters
            and (user_type in {'admin', 'receptionist'} or is_cross_facility_admin(request.user))
        ):
            return Response(
                {"error": "A query or filter is required for facility-wide patient directory search."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if include_fhir and (not query or has_other_filters):
            return Response(
                {"error": "FHIR search requires a query and cannot be combined with filters."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if include_fhir and request.user.user_type not in ['admin', 'doctor', 'nurse']:
            return Response(
                {"error": "FHIR search is restricted to clinical staff."},
                status=status.HTTP_403_FORBIDDEN
            )

        if my_patients and request.user.user_type not in ['doctor', 'nurse', 'lab_technician', 'pharmacist']:
            return Response(
                {"error": "My Patients filter is restricted to clinical staff."},
                status=status.HTTP_403_FORBIDDEN
            )

        start_time = time.perf_counter()
        inc_counter(
            'hms_patient_search_requests_total',
            labels={'source': 'http'},
            description='Patient search requests received by the API.',
        )

        cache_params = {
            "query": query,
            "ward": ward_id,
            "admission_start": admission_start,
            "admission_end": admission_end,
            "department_id": department_id,
            "admission_status": admission_status,
            "admission_type": admission_type,
            "encounter_type": encounter_type,
            "attending_id": attending_id,
            "age_min": age_min_value,
            "age_max": age_max_value,
            "ordering": ordering,
            "page": requested_page,
            "page_size": requested_page_size,
            "include_total": include_total,
            "my_patients": my_patients,
            "registry_scope": registry_scope,
            "user_id": str(request.user.id),
            "access_policy": "patient-search-scoped-v2",
            "result_shape": _patient_search_serializer_class(request.user).__name__,
        }
        cache_key = facility_cache_key(
            f"patient_search_{hashlib.md5(json.dumps(cache_params, sort_keys=True).encode()).hexdigest()}"
        )
        search_summary = _build_safe_patient_search_summary(
            query=query,
            ward_id=ward_id,
            admission_start=admission_start,
            admission_end=admission_end,
            department_id=department_id,
            admission_status=admission_status,
            admission_type=admission_type,
            encounter_type=encounter_type,
            attending_id=attending_id,
            age_min_value=age_min_value,
            age_max_value=age_max_value,
            my_patients=my_patients,
            registry_scope=registry_scope,
            ordering=ordering,
            requested_page=requested_page,
            requested_page_size=requested_page_size,
        )

        # Try to get from cache first (skip cache if include_fhir is requested)
        if not include_fhir:
            cached_result = cache.get(cache_key)
            if cached_result is not None:
                logger.info("Search cache hit for user %s", request.user.id)
                inc_counter(
                    'hms_patient_search_cache_events_total',
                    labels={'result': 'hit'},
                    description='Patient search cache events.',
                )
                observe_histogram(
                    'hms_patient_search_latency_seconds',
                    time.perf_counter() - start_time,
                    labels={'source': 'cache'},
                    description='Patient search latency in seconds.',
                )
                facility = get_user_facility(request) or getattr(request.user, 'primary_facility', None)
                log_patient_search.delay(
                    str(request.user.id),
                    search_summary,
                    facility_code=facility.code if facility else None
                )
                return Response(cached_result)
        inc_counter(
            'hms_patient_search_cache_events_total',
            labels={'result': 'miss'},
            description='Patient search cache events.',
        )

        # Log search for auditing/history
        facility = get_user_facility(request) or getattr(request.user, 'primary_facility', None)
        log_patient_search.delay(
            str(request.user.id),
            search_summary,
            facility_code=facility.code if facility else None
        )

        try:
            from apps.wards.models import Admission
            from apps.encounters.models import Encounter
            from apps.users.models import UserPatientList
            from apps.core.security import ACTIVE_ADMISSION_STATUSES
            facility = get_user_facility(request)
            if not facility:
                raise PermissionDenied("Facility context is required.")
            today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
            today_end = today_start + timedelta(days=1)
            active_encounter_q = _build_operational_active_encounter_q(today_start, today_end)

            # Base query with bounded prefetches for active admission/encounter context.
            local_patients_qs = PatientProfile.objects.select_related('user').prefetch_related(
                Prefetch(
                    'admissions',
                    queryset=Admission.objects.filter(
                        status__in=ACTIVE_ADMISSION_STATUSES
                    ).select_related('bed', 'bed__ward').order_by('-admission_date'),
                    to_attr='active_admissions_list'
                ),
                Prefetch(
                    'encounters',
                    queryset=Encounter.objects.filter(
                        active_encounter_q
                    ).select_related('clinic', 'outpatient_visit').order_by('-start_time', '-id'),
                    to_attr='active_encounters_list'
                )
            ).filter(facility=facility)

            local_patients_qs = scope_patient_queryset_for_search_access(
                local_patients_qs,
                request.user,
                facility,
            )

            admission_start_date = parse_date(admission_start) if admission_start else None
            if admission_start and not admission_start_date:
                return Response(
                    {"error": "Invalid admission_start format. Use YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            admission_end_date = parse_date(admission_end) if admission_end else None
            if admission_end and not admission_end_date:
                return Response(
                    {"error": "Invalid admission_end format. Use YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            if admission_start_date and admission_end_date and admission_start_date > admission_end_date:
                return Response(
                    {"error": "admission_start must be on or before admission_end."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Filter by text query (Name, MRN, NHIS) using the compact search projection
            search_index_ready = bool(cache.get(facility_cache_key('patient_search_index_ready')))
            if query:
                if search_index_ready:
                    local_patients_qs, _normalized_query = apply_search_index_filter(
                        local_patients_qs,
                        facility=facility,
                        query=query,
                    )
                else:
                    rebuild_request_key = facility_cache_key('patient_search_index_rebuild_requested')
                    if (
                        not getattr(settings, 'CELERY_TASK_ALWAYS_EAGER', False)
                        and cache.add(rebuild_request_key, '1', timeout=300)
                    ):
                        enqueue_patient_search_index_rebuild.delay(
                            facility_id=str(facility.id),
                            facility_code=facility.code,
                        )
                    local_patients_qs = local_patients_qs.filter(_build_patient_text_query(query))

            if my_patients:
                my_patients_exists = UserPatientList.objects.filter(
                    user=request.user,
                    patient=OuterRef('pk')
                )
                local_patients_qs = local_patients_qs.filter(Exists(my_patients_exists))

            if registry_scope != 'all':
                active_admission_exists_qs = Admission.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                    status__in=ACTIVE_ADMISSION_STATUSES,
                )
                active_encounter_exists_qs = Encounter.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                ).filter(active_encounter_q)
                completed_outpatient_exists_qs = Encounter.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                    encounter_type='outpatient',
                    status__in=['finished', 'cancelled'],
                )
                deceased_admission_exists_qs = Admission.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                    status='deceased',
                )
                discharged_or_transferred_exists_qs = Admission.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                    status__in=['discharged', 'transferred'],
                )

                local_patients_qs = local_patients_qs.annotate(
                    has_active_admission=Exists(active_admission_exists_qs),
                    has_active_encounter=Exists(active_encounter_exists_qs),
                    has_deceased_admission=Exists(deceased_admission_exists_qs),
                    has_discharged_or_transferred_admission=Exists(discharged_or_transferred_exists_qs),
                    has_completed_outpatient=Exists(completed_outpatient_exists_qs),
                )

                if registry_scope == 'active':
                    local_patients_qs = local_patients_qs.filter(
                        Q(has_active_admission=True) | Q(has_active_encounter=True)
                    )
                elif registry_scope == 'deceased':
                    local_patients_qs = local_patients_qs.filter(has_deceased_admission=True)
                elif registry_scope == 'discharged':
                    local_patients_qs = local_patients_qs.filter(
                        has_active_admission=False,
                        has_active_encounter=False,
                        has_deceased_admission=False,
                    ).filter(
                        Q(has_discharged_or_transferred_admission=True) | Q(has_completed_outpatient=True)
                    )

            admission_filters_active = bool(
                ward_id or admission_start_date or admission_end_date or admission_status or admission_type
            )
            if admission_filters_active:
                admission_qs = Admission.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                )
                if admission_status:
                    admission_qs = admission_qs.filter(status=admission_status)
                else:
                    admission_qs = admission_qs.filter(status__in=ACTIVE_ADMISSION_STATUSES)

                if admission_type:
                    admission_qs = admission_qs.filter(admission_type=admission_type)

                if ward_id:
                    admission_qs = admission_qs.filter(bed__ward_id=ward_id)

                if admission_start_date:
                    start_dt = timezone.make_aware(
                        datetime.combine(admission_start_date, datetime.min.time()),
                        timezone.get_current_timezone()
                    )
                    admission_qs = admission_qs.filter(admission_date__gte=start_dt)

                if admission_end_date:
                    end_dt = timezone.make_aware(
                        datetime.combine(admission_end_date, datetime.min.time()),
                        timezone.get_current_timezone()
                    ) + timedelta(days=1)
                    admission_qs = admission_qs.filter(admission_date__lt=end_dt)

                local_patients_qs = local_patients_qs.filter(Exists(admission_qs))

            encounter_filters_active = bool(department_id or encounter_type)
            if encounter_filters_active:
                encounter_qs = Encounter.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                ).filter(active_encounter_q)
                if encounter_type:
                    encounter_qs = encounter_qs.filter(encounter_type=encounter_type)
                if department_id:
                    encounter_qs = encounter_qs.filter(
                        Q(department_id=department_id) | Q(primary_team_id=department_id)
                    )
                local_patients_qs = local_patients_qs.filter(Exists(encounter_qs))

            if attending_id:
                admission_attending_qs = Admission.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                    admitting_doctor_id=attending_id,
                )
                if admission_status:
                    admission_attending_qs = admission_attending_qs.filter(status=admission_status)
                else:
                    admission_attending_qs = admission_attending_qs.filter(
                        status__in=ACTIVE_ADMISSION_STATUSES
                    )

                encounter_attending_qs = Encounter.objects.filter(
                    patient=OuterRef('pk'),
                    facility=facility,
                    practitioner_id=attending_id,
                ).filter(active_encounter_q)
                if encounter_type:
                    encounter_attending_qs = encounter_attending_qs.filter(encounter_type=encounter_type)

                local_patients_qs = local_patients_qs.filter(
                    Q(Exists(admission_attending_qs)) | Q(Exists(encounter_attending_qs))
                )

            if age_min_value is not None or age_max_value is not None:
                local_patients_qs = local_patients_qs.filter(user__date_of_birth__isnull=False)
                today = timezone.localdate()

                def years_ago(years):
                    try:
                        return today.replace(year=today.year - years)
                    except ValueError:
                        return today.replace(year=today.year - years, month=2, day=28)

                if age_min_value is not None:
                    latest_dob = years_ago(age_min_value)
                    local_patients_qs = local_patients_qs.filter(user__date_of_birth__lte=latest_dob)

                if age_max_value is not None:
                    earliest_dob = years_ago(age_max_value)
                    local_patients_qs = local_patients_qs.filter(user__date_of_birth__gte=earliest_dob)

            # Annotate sortable and serializer fields once to avoid per-row queries.
            active_admission_sort_qs = Admission.objects.filter(
                patient=OuterRef('pk'),
                facility=facility,
                status__in=ACTIVE_ADMISSION_STATUSES,
            ).order_by('-admission_date')
            active_encounter_sort_qs = Encounter.objects.filter(
                patient=OuterRef('pk'),
                facility=facility,
            ).filter(active_encounter_q).order_by('-start_time', '-id')
            terminal_admission_sort_qs = Admission.objects.filter(
                patient=OuterRef('pk'),
                facility=facility,
                status__in=['discharged', 'transferred', 'deceased'],
            ).order_by('-admission_date', '-id')
            completed_outpatient_sort_qs = Encounter.objects.filter(
                patient=OuterRef('pk'),
                facility=facility,
                encounter_type='outpatient',
                status__in=['finished', 'cancelled'],
            ).order_by('-end_time', '-start_time', '-id')
            local_patients_qs = local_patients_qs.annotate(
                sort_admission_date=Subquery(active_admission_sort_qs.values('admission_date')[:1]),
                sort_admission_status=Subquery(active_admission_sort_qs.values('status')[:1]),
                sort_current_ward=Subquery(active_admission_sort_qs.values('bed__ward__name')[:1]),
                sort_patient_location=Coalesce(
                    Subquery(active_admission_sort_qs.values('bed__ward__name')[:1]),
                    Subquery(active_encounter_sort_qs.values('clinic__name')[:1]),
                    Subquery(active_encounter_sort_qs.values('location')[:1]),
                    Value('', output_field=CharField()),
                ),
                sort_registry_status=Coalesce(
                    Subquery(active_admission_sort_qs.values('status')[:1]),
                    Subquery(active_encounter_sort_qs.values('status')[:1]),
                    Subquery(terminal_admission_sort_qs.values('status')[:1]),
                    Subquery(completed_outpatient_sort_qs.values('status')[:1]),
                    Value('', output_field=CharField()),
                ),
                latest_terminal_admission_status=Subquery(terminal_admission_sort_qs.values('status')[:1]),
                latest_completed_outpatient_status=Subquery(completed_outpatient_sort_qs.values('status')[:1]),
            )

            order_fields = [
                f"-{field}" if ordering_desc else field
                for field in ordering_field_map[ordering_key]
            ]
            order_fields.append('-id' if ordering_desc else 'id')
            local_patients_qs = local_patients_qs.order_by(*order_fields)

            paginator = self.pagination_class()
            with track_query_count() as query_counter:
                with measure_duration(
                    'hms_patient_search_latency_seconds',
                    labels={'source': 'database'},
                    description='Patient search latency in seconds.',
                ):
                    page = paginator.paginate_queryset(local_patients_qs, request, view=self)
                    patients_list = page if page is not None else list(local_patients_qs)
                    serializer_class = _patient_search_serializer_class(request.user)
                    results = serializer_class(patients_list, many=True).data

            total_results = getattr(paginator, 'total_count', len(results))
            total_is_exact = getattr(paginator, 'total_is_exact', True)
            page_number = getattr(paginator, 'page_number', 1)
            page_size_value = getattr(paginator, 'page_size_value', (paginator.get_page_size(request) or len(results)))
            next_link = paginator.get_next_link() if page is not None else None
            previous_link = paginator.get_previous_link() if page is not None else None
            observe_histogram(
                'hms_patient_search_query_count',
                query_counter.count,
                labels={'search_index': 'warm' if search_index_ready else 'cold'},
                description='SQL statements executed by patient search requests.',
                buckets=(1, 2, 4, 8, 12, 16, 24, 32),
            )
            observe_histogram(
                'hms_patient_search_results_returned',
                len(results),
                description='Patient search result counts per page.',
                buckets=(1, 5, 10, 25, 50, 100),
            )

            # Log timing
            local_proc_time = time.perf_counter()
            logger.info(
                "Search completed in %.4fs. Returned=%s total=%s exact=%s ordering=%s page=%s page_size=%s queries=%s",
                local_proc_time - start_time,
                len(results),
                total_results,
                total_is_exact,
                ordering,
                page_number,
                page_size_value,
                query_counter.count,
            )

            response_data = {
                "query": query,
                "registry_scope": registry_scope,
                "ordering": ordering,
                "total": total_results,
                "count": total_results,
                "count_exact": total_is_exact,
                "page": page_number,
                "page_size": page_size_value,
                "next": next_link,
                "previous": previous_link,
                "results": results,
            }

            # Cache results for 30 seconds (skip caching for FHIR results)
            if not include_fhir:
                cache.set(cache_key, response_data, timeout=30)

            # Optional: Include FHIR results if explicitly requested and local results are sparse
            if include_fhir and query and not has_other_filters and len(results) < 10:
                fhir_results, fhir_status = self._search_fhir(
                    query,
                    results,
                    user=request.user,
                    facility=facility
                )
                response_data['fhir_results'] = fhir_results
                response_data['fhir_status'] = fhir_status
                if fhir_results:
                    response_data['total'] += len(fhir_results)

            return Response(response_data)

        except Exception as e:
            logger.error(f"Search error: {str(e)}")
            return Response(
                {"error": "Failed to search patients. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(
        detail=False,
        methods=['post'],
        url_path='search-index/reindex',
        permission_classes=[permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin],
    )
    def reindex_search_index(self, request):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        patient_ids = request.data.get('patient_ids') or None
        if patient_ids:
            task = rebuild_patient_search_index_task.delay(
                patient_profile_ids=patient_ids,
                facility_code=facility.code,
            )
        else:
            task = enqueue_patient_search_index_rebuild.delay(
                facility_id=str(facility.id),
                facility_code=facility.code,
            )

        return Response(
            {
                'message': 'Patient search index rebuild queued.',
                'task_id': task.id,
                'facility_code': facility.code,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    def _search_fhir(self, query, existing_results, user, facility):
        """
        Helper method to search FHIR for additional patients.
        Called only when include_fhir=true and local results are sparse.
        """
        try:
            existing_ids = [str(r.get('id')) for r in existing_results if r.get('id')]
            cache_key = facility_cache_key(
                f'fhir_patient_search_{user.id}_{hashlib.md5(query.encode()).hexdigest()}'
            )
            cached = cache.get(cache_key)
            if cached is not None:
                return cached, "available"

            search_patients_in_fhir.delay(
                query,
                str(user.id),
                existing_ids=existing_ids,
                facility_code=facility.code if facility else None
            )
            return [], "pending"
        except Exception:
            logging.getLogger(__name__).warning("FHIR search failed")
            return [], "unavailable"

    @staticmethod
    def _filter_fhir_patient_update_payload(payload):
        """
        Allowlist FHIR Patient fields that can be updated from the API.
        """
        if not isinstance(payload, dict):
            return {}
        allowed_fields = {
            'name',
            'telecom',
            'address',
            'gender',
            'birthDate',
            'communication',
            'contact',
            'maritalStatus',
        }
        return {key: value for key, value in payload.items() if key in allowed_fields}

    @action(detail=True, methods=['get'])
    def get_patient(self, request, pk=None):
        """
        Get a patient by ID.
        Returns full data for clinical access, demographics-only for non-clinical access.
        """
        patient_profile = self._get_facility_patient(request, pk)

        # SECURITY: Check if user has permission to access this patient
        check_demographics_access(request.user, patient_profile)

        # Get access flags for frontend optimization
        access = get_access_flags(request.user, patient_profile)

        # Add to recent patients
        RecentPatient.objects.get_or_create(
            user=request.user,
            patient_profile=patient_profile,
            facility=patient_profile.facility
        )

        # SECURITY: If user only has demographics access (not clinical),
        # return limited data - no clinical info like allergies, blood group, FHIR
        if not access['clinical']:
            user = patient_profile.user
            return Response({
                "local_data": {
                    "id": str(patient_profile.id),
                    "user": str(user.id) if user else None,
                    "user_details": {
                        "id": str(user.id) if user else None,
                        "first_name": user.first_name if user else None,
                        "last_name": user.last_name if user else None,
                        "date_of_birth": user.date_of_birth.isoformat() if user and user.date_of_birth else None,
                        "gender": user.gender if user else None,
                    } if user else None,
                    "medical_record_number": patient_profile.medical_record_number,
                    # Exclude: blood_group, allergies, nhis_id, fhir_patient_id
                },
                "fhir_data": None,  # No FHIR data for demographics-only access
                "access": access
            })

        # Full access - return everything
        fhir_data = None
        fhir_status = "unavailable"
        if patient_profile.fhir_patient_id:
            cache_key = facility_cache_key(f'fhir_patient_snapshot_{patient_profile.id}')
            fhir_data = cache.get(cache_key)
            if fhir_data is not None:
                fhir_status = "available"
            else:
                mapping = PatientFHIRMapping.objects.filter(patient_profile=patient_profile).first()
                if mapping:
                    sync_patient_with_fhir.delay(str(mapping.id), facility_code=request.facility_code)
                    fhir_status = "pending"

        return Response({
            "local_data": PatientProfileSerializer(patient_profile).data,
            "fhir_data": fhir_data,
            "fhir_status": fhir_status,
            "access": access
        })

    @action(detail=True, methods=['get'], url_path='demographics')
    def get_demographics(self, request, pk=None):
        """
        Get patient demographics only (no FHIR, no clinical data).
        Lightweight endpoint for administrative views.
        """
        patient_profile = self._get_facility_patient(request, pk)

        # SECURITY: Check if user has permission to access this patient
        check_demographics_access(request.user, patient_profile)

        # Add to recent patients
        RecentPatient.objects.get_or_create(
            user=request.user,
            patient_profile=patient_profile,
            facility=patient_profile.facility
        )

        return Response(PatientDemographicsSerializer(patient_profile).data)

    @action(detail=True, methods=['post'], url_path='break-glass')
    def break_glass(self, request, pk=None):
        """
        Create a time-bound break-glass access event for clinical data.
        """
        patient_profile = self._get_facility_patient(request, pk)
        serializer = BreakGlassRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        if request.user.user_type not in ['admin', 'doctor', 'nurse']:
            return Response(
                {"error": "Break-glass access is limited to clinical staff."},
                status=status.HTTP_403_FORBIDDEN
            )

        scope = serializer.validated_data.get('scope', 'clinical')
        if scope != 'clinical':
            return Response(
                {"error": "Only clinical break-glass access is supported."},
                status=status.HTTP_400_BAD_REQUEST
            )

        now = timezone.now()
        active_event = BreakGlassEvent.objects.filter(
            user=request.user,
            patient=patient_profile,
            scope=scope,
            expires_at__gt=now
        ).order_by('-expires_at').first()

        if active_event:
            return Response({
                "message": "Break-glass access already active.",
                "break_glass": BreakGlassEventSerializer(active_event).data
            })

        expires_at = now + timedelta(minutes=settings.BREAK_GLASS_TTL_MINUTES)
        event = BreakGlassEvent.objects.create(
            user=request.user,
            patient=patient_profile,
            scope=scope,
            reason=serializer.validated_data['reason'],
            expires_at=expires_at
        )

        AuditService.log(
            request=request,
            action=AuditAction.BREAK_GLASS,
            category=AuditCategory.CLINICAL,
            resource_type='PatientProfile',
            resource_id=patient_profile.id,
            resource_name=patient_profile.user.get_full_name(),
            description=f"Break-glass access granted for patient {patient_profile.medical_record_number}",
            changes={
                'scope': {'old': None, 'new': scope},
                'expires_at': {'old': None, 'new': expires_at.isoformat()},
                'reason': {'old': None, 'new': serializer.validated_data['reason']},
            }
        )

        return Response({
            "message": "Break-glass access granted.",
            "break_glass": BreakGlassEventSerializer(event).data
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['put'])
    def update_patient(self, request, pk=None):
        """
        Update a patient by ID.
        """
        try:
            patient_profile = self._get_facility_patient(request, pk)

            local_data = request.data.get('local_data', {})
            if not isinstance(local_data, dict):
                return Response(
                    {"error": "local_data must be an object."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            fhir_data = request.data.get('fhir_data')
            clinical_profile_fields = {'blood_group', 'allergies', 'fhir_patient_id'}
            requires_clinical_access = bool(fhir_data) or bool(clinical_profile_fields.intersection(local_data))

            if requires_clinical_access:
                check_clinical_access(request.user, patient_profile)
                serializer_class = PatientProfileSerializer
            else:
                check_demographics_access(request.user, patient_profile)
                serializer_class = PatientDemographicsUpdateSerializer

            # Update local patient profile
            profile_serializer = serializer_class(
                patient_profile, 
                data=local_data,
                partial=True,
                context={'request': request}
            )

            if profile_serializer.is_valid():
                profile_serializer.save(updated_by=request.user)

                # Queue FHIR update if requested
                if patient_profile.fhir_patient_id and fhir_data:
                    if request.user.user_type not in ['admin', 'doctor', 'nurse']:
                        raise PermissionDenied("FHIR updates require clinical access.")
                    check_clinical_access(request.user, patient_profile)
                    mapping = PatientFHIRMapping.objects.filter(patient_profile=patient_profile).first()
                    if not mapping:
                        return Response(
                            {"error": "FHIR mapping not found for patient."},
                            status=status.HTTP_400_BAD_REQUEST
                        )
                    update_payload = self._filter_fhir_patient_update_payload(fhir_data)
                    if not update_payload:
                        return Response(
                            {"error": "No allowed FHIR fields provided."},
                            status=status.HTTP_400_BAD_REQUEST
                        )
                    update_patient_in_fhir.delay(
                        str(mapping.id),
                        update_payload,
                        facility_code=request.facility_code
                    )
                    return Response({
                        "message": "Patient local data updated; FHIR update queued",
                        "local_data": PatientProfileSerializer(patient_profile).data,
                        "fhir_status": "queued"
                    }, status=status.HTTP_202_ACCEPTED)

                # If no FHIR data to update or no FHIR ID
                return Response({
                    "message": "Patient local data updated successfully",
                    "local_data": (
                        PatientProfileSerializer(patient_profile).data
                        if requires_clinical_access
                        else PatientDemographicsSerializer(patient_profile).data
                    )
                })
            else:
                return Response(profile_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        except PermissionDenied:
            raise
        except Exception as e:
            logger.error(f"Failed to update patient {pk}: {str(e)}")
            return Response(
                {"error": "Failed to update patient."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['delete'])
    def delete_patient(self, request, pk=None):
        """
        Delete a patient by ID.
        """
        try:
            patient_profile = self._get_facility_patient(request, pk)

            # SECURITY: Check if user has permission to access this patient
            check_demographics_access(request.user, patient_profile)

            # Store FHIR ID before deletion
            fhir_patient_id = patient_profile.fhir_patient_id

            with transaction.atomic():
                # Delete the mapping first
                try:
                    mapping = PatientFHIRMapping.objects.get(patient_profile=patient_profile)
                    mapping.delete()
                except PatientFHIRMapping.DoesNotExist:
                    pass

                # Delete the patient profile and associated user
                user = patient_profile.user
                patient_profile.delete()
                user.delete()

                # Delete the FHIR resource asynchronously if available
                if fhir_patient_id:
                    delete_patient_in_fhir.delay(fhir_patient_id, facility_code=request.facility_code)

                return Response({
                    "message": "Patient deleted successfully"
                }, status=status.HTTP_200_OK)

        except PermissionDenied:
            raise
        except Exception as e:
            logger.error(f"Failed to delete patient {pk}: {str(e)}")
            return Response(
                {"error": "Failed to delete patient."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


attach_required_feature(
    (
        PatientFHIRMappingViewSet,
        PatientSearchViewSet,
        RecentPatientViewSet,
        PatientNoteViewSet,
    ),
    PATIENT_CHRONICLE_FEATURE,
)
attach_required_feature(
    (PatientRegistrationValidationViewSet,),
    PATIENT_REGISTRATION_FEATURE,
)
