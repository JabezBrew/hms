"""
Services for the organization app.

Contains business logic for unit access, permissions, and other operations.
"""
from datetime import timedelta

from django.core.cache import cache

from apps.core.cache_utils import facility_cache_key
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

        cache_key = facility_cache_key(f'user_unit_access:{user.id}')
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
        cache.delete(facility_cache_key(f'user_unit_access:{user_id}'))

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


# =============================================================================
# Duty Roster Services
# =============================================================================


class DutyRosterService:
    """
    Service class for duty roster operations.

    Provides business logic for:
    - Generating rosters from templates
    - Finding on-duty practitioners
    - Handling duty swaps
    """

    # Seniority ordering for primary practitioner selection
    SENIORITY_ORDER = ['attending', 'fellow', 'resident', 'intern']

    @classmethod
    def generate_roster(
        cls,
        unit,
        start_date,
        end_date,
        overwrite=False,
        created_by=None
    ):
        """
        Generate roster entries from templates for a date range.

        Args:
            unit: Clinical unit to generate roster for
            start_date: Start date (inclusive)
            end_date: End date (inclusive)
            overwrite: If True, delete existing manual entries; otherwise skip
            created_by: User creating the entries

        Returns:
            List of created DutyRoster entries
        """
        from datetime import timedelta
        from django.db import transaction
        from .models import DutyRosterTemplate, DutyRoster

        created_entries = []

        # Get active templates for this unit
        templates = DutyRosterTemplate.objects.filter(
            unit=unit,
            is_active=True,
            effective_from__lte=end_date,
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=start_date)
        ).select_related('shift', 'practitioner', 'facility')

        if not templates.exists():
            return created_entries

        with transaction.atomic():
            current_date = start_date
            while current_date <= end_date:
                day_of_week = current_date.weekday()

                # Get templates for this day of week
                day_templates = templates.filter(day_of_week=day_of_week)

                for template in day_templates:
                    # Check if template is effective for this date
                    if template.effective_from > current_date:
                        continue
                    if template.effective_until and template.effective_until < current_date:
                        continue

                    # Check for existing entry
                    existing = DutyRoster.objects.filter(
                        unit=unit,
                        date=current_date,
                        start_time=template.start_time,
                        end_time=template.end_time,
                        is_active=True,
                    ).first()

                    if existing:
                        if overwrite and existing.source == 'manual':
                            existing.is_active = False
                            existing.save(update_fields=['is_active', 'updated_at'])
                        else:
                            continue  # Skip - entry exists

                    # Create new entry
                    entry = DutyRoster.objects.create(
                        facility=template.facility,
                        unit=unit,
                        practitioner=template.practitioner,
                        date=current_date,
                        shift=template.shift,
                        start_time=template.start_time,
                        end_time=template.end_time,
                        role=template.role,
                        context=template.context,
                        seniority_level=template.seniority_level,
                        is_primary=template.is_primary,
                        source='template',
                        template=template,
                        created_by=created_by,
                    )
                    created_entries.append(entry)

                current_date += timedelta(days=1)

        return created_entries

    @classmethod
    def generate_facility_roster(
        cls,
        facility,
        start_date,
        end_date,
        created_by=None
    ):
        """
        Generate roster for all units in a facility.

        Returns:
            Total number of entries created
        """
        from .models import ClinicalUnit

        total_created = 0

        units = ClinicalUnit.objects.filter(
            root_unit__code=facility.code,
            is_active=True,
            accepts_admissions=True,
        )

        for unit in units:
            entries = cls.generate_roster(
                unit=unit,
                start_date=start_date,
                end_date=end_date,
                created_by=created_by,
            )
            total_created += len(entries)

        return total_created

    @classmethod
    def get_on_duty(
        cls,
        unit,
        at_datetime=None,
        role=None,
        context=None,
        include_descendants=False,
    ):
        """
        Get all practitioners currently on duty for a unit.

        Args:
            unit: Clinical unit
            at_datetime: Datetime to check (defaults to now)
            role: Filter by role (admitting, covering, etc.)
            context: Filter by context (inpatient, outpatient, etc.)
            include_descendants: Include child units

        Returns:
            QuerySet of DutyRoster entries
        """
        from .models import DutyRoster

        if at_datetime is None:
            at_datetime = timezone.now()

        check_date = at_datetime.date()
        check_time = at_datetime.time()
        previous_date = check_date - timedelta(days=1)

        # Build unit filter
        if include_descendants:
            unit_ids = list(unit.get_descendants(include_self=True).values_list('id', flat=True))
        else:
            unit_ids = [unit.id]

        # Base query
        from django.db.models import F

        queryset = DutyRoster.objects.filter(
            unit_id__in=unit_ids,
            is_active=True,
        ).filter(
            Q(date=check_date) | Q(date=previous_date, start_time__gt=F('end_time'))
        ).select_related(
            'practitioner',
            'practitioner__staff',
            'practitioner__staff__user',
            'unit'
        )

        # Time filtering - handle shifts crossing midnight
        # For normal shifts: start <= time < end (where start < end)
        # For night shifts: time >= start OR time < end (where start > end)
        queryset = queryset.filter(
            Q(
                # Normal shift (doesn't cross midnight)
                date=check_date,
                start_time__lte=check_time,
                end_time__gt=check_time,
                start_time__lt=F('end_time'),
            ) | Q(
                # Night shift part 1 (before midnight): time >= start
                date=check_date,
                start_time__lte=check_time,
                start_time__gt=F('end_time'),
            ) | Q(
                # Night shift part 2 (after midnight): time < end
                date=previous_date,
                end_time__gt=check_time,
                start_time__gt=F('end_time'),
            )
        )

        # Optional filters
        if role:
            queryset = queryset.filter(role=role)
        if context:
            queryset = queryset.filter(Q(context=context) | Q(context='all'))

        return queryset.order_by('-is_primary', 'seniority_level')

    @classmethod
    def get_admitting_practitioner(cls, unit, at_datetime=None):
        """
        Get the admitting practitioner for a unit.
        Returns the most senior, primary practitioner on duty.

        Args:
            unit: Clinical unit
            at_datetime: Datetime to check (defaults to now)

        Returns:
            PractitionerProfile or None
        """
        on_duty = cls.get_on_duty(
            unit=unit,
            at_datetime=at_datetime,
            role='admitting',
            context='inpatient',
        )

        # Get primary first, then most senior
        entry = on_duty.filter(is_primary=True).first()
        if entry:
            return entry.practitioner

        # Fall back to most senior
        for seniority in cls.SENIORITY_ORDER:
            entry = on_duty.filter(seniority_level=seniority).first()
            if entry:
                return entry.practitioner

        return None

    @classmethod
    def swap_duty(
        cls,
        roster_entry,
        replacement_practitioner,
        reason='',
        created_by=None,
    ):
        """
        Swap a duty assignment to a different practitioner.
        Creates a new entry with source='swap', preserving the original.

        Args:
            roster_entry: Original roster entry
            replacement_practitioner: New practitioner
            reason: Reason for the swap
            created_by: User performing the swap

        Returns:
            New DutyRoster entry
        """
        from django.db import transaction
        from .models import DutyRoster

        with transaction.atomic():
            # Deactivate the original entry
            roster_entry.is_active = False
            roster_entry.save(update_fields=['is_active', 'updated_at'])

            # Create new entry for replacement
            new_entry = DutyRoster.objects.create(
                facility=roster_entry.facility,
                unit=roster_entry.unit,
                practitioner=replacement_practitioner,
                date=roster_entry.date,
                shift=roster_entry.shift,
                start_time=roster_entry.start_time,
                end_time=roster_entry.end_time,
                role=roster_entry.role,
                context=roster_entry.context,
                seniority_level=roster_entry.seniority_level,
                is_primary=roster_entry.is_primary,
                source='swap',
                template=roster_entry.template,
                original_practitioner=roster_entry.practitioner,
                swap_reason=reason,
                notes=f"Swapped from {roster_entry.practitioner}",
                created_by=created_by,
            )

        return new_entry

    @classmethod
    def override_entry(
        cls,
        roster_entry,
        updated_by=None,
        **changes
    ):
        """
        Override an existing roster entry with changes.

        Args:
            roster_entry: Entry to override
            updated_by: User making changes
            **changes: Fields to update

        Returns:
            Updated DutyRoster entry
        """
        allowed_fields = {
            'start_time', 'end_time', 'role', 'context',
            'seniority_level', 'is_primary', 'notes'
        }

        for field, value in changes.items():
            if field in allowed_fields:
                setattr(roster_entry, field, value)

        roster_entry.updated_by = updated_by
        roster_entry.save()

        return roster_entry


class TeamAssignmentService:
    """
    Service for automatic team/practitioner assignment using duty roster.
    """

    @classmethod
    def assign_admission(
        cls,
        admission,
        target_unit,
        at_datetime=None
    ):
        """
        Assign admitting doctor and primary team for an admission based on duty roster.

        Args:
            admission: Admission instance
            target_unit: Target clinical unit
            at_datetime: Time to check roster (defaults to now)
        """
        # Get admitting practitioner from duty roster
        practitioner = DutyRosterService.get_admitting_practitioner(
            unit=target_unit,
            at_datetime=at_datetime,
        )

        if practitioner:
            admission.admitting_doctor = practitioner

        admission.primary_team = target_unit
        admission.save(update_fields=['admitting_doctor', 'primary_team', 'updated_at'])

    @classmethod
    def assign_encounter(
        cls,
        encounter,
        unit,
        at_datetime=None
    ):
        """
        Assign practitioner to an encounter based on duty roster.
        """
        if encounter.practitioner:
            return  # Already assigned

        practitioner = DutyRosterService.get_admitting_practitioner(
            unit=unit,
            at_datetime=at_datetime,
        )

        if practitioner:
            encounter.practitioner = practitioner
            encounter.save(update_fields=['practitioner', 'updated_at'])

    @classmethod
    def reassign_on_transfer(
        cls,
        admission,
        receiving_unit,
        at_datetime=None
    ):
        """
        Optionally reassign practitioner when patient transfers to new unit.
        """
        # Get the on-duty practitioner at the receiving unit
        practitioner = DutyRosterService.get_admitting_practitioner(
            unit=receiving_unit,
            at_datetime=at_datetime,
        )

        if practitioner:
            admission.admitting_doctor = practitioner

        admission.primary_team = receiving_unit
        admission.save(update_fields=['admitting_doctor', 'primary_team', 'updated_at'])
