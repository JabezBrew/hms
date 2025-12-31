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
from rest_framework.response import Response

from apps.core.pagination import StandardResultsSetPagination
from apps.users.rbac import IsAdmin

from .models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
    UnitWardAllocation,
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
)
from .tree_cache import ORG_TREE_CACHE_TTL, get_org_tree_payload

STAFF_LIST_CACHE_TTL = 60 * 60 * 3  # 3 hours
STAFF_LIST_MIN_QUERY_LEN = 2


def _get_unit_list_cache_version(kind, unit_id):
    cache_key = f'org_unit_{kind}_version:{unit_id}'
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
    return (
        f'org_unit_{kind}_list:v{version}:{unit_id}:{user_id}:'
        f'{int(include_descendants)}:{page}:{page_size}:{today}:{query_hash}'
    )


def _build_unit_counts_cache_key(kind, unit_id, user_id, include_descendants, query, today):
    normalized_query = (query or '').strip().lower()
    query_hash = (
        hashlib.md5(normalized_query.encode()).hexdigest()
        if normalized_query
        else 'none'
    )
    version = _get_unit_list_cache_version(kind, unit_id)
    return (
        f'org_unit_{kind}_counts:v{version}:{unit_id}:{user_id}:'
        f'{int(include_descendants)}:{today}:{query_hash}'
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
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit_type', 'parent', 'is_active', 'accepts_admissions']
    search_fields = ['code', 'name', 'short_name']

    def get_permissions(self):
        if self.action == 'tree':
            return [IsAdmin()]
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

        # Optimize with select_related for common foreign keys
        queryset = queryset.select_related('unit_type', 'parent', 'root_unit')

        # Filter by active status
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)

        # Filter by root/facility
        facility = self.request.query_params.get('facility')
        if facility:
            queryset = queryset.filter(root_unit_id=facility)

        # Filter to only root nodes
        if self.request.query_params.get('roots_only') == 'true':
            queryset = queryset.filter(parent__isnull=True)

        return queryset.order_by('tree_id', 'lft')

    @action(detail=False, methods=['get'])
    def tree(self, request):
        """
        Get the full organizational tree.

        Returns root nodes with nested children for building a tree UI.
        """
        include_inactive = request.query_params.get('include_inactive') == 'true'
        facility_id = request.query_params.get('facility') or None
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
# Leadership ViewSet
# =============================================================================


class UnitLeadershipViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing unit leadership assignments.
    """
    queryset = UnitLeadership.objects.all()
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'role', 'user', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return UnitLeadershipListSerializer
        return UnitLeadershipSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        queryset = queryset.select_related('unit', 'role', 'user')

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


# =============================================================================
# Staff Assignment ViewSet
# =============================================================================


class StaffUnitAssignmentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing staff unit assignments.
    """
    queryset = StaffUnitAssignment.objects.all()
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'practitioner', 'assignment_type', 'is_primary', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return StaffUnitAssignmentListSerializer
        return StaffUnitAssignmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        queryset = queryset.select_related('unit', 'practitioner', 'assignment_type')

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

        # Filter by currently active
        if self.request.query_params.get('current') == 'true':
            now = timezone.now()
            queryset = queryset.filter(
                is_active=True,
                start_datetime__lte=now,
                end_datetime__gte=now
            )

        return queryset.order_by('-start_datetime')


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
