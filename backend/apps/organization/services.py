"""
Services for the organization app.

Contains business logic for unit access, permissions, and other operations.
"""
from datetime import timedelta

from django.core.cache import cache

from apps.core.cache_utils import facility_cache_key
from django.db.models import Q
from django.db.models import F
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

    @classmethod
    def get_department_unit_for_core_department(cls, core_department, facility=None):
        """
        Resolve the ClinicalUnit department mapped to a core Department.

        Args:
            core_department: core.Department instance
            facility: Optional core.Facility to scope the lookup

        Returns:
            ClinicalUnit or None
        """
        if not core_department:
            return None

        from .models import ClinicalUnit

        queryset = ClinicalUnit.objects.filter(
            core_department=core_department,
            unit_type__code='department',
            is_active=True
        )
        if facility:
            queryset = queryset.filter(root_unit__code=facility.code)

        return queryset.select_related('unit_type', 'root_unit').first()


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

    TEAM_CACHE_TTL = 60

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
        include_practitioner=True,
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

        cache_key = facility_cache_key(
            f'duty_roster:{unit.id}:{check_date}:{check_time.strftime("%H%M")}:{role or "any"}:{context or "any"}:desc={include_descendants}:practitioner={include_practitioner}'
        )
        cached_ids = cache.get(cache_key)
        if cached_ids is not None:
            queryset = DutyRoster.objects.filter(id__in=cached_ids)
            if include_practitioner:
                queryset = queryset.select_related(
                    'practitioner',
                    'practitioner__staff',
                    'practitioner__staff__user',
                    'unit'
                )
            else:
                queryset = queryset.select_related('unit')
            return queryset.order_by('-is_primary', 'seniority_level')

        # Build unit filter
        if include_descendants:
            unit_ids = list(unit.get_descendants(include_self=True).values_list('id', flat=True))
        else:
            unit_ids = [unit.id]

        queryset = DutyRoster.objects.filter(
            unit_id__in=unit_ids,
            is_active=True,
        ).filter(
            Q(date=check_date) | Q(date=previous_date, start_time__gt=F('end_time'))
        )

        if include_practitioner:
            queryset = queryset.select_related(
                'practitioner',
                'practitioner__staff',
                'practitioner__staff__user',
                'unit'
            )
        else:
            queryset = queryset.select_related('unit')

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

        queryset = queryset.order_by('-is_primary', 'seniority_level')
        cache.set(cache_key, list(queryset.values_list('id', flat=True)), 60)
        return queryset

    @classmethod
    def get_on_duty_team(
        cls,
        department,
        at_datetime=None,
        role='admitting',
        context='inpatient',
    ):
        """Return the on-duty team for a department."""
        if not department:
            return None

        check_time = (at_datetime or timezone.now()).strftime("%Y%m%d%H%M")
        cache_key = facility_cache_key(
            f'on_duty_team:{department.id}:{role}:{context}:{check_time}'
        )
        cached = cache.get(cache_key)
        if cached is not None:
            if cached == 'none':
                return None
            from apps.organization.models import ClinicalUnit
            return ClinicalUnit.objects.filter(id=cached).first()

        on_duty = cls.get_on_duty(
            unit=department,
            at_datetime=at_datetime,
            role=role,
            context=context,
            include_descendants=True,
            include_practitioner=False,
        )
        entry = on_duty.filter(is_primary=True).first() or on_duty.first()
        team = entry.unit if entry else None
        cache.set(cache_key, str(team.id) if team else 'none', cls.TEAM_CACHE_TTL)
        return team

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
            include_practitioner=True,
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

    Primary team now lives on Encounter, not Admission. This service
    updates Encounter.primary_team as the source of truth, and keeps
    Admission.primary_team in sync for backward compatibility.
    """

    @classmethod
    def assign_initial_team(
        cls,
        encounter,
        team=None,
        use_duty_roster=True,
        context=None,
        at_datetime=None,
    ):
        """
        Assign the initial care team to an encounter.

        Sets both primary_team and admitted_by_team once. Subsequent calls are rejected.
        """
        from apps.organization.models import ClinicalUnit

        if encounter.admitted_by_team_id:
            raise ValueError("Encounter already has an admitted_by_team assigned")

        assigned_team = None
        if team:
            assigned_team = team
        elif use_duty_roster and encounter.department:
            if context is None:
                context = {
                    'inpatient': 'inpatient',
                    'outpatient': 'outpatient',
                    'emergency': 'emergency',
                }.get(encounter.encounter_type, 'inpatient')
            assigned_team = DutyRosterService.get_on_duty_team(
                department=encounter.department,
                at_datetime=at_datetime or encounter.start_time,
                role='admitting',
                context=context
            )
        if not assigned_team:
            assigned_team = encounter.department

        if not assigned_team and not encounter.department and not team:
            return None

        requires_admission = (context or encounter.encounter_type) == 'inpatient'

        if requires_admission and assigned_team and not getattr(assigned_team.unit_type, 'can_admit_patients', True):
            raise ValueError("Assigned team cannot admit patients")

        if assigned_team and getattr(assigned_team, 'is_active', True) is False:
            raise ValueError("Assigned team is inactive")

        if requires_admission and assigned_team and encounter.department and assigned_team.id != encounter.department.id:
            if not ClinicalUnit.objects.filter(
                id=assigned_team.id,
                parent_id=encounter.department.id,
                unit_type__can_admit_patients=True,
                is_active=True
            ).exists():
                raise ValueError("Assigned team is not valid for this department")

        if requires_admission and assigned_team and encounter.department and assigned_team.id == encounter.department.id:
            if getattr(encounter.department.unit_type, 'can_admit_patients', True) is False:
                raise ValueError("Department cannot admit patients")

        if not assigned_team and requires_admission:
            raise ValueError("Cannot determine care team for encounter")

        encounter.primary_team = assigned_team
        encounter.admitted_by_team = assigned_team
        encounter.save(update_fields=['primary_team', 'admitted_by_team', 'updated_at'])

        admission = getattr(encounter, 'admission', None)
        if admission and admission.primary_team_id != assigned_team.id:
            admission.primary_team = assigned_team
            admission.save(update_fields=['primary_team', 'updated_at'])

        return assigned_team

    @classmethod
    def reassign_team_on_bed_assignment(cls, encounter, bed):
        """Reassign primary_team when ward policy is strict."""
        if not encounter or not encounter.department_id:
            return None

        department = encounter.department
        policy = getattr(department, 'ward_assignment_policy', 'flexible')
        if policy == 'flexible':
            return None

        ward = bed.ward if bed else None
        if not ward:
            return None

        ward_owning_team = cls._get_ward_owning_team(ward)
        if ward_owning_team and ward_owning_team.id != encounter.primary_team_id:
            encounter.primary_team = ward_owning_team
            encounter.save(update_fields=['primary_team', 'updated_at'])

            admission = getattr(encounter, 'admission', None)
            if admission and admission.primary_team_id != ward_owning_team.id:
                admission.primary_team = ward_owning_team
                admission.save(update_fields=['primary_team', 'updated_at'])

            return ward_owning_team
        return None

    @classmethod
    def _get_ward_owning_team(cls, ward):
        from apps.organization.models import UnitWardAllocation

        allocation = UnitWardAllocation.objects.filter(
            ward=ward,
            allocation_type='dedicated',
            is_active=True
        ).select_related('unit').first()

        return allocation.unit if allocation else None

    @classmethod
    def assign_admission(
        cls,
        admission,
        target_unit,
        at_datetime=None
    ):
        """
        Assign admitting doctor and primary team for an admission based on duty roster.

        This sets primary_team on both the Encounter (source of truth) and
        Admission (backward compatibility).

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

        # Set primary_team on admission (backward compatibility)
        admission.primary_team = target_unit
        admission.save(update_fields=['admitting_doctor', 'primary_team', 'updated_at'])

        # Set primary_team on encounter (source of truth)
        if hasattr(admission, 'encounter') and admission.encounter:
            admission.encounter.primary_team = target_unit
            admission.encounter.save(update_fields=['primary_team', 'updated_at'])

    @classmethod
    def assign_encounter(
        cls,
        encounter,
        unit,
        at_datetime=None
    ):
        """
        Assign practitioner and primary team to an encounter based on duty roster.

        Args:
            encounter: Encounter instance
            unit: Target clinical unit
            at_datetime: Time to check roster (defaults to now)
        """
        update_fields = ['updated_at']

        if not encounter.practitioner:
            practitioner = DutyRosterService.get_admitting_practitioner(
                unit=unit,
                at_datetime=at_datetime,
            )
            if practitioner:
                encounter.practitioner = practitioner
                update_fields.append('practitioner')

        # Set primary_team on encounter
        if unit and encounter.primary_team_id != unit.id:
            encounter.primary_team = unit
            update_fields.append('primary_team')

        if len(update_fields) > 1:  # More than just 'updated_at'
            encounter.save(update_fields=update_fields)

    @classmethod
    def reassign_on_transfer(
        cls,
        admission,
        receiving_unit,
        at_datetime=None
    ):
        """
        Reassign practitioner and primary team when patient transfers to new unit.

        Updates both Encounter (source of truth) and Admission (backward compat).
        """
        # Get the on-duty practitioner at the receiving unit
        practitioner = DutyRosterService.get_admitting_practitioner(
            unit=receiving_unit,
            at_datetime=at_datetime,
        )

        if practitioner:
            admission.admitting_doctor = practitioner

        # Update primary_team on admission (backward compatibility)
        admission.primary_team = receiving_unit
        admission.save(update_fields=['admitting_doctor', 'primary_team', 'updated_at'])

        # Update primary_team on encounter (source of truth) - in-place per user preference
        if hasattr(admission, 'encounter') and admission.encounter:
            admission.encounter.primary_team = receiving_unit
            admission.encounter.save(update_fields=['primary_team', 'updated_at'])
