"""
Services for the organization app.

Contains business logic for unit access, permissions, and other operations.
"""
import csv
from datetime import datetime, timedelta
from io import StringIO

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


class DepartmentRosterService:
    """Roster generation and on-duty queries for departments."""

    COVERAGE_CACHE_TTL = 60

    @staticmethod
    def _normalize_time(value):
        if value is None:
            return None
        if isinstance(value, str):
            return datetime.strptime(value, '%H:%M').time()
        return value

    @staticmethod
    def _time_matches(start_time, end_time, check_time, is_24_hour=False):
        if is_24_hour:
            return True
        if start_time is None or end_time is None:
            return True
        if start_time <= end_time:
            return start_time <= check_time < end_time
        return check_time >= start_time or check_time < end_time

    @classmethod
    def get_on_duty(cls, department, at_datetime=None):
        if at_datetime is None:
            at_datetime = timezone.now()
        check_date = at_datetime.date()
        check_time = at_datetime.time()

        cache_key = facility_cache_key(
            f'department_roster:on_duty:{department.id}:{check_date}:{check_time.strftime("%H%M")}'
        )
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        from .models import RosterEntry

        entries = RosterEntry.objects.filter(
            department=department,
            date=check_date,
            status='published'
        ).select_related('duty_type', 'team')

        results = []
        for entry in entries:
            duty_type = entry.duty_type
            start_time = entry.start_time or duty_type.start_time
            end_time = entry.end_time or duty_type.end_time
            if not cls._time_matches(start_time, end_time, check_time, duty_type.is_24_hour):
                continue
            # For 24-hour duties, show 08:00 - 08:00
            if duty_type.is_24_hour:
                display_start = '08:00'
                display_end = '08:00'
            else:
                display_start = start_time.strftime('%H:%M') if start_time else None
                display_end = end_time.strftime('%H:%M') if end_time else None

            results.append({
                'id': str(entry.id),
                'department_id': str(department.id),
                'duty_type_id': str(duty_type.id),
                'duty_type_name': duty_type.name,
                'duty_type_code': duty_type.code,
                'team_id': str(entry.team_id) if entry.team_id else None,
                'team_name': entry.team.name if entry.team else None,
                'date': entry.date.isoformat(),
                'start_time': display_start,
                'end_time': display_end,
                'is_24_hour': duty_type.is_24_hour,
                'source': entry.source,
                'status': entry.status,
                'is_override': entry.is_override,
            })

        cache.set(cache_key, results, cls.COVERAGE_CACHE_TTL)
        return results

    @classmethod
    def get_on_duty_team(cls, department, at_datetime=None, duty_type_code=None):
        coverage = cls.get_on_duty(department, at_datetime=at_datetime)
        if duty_type_code:
            coverage = [entry for entry in coverage if entry.get('duty_type_code') == duty_type_code]
        if not coverage:
            return None
        team_id = coverage[0].get('team_id')
        if not team_id:
            return None
        from .models import ClinicalUnit
        return ClinicalUnit.objects.filter(id=team_id).first()


class RosterImportService:
    """
    CSV import validation and apply logic for department/team rosters.
    """

    @staticmethod
    def _normalize_time(value):
        if value in (None, ''):
            return None
        if isinstance(value, str):
            return datetime.strptime(value, '%H:%M').time()
        return value

    @classmethod
    def _parse_csv(cls, content):
        reader = csv.DictReader(StringIO(content))
        rows = []
        for index, row in enumerate(reader, start=2):
            rows.append((index, {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}))
        return rows

    @classmethod
    def validate_roster_csv(cls, content, department, facility):
        required = ['date', 'duty_type_code', 'team_code']
        rows = cls._parse_csv(content)
        errors = []
        resolved_rows = []
        conflicts = []

        from .models import ClinicalUnit, DepartmentDutyType, RosterEntry

        for line_number, row in rows:
            missing = [col for col in required if not row.get(col)]
            if missing:
                errors.append({'line': line_number, 'field': ','.join(missing), 'message': 'Missing required fields'})
                continue

            team = ClinicalUnit.objects.filter(
                code=row['team_code'],
                root_unit__code=facility.code
            ).first()
            if not team:
                errors.append({'line': line_number, 'field': 'team_code', 'message': 'Team not found'})
                continue

            duty_type = DepartmentDutyType.objects.filter(
                department=department,
                code=row['duty_type_code']
            ).first()
            if not duty_type:
                errors.append({'line': line_number, 'field': 'duty_type_code', 'message': 'Duty type not found'})
                continue

            try:
                roster_date = datetime.strptime(row['date'], '%Y-%m-%d').date()
            except ValueError:
                errors.append({'line': line_number, 'field': 'date', 'message': 'Invalid date format'})
                continue

            start_time = cls._normalize_time(row.get('start_time') or None)
            end_time = cls._normalize_time(row.get('end_time') or None)
            if (start_time is None) ^ (end_time is None):
                errors.append({'line': line_number, 'field': 'start_time', 'message': 'Both start_time and end_time required'})
                continue
            if start_time and end_time and start_time == end_time:
                errors.append({'line': line_number, 'field': 'start_time', 'message': 'start_time and end_time cannot match'})
                continue

            existing = RosterEntry.objects.filter(
                department=department,
                date=roster_date,
                duty_type=duty_type
            ).first()
            if existing:
                conflicts.append({
                    'line': line_number,
                    'entry_id': str(existing.id),
                    'message': 'Roster entry already exists for date and duty type'
                })

            resolved_rows.append({
                'line': line_number,
                'date': roster_date,
                'duty_type': duty_type,
                'team': team,
                'start_time': start_time,
                'end_time': end_time,
            })

        return {
            'errors': errors,
            'conflicts': conflicts,
            'rows': resolved_rows,
        }

    @classmethod
    def apply_roster_csv(cls, rows, department, user, conflict_strategy='skip'):
        from django.db import transaction
        from .models import RosterEntry

        created = 0
        with transaction.atomic():
            for row in rows:
                existing = RosterEntry.objects.filter(
                    department=department,
                    date=row['date'],
                    duty_type=row['duty_type']
                ).first()
                if existing and conflict_strategy == 'skip':
                    continue
                if existing:
                    existing.team = row['team']
                    existing.start_time = row['start_time']
                    existing.end_time = row['end_time']
                    existing.source = 'imported'
                    existing.updated_by = user
                    existing.save()
                    continue
                RosterEntry.objects.create(
                    department=department,
                    duty_type=row['duty_type'],
                    date=row['date'],
                    team=row['team'],
                    start_time=row['start_time'],
                    end_time=row['end_time'],
                    source='imported',
                    status='draft',
                    created_by=user,
                    updated_by=user,
                )
                created += 1
        return created



class RosterValidationService:
    """Validation helpers for roster entry constraints."""

    @staticmethod
    def validate_back_to_back(entries_by_team_date, duty_type, team_id, date):
        if not duty_type.is_24_hour or not team_id:
            return None
        prev_key = (team_id, duty_type.id, date - timedelta(days=1))
        next_key = (team_id, duty_type.id, date + timedelta(days=1))
        if prev_key in entries_by_team_date or next_key in entries_by_team_date:
            return 'Cannot assign back-to-back 24-hour shifts.'
        return None

    @staticmethod
    def resolve_excluded_team(rule, date, existing_by_date_duty_type):
        exclusion = rule.exclusion_rule or {}
        excluded_from = exclusion.get('excluded_from')
        team_working_on = exclusion.get('team_working_on')
        reference_duty_type_id = exclusion.get('duty_type_id') or rule.duty_type_id

        if excluded_from is None or team_working_on is None:
            return None

        def _day_value(value):
            if isinstance(value, int):
                return value
            days = {
                'monday': 0,
                'tuesday': 1,
                'wednesday': 2,
                'thursday': 3,
                'friday': 4,
                'saturday': 5,
                'sunday': 6,
            }
            return days.get(str(value).lower())

        excluded_day = _day_value(excluded_from)
        working_day = _day_value(team_working_on)
        if excluded_day is None or working_day is None:
            return None
        if date.weekday() != excluded_day:
            return None

        start_of_week = date - timedelta(days=date.weekday())
        reference_date = start_of_week + timedelta(days=working_day)
        return existing_by_date_duty_type.get((reference_date, reference_duty_type_id))


class RosterGenerationService:
    """Generate roster entries from rotation rules."""

    @classmethod
    def _get_initial_sequence_position(cls, rule, date_from, department):
        """
        Determine the starting sequence position for a rotation rule.

        For sequential rotations, looks up the last roster entry before date_from
        and calculates the next position in the sequence.
        """
        from .models import RosterEntry

        if rule.rule_type == 'fixed_weekly':
            return 0

        sequence = rule.team_sequence
        if not sequence:
            return 0

        # Find the last roster entry before date_from for this duty type
        last_entry = RosterEntry.objects.filter(
            department=department,
            duty_type=rule.duty_type,
            date__lt=date_from,
            team_id__isnull=False
        ).order_by('-date').first()

        if not last_entry or not last_entry.team_id:
            return 0

        # Find position of the last assigned team in the sequence
        last_team_id = str(last_entry.team_id)
        try:
            last_position = sequence.index(last_team_id)
            # Return the next position in sequence
            return last_position + 1
        except ValueError:
            # Team not in current sequence, start from beginning
            return 0

    @classmethod
    def generate_roster(cls, department, date_from, date_to, created_by=None):
        from .models import DepartmentDutyType, RotationRule, RosterEntry

        duty_types = list(
            DepartmentDutyType.objects.filter(
                department=department,
                is_active=True
            ).order_by('display_order')
        )
        rules = RotationRule.objects.filter(
            department=department,
            is_active=True
        ).select_related('duty_type')

        rules_by_duty_type = {rule.duty_type_id: rule for rule in rules}

        existing_entries = RosterEntry.objects.filter(
            department=department,
            date__gte=date_from - timedelta(days=1),
            date__lte=date_to + timedelta(days=1)
        ).select_related('duty_type', 'team')

        existing_by_date_duty_type = {
            (entry.date, entry.duty_type_id): entry.team_id
            for entry in existing_entries
        }
        entries_by_team_date = {
            (entry.team_id, entry.duty_type_id, entry.date)
            for entry in existing_entries
            if entry.team_id
        }

        # Initialize sequence positions, continuing from previous period for sequential rules
        sequence_positions = {}
        for duty_type in duty_types:
            rule = rules_by_duty_type.get(duty_type.id)
            if rule and rule.rule_type in ('sequential', 'exclusion'):
                sequence_positions[duty_type.id] = cls._get_initial_sequence_position(
                    rule, date_from, department
                )
            else:
                sequence_positions[duty_type.id] = 0
        to_create = []

        current = date_from
        while current <= date_to:
            day = current.weekday()
            for duty_type in duty_types:
                if duty_type.rotation_type == 'none':
                    continue
                if duty_type.applicable_days and day not in duty_type.applicable_days:
                    continue
                if (current, duty_type.id) in existing_by_date_duty_type:
                    continue

                rule = rules_by_duty_type.get(duty_type.id)
                if not rule:
                    continue

                team_id = cls._apply_rule(
                    rule,
                    current,
                    sequence_positions,
                    existing_by_date_duty_type
                )
                if not team_id:
                    continue

                back_to_back_error = RosterValidationService.validate_back_to_back(
                    entries_by_team_date,
                    duty_type,
                    team_id,
                    current
                )
                if back_to_back_error:
                    raise ValueError(back_to_back_error)

                entry = RosterEntry(
                    department=department,
                    duty_type=duty_type,
                    date=current,
                    team_id=team_id,
                    start_time=duty_type.start_time,
                    end_time=duty_type.end_time,
                    source='generated',
                    status='draft',
                    created_by=created_by,
                    updated_by=created_by,
                )
                to_create.append(entry)
                existing_by_date_duty_type[(current, duty_type.id)] = team_id
                entries_by_team_date.add((team_id, duty_type.id, current))
            current += timedelta(days=1)

        if to_create:
            RosterEntry.objects.bulk_create(to_create)
        return to_create

    @classmethod
    def _apply_rule(cls, rule, date, sequence_positions, existing_by_date_duty_type):
        if rule.rule_type == 'fixed_weekly':
            day_key = str(date.weekday())
            return rule.day_assignments.get(day_key) or rule.day_assignments.get(date.weekday())

        sequence = rule.team_sequence
        if not sequence:
            return None

        position = sequence_positions.get(rule.duty_type_id, 0)
        available = list(sequence)

        if rule.rule_type == 'exclusion':
            excluded_team = RosterValidationService.resolve_excluded_team(
                rule,
                date,
                existing_by_date_duty_type
            )
            if excluded_team:
                available = [team_id for team_id in available if team_id != excluded_team]
            if not available:
                return None

        team_id = available[position % len(available)]
        sequence_positions[rule.duty_type_id] = position + 1
        return team_id


class TeamAssignmentService:
    """
    Service for automatic team assignment using roster entries.

    Primary team now lives on Encounter, not Admission. This service
    updates Encounter.primary_team as the source of truth, and keeps
    Admission.primary_team in sync for backward compatibility.
    """

    @classmethod
    def assign_initial_team(
        cls,
        encounter,
        team=None,
        use_roster=True,
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
        elif use_roster and encounter.department:
            assigned_team = DepartmentRosterService.get_on_duty_team(
                department=encounter.department,
                at_datetime=at_datetime or encounter.start_time,
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
        # Update primary_team on admission (backward compatibility)
        admission.primary_team = receiving_unit
        admission.save(update_fields=['admitting_doctor', 'primary_team', 'updated_at'])

        # Update primary_team on encounter (source of truth) - in-place per user preference
        if hasattr(admission, 'encounter') and admission.encounter:
            admission.encounter.primary_team = receiving_unit
            admission.encounter.save(update_fields=['primary_team', 'updated_at'])
