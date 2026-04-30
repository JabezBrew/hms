"""
DRF ViewSets for the organization app.

Provides CRUD operations and specialized endpoints for organizational hierarchy management.
"""
import ast
import calendar
import hashlib
import io
import json
import re
from datetime import datetime, timedelta

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse, HttpResponseNotModified
from django.db.models import Q, Count
from django.utils.cache import patch_vary_headers
from django.utils import timezone
from django.utils.http import http_date, parse_http_date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, get_user_facility
from apps.users.permissions import IsAdminOrReadOnly
from apps.users.admin_access import (
    AdminCapabilities,
    CanManageOrganization,
    CanManageRosters,
    CanManageStaff,
    CanViewOrganization,
    get_admin_accessible_unit_ids,
    user_has_unit_admin_capability,
)
from apps.audit.services import AuditService
from apps.audit.models import AuditAction, AuditCategory

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
    DepartmentDutyType,
    RotationRule,
    RosterEntry,
    RosterValidationRule,
    VALIDATION_RULE_TEMPLATES,
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
    DepartmentDutyTypeListSerializer,
    DepartmentDutyTypeSerializer,
    RotationRuleListSerializer,
    RotationRuleSerializer,
    RosterEntryListSerializer,
    RosterEntrySerializer,
    RosterGenerateSerializer,
    RosterBulkSerializer,
    RosterPublishSerializer,
    RosterOverrideSerializer,
    RosterImportSerializer,
    OnDutyQuerySerializer,
    RosterValidationRuleListSerializer,
    RosterValidationRuleSerializer,
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


def _coerce_import_row(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            try:
                value = ast.literal_eval(value)
            except (ValueError, SyntaxError):
                value = _coerce_ordered_dict_literal(value)
    if isinstance(value, list):
        try:
            value = dict(value)
        except (TypeError, ValueError):
            return None
    return value


def _coerce_ordered_dict_literal(value):
    if not isinstance(value, str):
        return None
    for prefix in ('OrderedDict(', 'ReturnDict('):
        if value.startswith(prefix) and value.endswith(')'):
            inner = value[len(prefix):-1]
            try:
                parsed = ast.literal_eval(inner)
            except (ValueError, SyntaxError):
                return None
            if isinstance(parsed, list):
                try:
                    return dict(parsed)
                except (TypeError, ValueError):
                    return None
    return None


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


def _is_write_request(request):
    return request.method not in ('GET', 'HEAD', 'OPTIONS')


def _filter_admin_unit_scope(request, queryset, unit_id_field, capability, facility):
    unit_ids = get_admin_accessible_unit_ids(
        request.user,
        capability,
        facility_code=facility.code,
    )
    if unit_ids is None:
        return queryset
    return queryset.filter(**{f'{unit_id_field}__in': unit_ids})


def _require_admin_unit_scope(request, capability, unit, facility, message):
    if unit and not user_has_unit_admin_capability(
        request.user,
        capability,
        unit,
        facility_code=facility.code,
    ):
        raise PermissionDenied(message)


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
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
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
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
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
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]
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
            return [IsAuthenticated(), CanViewOrganization(), FacilityScopedPermission()]
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), CanManageOrganization(), FacilityScopedPermission()]
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

        unit_type_code = self.request.query_params.get('unit_type_code')
        if unit_type_code:
            queryset = queryset.filter(unit_type__code=unit_type_code)

        unit_category = self.request.query_params.get('unit_category')
        if unit_category:
            queryset = queryset.filter(unit_category=unit_category)

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
        """
        Get wards for a unit.

        For facility-level units: Returns all wards belonging to the facility
        (via ward.department.facility matching by code).

        For other units: Returns explicit ward allocations (UnitWardAllocation).
        """
        unit = self.get_object()

        # Check if this is a facility-level unit
        if unit.unit_type.code == 'facility':
            # For facilities, return all wards belonging to this facility
            # Match by code since ClinicalUnit and core.Facility share the same code
            from apps.wards.models import Ward
            from apps.wards.serializers import WardListSerializer

            wards = Ward.objects.filter(
                department__facility__code=unit.code,
                is_active=True
            ).select_related('department', 'head_nurse__staff__user').order_by('name')

            serializer = WardListSerializer(wards, many=True, context={'request': request})
            return Response(serializer.data)

        # For non-facility units, return explicit allocations
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
            return [IsAuthenticated(), CanManageOrganization(), FacilityScopedPermission()]
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
        instance = serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user
        )
        AuditService.log(
            request=self.request,
            action=AuditAction.CREATE,
            category=AuditCategory.ADMIN,
            resource_type='Clinic',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Created clinic.'
        )

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department') or serializer.instance.department
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        instance = serializer.save(updated_by=self.request.user)
        AuditService.log(
            request=self.request,
            action=AuditAction.UPDATE,
            category=AuditCategory.ADMIN,
            resource_type='Clinic',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Updated clinic.'
        )

    def perform_destroy(self, instance):
        AuditService.log(
            request=self.request,
            action=AuditAction.DELETE,
            category=AuditCategory.ADMIN,
            resource_type='Clinic',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Deleted clinic.'
        )
        instance.delete()


# =============================================================================
# Clinic Schedule ViewSet
# =============================================================================


class ClinicScheduleViewSet(viewsets.ModelViewSet):
    """ViewSet for managing clinic schedules."""
    queryset = ClinicSchedule.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['department', 'clinic', 'day_of_week', 'is_active']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), CanManageRosters(), FacilityScopedPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return ClinicScheduleListSerializer
        return ClinicScheduleSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ClinicSchedule.objects.none()
        queryset = super().get_queryset().select_related(
            'facility',
            'department',
            'department__unit_type',
            'clinic',
            'clinic__department',
        )
        queryset = queryset.filter(facility=facility)
        if _is_write_request(self.request):
            queryset = _filter_admin_unit_scope(
                self.request,
                queryset,
                'department_id',
                AdminCapabilities.ROSTER_MANAGE,
                facility,
            )
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department')
        clinic = serializer.validated_data.get('clinic')
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        if clinic and clinic.facility_id != facility.id:
            raise PermissionDenied("Clinic does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility,
            "You do not have roster administration access for this department.",
        )
        instance = serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user
        )
        AuditService.log(
            request=self.request,
            action=AuditAction.CREATE,
            category=AuditCategory.ADMIN,
            resource_type='ClinicSchedule',
            resource_id=instance.id,
            resource_name=str(instance),
            description='Created clinic schedule.'
        )

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department') or serializer.instance.department
        clinic = serializer.validated_data.get('clinic') or serializer.instance.clinic
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        if clinic and clinic.facility_id != facility.id:
            raise PermissionDenied("Clinic does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility,
            "You do not have roster administration access for this department.",
        )
        instance = serializer.save(updated_by=self.request.user)
        AuditService.log(
            request=self.request,
            action=AuditAction.UPDATE,
            category=AuditCategory.ADMIN,
            resource_type='ClinicSchedule',
            resource_id=instance.id,
            resource_name=str(instance),
            description='Updated clinic schedule.'
        )

    def perform_destroy(self, instance):
        AuditService.log(
            request=self.request,
            action=AuditAction.DELETE,
            category=AuditCategory.ADMIN,
            resource_type='ClinicSchedule',
            resource_id=instance.id,
            resource_name=str(instance),
            description='Deleted clinic schedule.'
        )
        instance.delete()



# =============================================================================
# Unit Leadership ViewSet
# =============================================================================


class UnitLeadershipViewSet(viewsets.ModelViewSet):
    """ViewSet for managing unit leadership assignments."""
    queryset = UnitLeadership.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'role', 'user', 'is_active']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), CanManageOrganization(), FacilityScopedPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return UnitLeadershipListSerializer
        return UnitLeadershipSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return UnitLeadership.objects.none()
        queryset = super().get_queryset().select_related(
            'unit',
            'unit__unit_type',
            'role',
            'user'
        )
        queryset = queryset.filter(unit__root_unit__code=facility.code)
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
        if self.request.query_params.get('current') == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True,
                effective_from__lte=today
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            )
        return queryset.order_by('-effective_from', 'unit__name')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        serializer.save(created_by=self.request.user)


# =============================================================================
# Unit Member Assignment ViewSet
# =============================================================================


class UnitMemberAssignmentViewSet(viewsets.ModelViewSet):
    """ViewSet for managing non-clinical unit memberships."""
    queryset = UnitMemberAssignment.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'staff', 'assignment_type', 'is_primary', 'is_active']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), CanManageStaff(), FacilityScopedPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return UnitMemberAssignmentListSerializer
        return UnitMemberAssignmentSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return UnitMemberAssignment.objects.none()
        queryset = super().get_queryset().select_related(
            'unit',
            'unit__unit_type',
            'staff',
            'staff__user',
            'assignment_type'
        )
        queryset = queryset.filter(unit__root_unit__code=facility.code)
        if _is_write_request(self.request):
            queryset = _filter_admin_unit_scope(
                self.request,
                queryset,
                'unit_id',
                AdminCapabilities.STAFF_MANAGE,
                facility,
            )
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
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
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.STAFF_MANAGE,
            unit,
            facility,
            "You do not have staff administration access for this unit.",
        )
        serializer.save()

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit') or serializer.instance.unit
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.STAFF_MANAGE,
            unit,
            facility,
            "You do not have staff administration access for this unit.",
        )
        serializer.save()

    def perform_destroy(self, instance):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.STAFF_MANAGE,
            instance.unit,
            facility,
            "You do not have staff administration access for this unit.",
        )
        instance.delete()


# =============================================================================
# Cross Coverage Schedule ViewSet
# =============================================================================


class CrossCoverageScheduleViewSet(viewsets.ModelViewSet):
    """ViewSet for managing cross-coverage schedules."""
    queryset = CrossCoverageSchedule.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['covered_unit', 'covering_practitioner', 'covering_unit', 'coverage_type', 'is_active']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), CanManageRosters(), FacilityScopedPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return CrossCoverageScheduleListSerializer
        return CrossCoverageScheduleSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return CrossCoverageSchedule.objects.none()
        queryset = super().get_queryset().select_related(
            'covered_unit',
            'covered_unit__unit_type',
            'covering_unit',
            'covering_unit__unit_type',
            'covering_practitioner',
            'covering_practitioner__staff',
            'covering_practitioner__staff__user'
        )
        queryset = queryset.filter(covered_unit__root_unit__code=facility.code)
        if _is_write_request(self.request):
            queryset = _filter_admin_unit_scope(
                self.request,
                queryset,
                'covered_unit_id',
                AdminCapabilities.ROSTER_MANAGE,
                facility,
            )
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
        if self.request.query_params.get('current') == 'true':
            now = timezone.now()
            queryset = queryset.filter(start_datetime__lte=now, end_datetime__gte=now)
        return queryset.order_by('-start_datetime')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        covered_unit = serializer.validated_data.get('covered_unit')
        covering_unit = serializer.validated_data.get('covering_unit')
        if covered_unit and covered_unit.root_unit and covered_unit.root_unit.code != facility.code:
            raise PermissionDenied("Covered unit does not belong to the active facility.")
        if covering_unit and covering_unit.root_unit and covering_unit.root_unit.code != facility.code:
            raise PermissionDenied("Covering unit does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            covered_unit,
            facility,
            "You do not have roster administration access for this unit.",
        )
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        covered_unit = serializer.validated_data.get('covered_unit') or serializer.instance.covered_unit
        covering_unit = serializer.validated_data.get('covering_unit') or serializer.instance.covering_unit
        if covered_unit and covered_unit.root_unit and covered_unit.root_unit.code != facility.code:
            raise PermissionDenied("Covered unit does not belong to the active facility.")
        if covering_unit and covering_unit.root_unit and covering_unit.root_unit.code != facility.code:
            raise PermissionDenied("Covering unit does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            covered_unit,
            facility,
            "You do not have roster administration access for this unit.",
        )
        serializer.save()

    def perform_destroy(self, instance):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            instance.covered_unit,
            facility,
            "You do not have roster administration access for this unit.",
        )
        instance.delete()


# =============================================================================
# Unit Ward Allocation ViewSet
# =============================================================================


class UnitWardAllocationViewSet(viewsets.ModelViewSet):
    """ViewSet for managing unit ward allocations."""
    queryset = UnitWardAllocation.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['unit', 'ward', 'allocation_type', 'is_active']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), CanManageRosters(), FacilityScopedPermission()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return UnitWardAllocationListSerializer
        return UnitWardAllocationSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return UnitWardAllocation.objects.none()
        queryset = super().get_queryset().select_related(
            'unit',
            'unit__unit_type',
            'ward'
        )
        queryset = queryset.filter(unit__root_unit__code=facility.code)
        if _is_write_request(self.request):
            queryset = _filter_admin_unit_scope(
                self.request,
                queryset,
                'unit_id',
                AdminCapabilities.ROSTER_MANAGE,
                facility,
            )
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
        return queryset.order_by('-created_at')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            unit,
            facility,
            "You do not have roster administration access for this unit.",
        )
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit') or serializer.instance.unit
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            unit,
            facility,
            "You do not have roster administration access for this unit.",
        )
        serializer.save()

    def perform_destroy(self, instance):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            instance.unit,
            facility,
            "You do not have roster administration access for this unit.",
        )
        instance.delete()



# =============================================================================
# Department Roster ViewSets
# =============================================================================


class DepartmentDutyTypeViewSet(viewsets.ModelViewSet):
    queryset = DepartmentDutyType.objects.all()
    permission_classes = [IsAuthenticated, CanManageRosters, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['department', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return DepartmentDutyTypeListSerializer
        return DepartmentDutyTypeSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return DepartmentDutyType.objects.none()
        queryset = super().get_queryset().select_related('department', 'department__unit_type', 'clinic')
        queryset = queryset.filter(department__root_unit__code=facility.code)
        unit_ids = get_admin_accessible_unit_ids(
            self.request.user,
            AdminCapabilities.ROSTER_MANAGE,
            facility_code=facility.code,
        )
        if unit_ids is not None:
            queryset = queryset.filter(department_id__in=unit_ids)
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
        return queryset.order_by('display_order', 'name')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department')
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        if department and not user_has_unit_admin_capability(
            self.request.user,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility_code=facility.code,
        ):
            raise PermissionDenied("You do not have roster administration access for this department.")
        instance = serializer.save()
        AuditService.log(
            request=self.request,
            action=AuditAction.CREATE,
            category=AuditCategory.ADMIN,
            resource_type='DepartmentDutyType',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Created department duty type.'
        )

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department') or serializer.instance.department
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility,
            "You do not have roster administration access for this department.",
        )
        instance = serializer.save()
        AuditService.log(
            request=self.request,
            action=AuditAction.UPDATE,
            category=AuditCategory.ADMIN,
            resource_type='DepartmentDutyType',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Updated department duty type.'
        )

    def perform_destroy(self, instance):
        AuditService.log(
            request=self.request,
            action=AuditAction.DELETE,
            category=AuditCategory.ADMIN,
            resource_type='DepartmentDutyType',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Deleted department duty type.'
        )
        instance.delete()


class RotationRuleViewSet(viewsets.ModelViewSet):
    queryset = RotationRule.objects.all()
    permission_classes = [IsAuthenticated, CanManageRosters, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['department', 'duty_type', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return RotationRuleListSerializer
        return RotationRuleSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return RotationRule.objects.none()
        queryset = super().get_queryset().select_related('department', 'duty_type')
        queryset = queryset.filter(department__root_unit__code=facility.code)
        unit_ids = get_admin_accessible_unit_ids(
            self.request.user,
            AdminCapabilities.ROSTER_MANAGE,
            facility_code=facility.code,
        )
        if unit_ids is not None:
            queryset = queryset.filter(department_id__in=unit_ids)

        # Filter by department_id from URL if present
        department_id = self.kwargs.get('department_id')
        if department_id:
            queryset = queryset.filter(department_id=department_id)

        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
        return queryset.order_by('name')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department')
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        if department and not user_has_unit_admin_capability(
            self.request.user,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility_code=facility.code,
        ):
            raise PermissionDenied("You do not have roster administration access for this department.")
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        AuditService.log(
            request=self.request,
            action=AuditAction.CREATE,
            category=AuditCategory.ADMIN,
            resource_type='RotationRule',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Created rotation rule.'
        )

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department') or serializer.instance.department
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility,
            "You do not have roster administration access for this department.",
        )
        instance = serializer.save(updated_by=self.request.user)
        AuditService.log(
            request=self.request,
            action=AuditAction.UPDATE,
            category=AuditCategory.ADMIN,
            resource_type='RotationRule',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Updated rotation rule.'
        )

    def perform_destroy(self, instance):
        AuditService.log(
            request=self.request,
            action=AuditAction.DELETE,
            category=AuditCategory.ADMIN,
            resource_type='RotationRule',
            resource_id=instance.id,
            resource_name=instance.name,
            description='Deleted rotation rule.'
        )
        instance.delete()


class RosterEntryViewSet(viewsets.ModelViewSet):
    queryset = RosterEntry.objects.all()
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['department', 'duty_type', 'status']

    def get_permissions(self):
        if self.action in ['list', 'retrieve', 'on_duty', 'on_duty_department', 'print_roster']:
            return [IsAuthenticated(), FacilityScopedPermission()]
        return [IsAuthenticated(), CanManageRosters(), FacilityScopedPermission()]

    def get_serializer_class(self):
        if self.action == 'list':
            return RosterEntryListSerializer
        if self.action == 'generate':
            return RosterGenerateSerializer
        if self.action == 'bulk':
            return RosterBulkSerializer
        if self.action == 'publish':
            return RosterPublishSerializer
        if self.action == 'override':
            return RosterOverrideSerializer
        if self.action == 'import_csv':
            return RosterImportSerializer
        if self.action in ['on_duty', 'on_duty_department']:
            return OnDutyQuerySerializer
        return RosterEntrySerializer

    def _get_department(self):
        department_id = self.kwargs.get('department_id') or self.request.query_params.get('department')
        if not department_id:
            return None
        # Allow both departments and divisions for roster management
        return ClinicalUnit.objects.filter(
            id=department_id,
            unit_type__code__in=['department', 'division']
        ).first()

    def _require_department(self):
        department = self._get_department()
        if not department:
            raise PermissionDenied("Department context is required.")
        facility = get_user_facility(self.request)
        if department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        if self.request.method not in ('GET', 'HEAD', 'OPTIONS') and not user_has_unit_admin_capability(
            self.request.user,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility_code=facility.code,
        ):
            raise PermissionDenied("You do not have roster administration access for this department.")
        return department

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return RosterEntry.objects.none()
        queryset = super().get_queryset().select_related('department', 'duty_type', 'team')
        queryset = queryset.filter(department__root_unit__code=facility.code)
        if self.action not in ['on_duty', 'on_duty_department']:
            unit_ids = get_admin_accessible_unit_ids(
                self.request.user,
                AdminCapabilities.ROSTER_VIEW,
                facility_code=facility.code,
            )
            if unit_ids is not None:
                queryset = queryset.filter(department_id__in=unit_ids)
        department = self._get_department()
        if department:
            queryset = queryset.filter(department=department)
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)
        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)
        return queryset.order_by('date', 'duty_type__display_order')

    def _resolve_entry_practitioner_ids(self, team, practitioner, entry_date):
        practitioner_ids = set()
        if practitioner:
            practitioner_ids.add(practitioner.id)
        if team:
            team_practitioner_ids = StaffUnitAssignment.objects.filter(
                unit=team,
                is_active=True,
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=entry_date)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=entry_date)
            ).values_list('practitioner_id', flat=True)
            practitioner_ids.update(team_practitioner_ids)
        return practitioner_ids

    def _build_recurring_conflict_map(
        self,
        practitioner_ids,
        entry_date,
        duty_type,
        start_time=None,
        end_time=None,
    ):
        if not practitioner_ids or not duty_type or duty_type.category != 'clinic':
            return {}

        from apps.appointments.models import RecurringSchedule

        recurring_qs = RecurringSchedule.objects.filter(
            practitioner_id__in=practitioner_ids,
            is_active=True,
            active_from__lte=entry_date,
            days_of_week__contains=[entry_date.weekday()],
        ).filter(
            Q(active_to__isnull=True) | Q(active_to__gte=entry_date)
        ).select_related('practitioner__staff__user')

        effective_start = start_time or duty_type.start_time
        effective_end = end_time or duty_type.end_time
        if duty_type.is_24_hour:
            conflicts = recurring_qs
        elif not effective_start or not effective_end:
            return {}
        else:
            conflicts = recurring_qs.filter(
                start_time__lt=effective_end,
                end_time__gt=effective_start,
            )

        conflict_map = {}
        for conflict in conflicts:
            conflict_map.setdefault(conflict.practitioner_id, conflict)
        return conflict_map

    def _validate_entry_against_recurring_schedules(
        self,
        team,
        practitioner,
        entry_date,
        duty_type,
        start_time=None,
        end_time=None,
    ):
        practitioner_ids = self._resolve_entry_practitioner_ids(team, practitioner, entry_date)
        conflict_map = self._build_recurring_conflict_map(
            practitioner_ids=practitioner_ids,
            entry_date=entry_date,
            duty_type=duty_type,
            start_time=start_time,
            end_time=end_time,
        )
        if not conflict_map:
            return

        if practitioner:
            conflict = conflict_map.get(practitioner.id)
            if not conflict:
                return
            practitioner_name = conflict.practitioner.staff.user.get_full_name()
            raise ValidationError(
                f"Roster entry conflicts with recurring schedule '{conflict.name}' for "
                f"{practitioner_name} ({conflict.start_time.strftime('%H:%M')}-"
                f"{conflict.end_time.strftime('%H:%M')})."
            )

        if team:
            assigned_ids = set(practitioner_ids)
            conflicting_ids = set(conflict_map.keys())
            if assigned_ids and assigned_ids.issubset(conflicting_ids):
                sample_conflict = next(iter(conflict_map.values()))
                raise ValidationError(
                    "Roster team entry conflicts with recurring schedules for all assigned "
                    f"practitioners (for example: {sample_conflict.name})."
                )

    def perform_create(self, serializer):
        department = self._require_department()
        facility = get_user_facility(self.request)
        duty_type = serializer.validated_data.get('duty_type')
        team = serializer.validated_data.get('team')
        entry_date = serializer.validated_data.get('date')

        if duty_type and duty_type.department_id != department.id:
            raise ValidationError('Duty type must belong to the selected department.')
        if team:
            if team.root_unit and team.root_unit.code != facility.code:
                raise PermissionDenied("Team does not belong to the active facility.")
            if not team.is_descendant_of(department):
                raise ValidationError('Team must belong to the selected department.')

        if duty_type and duty_type.is_24_hour and team and entry_date:
            adjacent = RosterEntry.objects.filter(
                department=department,
                duty_type=duty_type,
                team=team,
                date__in=[entry_date - timedelta(days=1), entry_date + timedelta(days=1)]
            )
            if adjacent.exists():
                raise ValidationError('Cannot assign back-to-back 24-hour shifts.')

        if duty_type and entry_date:
            self._validate_entry_against_recurring_schedules(
                team=team,
                practitioner=serializer.validated_data.get('practitioner'),
                entry_date=entry_date,
                duty_type=duty_type,
                start_time=serializer.validated_data.get('start_time'),
                end_time=serializer.validated_data.get('end_time'),
            )

        instance = serializer.save(
            department=department,
            source=serializer.validated_data.get('source') or 'manual',
            created_by=self.request.user,
            updated_by=self.request.user,
        )
        AuditService.log(
            request=self.request,
            action=AuditAction.CREATE,
            category=AuditCategory.ADMIN,
            resource_type='RosterEntry',
            resource_id=instance.id,
            resource_name=str(instance.date),
            description='Created roster entry.'
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        facility = get_user_facility(self.request)
        duty_type = serializer.validated_data.get('duty_type', instance.duty_type)
        team = serializer.validated_data.get('team', instance.team)
        practitioner = serializer.validated_data.get('practitioner', instance.practitioner)
        entry_date = serializer.validated_data.get('date', instance.date)

        if duty_type and duty_type.department_id != instance.department_id:
            raise ValidationError('Duty type must belong to the selected department.')
        if team:
            if team.root_unit and team.root_unit.code != facility.code:
                raise PermissionDenied("Team does not belong to the active facility.")
            if not team.is_descendant_of(instance.department):
                raise ValidationError('Team must belong to the selected department.')

        if duty_type and duty_type.is_24_hour and team and entry_date:
            adjacent = RosterEntry.objects.filter(
                department=instance.department,
                duty_type=duty_type,
                team=team,
                date__in=[entry_date - timedelta(days=1), entry_date + timedelta(days=1)]
            ).exclude(id=instance.id)
            if adjacent.exists():
                raise ValidationError('Cannot assign back-to-back 24-hour shifts.')

        if duty_type and entry_date:
            self._validate_entry_against_recurring_schedules(
                team=team,
                practitioner=practitioner,
                entry_date=entry_date,
                duty_type=duty_type,
                start_time=serializer.validated_data.get('start_time', instance.start_time),
                end_time=serializer.validated_data.get('end_time', instance.end_time),
            )

        instance = serializer.save(updated_by=self.request.user)
        AuditService.log(
            request=self.request,
            action=AuditAction.UPDATE,
            category=AuditCategory.ADMIN,
            resource_type='RosterEntry',
            resource_id=instance.id,
            resource_name=str(instance.date),
            description='Updated roster entry.'
        )

    def perform_destroy(self, instance):
        AuditService.log(
            request=self.request,
            action=AuditAction.DELETE,
            category=AuditCategory.ADMIN,
            resource_type='RosterEntry',
            resource_id=instance.id,
            resource_name=str(instance.date),
            description='Deleted roster entry.'
        )
        instance.delete()

    def _resolve_period(self, data):
        period = data.get('period')
        if period:
            try:
                start = datetime.strptime(period, '%Y-%m').date()
            except ValueError as exc:
                raise ValidationError('Period must be in YYYY-MM format.') from exc
            last_day = calendar.monthrange(start.year, start.month)[1]
            end = start.replace(day=last_day)
            return start, end
        return data.get('date_from'), data.get('date_to')

    def generate(self, request, department_id=None):
        serializer = RosterGenerateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        department = self._require_department()
        date_from, date_to = self._resolve_period(serializer.validated_data)
        if not date_from or not date_to:
            raise ValidationError('date_from and date_to are required.')

        from .services import RosterGenerationService

        try:
            entries = RosterGenerationService.generate_roster(
                department=department,
                date_from=date_from,
                date_to=date_to,
                created_by=request.user,
            )
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc

        return Response({'entries_created': len(entries)})

    def bulk(self, request, department_id=None):
        serializer = RosterBulkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        department = self._require_department()
        facility = get_user_facility(request)

        entries_data = serializer.validated_data['entries']
        duty_type_ids = {entry['duty_type'] for entry in entries_data}
        team_ids = {entry.get('team') for entry in entries_data if entry.get('team')}
        practitioner_ids = {entry.get('practitioner') for entry in entries_data if entry.get('practitioner')}

        duty_types = {
            str(duty_type.id): duty_type
            for duty_type in DepartmentDutyType.objects.filter(
                id__in=duty_type_ids,
                department=department
            )
        }
        teams = {
            str(team.id): team
            for team in ClinicalUnit.objects.filter(
                id__in=team_ids,
                root_unit__code=facility.code
            )
        }
        practitioners = {}
        if practitioner_ids:
            from apps.users.models import PractitionerProfile
            practitioner_qs = PractitionerProfile.objects.filter(
                id__in=practitioner_ids
            ).select_related('staff', 'staff__primary_facility', 'staff__user')
            practitioners = {str(prac.id): prac for prac in practitioner_qs}

        if len(duty_types) != len(duty_type_ids):
            raise ValidationError('One or more duty types are invalid for this department.')
        if len(teams) != len(team_ids):
            raise ValidationError('One or more teams are invalid for this facility.')
        if practitioner_ids and len(practitioners) != len(practitioner_ids):
            raise ValidationError('One or more practitioners are invalid.')

        dates = [entry['date'] for entry in entries_data]
        existing = RosterEntry.objects.filter(
            department=department,
            date__in=dates,
            duty_type_id__in=duty_type_ids
        ).values_list('date', 'duty_type_id')
        existing_keys = set(existing)

        date_from = min(dates)
        date_to = max(dates)
        adjacent_entries = RosterEntry.objects.filter(
            department=department,
            date__gte=date_from - timedelta(days=1),
            date__lte=date_to + timedelta(days=1)
        )
        entries_by_team_date = {
            (entry.team_id, entry.duty_type_id, entry.date)
            for entry in adjacent_entries
            if entry.team_id
        }

        to_create = []
        for entry in entries_data:
            duty_type = duty_types[str(entry['duty_type'])]
            team = None
            practitioner = None
            if entry.get('team'):
                team = teams[str(entry['team'])]
                if not team.is_descendant_of(department):
                    raise ValidationError('Team must belong to the selected department.')
            if entry.get('practitioner'):
                practitioner = practitioners[str(entry['practitioner'])]
                # Facility safety check: prevent cross-facility roster assignments.
                if (
                    not practitioner.staff
                    or not practitioner.staff.primary_facility_id
                    or practitioner.staff.primary_facility_id != facility.id
                ):
                    raise ValidationError('Practitioner does not belong to the active facility.')
            if (entry['date'], duty_type.id) in existing_keys:
                raise ValidationError('Roster entry already exists for provided date and duty type.')

            back_to_back_error = None
            if duty_type.is_24_hour and team:
                back_to_back_error = (
                    (team.id, duty_type.id, entry['date'] - timedelta(days=1)) in entries_by_team_date or
                    (team.id, duty_type.id, entry['date'] + timedelta(days=1)) in entries_by_team_date
                )
                if back_to_back_error:
                    raise ValidationError('Cannot assign back-to-back 24-hour shifts.')

            self._validate_entry_against_recurring_schedules(
                team=team,
                practitioner=practitioner,
                entry_date=entry['date'],
                duty_type=duty_type,
                start_time=entry.get('start_time'),
                end_time=entry.get('end_time'),
            )

            to_create.append(RosterEntry(
                department=department,
                duty_type=duty_type,
                date=entry['date'],
                team=team,
                practitioner=practitioner,
                start_time=entry.get('start_time'),
                end_time=entry.get('end_time'),
                source=entry.get('source') or 'manual',
                status=entry.get('status') or 'draft',
                created_by=request.user,
                updated_by=request.user,
            ))

        if to_create:
            RosterEntry.objects.bulk_create(to_create)
        return Response({'created': len(to_create)})

    def import_csv(self, request, department_id=None):
        serializer = RosterImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        department = self._require_department()
        facility = get_user_facility(request)
        conflict_strategy = request.data.get('conflict_strategy', 'skip')

        from .services import RosterImportService

        results = RosterImportService.validate_roster_csv(
            serializer.validated_data['csv'],
            department,
            facility
        )
        if results['errors']:
            return Response(results, status=status.HTTP_400_BAD_REQUEST)

        created = RosterImportService.apply_roster_csv(
            results['rows'],
            department,
            request.user,
            conflict_strategy=conflict_strategy
        )

        AuditService.log(
            request=request,
            action=AuditAction.CREATE,
            category=AuditCategory.ADMIN,
            resource_type='RosterImport',
            resource_id=None,
            resource_name='department-roster',
            description=f'Imported roster entries ({created} rows).'
        )

        return Response({
            'created': created,
            'conflicts': results['conflicts'],
        })

    def publish(self, request, department_id=None):
        from .services import RosterValidationService

        serializer = RosterPublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        department = self._require_department()
        date_from = serializer.validated_data['date_from']
        date_to = serializer.validated_data['date_to']

        # Get entries to publish
        entries_qs = RosterEntry.objects.filter(
            department=department,
            date__gte=date_from,
            date__lte=date_to,
            status='draft'
        ).select_related('duty_type', 'team')

        entries = list(entries_qs)

        # Validate before publishing (only 'error' severity rules block publish)
        rules = RosterValidationService.get_rules_for_department(department.id)
        validation_result = RosterValidationService.validate_roster(entries, rules)

        if validation_result['errors']:
            # Return validation errors without publishing
            return Response({
                'updated': 0,
                'validation_errors': validation_result['errors'],
                'validation_warnings': validation_result['warnings'],
                'message': 'Cannot publish roster with validation errors. Please fix the errors and try again.'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Publish the entries
        updated = entries_qs.update(status='published', updated_by=request.user)

        return Response({
            'updated': updated,
            'validation_warnings': validation_result['warnings'],
        })

    def clear(self, request, department_id=None):
        """Clear (delete) roster entries for a period. Only draft entries can be cleared."""
        serializer = RosterPublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        department = self._require_department()
        date_from = serializer.validated_data['date_from']
        date_to = serializer.validated_data['date_to']

        # Only delete draft entries to avoid accidentally removing published rosters
        entries = RosterEntry.objects.filter(
            department=department,
            date__gte=date_from,
            date__lte=date_to,
            status='draft'
        )
        deleted_count = entries.count()
        entries.delete()

        AuditService.log(
            request=request,
            action=AuditAction.DELETE,
            category=AuditCategory.ADMIN,
            resource_type='RosterEntry',
            resource_id=str(department.id),
            resource_name=department.name,
            description=f'Cleared {deleted_count} draft roster entries from {date_from} to {date_to}.'
        )

        return Response({'deleted': deleted_count})

    def override(self, request, pk=None):
        entry = self.get_object()
        serializer = RosterOverrideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        replacement_team_id = serializer.validated_data['replacement_team']
        replacement_team = ClinicalUnit.objects.filter(id=replacement_team_id).first()
        if not replacement_team:
            raise ValidationError('Replacement team not found.')
        if not replacement_team.is_descendant_of(entry.department):
            raise ValidationError('Replacement team must belong to the department.')

        if not entry.original_team_id:
            entry.original_team = entry.team
        entry.team = replacement_team
        entry.is_override = True
        entry.override_reason = serializer.validated_data.get('reason', '')
        entry.source = 'override'
        entry.updated_by = request.user
        entry.save()

        return Response(RosterEntrySerializer(entry).data)

    def on_duty_department(self, request, department_id=None):
        serializer = OnDutyQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        department = self._require_department()

        from .services import DepartmentRosterService

        coverage = DepartmentRosterService.get_on_duty(
            department=department,
            at_datetime=serializer.validated_data.get('at_datetime')
        )

        return Response({'results': coverage, 'count': len(coverage)})

    def on_duty(self, request):
        serializer = OnDutyQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        # Include both departments and divisions for on-duty lookup
        departments = ClinicalUnit.objects.filter(
            unit_type__code__in=['department', 'division'],
            root_unit__code=facility.code,
            is_active=True
        )

        from .services import DepartmentRosterService

        results = []
        at_datetime = serializer.validated_data.get('at_datetime')
        for department in departments:
            coverage = DepartmentRosterService.get_on_duty(department, at_datetime=at_datetime)
            for entry in coverage:
                entry['department_name'] = department.name
                results.append(entry)

        return Response({'results': results, 'count': len(results)})

    def print_roster(self, request, department_id=None):
        department = self._require_department()
        period = request.query_params.get('period')
        if not period:
            raise ValidationError('period query param is required (YYYY-MM).')
        try:
            start = datetime.strptime(period, '%Y-%m').date()
        except ValueError as exc:
            raise ValidationError('period must be in YYYY-MM format.') from exc
        end_day = calendar.monthrange(start.year, start.month)[1]
        end = start.replace(day=end_day)

        entries = RosterEntry.objects.filter(
            department=department,
            date__gte=start,
            date__lte=end,
            status='published'
        ).select_related('duty_type', 'team').order_by('date', 'duty_type__display_order')

        try:
            from reportlab.lib.pagesizes import letter, landscape
            from reportlab.lib import colors
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch
            from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        except Exception as exc:
            raise ValidationError('PDF generation dependency missing.') from exc

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(letter),
            rightMargin=0.5*inch,
            leftMargin=0.5*inch,
            topMargin=0.5*inch,
            bottomMargin=0.5*inch
        )

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            'Title',
            parent=styles['Heading1'],
            fontSize=16,
            spaceAfter=6
        )
        subtitle_style = ParagraphStyle(
            'Subtitle',
            parent=styles['Normal'],
            fontSize=11,
            textColor=colors.gray,
            spaceAfter=12
        )

        elements = []
        elements.append(Paragraph(f'{department.name} Duty Roster', title_style))
        elements.append(Paragraph(f'Period: {start.strftime("%B %Y")}', subtitle_style))
        elements.append(Spacer(1, 12))

        # Group entries by date and pivot by duty type
        duty_types = list(DepartmentDutyType.objects.filter(
            department=department,
            is_active=True
        ).order_by('display_order').values_list('id', 'name'))

        duty_type_names = {dt_id: name for dt_id, name in duty_types}
        duty_type_order = [dt_id for dt_id, _ in duty_types]

        # Build data by date
        from collections import defaultdict
        data_by_date = defaultdict(dict)
        for entry in entries:
            data_by_date[entry.date][entry.duty_type_id] = entry.team.name if entry.team else '-'

        # Build table header
        header = ['Date', 'Day'] + [duty_type_names.get(dt_id, '') for dt_id in duty_type_order]

        # Build table rows
        table_data = [header]
        current_date = start
        while current_date <= end:
            day_name = current_date.strftime('%a')
            row = [
                current_date.strftime('%d'),
                day_name
            ]
            date_entries = data_by_date.get(current_date, {})
            for dt_id in duty_type_order:
                row.append(date_entries.get(dt_id, '-'))
            table_data.append(row)
            current_date += timedelta(days=1)

        # Calculate column widths
        col_widths = [0.4*inch, 0.5*inch]  # Date, Day
        remaining_width = 9.5*inch - sum(col_widths)
        duty_col_width = remaining_width / max(len(duty_type_order), 1)
        col_widths.extend([duty_col_width] * len(duty_type_order))

        table = Table(table_data, colWidths=col_widths, repeatRows=1)

        # Style the table
        style = TableStyle([
            # Header
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a1a')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('TOPPADDING', (0, 0), (-1, 0), 8),

            # Body
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('ALIGN', (0, 1), (1, -1), 'CENTER'),  # Date and Day columns
            ('ALIGN', (2, 1), (-1, -1), 'CENTER'),  # Duty type columns
            ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
            ('TOPPADDING', (0, 1), (-1, -1), 5),

            # Grid
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cccccc')),
            ('LINEBELOW', (0, 0), (-1, 0), 1, colors.HexColor('#1a1a1a')),
        ])

        # Alternate row colors
        for i in range(1, len(table_data)):
            if i % 2 == 0:
                style.add('BACKGROUND', (0, i), (-1, i), colors.HexColor('#f5f5f5'))

            # Highlight weekends
            row_date = start + timedelta(days=i-1)
            if row_date.weekday() >= 5:  # Saturday or Sunday
                style.add('BACKGROUND', (0, i), (1, i), colors.HexColor('#fff3cd'))
                style.add('FONTNAME', (1, i), (1, i), 'Helvetica-Bold')

        table.setStyle(style)
        elements.append(table)

        # Footer
        elements.append(Spacer(1, 12))
        footer_style = ParagraphStyle(
            'Footer',
            parent=styles['Normal'],
            fontSize=8,
            textColor=colors.gray
        )
        generated_at = timezone.now().strftime('%Y-%m-%d %H:%M')
        elements.append(Paragraph(f'Generated: {generated_at}', footer_style))

        doc.build(elements)
        buffer.seek(0)
        response = HttpResponse(buffer.getvalue(), content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="roster-{period}.pdf"'
        return response


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

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), CanManageStaff(), FacilityScopedPermission()]
        return super().get_permissions()

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
        if _is_write_request(self.request):
            queryset = _filter_admin_unit_scope(
                self.request,
                queryset,
                'unit_id',
                AdminCapabilities.STAFF_MANAGE,
                facility,
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

        return queryset.order_by('-assigned_at')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit')
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        if unit and not user_has_unit_admin_capability(
            self.request.user,
            AdminCapabilities.STAFF_MANAGE,
            unit,
            facility_code=facility.code,
        ):
            raise PermissionDenied("You do not have staff administration access for this unit.")
        serializer.save()

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        unit = serializer.validated_data.get('unit') or serializer.instance.unit
        if unit and unit.root_unit and unit.root_unit.code != facility.code:
            raise PermissionDenied("Unit does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.STAFF_MANAGE,
            unit,
            facility,
            "You do not have staff administration access for this unit.",
        )
        serializer.save()

    def perform_destroy(self, instance):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.STAFF_MANAGE,
            instance.unit,
            facility,
            "You do not have staff administration access for this unit.",
        )
        instance.delete()


# =============================================================================
# Roster Validation Rules ViewSet
# =============================================================================


class RosterValidationRuleViewSet(viewsets.ModelViewSet):
    """
    CRUD for roster validation rules.

    Provides configurable validation constraints for roster entries.
    Rules can warn on draft or block on publish depending on severity.
    """
    queryset = RosterValidationRule.objects.all()
    permission_classes = [IsAuthenticated, CanManageRosters, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['department', 'duty_type', 'rule_type', 'severity', 'is_active']

    def get_serializer_class(self):
        if self.action == 'list':
            return RosterValidationRuleListSerializer
        return RosterValidationRuleSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return RosterValidationRule.objects.none()

        queryset = super().get_queryset().select_related('department', 'duty_type')
        queryset = queryset.filter(department__root_unit__code=facility.code)
        unit_ids = get_admin_accessible_unit_ids(
            self.request.user,
            AdminCapabilities.ROSTER_MANAGE,
            facility_code=facility.code,
        )
        if unit_ids is not None:
            queryset = queryset.filter(department_id__in=unit_ids)

        # Filter by department_id from URL if present
        department_id = self.kwargs.get('department_id')
        if department_id:
            queryset = queryset.filter(department_id=department_id)

        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)

        return queryset.order_by('name')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        department = serializer.validated_data.get('department')
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        if department and not user_has_unit_admin_capability(
            self.request.user,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility_code=facility.code,
        ):
            raise PermissionDenied("You do not have roster administration access for this department.")

        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        department = serializer.validated_data.get('department') or serializer.instance.department
        if department and department.root_unit and department.root_unit.code != facility.code:
            raise PermissionDenied("Department does not belong to the active facility.")
        _require_admin_unit_scope(
            self.request,
            AdminCapabilities.ROSTER_MANAGE,
            department,
            facility,
            "You do not have roster administration access for this department.",
        )
        serializer.save()

    @action(detail=False, methods=['get'])
    def templates(self, request):
        """
        Return available rule templates with their parameter schemas.

        Used by frontend to render appropriate form controls for each rule type.
        """
        return Response(VALIDATION_RULE_TEMPLATES)

    @action(detail=False, methods=['post'], url_path='validate')
    def validate_roster(self, request):
        """
        Validate roster entries against all rules.

        Request body:
            department_id: UUID (required)
            date_from: YYYY-MM-DD (optional)
            date_to: YYYY-MM-DD (optional)

        Returns:
            warnings: list of warning violations
            errors: list of error violations
        """
        from .services import RosterValidationService

        department_id = request.data.get('department_id')
        if not department_id:
            raise ValidationError({'department_id': 'Department ID is required.'})

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        department = ClinicalUnit.objects.filter(
            id=department_id,
            root_unit__code=facility.code,
            is_active=True,
        ).first()
        if not department:
            raise PermissionDenied("Department does not belong to the active facility.")

        # Get date range
        date_from = request.data.get('date_from')
        date_to = request.data.get('date_to')

        # Build query
        entries_qs = RosterEntry.objects.filter(
            department_id=department_id
        ).select_related('duty_type', 'team')

        if date_from:
            entries_qs = entries_qs.filter(date__gte=date_from)
        if date_to:
            entries_qs = entries_qs.filter(date__lte=date_to)

        entries = list(entries_qs)
        rules = RosterValidationService.get_rules_for_department(department.id)
        result = RosterValidationService.validate_roster(entries, rules)

        return Response(result)


from apps.core.features import attach_required_feature

attach_required_feature(
    [
        UnitWardAllocationViewSet,
    ],
    'wards',
)
attach_required_feature(
    [
        DepartmentDutyTypeViewSet,
        RotationRuleViewSet,
        RosterEntryViewSet,
        RosterValidationRuleViewSet,
    ],
    'department_rosters',
)
