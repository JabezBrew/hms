"""
Services for the organization app.

Contains business logic for unit access, permissions, and other operations.
"""
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

CLINICAL_STAFFING_MODES = ('clinical_only', 'mixed')
OPS_STAFFING_MODES = ('ops_only', 'mixed')


class UnitAccessService:
    """
    Service for determining user access to clinical units.

    Key pattern: Precompute unit IDs once per request, filter querysets with `__in`.
    This avoids N+1 queries when checking access to multiple units.
    """
    CACHE_TTL = 300  # 5 minutes

    @classmethod
    def get_accessible_unit_ids(cls, user, include_descendants=True):
        """
        Returns set of unit IDs user can access. Called ONCE per request.
        Results cached per user with short TTL.

        Access is granted via:
        1. Direct staff assignments
        2. Leadership positions
        3. Cross-coverage schedules

        Args:
            user: The user to check access for
            include_descendants: If True, include all descendant units

        Returns:
            Set of unit UUIDs the user can access
        """
        if not user or not user.is_authenticated:
            return set()

        cache_key = f'user_unit_access:{user.id}'
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        # Import here to avoid circular imports
        from apps.users.models import PractitionerProfile, Staff
        from .models import (
            ClinicalUnit,
            StaffUnitAssignment,
            UnitMemberAssignment,
            UnitLeadership,
            CrossCoverageSchedule,
        )

        # Get practitioner profile if exists
        try:
            practitioner = PractitionerProfile.objects.get(staff__user=user)
        except PractitionerProfile.DoesNotExist:
            practitioner = None
        try:
            staff = Staff.objects.get(user=user)
        except Staff.DoesNotExist:
            staff = None

        today = timezone.now().date()
        now = timezone.now()
        unit_ids = set()
        clinical_unit_ids = set()
        ops_unit_ids = set()

        # 1. Direct staff assignments (1 query)
        if practitioner:
            direct = StaffUnitAssignment.objects.filter(
                practitioner=practitioner,
                is_active=True
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            ).values_list('unit_id', flat=True)
            direct_ids = set(direct)
            unit_ids.update(direct_ids)
            clinical_unit_ids.update(direct_ids)

        # 1b. Ops member assignments (1 query)
        if staff:
            members = UnitMemberAssignment.objects.filter(
                staff=staff,
                is_active=True
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            ).values_list('unit_id', flat=True)
            member_ids = set(members)
            unit_ids.update(member_ids)
            if not practitioner:
                ops_unit_ids.update(member_ids)

        # 2. Leadership positions (1 query)
        leadership = UnitLeadership.objects.filter(
            user=user,
            is_active=True,
            effective_from__lte=today
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        ).select_related('unit')

        for leadership_assignment in leadership:
            unit_id = leadership_assignment.unit_id
            unit_ids.add(unit_id)
            staffing_mode = leadership_assignment.unit.staffing_mode
            if staffing_mode == 'ops_only':
                ops_unit_ids.add(unit_id)
            elif staffing_mode == 'clinical_only':
                clinical_unit_ids.add(unit_id)
            elif practitioner:
                clinical_unit_ids.add(unit_id)
            elif staff:
                ops_unit_ids.add(unit_id)

        # 3. Cross-coverage (1 query)
        if practitioner:
            coverage = CrossCoverageSchedule.objects.filter(
                covering_practitioner=practitioner,
                start_datetime__lte=now,
                end_datetime__gte=now,
                is_active=True
            ).values_list('covered_unit_id', flat=True)
            coverage_ids = set(coverage)
            unit_ids.update(coverage_ids)
            clinical_unit_ids.update(coverage_ids)

        # 4. Expand to descendants (1 MPTT query)
        if include_descendants:
            if clinical_unit_ids:
                clinical_units = ClinicalUnit.objects.filter(id__in=clinical_unit_ids, is_active=True)
                for unit in clinical_units:
                    descendant_ids = unit.get_descendants().filter(
                        is_active=True,
                        staffing_mode__in=CLINICAL_STAFFING_MODES
                    ).values_list('id', flat=True)
                    unit_ids.update(descendant_ids)

            if ops_unit_ids:
                ops_units = ClinicalUnit.objects.filter(id__in=ops_unit_ids, is_active=True)
                for unit in ops_units:
                    descendant_ids = unit.get_descendants().filter(
                        is_active=True,
                        staffing_mode__in=OPS_STAFFING_MODES
                    ).values_list('id', flat=True)
                    unit_ids.update(descendant_ids)

        cache.set(cache_key, unit_ids, cls.CACHE_TTL)
        return unit_ids

    @classmethod
    def invalidate_user_cache(cls, user_id):
        """
        Invalidate the unit access cache for a user.
        Call on staff/leadership/coverage changes.
        """
        cache.delete(f'user_unit_access:{user_id}')

    @classmethod
    def user_has_access(cls, user, unit):
        """
        Per-object check - USE SPARINGLY (prefer queryset filtering).
        Only for edge cases where queryset filtering isn't possible.

        Args:
            user: The user to check
            unit: The ClinicalUnit to check access to

        Returns:
            Boolean indicating if user has access
        """
        unit_ids = cls.get_accessible_unit_ids(user)
        return unit.id in unit_ids

    @classmethod
    def filter_queryset_by_access(cls, queryset, user, unit_field='unit'):
        """
        Filter a queryset to only include records the user has access to.

        Args:
            queryset: The queryset to filter
            user: The user to check access for
            unit_field: The name of the unit foreign key field (default: 'unit')

        Returns:
            Filtered queryset
        """
        if not user or not user.is_authenticated:
            return queryset.none()

        # Admin users can see everything
        if hasattr(user, 'user_type') and user.user_type == 'admin':
            return queryset

        unit_ids = cls.get_accessible_unit_ids(user)
        filter_kwargs = {f'{unit_field}_id__in': unit_ids}
        return queryset.filter(**filter_kwargs)


class UnitHierarchyService:
    """
    Service for working with the organizational hierarchy.
    """

    @classmethod
    def get_facility_for_unit(cls, unit):
        """Get the root facility for a unit."""
        return unit.root_unit or unit.get_root()

    @classmethod
    def get_units_by_type(cls, type_code, facility=None, active_only=True):
        """
        Get all units of a specific type.

        Args:
            type_code: The unit type code (e.g., 'department', 'team')
            facility: Optional facility to filter by
            active_only: If True, only return active units

        Returns:
            QuerySet of ClinicalUnit objects
        """
        from .models import ClinicalUnit

        queryset = ClinicalUnit.objects.filter(unit_type__code=type_code)

        if active_only:
            queryset = queryset.filter(is_active=True)

        if facility:
            queryset = queryset.filter(root_unit=facility)

        return queryset.select_related('unit_type', 'parent')

    @classmethod
    def get_teams_for_admission(cls, facility=None):
        """
        Get all units that can be primary teams for admissions.

        Args:
            facility: Optional facility to filter by

        Returns:
            QuerySet of ClinicalUnit objects
        """
        from .models import ClinicalUnit

        queryset = ClinicalUnit.objects.filter(
            unit_type__can_admit_patients=True,
            is_active=True,
            accepts_admissions=True
        )

        if facility:
            queryset = queryset.filter(root_unit=facility)

        return queryset.select_related('unit_type', 'parent')

    @classmethod
    def get_consulting_teams(cls, facility=None):
        """
        Get all units that can be consulting teams.

        Args:
            facility: Optional facility to filter by

        Returns:
            QuerySet of ClinicalUnit objects
        """
        from .models import ClinicalUnit

        queryset = ClinicalUnit.objects.filter(
            unit_type__can_consult=True,
            is_active=True,
            accepts_referrals=True
        )

        if facility:
            queryset = queryset.filter(root_unit=facility)

        return queryset.select_related('unit_type', 'parent')
