"""
Core views for system-wide settings and configuration APIs.
"""
import os
import re
import time
import uuid
from urllib.parse import urlparse

from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.models import Q, Prefetch
from django.http import HttpResponse

from redis import Redis

from apps.users.rbac import IsAdmin
from .features import effective_feature_state
from .models import Facility, FeatureEntitlementOverride, FacilityFluidBalanceSettings
from .metrics import render_prometheus_metrics, set_gauge
from .pagination import StandardResultsSetPagination
from .serializers import (
    FacilityFluidBalanceSettingsSerializer,
    FacilityListSerializer,
    FeatureEntitlementOverrideSerializer,
)
from .mixins import FacilityScopedCreateMixin
from .security import (
    CLINICAL_PATIENT_ACCESS_USER_TYPES,
    FacilityScopedPermission,
    FacilityScopedQuerysetMixin,
    get_accessible_patients_for_clinician,
    get_user_facility,
    get_user_facility_codes,
    is_cross_facility_admin,
    scope_patient_queryset_for_search_access,
)
from hms_backend.deployment import feature_enabled
from hms_backend.feature_manifest import FEATURE_MANIFEST
from hms_backend.celery import app as celery_app


PROCESS_STARTED_AT = time.time()


def _health_response(check_name: str, ok: bool, *, dependencies: dict | None = None, status_code: int = 200):
    payload = {
        'status': 'healthy' if ok else 'unhealthy',
        'check': check_name,
        'service': 'hms-backend',
        'pid': os.getpid(),
        'uptime_seconds': round(max(0.0, time.time() - PROCESS_STARTED_AT), 3),
    }
    if dependencies is not None:
        payload['dependencies'] = dependencies
    return Response(payload, status=status_code)


def _check_database():
    started = time.perf_counter()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        duration = time.perf_counter() - started
        return True, round(duration, 6), None
    except Exception:
        duration = time.perf_counter() - started
        return False, round(duration, 6), 'database_unavailable'


def _check_cache():
    probe_key = f"health:probe:{os.getpid()}:{uuid.uuid4().hex}"
    started = time.perf_counter()
    try:
        cache.set(probe_key, '1', timeout=5)
        cached = cache.get(probe_key)
        cache.delete(probe_key)
        duration = time.perf_counter() - started
        if cached != '1':
            return False, round(duration, 6), 'cache_roundtrip_failed'
        return True, round(duration, 6), None
    except Exception:
        duration = time.perf_counter() - started
        return False, round(duration, 6), 'cache_unavailable'


def _dependency_snapshot():
    db_ok, db_duration, db_error = _check_database()
    cache_ok, cache_duration, cache_error = _check_cache()

    set_gauge(
        'hms_dependency_ready',
        1 if db_ok else 0,
        labels={'dependency': 'database'},
        description='Dependency readiness for process-local health checks.',
    )
    set_gauge(
        'hms_dependency_ready',
        1 if cache_ok else 0,
        labels={'dependency': 'cache'},
        description='Dependency readiness for process-local health checks.',
    )
    set_gauge(
        'hms_process_uptime_seconds',
        max(0.0, time.time() - PROCESS_STARTED_AT),
        description='Process uptime in seconds.',
    )

    dependencies = {
        'database': {
            'status': 'connected' if db_ok else 'disconnected',
            'latency_seconds': db_duration,
        },
        'cache': {
            'status': 'connected' if cache_ok else 'disconnected',
            'latency_seconds': cache_duration,
        },
    }
    if db_error:
        dependencies['database']['error'] = db_error
    if cache_error:
        dependencies['cache']['error'] = cache_error

    return {
        'database_ok': db_ok,
        'cache_ok': cache_ok,
        'dependencies': dependencies,
    }


def _redis_queue_depths():
    broker_url = getattr(settings, 'CELERY_BROKER_URL', '')
    parsed = urlparse(broker_url)
    if parsed.scheme not in {'redis', 'rediss'}:
        return {}

    client = Redis.from_url(broker_url, socket_timeout=1.0, socket_connect_timeout=1.0)
    queue_names = []
    for queue in getattr(settings, 'CELERY_TASK_QUEUES', ()) or ():
        queue_name = getattr(queue, 'name', None)
        if queue_name:
            queue_names.append(queue_name)

    default_queue = getattr(settings, 'CELERY_TASK_DEFAULT_QUEUE', None) or 'celery'
    if default_queue not in queue_names:
        queue_names.append(default_queue)

    return {
        queue_name: int(client.llen(queue_name))
        for queue_name in queue_names
    }


def _collect_celery_operability():
    inspector = celery_app.control.inspect(timeout=1.0)

    try:
        stats = inspector.stats() or {}
    except Exception:
        stats = {}

    try:
        active = inspector.active() or {}
    except Exception:
        active = {}

    try:
        scheduled = inspector.scheduled() or {}
    except Exception:
        scheduled = {}

    try:
        reserved = inspector.reserved() or {}
    except Exception:
        reserved = {}

    workers = {}
    worker_names = set(stats) | set(active) | set(scheduled) | set(reserved)
    for worker_name in sorted(worker_names):
        worker_stats = stats.get(worker_name) or {}
        workers[worker_name] = {
            'active_count': len(active.get(worker_name) or []),
            'scheduled_count': len(scheduled.get(worker_name) or []),
            'reserved_count': len(reserved.get(worker_name) or []),
            'pool_max_concurrency': ((worker_stats.get('pool') or {}).get('max-concurrency')),
            'uptime_seconds': worker_stats.get('uptime'),
            'processed_total': sum((worker_stats.get('total') or {}).values()),
        }

    queue_depths = {}
    try:
        queue_depths = _redis_queue_depths()
    except Exception:
        queue_depths = {}

    return {
        'worker_count': len(workers),
        'workers': workers,
        'queue_depths': queue_depths,
        'aggregates': {
            'active_tasks': sum(worker['active_count'] for worker in workers.values()),
            'scheduled_tasks': sum(worker['scheduled_count'] for worker in workers.values()),
            'reserved_tasks': sum(worker['reserved_count'] for worker in workers.values()),
            'queue_depth_total': sum(queue_depths.values()),
        },
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def health_alive(_request):
    return _health_response('alive', True)


@api_view(['GET'])
@permission_classes([AllowAny])
def health_started(_request):
    return _health_response('started', True)


@api_view(['GET'])
@permission_classes([AllowAny])
def health_ready(_request):
    snapshot = _dependency_snapshot()
    ready = snapshot['database_ok'] and snapshot['cache_ok']
    return _health_response(
        'ready',
        ready,
        dependencies=snapshot['dependencies'],
        status_code=200 if ready else 503,
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def metrics_view(_request):
    snapshot = _dependency_snapshot()
    operability = _collect_celery_operability()

    for queue_name, depth in operability['queue_depths'].items():
        set_gauge(
            'hms_celery_queue_depth',
            depth,
            labels={'queue': queue_name},
            description='Current Redis-backed Celery queue depth.',
        )
    set_gauge(
        'hms_celery_workers',
        operability['worker_count'],
        description='Number of Celery workers visible via control.inspect.',
    )

    body = render_prometheus_metrics(
        extra_lines=[
            f'hms_health_ready {1 if snapshot["database_ok"] and snapshot["cache_ok"] else 0}',
        ]
    )
    response = HttpResponse(body, content_type='text/plain; version=0.0.4; charset=utf-8')
    response['Cache-Control'] = 'no-store'
    return response


class FacilityScopedViewSet(FacilityScopedQuerysetMixin, FacilityScopedCreateMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination


class FacilityViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    serializer_class = FacilityListSerializer

    def get_queryset(self):
        include_inactive = self.request.query_params.get('include_inactive')
        include_inactive = str(include_inactive).lower() in {'1', 'true', 'yes', 'on'}

        queryset = Facility.objects.select_related('parent_facility').order_by('name')

        user = self.request.user
        if not user or not user.is_authenticated:
            return queryset.none()

        allow_cross = getattr(self.request, 'allow_cross_facility', None)
        if allow_cross is None:
            allow_cross = feature_enabled('cross_facility_access')

        if allow_cross and is_cross_facility_admin(user):
            scoped = queryset
        else:
            codes = get_user_facility_codes(user)
            if not codes:
                return queryset.none()
            scoped = queryset.filter(code__in=codes)

        if not include_inactive or (user.user_type != 'admin' and not is_cross_facility_admin(user)):
            scoped = scoped.filter(is_active=True)

        return scoped


class FeatureEntitlementOverrideViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = FeatureEntitlementOverrideSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        queryset = FeatureEntitlementOverride.objects.select_related(
            'facility',
            'created_by',
            'updated_by',
        ).order_by('scope', 'facility__code', 'feature_key')

        if not self.request.user.is_superuser:
            queryset = queryset.filter(
                scope=FeatureEntitlementOverride.SCOPE_FACILITY,
                facility__in=self.request.user.facilities.all(),
            )

        scope = self.request.query_params.get('scope')
        if scope in {
            FeatureEntitlementOverride.SCOPE_GLOBAL,
            FeatureEntitlementOverride.SCOPE_FACILITY,
        }:
            queryset = queryset.filter(scope=scope)

        facility = self.request.query_params.get('facility')
        if facility:
            queryset = queryset.filter(facility__code__iexact=facility)

        return queryset

    def perform_create(self, serializer):
        self._assert_override_scope_allowed(
            serializer.validated_data.get('scope'),
            serializer.validated_data.get('facility'),
        )
        instance = serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
        )
        self._log_change(instance, action='CREATE')

    def perform_update(self, serializer):
        self._assert_override_scope_allowed(
            serializer.validated_data.get('scope', serializer.instance.scope),
            serializer.validated_data.get('facility', serializer.instance.facility),
        )
        instance = serializer.save(updated_by=self.request.user)
        self._log_change(instance, action='UPDATE')

    def _assert_override_scope_allowed(self, scope, facility):
        user = self.request.user
        if scope == FeatureEntitlementOverride.SCOPE_GLOBAL and not user.is_superuser:
            raise PermissionDenied('Only superusers can manage global feature overrides.')

        if scope == FeatureEntitlementOverride.SCOPE_FACILITY and not user.is_superuser:
            if facility is None or not user.facilities.filter(id=facility.id).exists():
                raise PermissionDenied('You can only manage feature overrides for assigned facilities.')

    def perform_destroy(self, instance):
        self._assert_override_scope_allowed(instance.scope, instance.facility)
        feature_key = instance.feature_key
        scope = instance.scope
        facility_code = getattr(instance.facility, 'code', None)
        instance.delete()
        self._log_change_payload(feature_key, scope, facility_code, 'DELETE')

    def _log_change(self, instance, action):
        self._log_change_payload(
            instance.feature_key,
            instance.scope,
            getattr(instance.facility, 'code', None),
            action,
        )

    def _log_change_payload(self, feature_key, scope, facility_code, action):
        from apps.audit.models import AuditAction, AuditCategory
        from apps.audit.services import AuditService

        action_map = {
            'CREATE': AuditAction.CREATE,
            'UPDATE': AuditAction.UPDATE,
            'DELETE': AuditAction.DELETE,
        }
        scope_label = f"{scope}:{facility_code}" if facility_code else scope
        AuditService.log(
            request=self.request,
            action=action_map[action],
            category=AuditCategory.ADMIN,
            resource_type='FeatureEntitlementOverride',
            resource_id=feature_key,
            resource_name=f"{feature_key}:{scope_label}",
            description='Product feature entitlement override changed.',
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def fluid_balance_settings(request):
    """
    Get current facility fluid balance alert settings.

    Returns the current threshold values for fluid balance monitoring.
    Available to all authenticated users.
    """
    settings = FacilityFluidBalanceSettings.get_settings()
    serializer = FacilityFluidBalanceSettingsSerializer(settings)
    return Response(serializer.data)


@api_view(['PATCH'])
@permission_classes([IsAdminUser])
def update_fluid_balance_settings(request):
    """
    Update facility fluid balance alert settings.

    Only admin users can update these settings.
    Accepts partial updates - only send the fields you want to change.
    """
    settings = FacilityFluidBalanceSettings.get_settings()
    serializer = FacilityFluidBalanceSettingsSerializer(data=request.data, partial=True)

    if serializer.is_valid():
        # Update only the fields that were provided
        for field, value in serializer.validated_data.items():
            setattr(settings, field, value)
        settings.save()

        # Return the updated settings
        return Response(FacilityFluidBalanceSettingsSerializer(settings).data)

    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def deployment_capabilities(request):
    """
    Return deployment profile and capability flags for conditional UX logic.
    """
    deployment = getattr(settings, 'DEPLOYMENT', {})
    facility = get_user_facility(request)
    feature_state = effective_feature_state(facility=facility, request=request)
    features = feature_state['features']

    capabilities = dict(getattr(settings, 'DEPLOYMENT_CAPABILITIES', {}))
    capabilities.update({
        'practitioner_scheduling_mode': 'roster'
        if features.get('department_rosters')
        else 'simple',
        'supports_department_rosters': features.get('department_rosters', False),
        'outpatient_requires_active_clinic_schedule': features.get(
            'outpatient_active_clinic_required',
            False,
        ),
        'facility_context_required': features.get('facility_context_required', False),
        'multi_facility_mode': features.get('multi_facility', False),
        'facility_switcher': features.get('facility_switcher', False),
        'cross_facility_access': features.get('cross_facility_access', False),
        'cross_facility_referrals': features.get('cross_facility_referrals', False),
        'cross_facility_record_exchange': features.get(
            'cross_facility_record_exchange',
            False,
        ),
        'inpatient_admissions': features.get('inpatient_admissions', False),
        'wards': features.get('wards', False),
        'bed_management': features.get('bed_management', False),
    })

    manifest = [
        {
            'key': key,
            'label': value.get('label', key),
            'kind': value.get('kind', 'module'),
            'parent': value.get('parent'),
        }
        for key, value in FEATURE_MANIFEST.items()
    ]

    return Response({
        'deployment_profile': getattr(settings, 'DEPLOYMENT_PROFILE', 'hospital'),
        'profile_label': deployment.get('profile_label'),
        'facility_scope': deployment.get('facility_scope'),
        'facility_code': getattr(facility, 'code', None),
        'features': features,
        'feature_sources': feature_state['feature_sources'],
        'capabilities': capabilities,
        'available_profiles': list(getattr(settings, 'DEPLOYMENT_PROFILES', {}).keys())
        if hasattr(settings, 'DEPLOYMENT_PROFILES')
        else ['clinic', 'hospital', 'hospital_network'],
        'feature_manifest': manifest,
    })


# =============================================================================
# Omni Search (Command Palette)
# =============================================================================


OMNI_SUPPORTED_TYPES = frozenset({
    'patients',
    'wards',
    'encounters',
    'appointments',
    'admissions',
    'staff',
})

# Keep this list in sync with frontend `ROLE_GROUPS.CLINICAL` (defensive: backend
# user_type choices may lag behind).
OMNI_CLINICAL_USER_TYPES = frozenset({
    'doctor',
    'nurse',
    'head_nurse',
    'nurse_practitioner',
    'physician',
    'practitioner',
    'inpatient_doctor',
})


def _patient_result_serializer_class(user):
    user_type = getattr(user, 'user_type', None)
    if user_type == 'patient' or user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES:
        from apps.users.serializers import PatientSearchListSerializer
        return PatientSearchListSerializer

    from apps.users.serializers import PatientDirectorySearchListSerializer
    return PatientDirectorySearchListSerializer


def _parse_int(value, *, default, min_value=None, max_value=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    if min_value is not None:
        parsed = max(min_value, parsed)
    if max_value is not None:
        parsed = min(max_value, parsed)
    return parsed


def _normalize_types_param(types_param):
    if not types_param:
        return set()
    raw = [t.strip().lower() for t in str(types_param).split(',')]
    return {t for t in raw if t}


def _allowed_omni_types_for_user(user):
    user_type = getattr(user, 'user_type', None)
    # Keep in sync with the frontend's navigable routes.
    if user_type == 'admin' or is_cross_facility_admin(user):
        return set(OMNI_SUPPORTED_TYPES)

    # Clinical staff and providers.
    if user_type in OMNI_CLINICAL_USER_TYPES:
        return {'patients', 'wards', 'encounters', 'appointments', 'admissions'}

    # Front desk.
    if user_type == 'receptionist':
        return {'patients', 'appointments', 'admissions'}

    # Billing staff can navigate to patient demographics; patient set is scoped.
    if user_type == 'billing':
        return {'patients'}

    # Patient portal (if enabled): self only.
    if user_type == 'patient':
        return {'patients'}

    return set()


def _get_patient_base_queryset(user, facility):
    from apps.users.models import PatientProfile
    from apps.core.security import ACTIVE_ADMISSION_STATUSES
    from apps.wards.models import Admission

    qs = PatientProfile.objects.select_related('user').filter(facility=facility)

    qs = scope_patient_queryset_for_search_access(qs, user, facility)

    # Used by PatientSearchListSerializer without per-row lookups.
    return qs.prefetch_related(
        Prefetch(
            'admissions',
            queryset=Admission.objects.filter(
                facility=facility,
                status__in=ACTIVE_ADMISSION_STATUSES,
            ).select_related('bed', 'bed__ward').order_by('-admission_date'),
            to_attr='active_admissions_list',
        )
    )


def _get_recent_patients_queryset(user, facility, *, limit):
    from apps.patients.models import RecentPatient
    from apps.core.security import ACTIVE_ADMISSION_STATUSES
    from apps.wards.models import Admission

    return RecentPatient.objects.filter(
        user=user,
        facility=facility,
    ).select_related(
        'patient_profile',
        'patient_profile__user',
    ).prefetch_related(
        Prefetch(
            'patient_profile__admissions',
            queryset=Admission.objects.filter(
                facility=facility,
                status__in=ACTIVE_ADMISSION_STATUSES,
            ).select_related('bed', 'bed__ward').order_by('-admission_date'),
            to_attr='active_admissions_list',
        )
    ).order_by('-access_date')[:limit]


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def omni_search(request):
    """
    System-wide omni search endpoint for the command palette.

    Security:
    - Facility-scoped
    - Role-scoped per group
    - No PHI query logging
    - No DB side effects (no search history writes)
    """
    facility = get_user_facility(request)
    if not facility:
        raise PermissionDenied("Facility context is required.")

    user = request.user
    user_type = (getattr(user, 'user_type', None) or '').strip()

    query = (request.query_params.get('q') or '').strip()
    limit = _parse_int(request.query_params.get('limit'), default=8, min_value=1, max_value=20)
    recent_limit = 10

    requested_types = _normalize_types_param(request.query_params.get('types'))
    if requested_types:
        requested_types &= set(OMNI_SUPPORTED_TYPES)

    allowed_types = _allowed_omni_types_for_user(user)
    if requested_types:
        effective_types = sorted(requested_types & allowed_types)
    else:
        effective_types = sorted(allowed_types)

    groups = {
        'recent_patients': [],
        'patients': [],
        'wards': [],
        'encounters': [],
        'appointments': [],
        'admissions': [],
        'staff': [],
    }

    # Recent patients are safe to show when the user can navigate patient detail.
    if 'patients' in allowed_types:
        from rest_framework import serializers

        class OmniRecentPatientSerializer(serializers.Serializer):
            id = serializers.UUIDField(source='patient_profile.id', read_only=True)
            medical_record_number = serializers.CharField(
                source='patient_profile.medical_record_number',
                read_only=True,
            )
            name = serializers.SerializerMethodField()
            date_of_birth = serializers.DateField(
                source='patient_profile.user.date_of_birth',
                read_only=True,
                allow_null=True,
            )
            gender = serializers.CharField(
                source='patient_profile.user.gender',
                read_only=True,
                allow_null=True,
            )
            created_at = serializers.DateTimeField(source='patient_profile.created_at', read_only=True)
            current_ward = serializers.SerializerMethodField()
            admission_status = serializers.SerializerMethodField()
            admission_date = serializers.SerializerMethodField()
            last_accessed_at = serializers.DateTimeField(source='access_date', read_only=True)

            def _get_active_admission(self, obj):
                patient = getattr(obj, 'patient_profile', None)
                if patient and hasattr(patient, 'active_admissions_list') and patient.active_admissions_list:
                    return patient.active_admissions_list[0]
                return None

            def get_name(self, obj):
                patient = getattr(obj, 'patient_profile', None)
                user_obj = getattr(patient, 'user', None) if patient else None
                return user_obj.get_full_name() if user_obj else None

            def get_current_ward(self, obj):
                admission = self._get_active_admission(obj)
                if not admission:
                    return None
                if admission.status == 'waiting':
                    return "Waiting List"
                if admission.bed and admission.bed.ward:
                    return admission.bed.ward.name
                return "Admitted (No Bed)"

            def get_admission_status(self, obj):
                admission = self._get_active_admission(obj)
                return admission.status if admission else None

            def get_admission_date(self, obj):
                admission = self._get_active_admission(obj)
                if admission and admission.admission_date:
                    return admission.admission_date.isoformat()
                return None

        recent_qs = list(_get_recent_patients_queryset(user, facility, limit=recent_limit))
        if user_type == 'patient' or user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES:
            groups['recent_patients'] = OmniRecentPatientSerializer(recent_qs, many=True).data
        else:
            serializer_class = _patient_result_serializer_class(user)
            patient_rows = serializer_class(
                [recent.patient_profile for recent in recent_qs],
                many=True,
            ).data
            for row, recent in zip(patient_rows, recent_qs):
                row['last_accessed_at'] = recent.access_date.isoformat() if recent.access_date else None
            groups['recent_patients'] = patient_rows

    # Treat empty or too-short queries as "recents only" for predictable perf and PHI hygiene.
    if len(query) < 2:
        return Response({
            'query': query,
            'types': [],
            'limit': limit,
            'groups': groups,
        })

    # Build groups only for requested + allowed types.
    effective_types_set = set(effective_types)

    if 'patients' in effective_types_set:
        from apps.core.cache_utils import facility_cache_key
        from apps.patients.models import PatientSearchIndex
        from apps.patients.search_index import apply_search_index_filter
        from django.core.cache import cache as _cache
        patients_qs = _get_patient_base_queryset(user, facility)
        match_reasons = {}
        search_index_ready = bool(_cache.get(facility_cache_key('patient_search_index_ready')))
        if not search_index_ready:
            search_index_ready = PatientSearchIndex.objects.filter(facility=facility).exists()
            if search_index_ready:
                _cache.set(facility_cache_key('patient_search_index_ready'), '1', timeout=300)
        if search_index_ready:
            patients_qs, _, match_reasons = apply_search_index_filter(
                patients_qs,
                facility=facility,
                query=query,
                limit=limit,
                user=user,
            )
        else:
            patients_qs = patients_qs.filter(
                Q(user__first_name__icontains=query)
                | Q(user__last_name__icontains=query)
                | Q(medical_record_number__icontains=query)
                | Q(nhis_id__icontains=query)
            ).order_by('user__last_name', 'user__first_name', 'id')[:limit]
        serializer_class = _patient_result_serializer_class(user)
        patient_rows = list(serializer_class(patients_qs, many=True).data)
        for row in patient_rows:
            row['match_reason'] = match_reasons.get(row.get('id'), 'text_match')
        groups['patients'] = patient_rows

    if 'wards' in effective_types_set:
        from apps.wards.models import Ward, WardSearchIndex
        from apps.wards.serializers import WardSearchSerializer
        from apps.core.search_projections import OMNI_TRIGRAM_THRESHOLD, projection_ready
        from django.contrib.postgres.search import TrigramWordSimilarity

        normalized_q = " ".join(query.split()).lower()
        if projection_ready('wards', facility, WardSearchIndex):
            ward_ids = list(
                WardSearchIndex.objects.filter(facility=facility, is_active=True)
                .annotate(sim=TrigramWordSimilarity(normalized_q, 'search_document'))
                .filter(Q(search_document__icontains=normalized_q) | Q(sim__gte=OMNI_TRIGRAM_THRESHOLD))
                .order_by('-sim')
                .values_list('ward_id', flat=True)[:limit]
            )
            wards_qs = Ward.objects.select_related('department').filter(
                pk__in=ward_ids,
                is_active=True,
            ).order_by('name')[:limit]
        else:
            wards_qs = Ward.objects.select_related('department').filter(
                department__facility=facility,
                is_active=True,
            ).filter(
                Q(name__icontains=query) | Q(ward_type__icontains=query)
            ).order_by('name')[:limit]
        ward_rows = list(WardSearchSerializer(wards_qs, many=True).data)
        for row in ward_rows:
            row['match_reason'] = 'text_match'
        groups['wards'] = ward_rows

    if 'encounters' in effective_types_set:
        from apps.encounters.models import Encounter, EncounterSearchIndex
        from apps.encounters.serializers import EncounterListSerializer
        from apps.core.search_projections import OMNI_TRIGRAM_THRESHOLD, projection_ready
        from django.contrib.postgres.search import TrigramWordSimilarity

        base_encounters_qs = Encounter.objects.select_related(
            'patient',
            'patient__user',
            'practitioner',
            'practitioner__staff',
            'practitioner__staff__user',
            'clinic',
            'department',
            'primary_team',
            'admitted_by_team',
        ).filter(facility=facility)

        if user_type == 'patient':
            base_encounters_qs = base_encounters_qs.filter(patient__user=user)
        elif user_type in OMNI_CLINICAL_USER_TYPES:
            accessible_patients = get_accessible_patients_for_clinician(user)
            base_encounters_qs = base_encounters_qs.filter(patient__in=accessible_patients)
        elif user_type == 'admin' or is_cross_facility_admin(user):
            pass
        elif user_type == 'receptionist':
            pass
        else:
            base_encounters_qs = Encounter.objects.none()

        normalized_q = " ".join(query.split()).lower()
        if projection_ready('encounters', facility, EncounterSearchIndex):
            enc_ids = (
                EncounterSearchIndex.objects.filter(facility=facility)
                .annotate(sim=TrigramWordSimilarity(normalized_q, 'search_document'))
                .filter(Q(search_document__icontains=normalized_q) | Q(sim__gte=OMNI_TRIGRAM_THRESHOLD))
                .values_list('encounter_id', flat=True)
            )
            encounters_qs = base_encounters_qs.filter(pk__in=enc_ids).order_by('-start_time')[:limit]
        else:
            encounters_qs = base_encounters_qs.filter(
                Q(patient__user__first_name__icontains=query)
                | Q(patient__user__last_name__icontains=query)
                | Q(reason__icontains=query)
                | Q(location__icontains=query)
            ).order_by('-start_time')[:limit]
        enc_rows = list(EncounterListSerializer(encounters_qs, many=True).data)
        for row in enc_rows:
            row['match_reason'] = 'text_match'
        groups['encounters'] = enc_rows

    if 'appointments' in effective_types_set:
        from apps.appointments.models import Appointment, AppointmentSearchIndex
        from apps.appointments.serializers import AppointmentListSerializer
        from apps.core.search_projections import OMNI_TRIGRAM_THRESHOLD, projection_ready
        from django.contrib.postgres.search import TrigramWordSimilarity

        base_appointments_qs = Appointment.objects.select_related(
            'patient',
            'patient__user',
            'practitioner',
            'practitioner__staff',
            'practitioner__staff__user',
            'clinic',
            'appointment_type',
        ).filter(facility=facility)

        if user_type in OMNI_CLINICAL_USER_TYPES:
            base_appointments_qs = base_appointments_qs.filter(practitioner__staff__user=user)
        elif user_type not in {'admin', 'receptionist'} and not is_cross_facility_admin(user):
            base_appointments_qs = Appointment.objects.none()

        normalized_q = " ".join(query.split()).lower()
        if projection_ready('appointments', facility, AppointmentSearchIndex):
            appt_ids = (
                AppointmentSearchIndex.objects.filter(facility=facility)
                .annotate(sim=TrigramWordSimilarity(normalized_q, 'search_document'))
                .filter(Q(search_document__icontains=normalized_q) | Q(sim__gte=OMNI_TRIGRAM_THRESHOLD))
                .values_list('appointment_id', flat=True)
            )
            appointments_qs = base_appointments_qs.filter(pk__in=appt_ids).order_by('start_time')[:limit]
        else:
            appointments_qs = base_appointments_qs.filter(
                Q(patient__user__first_name__icontains=query)
                | Q(patient__user__last_name__icontains=query)
                | Q(patient__medical_record_number__icontains=query)
            ).order_by('start_time')[:limit]
        appt_rows = list(AppointmentListSerializer(appointments_qs, many=True).data)
        for row in appt_rows:
            row['match_reason'] = 'text_match'
        groups['appointments'] = appt_rows

    if 'admissions' in effective_types_set:
        from apps.wards.models import Admission, AdmissionSearchIndex
        from apps.wards.serializers import AdmissionListSerializer
        from apps.core.search_projections import OMNI_TRIGRAM_THRESHOLD, projection_ready
        from django.contrib.postgres.search import TrigramWordSimilarity

        base_admissions_qs = Admission.objects.select_related(
            'patient',
            'patient__user',
            'bed',
            'bed__ward',
            'admitting_doctor',
            'admitting_doctor__staff',
            'admitting_doctor__staff__user',
        ).filter(facility=facility)

        if user_type in OMNI_CLINICAL_USER_TYPES:
            accessible_patients = get_accessible_patients_for_clinician(user)
            base_admissions_qs = base_admissions_qs.filter(patient__in=accessible_patients)
        elif user_type not in {'admin', 'receptionist'} and not is_cross_facility_admin(user):
            base_admissions_qs = Admission.objects.none()

        normalized_q = " ".join(query.split()).lower()
        if projection_ready('admissions', facility, AdmissionSearchIndex):
            adm_ids = (
                AdmissionSearchIndex.objects.filter(facility=facility)
                .annotate(sim=TrigramWordSimilarity(normalized_q, 'search_document'))
                .filter(Q(search_document__icontains=normalized_q) | Q(sim__gte=OMNI_TRIGRAM_THRESHOLD))
                .values_list('admission_id', flat=True)
            )
            admissions_qs = base_admissions_qs.filter(pk__in=adm_ids).order_by('-admission_date')[:limit]
        else:
            admissions_qs = base_admissions_qs.filter(
                Q(patient__user__first_name__icontains=query)
                | Q(patient__user__last_name__icontains=query)
                | Q(patient__medical_record_number__icontains=query)
                | Q(bed__ward__name__icontains=query)
                | Q(bed__bed_number__icontains=query)
            ).order_by('-admission_date')[:limit]
        adm_rows = list(AdmissionListSerializer(admissions_qs, many=True).data)
        for row in adm_rows:
            row['match_reason'] = 'text_match'
        groups['admissions'] = adm_rows

    if 'staff' in effective_types_set and (user_type == 'admin' or is_cross_facility_admin(user)):
        from apps.users.models import Staff, StaffSearchIndex
        from apps.users.serializers import StaffSearchSerializer
        from apps.core.search_projections import OMNI_TRIGRAM_THRESHOLD, projection_ready
        from django.contrib.postgres.search import TrigramWordSimilarity

        normalized_query = (
            query
            .replace('\u2013', '-')
            .replace('\u2014', '-')
            .replace('\u2212', '-')
        )

        normalized_q = " ".join(normalized_query.split()).lower()
        is_id_query = bool(re.fullmatch(r"[A-Za-z0-9\-]+", normalized_q)) and any(
            char.isdigit() for char in normalized_q
        )

        if projection_ready('staff', facility, StaffSearchIndex):
            staff_index_qs = StaffSearchIndex.objects.filter(facility=facility)
            if is_id_query:
                matched = staff_index_qs.filter(
                    employee_id__istartswith=normalized_q
                ).values_list('staff_id', flat=True)
            else:
                matched = (
                    staff_index_qs
                    .annotate(sim=TrigramWordSimilarity(normalized_q, 'search_document'))
                    .filter(Q(search_document__icontains=normalized_q) | Q(sim__gte=OMNI_TRIGRAM_THRESHOLD))
                    .order_by('-sim')
                    .values_list('staff_id', flat=True)
                )
            staff_qs = Staff.objects.select_related('user', 'practitioner_profile').filter(
                pk__in=matched
            ).order_by('user__last_name', 'user__first_name')
        else:
            staff_qs = Staff.objects.select_related('user', 'practitioner_profile').filter(
                primary_facility=facility
            )
            if is_id_query:
                staff_qs = staff_qs.filter(employee_id__istartswith=normalized_q).order_by('employee_id')
            else:
                tokens = [t for t in normalized_q.split() if t]
                if len(tokens) >= 2:
                    first, second = tokens[0], tokens[1]
                    staff_qs = staff_qs.filter(
                        Q(user__first_name__icontains=first, user__last_name__icontains=second)
                        | Q(user__first_name__icontains=second, user__last_name__icontains=first)
                    )
                else:
                    token = tokens[0] if tokens else normalized_q
                    staff_qs = staff_qs.filter(
                        Q(user__first_name__icontains=token) | Q(user__last_name__icontains=token)
                    )
                staff_qs = staff_qs.order_by('user__last_name', 'user__first_name')

        staff_rows = list(StaffSearchSerializer(staff_qs[:limit], many=True).data)
        for row in staff_rows:
            row['match_reason'] = 'employee_id' if is_id_query else 'text_match'
        groups['staff'] = staff_rows

    return Response({
        'query': query,
        'types': effective_types,
        'limit': limit,
        'groups': groups,
    })
