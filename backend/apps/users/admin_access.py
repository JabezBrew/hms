"""
Scoped administrative access helpers.

Hospital administration is not a single global role.  This module derives
coarse admin capabilities from the user's base role plus current organization
leadership assignments.  Object-level PHI checks still belong in
apps.core.security; these capabilities are for operational/admin surfaces.
"""
from django.utils import timezone
from django.db.models import Q
from rest_framework import permissions


class AdminCapabilities:
    ORGANIZATION_VIEW = 'admin.organization.view'
    ORGANIZATION_MANAGE = 'admin.organization.manage'
    STAFF_VIEW = 'admin.staff.view'
    STAFF_MANAGE = 'admin.staff.manage'
    ROSTER_VIEW = 'admin.roster.view'
    ROSTER_MANAGE = 'admin.roster.manage'
    AUDIT_VIEW = 'admin.audit.view'
    FEATURE_ENTITLEMENTS_MANAGE = 'admin.feature_entitlements.manage'
    UNIT_DATA_VIEW = 'admin.unit_data.view'
    UNIT_APPROVALS_MANAGE = 'admin.unit_approvals.manage'
    UNIT_BUDGET_MANAGE = 'admin.unit_budget.manage'


FACILITY_ADMIN_CAPABILITIES = frozenset({
    AdminCapabilities.ORGANIZATION_VIEW,
    AdminCapabilities.ORGANIZATION_MANAGE,
    AdminCapabilities.STAFF_VIEW,
    AdminCapabilities.STAFF_MANAGE,
    AdminCapabilities.ROSTER_VIEW,
    AdminCapabilities.ROSTER_MANAGE,
    AdminCapabilities.AUDIT_VIEW,
    AdminCapabilities.FEATURE_ENTITLEMENTS_MANAGE,
    AdminCapabilities.UNIT_DATA_VIEW,
    AdminCapabilities.UNIT_APPROVALS_MANAGE,
    AdminCapabilities.UNIT_BUDGET_MANAGE,
})

PLATFORM_ADMIN_CAPABILITIES = FACILITY_ADMIN_CAPABILITIES

ROLE_CAPABILITIES = {
    # Existing explicit leadership role.  Keep this unscoped for compatibility
    # until nursing units are represented entirely by UnitLeadership records.
    'head_nurse': frozenset({
        AdminCapabilities.STAFF_VIEW,
        AdminCapabilities.ROSTER_VIEW,
        AdminCapabilities.ROSTER_MANAGE,
        AdminCapabilities.UNIT_DATA_VIEW,
    }),
}


def is_platform_admin(user):
    return bool(
        user
        and getattr(user, 'is_authenticated', False)
        and (
            getattr(user, 'is_superuser', False)
            or getattr(user, 'user_type', None) == 'platform_admin'
        )
    )


def is_facility_admin(user):
    return bool(
        user
        and getattr(user, 'is_authenticated', False)
        and getattr(user, 'user_type', None) == 'admin'
    )


def _current_leadership_queryset(user, facility_code=None):
    from apps.organization.models import UnitLeadership

    today = timezone.now().date()
    queryset = (
        UnitLeadership.objects
        .filter(
            user=user,
            is_active=True,
            effective_from__lte=today,
        )
        .filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        )
    )
    queryset = queryset.select_related('role', 'unit', 'unit__unit_type', 'unit__root_unit')
    if facility_code:
        queryset = queryset.filter(unit__root_unit__code__iexact=facility_code)
    return queryset


def _capabilities_for_leadership(leadership):
    role = leadership.role
    capabilities = {AdminCapabilities.ORGANIZATION_VIEW}

    if role.can_view_all_data:
        capabilities.add(AdminCapabilities.UNIT_DATA_VIEW)
    if role.can_approve:
        capabilities.add(AdminCapabilities.UNIT_APPROVALS_MANAGE)
        capabilities.add(AdminCapabilities.ROSTER_VIEW)
    if role.can_manage_staff:
        capabilities.update({
            AdminCapabilities.STAFF_VIEW,
            AdminCapabilities.STAFF_MANAGE,
            AdminCapabilities.ROSTER_VIEW,
            AdminCapabilities.ROSTER_MANAGE,
        })
    if role.can_manage_budget:
        capabilities.add(AdminCapabilities.UNIT_BUDGET_MANAGE)

    return frozenset(capabilities)


def _base_capabilities_for_user(user):
    capabilities = set()
    user_type = getattr(user, 'user_type', None)

    if is_platform_admin(user):
        capabilities.update(PLATFORM_ADMIN_CAPABILITIES)
    if is_facility_admin(user):
        capabilities.update(FACILITY_ADMIN_CAPABILITIES)
    capabilities.update(ROLE_CAPABILITIES.get(user_type, ()))

    return capabilities


def build_admin_access_payload(user, facility_code=None):
    if not user or not getattr(user, 'is_authenticated', False):
        return {
            'capabilities': [],
            'scopes': [],
            'is_platform_admin': False,
            'is_facility_admin': False,
        }

    capabilities = _base_capabilities_for_user(user)
    scopes = []

    try:
        leadership_queryset = _current_leadership_queryset(user, facility_code)
        for leadership in leadership_queryset:
            scope_capabilities = sorted(_capabilities_for_leadership(leadership))
            capabilities.update(scope_capabilities)
            unit = leadership.unit
            scopes.append({
                'unit_id': str(unit.id),
                'unit_name': unit.name,
                'unit_type': getattr(unit.unit_type, 'code', None),
                'unit_path': unit.path_cache or unit.full_path,
                'facility_code': getattr(unit.root_unit, 'code', None),
                'role_code': leadership.role.code,
                'role_name': leadership.role.name,
                'capabilities': scope_capabilities,
            })
    except Exception:
        # Authentication responses must not fail because optional organization
        # tables are unavailable during setup/migration windows.
        scopes = []

    return {
        'capabilities': sorted(capabilities),
        'scopes': scopes,
        'is_platform_admin': is_platform_admin(user),
        'is_facility_admin': is_facility_admin(user),
    }


def user_has_admin_capability(user, capability, facility_code=None):
    if not capability:
        return False
    payload = build_admin_access_payload(user, facility_code=facility_code)
    return capability in set(payload.get('capabilities') or [])


def user_has_unscoped_admin_capability(user, capability):
    return capability in _base_capabilities_for_user(user)


def get_admin_accessible_unit_ids(user, capability, facility_code=None):
    """
    Return unit ids where a leadership-scoped capability applies.

    Returns None when the user has unscoped facility/platform authority for the
    capability.  Callers can use None as "all facility-scoped rows".
    """
    if user_has_unscoped_admin_capability(user, capability):
        return None

    unit_ids = set()
    try:
        for leadership in _current_leadership_queryset(user, facility_code):
            if capability not in _capabilities_for_leadership(leadership):
                continue
            unit = leadership.unit
            unit_ids.add(unit.id)
            unit_ids.update(unit.get_descendants().values_list('id', flat=True))
    except Exception:
        return set()

    return unit_ids


def user_has_unit_admin_capability(user, capability, unit, facility_code=None):
    if not user or not getattr(user, 'is_authenticated', False) or not unit:
        return False
    if capability in _base_capabilities_for_user(user):
        return True

    try:
        for leadership in _current_leadership_queryset(user, facility_code):
            if capability not in _capabilities_for_leadership(leadership):
                continue
            leadership_unit = leadership.unit
            if unit.pk == leadership_unit.pk or unit.is_descendant_of(leadership_unit):
                return True
    except Exception:
        return False

    return False


class HasAdminCapability(permissions.BasePermission):
    capability = None

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        facility_code = getattr(getattr(request, 'facility', None), 'code', None)
        if not facility_code:
            facility_code = getattr(request, 'facility_code', None)
        if not facility_code:
            try:
                from apps.core.security import get_user_facility
                facility = get_user_facility(request)
                facility_code = getattr(facility, 'code', None)
            except Exception:
                facility_code = None
        return user_has_admin_capability(
            request.user,
            self.capability,
            facility_code=facility_code,
        )


class CanViewOrganization(HasAdminCapability):
    capability = AdminCapabilities.ORGANIZATION_VIEW


class CanManageOrganization(HasAdminCapability):
    capability = AdminCapabilities.ORGANIZATION_MANAGE


class CanViewStaff(HasAdminCapability):
    capability = AdminCapabilities.STAFF_VIEW


class CanManageStaff(HasAdminCapability):
    capability = AdminCapabilities.STAFF_MANAGE


class CanViewRosters(HasAdminCapability):
    capability = AdminCapabilities.ROSTER_VIEW


class CanManageRosters(HasAdminCapability):
    capability = AdminCapabilities.ROSTER_MANAGE


class CanViewAudit(HasAdminCapability):
    capability = AdminCapabilities.AUDIT_VIEW
