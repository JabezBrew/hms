"""
DRF ViewSets for the organization app.

Provides CRUD operations and specialized endpoints for organizational hierarchy management.
"""
import hashlib
import re

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponseNotModified
from django.db.models import Q, Count
from django.utils.cache import patch_vary_headers
from django.utils import timezone
from django.utils.http import http_date, parse_http_date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, get_user_facility
from apps.users.rbac import IsAdmin

from .models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    Clinic,
    ClinicSchedule,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
    UnitWardAllocation,
    ShiftDefinition,
    DutyRosterTemplate,
    DutyRoster,
)
from .serializers import (
    UnitTypeConfigListSerializer,
    UnitTypeConfigSerializer,
    LeadershipRoleConfigListSerializer,
    LeadershipRoleConfigSerializer,
    StaffAssignmentTypeConfigSerializer,
    ClinicalUnitListSerializer,
    ClinicalUnitTreeSerializer,
    ClinicalUnitSerializer,
    ClinicalUnitCreateSerializer,
    ClinicListSerializer,
    ClinicSerializer,
    ClinicScheduleListSerializer,
    ClinicScheduleSerializer,
    UnitLeadershipListSerializer,
    UnitLeadershipSerializer,
    StaffUnitAssignmentListSerializer,
    StaffUnitAssignmentSerializer,
    UnitMemberAssignmentListSerializer,
    UnitMemberAssignmentSerializer,
    CrossCoverageScheduleListSerializer,
    CrossCoverageScheduleSerializer,
    UnitWardAllocationListSerializer,
    UnitWardAllocationSerializer,
    ShiftDefinitionListSerializer,
    ShiftDefinitionSerializer,
    DutyRosterTemplateListSerializer,
    DutyRosterTemplateSerializer,
    DutyRosterListSerializer,
    DutyRosterSerializer,
    GenerateRosterSerializer,
    SwapDutySerializer,
    OnDutyQuerySerializer,
)
from apps.core.cache_utils import facility_cache_key
from .tree_cache import ORG_TREE_CACHE_TTL, get_org_tree_payload

STAFF_LIST_CACHE_TTL = 60 * 60 * 3  # 3 hours
STAFF_LIST_MIN_QUERY_LEN = 2
ASSIGNMENT_LIST_CACHE_SCHEMA_VERSION = 2


def _get_unit_list_cache_version(kind, unit_id):
    cache_key = facility_cache_key(f'org_unit_{kind}_version:{unit_id}')
    version = cache.get(cache_key)
    if version is None:
        cache.set(cache_key, 1, timeout=None)
        version = 1
    return version


def _build_unit_list_cache_key(kind, unit_id, user_id, include_descendants, query, page, page_size, today):
    normalized_query = (query or '').strip().lower()
    query_hash = (
        hashlib.md5(normalized_query.encode()).hexdigest()
        if normalized_query
        else 'none'
    )
    version = _get_unit_list_cache_version(kind, unit_id)
    return facility_cache_key(
        f'org_unit_{kind}_list:s{ASSIGNMENT_LIST_CACHE_SCHEMA_VERSION}:v{version}:'
        f'{unit_id}:{user_id}:{int(include_descendants)}:{page}:{page_size}:{today}:{query_hash}'
    )


def _build_unit_counts_cache_key(kind, unit_id, user_id, include_descendants, query, today):
    normalized_query = (query or '').strip().lower()
    query_hash = (
        hashlib.md5(normalized_query.encode()).hexdigest()
        if normalized_query
        else 'none'
    )
    version = _get_unit_list_cache_version(kind, unit_id)
    return facility_cache_key(
        f'org_unit_{kind}_counts:s{ASSIGNMENT_LIST_CACHE_SCHEMA_VERSION}:v{version}:'
        f'{unit_id}:{user_id}:{int(include_descendants)}:{today}:{query_hash}'
    )


def _apply_assignment_search(queryset, query, user_field_prefix, employee_field):
    if not query:
        return queryset

    normalized_query = (
        query
        .replace('\u2013', '-')
        .replace('\u2014', '-')
        .replace('\u2212', '-')
    )
    is_id_query = bool(re.fullmatch(r"[A-Za-z0-9\-]+", normalized_query)) and any(
        char.isdigit() for char in normalized_query
    )
    if is_id_query:
        return queryset.filter(**{f'{employee_field}__istartswith': normalized_query})

    tokens = [token for token in normalized_query.split() if token]
    if len(tokens) >= 2:
        first, second = tokens[0], tokens[1]
        return queryset.filter(
            Q(**{
                f'{user_field_prefix}first_name__icontains': first,
                f'{user_field_prefix}last_name__icontains': second
            }) |
            Q(**{
                f'{user_field_prefix}first_name__icontains': second,
                f'{user_field_prefix}last_name__icontains': first
            })
        )

    token = tokens[0] if tokens else normalized_query
    return queryset.filter(
        Q(**{f'{user_field_prefix}first_name__icontains': token}) |
        Q(**{f'{user_field_prefix}last_name__icontains': token})
    )


def _use_shared_cache():
    backend = settings.CACHES.get('default', {}).get('BACKEND', '')
    return backend != 'django.core.cache.backends.locmem.LocMemCache'


def _etag_matches(if_none_match, etag):
    if not if_none_match:
        return False
    if if_none_match.strip() == '*':
        return True
    quoted = f'"{etag}"'
    weak = f'W/"{etag}"'
    tags = [tag.strip() for tag in if_none_match.split(',') if tag.strip()]
    return quoted in tags or weak in tags


def _is_not_modified(request, etag, last_modified):
    if_none_match = request.headers.get('If-None-Match')
    if if_none_match and _etag_matches(if_none_match, etag):
        return True
    if_modified_since = request.headers.get('If-Modified-Since')
    if if_modified_since:
        parsed = parse_http_date(if_modified_since)
        if parsed is not None and parsed >= last_modified:
            return True
    return False


def _set_tree_cache_headers(response, etag, last_modified):
    response['ETag'] = f'"{etag}"'
    response['Last-Modified'] = http_date(last_modified)
    response['Cache-Control'] = (
        f'private, max-age={ORG_TREE_CACHE_TTL}, must-revalidate'
    )
    patch_vary_headers(response, ['Authorization'])
    return response

# =============================================================================
# Configuration ViewSets
# =============================================================================


class UnitTypeConfigViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing unit type configurations.

    Unit types define the types of organizational units that can exist
    (e.g., facility, department, team) and their capabilities.
    """
    queryset = UnitTypeConfig.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return UnitTypeConfigListSerializer
        return UnitTypeConfigSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == 'list':
            # Only show active by default for lists
            if self.request.query_params.get('include_inactive') != 'true':
                queryset = queryset.filter(is_active=True)
        else:
            # Include allowed_parent_types for detail views
            queryset = queryset.prefetch_related('allowed_parent_types')
        return queryset.order_by('display_order', 'name')


class LeadershipRoleConfigViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing leadership role configurations.

    Leadership roles define positions like Head, Deputy, Nurse Manager
    and their associated permissions.
    """
    queryset = LeadershipRoleConfig.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return LeadershipRoleConfigListSerializer
        return LeadershipRoleConfigSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == 'list':
            if self.request.query_params.get('include_inactive') != 'true':
                queryset = queryset.filter(is_active=True)
        else:
            queryset = queryset.prefetch_related('applicable_unit_types')

        # Filter by unit type if specified
        unit_type = self.request.query_params.get('unit_type')
        if unit_type:
            queryset = queryset.filter(applicable_unit_types__code=unit_type)

        return queryset.order_by('display_order', 'name')


class StaffAssignmentTypeConfigViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing staff assignment type configurations.

    Assignment types define how staff are assigned to units
    (e.g., single, primary/secondary, rotational).
    """
    queryset = StaffAssignmentTypeConfig.objects.all()
    serializer_class = StaffAssignmentTypeConfigSerializer
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
        return queryset.order_by('name')


# =============================================================================
# Clinical Unit ViewSet
# =============================================================================


class ClinicalUnitViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing clinical units.

    Provides CRUD operations plus specialized endpoints for:
    - Tree view of the organizational hierarchy
    - Children/ancestors of a specific unit
    - Staff and leadership assignments
    - Ward allocations
    """
    queryset = ClinicalUnit.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit_type', 'parent', 'is_active', 'accepts_admissions']
    search_fields = ['code', 'name', 'short_name']

    def get_permissions(self):
        if self.action == 'tree':
            return [IsAdmin(), FacilityScopedPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return ClinicalUnitListSerializer
        if self.action == 'tree':
            return ClinicalUnitTreeSerializer
        if self.action in ['create', 'update', 'partial_update']:
            return ClinicalUnitCreateSerializer
        return ClinicalUnitSerializer

    def get_queryset(self):
        queryset = super().get_queryset()

        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()

        # Optimize with select_related for common foreign keys
        queryset = queryset.select_related('unit_type', 'parent', 'root_unit')

        # Filter by active status
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)

        # Scope to the active facility context
        queryset = queryset.filter(root_unit__code=facility.code)

        # Filter to only root nodes
        if self.request.query_params.get('roots_only') == 'true':
            queryset = queryset.filter(parent__isnull=True)

        return queryset.order_by('tree_id', 'lft')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        parent = serializer.validated_data.get('parent')
        if parent:
            root = parent.root_unit or parent.get_root()
            if root and root.code != facility.code:
                raise PermissionDenied("Parent unit does not belong to the active facility.")
        else:
            code = serializer.validated_data.get('code')
            if code and code.strip().upper() != facility.code:
                raise PermissionDenied("Root unit code must match active facility code.")
        serializer.save()

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        parent = serializer.validated_data.get('parent')
        if parent:
            root = parent.root_unit or parent.get_root()
            if root and root.code != facility.code:
                raise PermissionDenied("Parent unit does not belong to the active facility.")
        serializer.save()

    @action(detail=False, methods=['get'])
    def tree(self, request):
        """
        Get the full organizational tree.

        Returns root nodes with nested children for building a tree UI.
        """
        include_inactive = request.query_params.get('include_inactive') == 'true'
        facility = get_user_facility(request)
        facility_id = request.query_params.get('facility') or None
        if facility:
            root_unit = ClinicalUnit.objects.filter(
                unit_type__code='facility',
                code=facility.code
            ).only('id').first()
            if not root_unit:
                return Response([])
            facility_id = root_unit.id
        payload = get_org_tree_payload(
            facility_id=facility_id,
            include_inactive=include_inactive
        )
        etag = payload['etag']
        last_modified = payload['last_modified']
        if _is_not_modified(request, etag, last_modified):
            response = HttpResponseNotModified()
            return _set_tree_cache_headers(response, etag, last_modified)
        response = Response(payload['data'])
        return _set_tree_cache_headers(response, etag, last_modified)

    @action(detail=True, methods=['get'])
    def children(self, request, pk=None):
        """Get direct children of a unit."""
        unit = self.get_object()
        children = unit.get_children().filter(is_active=True)
        serializer = ClinicalUnitListSerializer(children, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def ancestors(self, request, pk=None):
        """Get all ancestors of a unit (path to root)."""
        unit = self.get_object()
        ancestors = unit.get_ancestors()
        serializer = ClinicalUnitListSerializer(ancestors, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def descendants(self, request, pk=None):
        """Get all descendants of a unit."""
        unit = self.get_object()
        descendants = unit.get_descendants().filter(is_active=True)
        page = self.paginate_queryset(descendants)
        if page is not None:
            serializer = ClinicalUnitListSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)
        serializer = ClinicalUnitListSerializer(descendants, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def leaders(self, request, pk=None):
        """Get current leadership of a unit."""
        unit = self.get_object()
        today = timezone.now().date()
        leadership = UnitLeadership.objects.filter(
            unit=unit,
            is_active=True,
            effective_from__lte=today
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        ).select_related('role', 'user')
        serializer = UnitLeadershipListSerializer(leadership, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def staff(self, request, pk=None):
        """Get current staff assigned to a unit."""
        unit = self.get_object()
        if unit.staffing_mode == 'ops_only':
            return Response(
                {'detail': 'Operations-only units use non-clinical member assignments.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        include_descendants = request.query_params.get('include_descendants') == 'true'
        query = (request.query_params.get('q') or '').strip()
        if query and len(query) < STAFF_LIST_MIN_QUERY_LEN:
            query = ''
        today = timezone.now().date()
        page = request.query_params.get('page', 1)
        page_size = (
            self.paginator.get_page_size(request)
            if self.paginator is not None
            else StandardResultsSetPagination.page_size
        )
        page_size = page_size or StandardResultsSetPagination.page_size
        use_cache = _use_shared_cache()
        cache_key = None
        if use_cache:
            cache_key = _build_unit_list_cache_key(
                'staff',
                unit.id,
                request.user.id,
                include_descendants,
                query,
                page,
                page_size,
                today.isoformat()
            )
            cached = cache.get(cache_key)
            if cached is not None:
                return Response(cached)
        units_qs = (
            unit.get_descendants(include_self=True).filter(is_active=True)
            if include_descendants
            else ClinicalUnit.objects.filter(pk=unit.pk)
        )
        staff = StaffUnitAssignment.objects.filter(
            unit__in=units_qs,
            is_active=True
        ).filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=today)
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        )
        staff = _apply_assignment_search(
            staff,
            query,
            'practitioner__staff__user__',
            'practitioner__staff__employee_id'
        ).select_related(
            'unit',
            'unit__unit_type',
            'practitioner',
            'practitioner__staff',
            'practitioner__staff__user',
            'assignment_type'
        ).order_by('-assigned_at')
        page = self.paginate_queryset(staff)
        if page is not None:
            serializer = StaffUnitAssignmentListSerializer(page, many=True, context={'request': request})
            response = self.get_paginated_response(serializer.data)
            if use_cache and cache_key:
                cache.set(cache_key, response.data, timeout=STAFF_LIST_CACHE_TTL)
            return response
        serializer = StaffUnitAssignmentListSerializer(staff, many=True, context={'request': request})
        response_data = serializer.data
        if use_cache and cache_key:
            cache.set(cache_key, response_data, timeout=STAFF_LIST_CACHE_TTL)
        return Response(response_data)

    @action(detail=True, methods=['get'], url_path='staff/counts')
    def staff_counts(self, request, pk=None):
        """Get counts of staff assignments grouped by unit."""
        unit = self.get_object()
        if unit.staffing_mode == 'ops_only':
            return Response(
                {'detail': 'Operations-only units use non-clinical member assignments.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        include_descendants = request.query_params.get('include_descendants') == 'true'
        query = (request.query_params.get('q') or '').strip()
        if query and len(query) < STAFF_LIST_MIN_QUERY_LEN:
            query = ''
        today = timezone.now().date()
        cache_key = _build_unit_counts_cache_key(
            'staff',
            unit.id,
            request.user.id,
            include_descendants,
            query,
            today.isoformat()
        )
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)
        units_qs = (
            unit.get_descendants(include_self=True).filter(is_active=True)
            if include_descendants
            else ClinicalUnit.objects.filter(pk=unit.pk)
        )
        staff = StaffUnitAssignment.objects.filter(
            unit__in=units_qs,
            is_active=True
        ).filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=today)
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        )
        staff = _apply_assignment_search(
            staff,
            query,
            'practitioner__staff__user__',
            'practitioner__staff__employee_id'
        )
        counts = staff.values('unit_id').annotate(count=Count('id')).order_by()
        response_data = {str(row['unit_id']): row['count'] for row in counts}
        cache.set(cache_key, response_data, timeout=STAFF_LIST_CACHE_TTL)
        return Response(response_data)

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """Get current ops members assigned to a unit."""
        unit = self.get_object()
        if unit.staffing_mode == 'clinical_only':
            return Response(
                {'detail': 'Clinical-only units use practitioner staff assignments.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        include_descendants = request.query_params.get('include_descendants') == 'true'
        query = (request.query_params.get('q') or '').strip()
        if query and len(query) < STAFF_LIST_MIN_QUERY_LEN:
            query = ''
        today = timezone.now().date()
        page = request.query_params.get('page', 1)
        page_size = (
            self.paginator.get_page_size(request)
            if self.paginator is not None
            else StandardResultsSetPagination.page_size
        )
        page_size = page_size or StandardResultsSetPagination.page_size
        use_cache = _use_shared_cache()
        cache_key = None
        if use_cache:
            cache_key = _build_unit_list_cache_key(
                'members',
                unit.id,
                request.user.id,
                include_descendants,
                query,
                page,
                page_size,
                today.isoformat()
            )
            cached = cache.get(cache_key)
            if cached is not None:
                return Response(cached)
        units_qs = (
            unit.get_descendants(include_self=True).filter(is_active=True)
            if include_descendants
            else ClinicalUnit.objects.filter(pk=unit.pk)
        )
        members = UnitMemberAssignment.objects.filter(
            unit__in=units_qs,
            is_active=True
        ).filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=today)
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        )
        members = _apply_assignment_search(
            members,
            query,
            'staff__user__',
            'staff__employee_id'
        ).select_related(
            'unit',
            'unit__unit_type',
            'staff',
            'staff__user',
            'assignment_type'
        ).order_by('-assigned_at')
        page = self.paginate_queryset(members)
        if page is not None:
            serializer = UnitMemberAssignmentListSerializer(page, many=True, context={'request': request})
            response = self.get_paginated_response(serializer.data)
            if use_cache and cache_key:
                cache.set(cache_key, response.data, timeout=STAFF_LIST_CACHE_TTL)
            return response
        serializer = UnitMemberAssignmentListSerializer(members, many=True, context={'request': request})
        response_data = serializer.data
        if use_cache and cache_key:
            cache.set(cache_key, response_data, timeout=STAFF_LIST_CACHE_TTL)
        return Response(response_data)

    @action(detail=True, methods=['get'], url_path='members/counts')
    def members_counts(self, request, pk=None):
        """Get counts of ops member assignments grouped by unit."""
        unit = self.get_object()
        if unit.staffing_mode == 'clinical_only':
            return Response(
                {'detail': 'Clinical-only units use practitioner staff assignments.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        include_descendants = request.query_params.get('include_descendants') == 'true'
        query = (request.query_params.get('q') or '').strip()
        if query and len(query) < STAFF_LIST_MIN_QUERY_LEN:
            query = ''
        today = timezone.now().date()
        cache_key = _build_unit_counts_cache_key(
            'members',
            unit.id,
            request.user.id,
            include_descendants,
            query,
            today.isoformat()
        )
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)
        units_qs = (
            unit.get_descendants(include_self=True).filter(is_active=True)
            if include_descendants
            else ClinicalUnit.objects.filter(pk=unit.pk)
        )
        members = UnitMemberAssignment.objects.filter(
            unit__in=units_qs,
            is_active=True
        ).filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=today)
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        )
        members = _apply_assignment_search(
            members,
            query,
            'staff__user__',
            'staff__employee_id'
        )
        counts = members.values('unit_id').annotate(count=Count('id')).order_by()
        response_data = {str(row['unit_id']): row['count'] for row in counts}
        cache.set(cache_key, response_data, timeout=STAFF_LIST_CACHE_TTL)
        return Response(response_data)

    @action(detail=True, methods=['get'])
    def wards(self, request, pk=None):
        """Get ward allocations for a unit."""
        unit = self.get_object()
        allocations = UnitWardAllocation.objects.filter(
            unit=unit,
            is_active=True
        ).select_related('ward')
        serializer = UnitWardAllocationListSerializer(allocations, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def coverage(self, request, pk=None):
        """Get active coverage schedules for a unit."""
        unit = self.get_object()
        now = timezone.now()
        coverage = CrossCoverageSchedule.objects.filter(
            covered_unit=unit,
            is_active=True,
            start_datetime__lte=now,
            end_datetime__gte=now
        ).select_related('covering_practitioner', 'covering_unit')
        serializer = CrossCoverageScheduleListSerializer(coverage, many=True, context={'request': request})
        return Response(serializer.data)


# =============================================================================
# Clinic ViewSet
# =============================================================================


class ClinicViewSet(viewsets.ModelViewSet):
    """ViewSet for managing outpatient clinics."""
    queryset = Clinic.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['department', 'is_active']
    search_fields = ['code', 'name']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdmin(), FacilityScopedPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return ClinicListSerializer
        return ClinicSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('facility', 'department')
        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()
        return queryset.filter(facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department')
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department')
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        serializer.save(updated_by=self.request.user)


# =============================================================================
# Clinic Schedule ViewSet
# =============================================================================


class ClinicScheduleViewSet(viewsets.ModelViewSet):
    """ViewSet for managing clinic schedules."""
    queryset = ClinicSchedule.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['department', 'clinic', 'day_of_week', 'is_active']
    search_fields = ['clinic__code', 'clinic__name', 'department__name']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdmin(), FacilityScopedPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return ClinicScheduleListSerializer
        return ClinicScheduleSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('facility', 'department', 'clinic')
        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()
        return queryset.filter(facility=facility)

    def _validate_facility_relations(self, facility, department, clinic):
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        if clinic and clinic.facility_id != facility.id:
            raise PermissionDenied("Clinic does not belong to the active facility.")
        if department and clinic and clinic.department_id != department.id:
            raise PermissionDenied("Clinic does not belong to the selected department.")

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department')
        clinic = serializer.validated_data.get('clinic')
        self._validate_facility_relations(facility, department, clinic)
        serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department') or serializer.instance.department
        clinic = serializer.validated_data.get('clinic') or serializer.instance.clinic
        self._validate_facility_relations(facility, department, clinic)
        serializer.save(updated_by=self.request.user)


# =============================================================================
# Leadership ViewSet
# =============================================================================


class UnitLeadershipViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing unit leadership assignments.
    """
    queryset = UnitLeadership.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'role', 'user', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return UnitLeadershipListSerializer
        return UnitLeadershipSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        queryset = queryset.select_related('unit', 'role', 'user')

        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()
        queryset = queryset.filter(unit__root_unit__code=facility.code)

        # Filter by currently effective
        if self.request.query_params.get('current') == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True,
                effective_from__lte=today
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            )

        return queryset.order_by('-effective_from')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        serializer.save()


# =============================================================================
# Staff Assignment ViewSet
# =============================================================================


class StaffUnitAssignmentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing staff unit assignments.
    """
    queryset = StaffUnitAssignment.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'practitioner', 'assignment_type', 'is_primary', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return StaffUnitAssignmentListSerializer
        return StaffUnitAssignmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        queryset = queryset.select_related('unit', 'practitioner', 'assignment_type')

        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()
        queryset = queryset.filter(unit__root_unit__code=facility.code)

        # Filter by currently effective
        if self.request.query_params.get('current') == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            )

        return queryset.order_by('-assigned_at')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        serializer.save()


# =============================================================================
# Ops Unit Member ViewSet
# =============================================================================


class UnitMemberAssignmentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing non-clinical unit member assignments.
    """
    queryset = UnitMemberAssignment.objects.all()
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'staff', 'assignment_type', 'is_primary', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return UnitMemberAssignmentListSerializer
        return UnitMemberAssignmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        queryset = queryset.select_related('unit', 'staff', 'staff__user', 'assignment_type')

        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()
        queryset = queryset.filter(unit__root_unit__code=facility.code)

        if self.request.query_params.get('current') == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            )

        return queryset.order_by('-assigned_at')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        serializer.save()

# =============================================================================
# Cross Coverage ViewSet
# =============================================================================


class CrossCoverageScheduleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing cross-coverage schedules.
    """
    queryset = CrossCoverageSchedule.objects.all()
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['covered_unit', 'covering_practitioner', 'covering_unit', 'coverage_type', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return CrossCoverageScheduleListSerializer
        return CrossCoverageScheduleSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        queryset = queryset.select_related('covered_unit', 'covering_practitioner', 'covering_unit')

        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()
        queryset = queryset.filter(covered_unit__root_unit__code=facility.code)

        # Filter by currently active
        if self.request.query_params.get('current') == 'true':
            now = timezone.now()
            queryset = queryset.filter(
                is_active=True,
                start_datetime__lte=now,
                end_datetime__gte=now
            )

        return queryset.order_by('-start_datetime')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        covered_unit = serializer.validated_data.get('covered_unit')
        if covered_unit and covered_unit.root_unit and covered_unit.root_unit.code != facility.code:
            raise PermissionDenied("Covered unit does not belong to the active facility.")
        serializer.save()


# =============================================================================
# Ward Allocation ViewSet
# =============================================================================


class UnitWardAllocationViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing unit-ward bed allocations.
    """
    queryset = UnitWardAllocation.objects.all()
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'ward', 'allocation_type', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return UnitWardAllocationListSerializer
        return UnitWardAllocationSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        queryset = queryset.select_related('unit', 'ward')

        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()
        queryset = queryset.filter(
            unit__root_unit__code=facility.code,
            ward__department__facility=facility
        )

        # Filter by currently effective
        if self.request.query_params.get('current') == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            )

        return queryset.order_by('priority', 'unit__name')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        ward = serializer.validated_data.get('ward')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        if ward and ward.department and ward.department.facility_id != facility.id:
            raise PermissionDenied("Ward does not belong to the active facility.")
        serializer.save()


# =============================================================================
# Duty Roster ViewSets
# =============================================================================


class ShiftDefinitionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing shift definitions.
    """
    queryset = ShiftDefinition.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return ShiftDefinitionListSerializer
        return ShiftDefinitionSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ShiftDefinition.objects.none()

        queryset = super().get_queryset().filter(facility=facility)

        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)

        return queryset.order_by('display_order', 'start_time')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(facility=facility)


class DutyRosterTemplateViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing duty roster templates.
    """
    queryset = DutyRosterTemplate.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'practitioner', 'day_of_week', 'role', 'context', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return DutyRosterTemplateListSerializer
        return DutyRosterTemplateSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return DutyRosterTemplate.objects.none()

        queryset = super().get_queryset().filter(facility=facility)
        queryset = queryset.select_related('unit', 'practitioner', 'shift', 'facility')

        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)

        return queryset.order_by('unit', 'day_of_week')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        serializer.save(facility=facility)


class DutyRosterViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing duty roster entries.
    """
    queryset = DutyRoster.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'practitioner', 'date', 'role', 'context', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return DutyRosterListSerializer
        if self.action == 'generate':
            return GenerateRosterSerializer
        if self.action == 'swap':
            return SwapDutySerializer
        if self.action == 'on_duty':
            return OnDutyQuerySerializer
        return DutyRosterSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return DutyRoster.objects.none()

        queryset = super().get_queryset().filter(facility=facility)
        queryset = queryset.select_related(
            'unit', 'practitioner', 'practitioner__staff', 'practitioner__staff__user',
            'shift', 'original_practitioner'
        )

        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)

        # Date range filter
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        return queryset.order_by('date', 'start_time')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        serializer.save(facility=facility)

    @action(detail=False, methods=['post'])
    def generate(self, request):
        """
        Generate roster entries from templates.

        POST /api/organization/duty-roster/generate/
        Body: { unit_id?: UUID, start_date: date, end_date: date, overwrite: bool }
        """
        serializer = GenerateRosterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        unit_id = serializer.validated_data.get('unit_id')
        start_date = serializer.validated_data['start_date']
        end_date = serializer.validated_data['end_date']
        overwrite = serializer.validated_data['overwrite']

        from .services import DutyRosterService

        if unit_id:
            unit = ClinicalUnit.objects.filter(id=unit_id).first()
            if not unit:
                return Response({'error': 'Unit not found'}, status=status.HTTP_404_NOT_FOUND)
            if unit.root_unit and unit.root_unit.code != facility.code:
                raise PermissionDenied("Unit does not belong to the active facility.")

            entries = DutyRosterService.generate_roster(
                unit=unit,
                start_date=start_date,
                end_date=end_date,
                overwrite=overwrite,
                created_by=request.user,
            )
            count = len(entries)
        else:
            count = DutyRosterService.generate_facility_roster(
                facility=facility,
                start_date=start_date,
                end_date=end_date,
                created_by=request.user,
            )

        return Response({
            'success': True,
            'entries_created': count,
        })

    @action(detail=True, methods=['post'])
    def swap(self, request, pk=None):
        """
        Swap a duty assignment to a different practitioner.

        POST /api/organization/duty-roster/{id}/swap/
        Body: { replacement_practitioner_id: UUID, reason: str }
        """
        roster_entry = self.get_object()
        serializer = SwapDutySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from apps.users.models import PractitionerProfile
        from .services import DutyRosterService

        replacement = PractitionerProfile.objects.get(
            id=serializer.validated_data['replacement_practitioner_id']
        )

        new_entry = DutyRosterService.swap_duty(
            roster_entry=roster_entry,
            replacement_practitioner=replacement,
            reason=serializer.validated_data.get('reason', ''),
            created_by=request.user,
        )

        # Trigger notification task (if tasks are set up)
        try:
            from .tasks import notify_duty_swap
            notify_duty_swap.delay(str(new_entry.id))
        except ImportError:
            pass  # Tasks not yet set up

        return Response({
            'success': True,
            'new_entry': DutyRosterSerializer(new_entry).data,
        })

    @action(detail=False, methods=['get'])
    def on_duty(self, request):
        """
        Get practitioners currently on duty.

        GET /api/organization/duty-roster/on-duty/?unit_id=...&role=...&context=...
        """
        serializer = OnDutyQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        unit = ClinicalUnit.objects.filter(id=data['unit_id']).first()
        if not unit:
            return Response({'error': 'Unit not found'}, status=status.HTTP_404_NOT_FOUND)

        facility = get_user_facility(request)
        if unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")

        from .services import DutyRosterService

        on_duty = DutyRosterService.get_on_duty(
            unit=unit,
            at_datetime=data.get('at_datetime'),
            role=data.get('role'),
            context=data.get('context'),
            include_descendants=data.get('include_descendants', False),
        )

        return Response({
            'results': DutyRosterListSerializer(on_duty, many=True).data,
            'count': on_duty.count(),
        })
