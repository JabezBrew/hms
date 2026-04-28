"""
Services for the organization app.

Contains business logic for unit access, permissions, and other operations.
"""
import csv
from datetime import datetime, timedelta, time
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
    def _duty_window_contains(at_datetime, entry_date, start_time, end_time, is_24_hour=False):
        """
        Determine whether `at_datetime` is inside a roster entry's duty window.

        Important: for overnight shifts (end <= start), the window spans into the next day.
        For 24-hour duties we treat the duty window as a 24 hour span anchored at a
        configured start time (default 08:00 to match existing UI).
        """
        if at_datetime is None:
            return False
        if entry_date is None:
            return False

        local_at = at_datetime
        if timezone.is_aware(local_at):
            local_at = timezone.localtime(local_at)
        else:
            # Fail-safe: interpret naive datetimes in the project's current timezone.
            local_at = timezone.make_aware(local_at, timezone.get_current_timezone())

        if is_24_hour:
            # 24-hour duties intentionally do not store start/end; anchor at 08:00 by convention.
            start_time = start_time or time(8, 0)
            start_dt = timezone.make_aware(
                datetime.combine(entry_date, start_time),
                timezone.get_current_timezone(),
            )
            end_dt = start_dt + timedelta(days=1)
            return start_dt <= local_at < end_dt

        # Non-24 hour duties must have start/end times to avoid incorrect "on duty" assignment.
        if start_time is None or end_time is None:
            return False

        start_dt = timezone.make_aware(
            datetime.combine(entry_date, start_time),
            timezone.get_current_timezone(),
        )
        end_dt = timezone.make_aware(
            datetime.combine(entry_date, end_time),
            timezone.get_current_timezone(),
        )
        if end_time <= start_time:
            end_dt += timedelta(days=1)
        return start_dt <= local_at < end_dt

    @classmethod
    def get_on_duty(cls, department, at_datetime=None):
        if at_datetime is None:
            at_datetime = timezone.now()
        local_at = at_datetime
        if timezone.is_aware(local_at):
            local_at = timezone.localtime(local_at)
        else:
            local_at = timezone.make_aware(local_at, timezone.get_current_timezone())

        check_date = local_at.date()
        check_time = local_at.time()

        cache_key = facility_cache_key(
            f'department_roster:on_duty:{department.id}:{check_date}:{check_time.strftime("%H%M")}'
        )
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        from .models import RosterEntry

        # A shift can span midnight, so coverage at a given datetime may come from either
        # the current day entry or the previous day's entry.
        date_candidates = [check_date, check_date - timedelta(days=1)]
        entries = RosterEntry.objects.filter(
            department=department,
            date__in=date_candidates,
            status='published'
        ).select_related('duty_type', 'duty_type__clinic', 'team')

        results = []
        for entry in entries:
            duty_type = entry.duty_type
            start_time = entry.start_time or duty_type.start_time
            end_time = entry.end_time or duty_type.end_time
            if not cls._duty_window_contains(local_at, entry.date, start_time, end_time, duty_type.is_24_hour):
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
                'duty_type_category': duty_type.category,
                'clinic_id': str(duty_type.clinic_id) if duty_type.clinic_id else None,
                'clinic_name': duty_type.clinic.name if duty_type.clinic else None,
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



class ValidationResult:
    """Result of a validation check."""

    def __init__(self, rule, severity, message, entry=None):
        self.rule = rule
        self.severity = severity
        self.message = message
        self.entry = entry

    def to_dict(self):
        return {
            'rule_id': str(self.rule.id) if self.rule else None,
            'rule_name': self.rule.name if self.rule else None,
            'severity': self.severity,
            'message': self.message,
            'entry_id': str(self.entry.id) if self.entry else None,
            'date': str(self.entry.date) if self.entry else None,
            'duty_type': self.entry.duty_type.name if self.entry and self.entry.duty_type else None,
        }


class RosterValidationService:
    """
    Validation service for roster entry constraints.

    Supports both legacy hardcoded validations and configurable RosterValidationRules.
    """

    # -------------------------------------------------------------------------
    # Legacy validators (for backward compatibility during generation)
    # -------------------------------------------------------------------------

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

    # -------------------------------------------------------------------------
    # Configurable rule validators
    # -------------------------------------------------------------------------

    @classmethod
    def get_rules_for_department(cls, department_id):
        """Fetch active validation rules for a department."""
        from .models import RosterValidationRule
        return list(
            RosterValidationRule.objects.filter(
                department_id=department_id,
                is_active=True
            ).select_related('duty_type')
        )

    @classmethod
    def validate_entry(cls, entry, all_entries, rules=None):
        """
        Validate a single roster entry against all applicable rules.

        Args:
            entry: RosterEntry to validate
            all_entries: List of all entries in the roster period (for cross-checks)
            rules: Optional list of rules (fetched if not provided)

        Returns:
            List of ValidationResult objects
        """
        if rules is None:
            rules = cls.get_rules_for_department(entry.department_id)

        results = []
        for rule in rules:
            # Skip inactive rules
            if not rule.is_active:
                continue

            # For linked_duty_no_consecutive, check if entry's duty type is in the linked list
            if rule.rule_type == 'linked_duty_no_consecutive':
                duty_type_ids = rule.params.get('duty_type_ids', [])
                duty_type_ids_str = [str(d) for d in duty_type_ids]
                if str(entry.duty_type_id) not in duty_type_ids_str:
                    continue
            else:
                # Skip if rule is for specific duty type and doesn't match
                if rule.duty_type_id and rule.duty_type_id != entry.duty_type_id:
                    continue

            # Skip if rule only applies on certain days and this isn't one
            if rule.apply_days and entry.date.weekday() not in rule.apply_days:
                continue

            # Get the validator for this rule type
            validator = cls._get_validator(rule.rule_type)
            if not validator:
                continue

            # Run validation
            error_msg = validator(entry, all_entries, rule.params)
            if error_msg:
                results.append(ValidationResult(
                    rule=rule,
                    severity=rule.severity,
                    message=error_msg,
                    entry=entry
                ))

        return results

    @classmethod
    def validate_roster(cls, entries, rules=None):
        """
        Validate all entries in a roster.

        Returns:
            dict with 'warnings' and 'errors' lists
        """
        if not entries:
            return {'warnings': [], 'errors': []}

        if rules is None:
            # Assume all entries are from same department
            department_id = entries[0].department_id
            rules = cls.get_rules_for_department(department_id)

        all_results = []
        for entry in entries:
            if entry.team_id:  # Only validate entries with team assigned
                results = cls.validate_entry(entry, entries, rules)
                all_results.extend(results)

        return {
            'warnings': [r.to_dict() for r in all_results if r.severity == 'warning'],
            'errors': [r.to_dict() for r in all_results if r.severity == 'error'],
        }

    @classmethod
    def validate_for_publish(cls, entries, rules=None):
        """
        Validate roster before publishing. Returns errors only.
        Raises ValueError if there are blocking errors.
        """
        result = cls.validate_roster(entries, rules)
        if result['errors']:
            error_messages = [e['message'] for e in result['errors'][:5]]  # First 5
            raise ValueError(
                f"Cannot publish roster with validation errors: {'; '.join(error_messages)}"
            )
        return result

    @classmethod
    def _get_validator(cls, rule_type):
        """Get validator function for a rule type."""
        validators = {
            'no_consecutive_days': cls._validate_no_consecutive_days,
            'linked_duty_no_consecutive': cls._validate_linked_duty_no_consecutive,
            'day_pair_exclusion': cls._validate_day_pair_exclusion,
            'team_day_exclusion': cls._validate_team_day_exclusion,
            'max_per_period': cls._validate_max_per_period,
        }
        return validators.get(rule_type)

    # -------------------------------------------------------------------------
    # Individual rule validators
    # -------------------------------------------------------------------------

    @staticmethod
    def _validate_no_consecutive_days(entry, all_entries, params):
        """
        Validate that same team doesn't work days that are N days apart.

        Params:
            days_apart: int (default 1 = consecutive days)
        """
        days_apart = params.get('days_apart', 1)
        if not entry.team_id:
            return None

        # Find entries for same team and duty type within days_apart
        for other in all_entries:
            if other.id == entry.id:
                continue
            if other.team_id != entry.team_id:
                continue
            if other.duty_type_id != entry.duty_type_id:
                continue

            day_diff = abs((entry.date - other.date).days)
            if day_diff <= days_apart:
                return f"Team cannot work duties {days_apart} day(s) apart. Conflict: {entry.date} and {other.date}"

        return None

    @staticmethod
    def _validate_linked_duty_no_consecutive(entry, all_entries, params):
        """
        Validate that same team doesn't work consecutive days across linked duty types.

        Params:
            duty_type_ids: list of duty type UUIDs to treat as linked
            days_apart: int (default 1 = consecutive days)

        Example: Emergency Weekdays (Fri) + Emergency Weekends (Sat) = violation
        """
        duty_type_ids = params.get('duty_type_ids', [])
        days_apart = params.get('days_apart', 1)

        if not entry.team_id or not duty_type_ids:
            return None

        # Convert to strings for comparison (UUIDs may come as strings)
        duty_type_ids_str = [str(d) for d in duty_type_ids]

        # Only check if this entry's duty type is in the linked list
        if str(entry.duty_type_id) not in duty_type_ids_str:
            return None

        # Find entries for same team with ANY of the linked duty types within days_apart
        for other in all_entries:
            if other.id == entry.id:
                continue
            if other.team_id != entry.team_id:
                continue
            # Check if other entry's duty type is in the linked list
            if str(other.duty_type_id) not in duty_type_ids_str:
                continue

            day_diff = abs((entry.date - other.date).days)
            if day_diff <= days_apart and day_diff > 0:
                return f"Team cannot work linked duties {days_apart} day(s) apart. Conflict: {entry.date} and {other.date}"

        return None

    @staticmethod
    def _validate_day_pair_exclusion(entry, all_entries, params):
        """
        Validate that same team doesn't work specific day pairs in same week.

        Params:
            pairs: list of [day1, day2] pairs (0=Mon, 6=Sun)
        """
        pairs = params.get('pairs', [])
        if not pairs or not entry.team_id:
            return None

        entry_weekday = entry.date.weekday()
        # Calculate start of week (Monday)
        start_of_week = entry.date - timedelta(days=entry_weekday)
        end_of_week = start_of_week + timedelta(days=6)

        # Check if this entry's day is in any pair
        for pair in pairs:
            if len(pair) != 2:
                continue

            day_a, day_b = pair

            # If entry is on day_a, check if team has day_b in same week
            if entry_weekday == day_a:
                target_date = start_of_week + timedelta(days=day_b)
                for other in all_entries:
                    if other.id == entry.id:
                        continue
                    if other.team_id != entry.team_id:
                        continue
                    if other.duty_type_id != entry.duty_type_id:
                        continue
                    if other.date == target_date:
                        day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                        return f"Team cannot work both {day_names[day_a]} and {day_names[day_b]} in the same week"

            # If entry is on day_b, check if team has day_a in same week
            if entry_weekday == day_b:
                target_date = start_of_week + timedelta(days=day_a)
                for other in all_entries:
                    if other.id == entry.id:
                        continue
                    if other.team_id != entry.team_id:
                        continue
                    if other.duty_type_id != entry.duty_type_id:
                        continue
                    if other.date == target_date:
                        day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                        return f"Team cannot work both {day_names[day_a]} and {day_names[day_b]} in the same week"

        return None

    @staticmethod
    def _validate_team_day_exclusion(entry, all_entries, params):
        """
        Validate that specific teams don't work on specific days.

        Params:
            team_ids: list of team UUIDs
            days: list of day indices (0=Mon, 6=Sun)
        """
        team_ids = params.get('team_ids', [])
        days = params.get('days', [])

        if not team_ids or not days or not entry.team_id:
            return None

        # Convert to strings for comparison (UUIDs might come as strings)
        team_ids_str = [str(t) for t in team_ids]
        entry_team_str = str(entry.team_id)

        if entry_team_str in team_ids_str and entry.date.weekday() in days:
            day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            day_name = day_names[entry.date.weekday()]
            return f"This team is excluded from working on {day_name}"

        return None

    @staticmethod
    def _validate_max_per_period(entry, all_entries, params):
        """
        Validate that team doesn't exceed max duties in a period.

        Params:
            max: int (maximum duties allowed)
            period: 'week' or 'month'
        """
        max_duties = params.get('max', 2)
        period = params.get('period', 'week')

        if not entry.team_id:
            return None

        # Determine period boundaries
        if period == 'week':
            # Week starts on Monday
            start = entry.date - timedelta(days=entry.date.weekday())
            end = start + timedelta(days=6)
        else:  # month
            start = entry.date.replace(day=1)
            # Last day of month
            if start.month == 12:
                end = start.replace(year=start.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                end = start.replace(month=start.month + 1, day=1) - timedelta(days=1)

        # Count duties for this team in the period
        count = 0
        for other in all_entries:
            if other.team_id != entry.team_id:
                continue
            if other.duty_type_id != entry.duty_type_id:
                continue
            if start <= other.date <= end:
                count += 1

        if count > max_duties:
            return f"Team exceeds maximum of {max_duties} duties per {period} (has {count})"

        return None


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


class RosterAvailabilityService:
    """
    Service for computing available appointment slots from published roster entries.

    This service provides roster-based availability as the single source of truth
    for practitioner scheduling. It derives appointment slots from RosterEntry
    records where the duty_type.category='clinic'.

    This replaces the RecurringSchedule-based approach during the migration period,
    with dual-mode support in AvailabilityService.
    """

    @staticmethod
    def _add_minutes_to_time(base_time, minutes):
        """Add minutes to a time object."""
        from datetime import datetime, timedelta, date
        dummy_date = date.today()
        dt = datetime.combine(dummy_date, base_time)
        dt += timedelta(minutes=minutes)
        return dt.time()

    @staticmethod
    def _times_overlap(start1, end1, start2, end2):
        """Check if two time ranges overlap."""
        return start1 < end2 and end1 > start2

    @staticmethod
    def _is_in_break(slot_start, slot_end, breaks):
        """Check if a slot overlaps with any break period."""
        for break_period in breaks:
            break_start = datetime.strptime(break_period['start'], '%H:%M').time()
            break_end = datetime.strptime(break_period['end'], '%H:%M').time()
            if RosterAvailabilityService._times_overlap(slot_start, slot_end, break_start, break_end):
                return True
        return False

    @staticmethod
    def _is_blocked(check_date, slot_start, slot_end, blocked_times):
        """Check if a slot is blocked by a BlockedTime entry."""
        for blocked in blocked_times:
            if blocked.date != check_date:
                continue
            if blocked.is_all_day:
                return True
            if RosterAvailabilityService._times_overlap(
                slot_start, slot_end, blocked.start_time, blocked.end_time
            ):
                return True
        return False

    @staticmethod
    def _has_appointment(check_date, slot_start, slot_end, appointments):
        """Check if there's an appointment during this slot."""
        return RosterAvailabilityService._appointment_overlap_count(
            check_date=check_date,
            slot_start=slot_start,
            slot_end=slot_end,
            appointments=appointments,
        ) > 0

    @staticmethod
    def _appointment_overlap_count(check_date, slot_start, slot_end, appointments):
        """Count overlapping appointments during this slot."""
        slot_start_dt = datetime.combine(check_date, slot_start)
        slot_end_dt = datetime.combine(check_date, slot_end)

        # Make timezone-aware if needed
        if timezone.is_aware(slot_start_dt):
            pass  # Already aware
        else:
            # Use current timezone
            slot_start_dt = timezone.make_aware(slot_start_dt)
            slot_end_dt = timezone.make_aware(slot_end_dt)

        overlap_count = 0
        for appointment in appointments:
            appt_start = appointment.start_time
            appt_end = appointment.end_time

            # Ensure both are timezone-aware for comparison
            if appt_start and not timezone.is_aware(appt_start):
                appt_start = timezone.make_aware(appt_start)
            if appt_end and not timezone.is_aware(appt_end):
                appt_end = timezone.make_aware(appt_end)

            # Check for overlap
            if appt_start and appt_end and slot_start_dt < appt_end and slot_end_dt > appt_start:
                overlap_count += 1
        return overlap_count

    @classmethod
    def _resolve_practitioners_from_entry(cls, entry, facility):
        """
        Resolve individual practitioners from a roster entry.

        For team-based entries, resolves to practitioners via StaffUnitAssignment.
        For practitioner-based entries, returns the practitioner directly.

        Returns list of (practitioner_id, practitioner_name) tuples.
        """
        from .models import StaffUnitAssignment

        practitioners = []

        if entry.practitioner_id:
            # Direct practitioner assignment
            practitioners.append((
                entry.practitioner_id,
                entry.practitioner.staff.user.get_full_name() if entry.practitioner else None
            ))
        elif entry.team_id:
            # Team-based entry - resolve to practitioners assigned to this team
            today = timezone.now().date()
            assignments = StaffUnitAssignment.objects.filter(
                unit_id=entry.team_id,
                is_active=True
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            ).select_related('practitioner__staff__user')

            for assignment in assignments:
                prac = assignment.practitioner
                prac_name = prac.staff.user.get_full_name() if prac and prac.staff else None
                practitioners.append((prac.id, prac_name))

        return practitioners

    @classmethod
    def compute_available_slots(
        cls,
        practitioner_id,
        start_date,
        end_date,
        facility=None,
        appointment_type_id=None,
    ):
        """
        Compute available slots from published roster entries for a practitioner.

        This is the core method that queries published RosterEntry records where
        duty_type.category='clinic' and generates appointment slots based on
        the duty type's slot_duration_minutes and breaks configuration.

        Args:
            practitioner_id: UUID of the PractitionerProfile
            start_date: Start date string (YYYY-MM-DD)
            end_date: End date string (YYYY-MM-DD)
            facility: Optional Facility instance for scoping
            appointment_type_id: Optional AppointmentType ID for filtering

        Returns:
            List of slot dictionaries with status (free, busy, busy-unavailable)
        """
        import logging
        from .models import RosterEntry, StaffUnitAssignment

        logger = logging.getLogger(__name__)

        # Convert string dates to date objects
        if isinstance(start_date, str):
            start_date_obj = datetime.strptime(start_date, '%Y-%m-%d').date()
        else:
            start_date_obj = start_date

        if isinstance(end_date, str):
            end_date_obj = datetime.strptime(end_date, '%Y-%m-%d').date()
        else:
            end_date_obj = end_date

        # 1. Get published roster entries for clinic-type duties that include this practitioner
        # This includes entries where:
        #   - practitioner is directly assigned, OR
        #   - the team the practitioner is assigned to is on duty
        today = timezone.now().date()

        # Get teams the practitioner is assigned to
        team_ids = list(StaffUnitAssignment.objects.filter(
            practitioner_id=practitioner_id,
            is_active=True
        ).filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=today)
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        ).values_list('unit_id', flat=True))

        # Query roster entries
        roster_entries = RosterEntry.objects.filter(
            date__gte=start_date_obj,
            date__lte=end_date_obj,
            status='published',
            duty_type__category='clinic',
            duty_type__is_active=True
        ).filter(
            Q(practitioner_id=practitioner_id) |
            Q(team_id__in=team_ids)
        ).select_related(
            'duty_type',
            'duty_type__clinic',
            'duty_type__default_appointment_type',
            'team'
        )

        # Note: Facility filtering is complex due to the unit hierarchy.
        # For now, we rely on the practitioner assignment being facility-specific.
        # Full facility isolation would require ensuring the department's root unit
        # is linked to the correct facility via ClinicalUnit.core_department.facility

        roster_entries = list(roster_entries)

        if not roster_entries:
            logger.info(f"No roster entries found for practitioner {practitioner_id}")
            return []

        # 2. Get blocked times (1 query)
        from apps.appointments.models import BlockedTime
        blocked_times = BlockedTime.objects.filter(
            practitioner_id=practitioner_id,
            date__gte=start_date_obj,
            date__lte=end_date_obj
        )
        if facility:
            blocked_times = blocked_times.filter(facility=facility)
        blocked_times = list(blocked_times)

        # 3. Get booked appointments (1 query)
        from apps.appointments.models import Appointment
        start_dt = timezone.make_aware(
            datetime.combine(start_date_obj, datetime.min.time()),
            timezone.get_current_timezone()
        )
        end_dt = timezone.make_aware(
            datetime.combine(end_date_obj, datetime.min.time()),
            timezone.get_current_timezone()
        ) + timedelta(days=1)
        appointments = Appointment.objects.filter(
            practitioner_id=practitioner_id,
            status__in=['booked', 'arrived', 'fulfilled'],
            start_time__gte=start_dt,
            start_time__lt=end_dt,
        )
        if facility:
            appointments = appointments.filter(facility=facility)
        appointments = list(appointments)

        # 4. Compute slots from roster entries
        slots = []

        for entry in roster_entries:
            duty_type = entry.duty_type

            # Skip if no slot duration configured
            if not duty_type.slot_duration_minutes:
                logger.warning(
                    f"Duty type {duty_type.name} has category=clinic but no slot_duration_minutes"
                )
                continue

            # Get time range from entry or duty type
            start_time = entry.start_time or duty_type.start_time
            end_time = entry.end_time or duty_type.end_time

            if not start_time or not end_time:
                logger.warning(f"No time range defined for roster entry {entry.id}")
                continue

            # Get breaks from duty type
            breaks = duty_type.breaks or []
            slot_duration = duty_type.slot_duration_minutes
            current_time = start_time

            while current_time < end_time:
                # Calculate slot end time
                slot_end = cls._add_minutes_to_time(current_time, slot_duration)

                # Ensure slot doesn't go beyond schedule end time
                if slot_end > end_time:
                    break

                # Check if slot is valid
                is_in_break = cls._is_in_break(current_time, slot_end, breaks)
                is_blocked = cls._is_blocked(entry.date, current_time, slot_end, blocked_times)
                booked_count = cls._appointment_overlap_count(
                    entry.date, current_time, slot_end, appointments
                )
                max_patients_per_slot = duty_type.max_patients_per_slot or 1

                # Only add slot if not in a break
                if not is_in_break:
                    # Determine slot status
                    if is_blocked:
                        status = "busy-unavailable"
                    elif booked_count >= max_patients_per_slot:
                        status = "busy"
                    else:
                        status = "free"

                    # Create slot dictionary
                    slot_start_dt = datetime.combine(entry.date, current_time)
                    slot_end_dt = datetime.combine(entry.date, slot_end)

                    slot_data = {
                        "id": f"roster-{entry.id}-{slot_start_dt.isoformat()}",
                        "resourceType": "Slot",
                        "status": status,
                        "start": slot_start_dt.isoformat(),
                        "end": slot_end_dt.isoformat(),
                        "schedule": {
                            "reference": f"RosterEntry/{entry.id}"
                        },
                        "roster_entry_id": str(entry.id),
                        "duty_type_id": str(duty_type.id),
                        "duty_type_name": duty_type.name,
                        "capacity": {
                            "max": max_patients_per_slot,
                            "booked": booked_count,
                            "remaining": max(0, max_patients_per_slot - booked_count),
                        },
                        "computed": True,
                        "source": "roster"
                    }

                    # Add clinic info if available
                    if duty_type.clinic:
                        slot_data["clinic_id"] = str(duty_type.clinic.id)
                        slot_data["clinic_name"] = duty_type.clinic.name

                    # Add default appointment type if available
                    if duty_type.default_appointment_type:
                        slot_data["default_appointment_type_id"] = str(
                            duty_type.default_appointment_type.id
                        )
                        slot_data["default_appointment_type_name"] = (
                            duty_type.default_appointment_type.name
                        )

                    slots.append(slot_data)

                # Move to next slot
                current_time = slot_end

        logger.info(
            f"Computed {len(slots)} roster-based slots for practitioner "
            f"{practitioner_id} from {start_date} to {end_date}"
        )
        return slots

    @classmethod
    def has_roster_availability(cls, practitioner_id, start_date, end_date, facility=None):
        """
        Check if a practitioner has any roster-based availability in the date range.

        This is a fast check used to determine whether to use roster-based or
        RecurringSchedule-based availability.

        Returns:
            Boolean indicating if roster entries exist for this practitioner
        """
        from .models import RosterEntry, StaffUnitAssignment

        if isinstance(start_date, str):
            start_date_obj = datetime.strptime(start_date, '%Y-%m-%d').date()
        else:
            start_date_obj = start_date

        if isinstance(end_date, str):
            end_date_obj = datetime.strptime(end_date, '%Y-%m-%d').date()
        else:
            end_date_obj = end_date

        today = timezone.now().date()

        # Get teams the practitioner is assigned to
        team_ids = list(StaffUnitAssignment.objects.filter(
            practitioner_id=practitioner_id,
            is_active=True
        ).filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=today)
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=today)
        ).values_list('unit_id', flat=True))

        return RosterEntry.objects.filter(
            date__gte=start_date_obj,
            date__lte=end_date_obj,
            status='published',
            duty_type__category='clinic',
            duty_type__is_active=True
        ).filter(
            Q(practitioner_id=practitioner_id) |
            Q(team_id__in=team_ids)
        ).exists()


    @classmethod
    def compute_clinic_available_slots(
        cls,
        duty_type_id,
        start_date,
        end_date,
        facility=None,
    ):
        """
        Compute available slots for ALL practitioners at a clinic duty type.

        This is more efficient than calling compute_available_slots() for each
        practitioner individually when showing "any doctor" availability.

        Query count: 4 queries total (vs 4 × N practitioners)

        Args:
            duty_type_id: UUID of the DepartmentDutyType (must be category='clinic')
            start_date: Start date string (YYYY-MM-DD)
            end_date: End date string (YYYY-MM-DD)
            facility: Optional Facility instance for scoping

        Returns:
            Dict with:
                - practitioners: List of {id, name} for practitioners with slots
                - slots_by_practitioner: Dict[practitioner_id, List[slot]]
                - all_slots: Flat list of all slots (for "any doctor" view)
        """
        import logging
        from .models import RosterEntry, StaffUnitAssignment, DepartmentDutyType

        logger = logging.getLogger(__name__)

        # Convert string dates to date objects
        if isinstance(start_date, str):
            start_date_obj = datetime.strptime(start_date, '%Y-%m-%d').date()
        else:
            start_date_obj = start_date

        if isinstance(end_date, str):
            end_date_obj = datetime.strptime(end_date, '%Y-%m-%d').date()
        else:
            end_date_obj = end_date

        # Verify duty type is clinic
        try:
            duty_type = DepartmentDutyType.objects.get(id=duty_type_id)
            if duty_type.category != 'clinic':
                logger.warning(f"Duty type {duty_type_id} is not a clinic type")
                return {'practitioners': [], 'slots_by_practitioner': {}, 'all_slots': []}
        except DepartmentDutyType.DoesNotExist:
            return {'practitioners': [], 'slots_by_practitioner': {}, 'all_slots': []}

        # 1. Get all roster entries for this duty type in date range (1 query)
        roster_entries = RosterEntry.objects.filter(
            duty_type_id=duty_type_id,
            date__gte=start_date_obj,
            date__lte=end_date_obj,
            status='published',
        ).select_related('team', 'practitioner__staff__user')

        roster_entries = list(roster_entries)
        if not roster_entries:
            return {'practitioners': [], 'slots_by_practitioner': {}, 'all_slots': []}

        # 2. Resolve all practitioners from roster entries
        # Collect team IDs and direct practitioner IDs
        team_ids = set()
        direct_practitioner_ids = set()

        for entry in roster_entries:
            if entry.practitioner_id:
                direct_practitioner_ids.add(entry.practitioner_id)
            if entry.team_id:
                team_ids.add(entry.team_id)

        # Get practitioners assigned to teams (1 query)
        today = timezone.now().date()
        team_assignments = {}
        if team_ids:
            assignments = StaffUnitAssignment.objects.filter(
                unit_id__in=team_ids,
                is_active=True
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            ).select_related('practitioner__staff__user')

            for assignment in assignments:
                if assignment.unit_id not in team_assignments:
                    team_assignments[assignment.unit_id] = []
                team_assignments[assignment.unit_id].append(assignment.practitioner)

        # Build practitioner list with their applicable roster entries
        practitioner_entries = {}  # practitioner_id -> list of roster entries

        for entry in roster_entries:
            if entry.practitioner_id:
                # Direct practitioner assignment
                if entry.practitioner_id not in practitioner_entries:
                    practitioner_entries[entry.practitioner_id] = []
                practitioner_entries[entry.practitioner_id].append(entry)
            elif entry.team_id and entry.team_id in team_assignments:
                # Team-based assignment - add entry to all team members
                for practitioner in team_assignments[entry.team_id]:
                    if practitioner.id not in practitioner_entries:
                        practitioner_entries[practitioner.id] = []
                    practitioner_entries[practitioner.id].append(entry)

        if not practitioner_entries:
            return {'practitioners': [], 'slots_by_practitioner': {}, 'all_slots': []}

        practitioner_ids = list(practitioner_entries.keys())

        # 3. Get blocked times for all practitioners (1 query)
        from apps.appointments.models import BlockedTime
        blocked_times_qs = BlockedTime.objects.filter(
            practitioner_id__in=practitioner_ids,
            date__gte=start_date_obj,
            date__lte=end_date_obj
        )
        if facility:
            blocked_times_qs = blocked_times_qs.filter(facility=facility)

        blocked_by_practitioner = {}
        for bt in blocked_times_qs:
            if bt.practitioner_id not in blocked_by_practitioner:
                blocked_by_practitioner[bt.practitioner_id] = []
            blocked_by_practitioner[bt.practitioner_id].append(bt)

        # 4. Get appointments for all practitioners (1 query)
        from apps.appointments.models import Appointment
        start_dt = timezone.make_aware(
            datetime.combine(start_date_obj, datetime.min.time()),
            timezone.get_current_timezone()
        )
        end_dt = timezone.make_aware(
            datetime.combine(end_date_obj, datetime.min.time()),
            timezone.get_current_timezone()
        ) + timedelta(days=1)
        appointments_qs = Appointment.objects.filter(
            practitioner_id__in=practitioner_ids,
            status__in=['booked', 'arrived', 'fulfilled'],
            start_time__gte=start_dt,
            start_time__lt=end_dt,
        )
        if facility:
            appointments_qs = appointments_qs.filter(facility=facility)

        appts_by_practitioner = {}
        for appt in appointments_qs:
            if appt.practitioner_id not in appts_by_practitioner:
                appts_by_practitioner[appt.practitioner_id] = []
            appts_by_practitioner[appt.practitioner_id].append(appt)

        # 5. Generate slots for each practitioner
        slots_by_practitioner = {}
        all_slots = []
        practitioners_info = []

        # Get practitioner names
        from apps.users.models import PractitionerProfile
        practitioner_objs = {
            p.id: p for p in PractitionerProfile.objects.filter(
                id__in=practitioner_ids
            ).select_related('staff__user')
        }

        for prac_id, entries in practitioner_entries.items():
            prac = practitioner_objs.get(prac_id)
            prac_name = prac.staff.user.get_full_name() if prac and prac.staff else 'Unknown'

            blocked_times = blocked_by_practitioner.get(prac_id, [])
            appointments = appts_by_practitioner.get(prac_id, [])

            prac_slots = []
            for entry in entries:
                # Generate slots for this entry
                entry_slots = cls._generate_slots_for_entry(
                    entry, duty_type, prac_id, prac_name, blocked_times, appointments
                )
                prac_slots.extend(entry_slots)

            if prac_slots:
                slots_by_practitioner[str(prac_id)] = prac_slots
                all_slots.extend(prac_slots)
                practitioners_info.append({
                    'id': str(prac_id),
                    'name': prac_name,
                    'slot_count': len(prac_slots),
                    'free_slot_count': len([s for s in prac_slots if s['status'] == 'free'])
                })

        # Sort all_slots by start time
        all_slots.sort(key=lambda s: s['start'])

        logger.info(
            f"Computed clinic slots for duty_type {duty_type_id}: "
            f"{len(practitioners_info)} practitioners, {len(all_slots)} total slots"
        )

        return {
            'practitioners': practitioners_info,
            'slots_by_practitioner': slots_by_practitioner,
            'all_slots': all_slots,
        }

    @classmethod
    def _generate_slots_for_entry(cls, entry, duty_type, practitioner_id, practitioner_name, blocked_times, appointments):
        """Generate slots for a single roster entry."""
        slots = []

        if not duty_type.slot_duration_minutes:
            return slots

        start_time = entry.start_time or duty_type.start_time
        end_time = entry.end_time or duty_type.end_time

        if not start_time or not end_time:
            return slots

        breaks = duty_type.breaks or []
        slot_duration = duty_type.slot_duration_minutes
        current_time = start_time

        while current_time < end_time:
            slot_end = cls._add_minutes_to_time(current_time, slot_duration)

            # SAFETY: Adding minutes to a `time` can wrap past midnight (e.g., 23:30 + 30m = 00:00).
            # This slot generator currently assumes same-day windows for clinic duties.
            # Without this guard, wrapped times will cause an infinite loop.
            if slot_end <= current_time:
                break

            if slot_end > end_time:
                break

            is_in_break = cls._is_in_break(current_time, slot_end, breaks)
            is_blocked = cls._is_blocked(entry.date, current_time, slot_end, blocked_times)
            booked_count = cls._appointment_overlap_count(
                entry.date, current_time, slot_end, appointments
            )
            max_patients_per_slot = duty_type.max_patients_per_slot or 1

            if not is_in_break:
                if is_blocked:
                    status = "busy-unavailable"
                elif booked_count >= max_patients_per_slot:
                    status = "busy"
                else:
                    status = "free"

                slot_start_dt = datetime.combine(entry.date, current_time)
                slot_end_dt = datetime.combine(entry.date, slot_end)

                slot_data = {
                    "id": f"roster-{entry.id}-{practitioner_id}-{slot_start_dt.isoformat()}",
                    "resourceType": "Slot",
                    "status": status,
                    "start": slot_start_dt.isoformat(),
                    "end": slot_end_dt.isoformat(),
                    "practitioner_id": str(practitioner_id),
                    "practitioner_name": practitioner_name,
                    "schedule": {"reference": f"RosterEntry/{entry.id}"},
                    "roster_entry_id": str(entry.id),
                    "duty_type_id": str(duty_type.id),
                    "duty_type_name": duty_type.name,
                    "capacity": {
                        "max": max_patients_per_slot,
                        "booked": booked_count,
                        "remaining": max(0, max_patients_per_slot - booked_count),
                    },
                    "computed": True,
                    "source": "roster"
                }

                if duty_type.clinic:
                    slot_data["clinic_id"] = str(duty_type.clinic.id)
                    slot_data["clinic_name"] = duty_type.clinic.name

                slots.append(slot_data)

            current_time = slot_end

        return slots


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
