"""
Services for appointment scheduling, availability generation, and conflict prevention.
"""
from collections import defaultdict
from typing import Dict, List, Optional, Any, Tuple, TYPE_CHECKING
from datetime import datetime, timedelta, time, date
import logging
from django.utils import timezone
from django.db.models import Q, Count
from .models import Appointment, AppointmentType, PractitionerAvailabilityRule, BlockedTime
from ..users.models import PractitionerProfile

if TYPE_CHECKING:
    from apps.users.models import User

logger = logging.getLogger(__name__)


class AvailabilityService:
    """
    Service for computing practitioner availability from department rosters and
    practitioner-owned personal calendar rules.
    """

    @staticmethod
    def _validate_slot_duration(slot_duration: int) -> int:
        try:
            normalized_duration = int(slot_duration)
        except (TypeError, ValueError):
            raise ValueError("Availability slot_duration must be a positive integer.")

        if normalized_duration <= 0:
            raise ValueError("Availability slot_duration must be a positive integer.")

        return normalized_duration

    @staticmethod
    def _add_minutes_to_time(base_time: time, minutes: int) -> time:
        dummy_date = date.today()
        dt = datetime.combine(dummy_date, base_time)
        dt += timedelta(minutes=minutes)
        return dt.time()

    @staticmethod
    def _times_overlap(start1: time, end1: time, start2: time, end2: time) -> bool:
        return start1 < end2 and end1 > start2

    @staticmethod
    def _is_in_break(slot_start: time, slot_end: time, breaks: List[Dict]) -> bool:
        for break_period in breaks or []:
            break_start = datetime.strptime(break_period['start'], '%H:%M').time()
            break_end = datetime.strptime(break_period['end'], '%H:%M').time()
            if AvailabilityService._times_overlap(slot_start, slot_end, break_start, break_end):
                return True
        return False

    @staticmethod
    def _is_blocked(check_date: date, slot_start: time, slot_end: time, blocked_times: List['BlockedTime']) -> bool:
        for blocked in blocked_times:
            if blocked.date != check_date:
                continue
            if blocked.is_all_day:
                return True
            if AvailabilityService._times_overlap(slot_start, slot_end, blocked.start_time, blocked.end_time):
                return True
        return False

    @staticmethod
    def _has_appointment(check_date: date, slot_start: time, slot_end: time, appointments: List[Appointment]) -> bool:
        slot_start_dt = timezone.make_aware(
            datetime.combine(check_date, slot_start),
            timezone.get_current_timezone(),
        )
        slot_end_dt = timezone.make_aware(
            datetime.combine(check_date, slot_end),
            timezone.get_current_timezone(),
        )

        for appointment in appointments:
            appt_start = appointment.start_time
            appt_end = appointment.end_time
            if appt_start and not timezone.is_aware(appt_start):
                appt_start = timezone.make_aware(appt_start, timezone.get_current_timezone())
            if appt_end and not timezone.is_aware(appt_end):
                appt_end = timezone.make_aware(appt_end, timezone.get_current_timezone())
            if appt_start and appt_end and slot_start_dt < appt_end and slot_end_dt > appt_start:
                return True
        return False

    @staticmethod
    def _local_naive(value: datetime) -> datetime:
        if timezone.is_aware(value):
            return timezone.localtime(value, timezone.get_current_timezone()).replace(tzinfo=None)
        return value

    @staticmethod
    def _date_range(start_date, end_date) -> Tuple[date, date]:
        if isinstance(start_date, str):
            start_date = datetime.strptime(start_date, '%Y-%m-%d').date()
        if isinstance(end_date, str):
            end_date = datetime.strptime(end_date, '%Y-%m-%d').date()
        return start_date, end_date

    @staticmethod
    def _range_datetimes(start_date_obj: date, end_date_obj: date) -> Tuple[datetime, datetime]:
        tz = timezone.get_current_timezone()
        start_dt = timezone.make_aware(datetime.combine(start_date_obj, time.min), tz)
        end_dt = timezone.make_aware(datetime.combine(end_date_obj, time.min), tz) + timedelta(days=1)
        return start_dt, end_dt

    @staticmethod
    def _matching_slots(slots: List[Dict[str, Any]], start_time: datetime, end_time: datetime) -> List[Dict[str, Any]]:
        requested_start = AvailabilityService._local_naive(start_time)
        requested_end = AvailabilityService._local_naive(end_time)
        matches = []
        for slot in slots:
            slot_start = datetime.fromisoformat(slot['start'])
            slot_end = datetime.fromisoformat(slot['end'])
            if slot_start == requested_start and slot_end == requested_end:
                matches.append(slot)
        return matches

    @staticmethod
    def is_slot_available(
        practitioner: PractitionerProfile,
        start_time: datetime,
        end_time: datetime,
        facility=None,
        clinic=None,
    ) -> bool:
        """Check whether the requested exact slot is free in unified availability."""
        local_start = AvailabilityService._local_naive(start_time)
        local_end = AvailabilityService._local_naive(end_time)
        slots = AvailabilityService.compute_available_slots(
            practitioner_id=str(practitioner.id),
            start_date=local_start.date(),
            end_date=local_start.date(),
            facility=facility,
            clinic_id=str(clinic.id) if clinic else None,
        )
        return any(slot.get('status') == 'free' for slot in AvailabilityService._matching_slots(slots, local_start, local_end))

    @staticmethod
    def compute_available_slots(
        practitioner_id: str,
        start_date: str,
        end_date: str,
        appointment_type_id: Optional[str] = None,
        facility=None,
        clinic_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Compute available slots from roster and personal calendar sources.
        """
        try:
            from apps.organization.services import RosterAvailabilityService

            roster_slots = RosterAvailabilityService.compute_available_slots(
                practitioner_id=practitioner_id,
                start_date=start_date,
                end_date=end_date,
                facility=facility,
                appointment_type_id=appointment_type_id,
            )
            if clinic_id:
                roster_slots = [
                    slot for slot in roster_slots
                    if not slot.get('clinic_id') or str(slot.get('clinic_id')) == str(clinic_id)
                ]

            personal_slots = AvailabilityService._compute_slots_from_personal_rules(
                practitioner_id=practitioner_id,
                start_date=start_date,
                end_date=end_date,
                facility=facility,
                clinic_id=clinic_id,
            )
            slots = roster_slots + personal_slots
            slots.sort(key=lambda slot: slot['start'])
            return slots
        except Exception as e:
            logger.error(f"Error computing available slots: {str(e)}", exc_info=True)
            raise

    @staticmethod
    def _compute_slots_from_personal_rules(
        practitioner_id: str,
        start_date: str,
        end_date: str,
        facility=None,
        clinic_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        start_date_obj, end_date_obj = AvailabilityService._date_range(start_date, end_date)

        rules = PractitionerAvailabilityRule.objects.filter(
            practitioner_id=practitioner_id,
            is_active=True,
            active_from__lte=end_date_obj,
        )
        if facility is not None:
            rules = rules.filter(facility=facility)
        if clinic_id:
            rules = rules.filter(Q(clinic_id=clinic_id) | Q(clinic__isnull=True))
        rules = list(rules.filter(
            Q(active_to__isnull=True) | Q(active_to__gte=start_date_obj)
        ).select_related('practitioner', 'clinic'))

        if not rules:
            return []

        for rule in rules:
            AvailabilityService._validate_slot_duration(rule.slot_duration)

        blocked_times = BlockedTime.objects.filter(
            practitioner_id=practitioner_id,
            date__gte=start_date_obj,
            date__lte=end_date_obj,
        )
        if facility is not None:
            blocked_times = blocked_times.filter(facility=facility)
        blocked_times = list(blocked_times)

        start_dt, end_dt = AvailabilityService._range_datetimes(start_date_obj, end_date_obj)
        appointments = Appointment.objects.filter(
            practitioner_id=practitioner_id,
            status__in=['booked', 'arrived', 'fulfilled'],
            start_time__gte=start_dt,
            start_time__lt=end_dt,
        )
        if facility is not None:
            appointments = appointments.filter(facility=facility)
        appointments = list(appointments)

        slots = []
        current_date = start_date_obj
        while current_date <= end_date_obj:
            day_of_week = current_date.weekday()
            for rule in rules:
                if day_of_week not in rule.days_of_week:
                    continue

                current_time = rule.start_time
                slot_duration = AvailabilityService._validate_slot_duration(rule.slot_duration)
                while current_time < rule.end_time:
                    slot_end = AvailabilityService._add_minutes_to_time(current_time, slot_duration)
                    if slot_end > rule.end_time:
                        break

                    is_in_break = AvailabilityService._is_in_break(current_time, slot_end, rule.breaks)
                    is_blocked = AvailabilityService._is_blocked(current_date, current_time, slot_end, blocked_times)
                    has_appointment = AvailabilityService._has_appointment(current_date, current_time, slot_end, appointments)

                    if not is_in_break:
                        if is_blocked:
                            status = 'busy-unavailable'
                        elif has_appointment:
                            status = 'busy'
                        else:
                            status = 'free'

                        slot_start_dt = datetime.combine(current_date, current_time)
                        slot_end_dt = datetime.combine(current_date, slot_end)
                        slot_data = {
                            'id': f'personal-{rule.id}-{slot_start_dt.isoformat()}',
                            'resourceType': 'Slot',
                            'status': status,
                            'start': slot_start_dt.isoformat(),
                            'end': slot_end_dt.isoformat(),
                            'schedule': {'reference': f'PractitionerAvailabilityRule/{rule.id}'},
                            'availability_rule_id': str(rule.id),
                            'capacity': {
                                'max': 1,
                                'booked': 1 if has_appointment else 0,
                                'remaining': 0 if (is_blocked or has_appointment) else 1,
                            },
                            'computed': True,
                            'source': 'personal_calendar',
                        }
                        if rule.clinic_id:
                            slot_data['clinic_id'] = str(rule.clinic_id)
                            slot_data['clinic_name'] = rule.clinic.name
                        slots.append(slot_data)

                    current_time = slot_end
            current_date += timedelta(days=1)

        return slots


class ClinicBookingService:
    """Clinic-level booking and assignment rules for pool clinics."""

    ACTIVE_BOOKING_STATUSES = ['booked', 'arrived', 'fulfilled']

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
        from datetime import datetime
        for break_period in breaks or []:
            break_start = datetime.strptime(break_period['start'], '%H:%M').time()
            break_end = datetime.strptime(break_period['end'], '%H:%M').time()
            if ClinicBookingService._times_overlap(slot_start, slot_end, break_start, break_end):
                return True
        return False

    @staticmethod
    def _local_naive(dt_value):
        """Return a naive datetime in the current timezone for stable comparisons/keys."""
        tz = timezone.get_current_timezone()
        if timezone.is_aware(dt_value):
            return timezone.localtime(dt_value, tz).replace(tzinfo=None)
        return dt_value

    @staticmethod
    def _time_matches(start_time, end_time, check_time, is_24_hour=False) -> bool:
        if is_24_hour:
            return True
        if start_time is None or end_time is None:
            return True
        if start_time <= end_time:
            return start_time <= check_time < end_time
        return check_time >= start_time or check_time < end_time

    @staticmethod
    def _matching_slots(slots: List[Dict[str, Any]], start_time: datetime, end_time: datetime) -> List[Dict[str, Any]]:
        tz = timezone.get_current_timezone()
        if timezone.is_aware(start_time):
            start_local = timezone.localtime(start_time, tz).replace(tzinfo=None)
        else:
            start_local = start_time
        if timezone.is_aware(end_time):
            end_local = timezone.localtime(end_time, tz).replace(tzinfo=None)
        else:
            end_local = end_time

        matches = []
        for slot in slots:
            slot_start = datetime.fromisoformat(slot['start'])
            slot_end = datetime.fromisoformat(slot['end'])
            if slot_start == start_local and slot_end == end_local:
                matches.append(slot)
        return matches

    @classmethod
    def _pool_capacity_allowance(cls, base_capacity: int, clinic) -> int:
        """
        Compute additional capacity allowed via overbooking settings.

        This mirrors the logic in validate_pool_booking so UI availability and server
        acceptance stay consistent.
        """
        base_capacity = max(0, int(base_capacity or 0))
        percent_allowance = (base_capacity * (clinic.overbook_percent or 0)) // 100
        hard_cap = clinic.overbook_hard_cap or 0
        if percent_allowance and hard_cap:
            return min(percent_allowance, hard_cap)
        return max(percent_allowance, hard_cap)

    @classmethod
    def _compute_pool_windows(
        cls,
        clinic,
        start_date: str,
        end_date: str,
        facility=None,
        exclude_appointment_id=None,
    ) -> Dict[str, Any]:
        """
        Compute pool-clinic availability as window "buckets" with capacity caps.

        Key behavior:
        - Capacity is derived from roster entries (published) for the clinic duty types.
        - Capacity does NOT require practitioner resolution. Team roster entries still
          produce bookable capacity even when there are no staff assignments.
        - Booked counts come from Appointment records for the clinic, regardless of
          practitioner assignment (pool bookings are often unassigned until check-in).
        """
        from apps.organization.models import DepartmentDutyType, RosterEntry
        from apps.appointments.models import Appointment

        # Parse date strings.
        start_date_obj = datetime.strptime(start_date, '%Y-%m-%d').date() if isinstance(start_date, str) else start_date
        end_date_obj = datetime.strptime(end_date, '%Y-%m-%d').date() if isinstance(end_date, str) else end_date

        duty_types = list(
            DepartmentDutyType.objects.filter(
                clinic=clinic,
                category='clinic',
                is_active=True,
            ).only(
                'id',
                'name',
                'code',
                'category',
                'is_active',
                'is_24_hour',
                'start_time',
                'end_time',
                'slot_duration_minutes',
                'max_patients_per_slot',
                'breaks',
            )
        )
        if not duty_types:
            return {'practitioners': [], 'slots_by_practitioner': {}, 'all_slots': []}

        duty_type_by_id = {dt.id: dt for dt in duty_types}

        entries = list(
            RosterEntry.objects.filter(
                duty_type_id__in=[dt.id for dt in duty_types],
                date__gte=start_date_obj,
                date__lte=end_date_obj,
                status='published',
            ).only(
                'id',
                'date',
                'duty_type_id',
                'start_time',
                'end_time',
                'team_id',
                'practitioner_id',
            )
        )
        if not entries:
            return {'practitioners': [], 'slots_by_practitioner': {}, 'all_slots': []}

        # Pull all active bookings for the clinic in the date range (timezone-aware bounds).
        tz = timezone.get_current_timezone()
        range_start = timezone.make_aware(datetime.combine(start_date_obj, datetime.min.time()), tz)
        range_end = timezone.make_aware(datetime.combine(end_date_obj, datetime.min.time()), tz) + timedelta(days=1)
        bookings_qs = Appointment.objects.filter(
            clinic=clinic,
            status__in=cls.ACTIVE_BOOKING_STATUSES,
            start_time__gte=range_start,
            start_time__lt=range_end,
        )
        if facility is not None:
            bookings_qs = bookings_qs.filter(facility=facility)
        if exclude_appointment_id:
            bookings_qs = bookings_qs.exclude(id=exclude_appointment_id)

        booked_by_window: Dict[tuple, int] = {}
        for appt in bookings_qs.only('start_time', 'end_time'):
            start_local = cls._local_naive(appt.start_time)
            end_local = cls._local_naive(appt.end_time)
            booked_by_window[(start_local.isoformat(), end_local.isoformat())] = (
                booked_by_window.get((start_local.isoformat(), end_local.isoformat()), 0) + 1
            )

        # Aggregate roster-derived windows to base capacity.
        #
        # IMPORTANT: For pool clinics, roster entries represent "the clinic is running",
        # not a pre-known practitioner headcount. Capacity is therefore modeled as a
        # per-window bucket cap derived from configuration (duty_type.max_patients_per_slot),
        # and is counted once per duty_type per (start,end) window, regardless of how many
        # roster entries exist for that duty_type.
        base_capacity_by_window_duty: Dict[tuple, int] = {}
        for entry in entries:
            duty_type = duty_type_by_id.get(entry.duty_type_id)
            if not duty_type:
                continue
            if not duty_type.slot_duration_minutes:
                continue

            start_time = entry.start_time or duty_type.start_time
            end_time = entry.end_time or duty_type.end_time
            if not start_time or not end_time:
                continue

            slot_duration = int(duty_type.slot_duration_minutes)
            breaks = duty_type.breaks or []

            # For pool clinics, interpret max_patients_per_slot as the bucket capacity per window.
            cap_per_window = int(duty_type.max_patients_per_slot or 1)
            cap_per_window = max(1, cap_per_window)

            current_time = start_time
            while current_time < end_time:
                slot_end = cls._add_minutes_to_time(current_time, slot_duration)

                # SAFETY: time math can wrap past midnight; this generator assumes same-day windows.
                if slot_end <= current_time:
                    break
                if slot_end > end_time:
                    break

                if not cls._is_in_break(current_time, slot_end, breaks):
                    slot_start_dt = datetime.combine(entry.date, current_time)
                    slot_end_dt = datetime.combine(entry.date, slot_end)
                    key = (slot_start_dt.isoformat(), slot_end_dt.isoformat(), str(duty_type.id))
                    base_capacity_by_window_duty[key] = cap_per_window

                current_time = slot_end

        base_capacity_by_window: Dict[tuple, int] = {}
        for (start_iso, end_iso, _duty_type_id), cap in base_capacity_by_window_duty.items():
            key = (start_iso, end_iso)
            base_capacity_by_window[key] = base_capacity_by_window.get(key, 0) + int(cap or 0)

        # Build final slot payload with effective capacity and booked/remaining counts.
        slots: List[Dict[str, Any]] = []
        for (start_iso, end_iso), base_capacity in base_capacity_by_window.items():
            allowance = cls._pool_capacity_allowance(base_capacity, clinic)
            effective_capacity = base_capacity + allowance
            booked = int(booked_by_window.get((start_iso, end_iso), 0) or 0)
            remaining = max(0, effective_capacity - booked)
            slots.append(
                {
                    'id': f'{start_iso}-{end_iso}',
                    'start': start_iso,
                    'end': end_iso,
                    'status': 'free' if remaining > 0 else 'busy',
                    'capacity': {
                        'max': effective_capacity,
                        'booked': booked,
                        'remaining': remaining,
                    },
                    'computed': True,
                    'source': 'roster',
                }
            )

        slots.sort(key=lambda s: s['start'])
        return {'practitioners': [], 'slots_by_practitioner': {}, 'all_slots': slots}

    @classmethod
    def get_clinic_roster_slots(cls, clinic, start_date: str, end_date: str, facility=None) -> Dict[str, Any]:
        """
        Aggregate roster-derived slots for a clinic across all active clinic duty types.
        """
        if clinic.booking_mode == clinic.BookingMode.CLINIC_POOL:
            return cls._compute_pool_windows(
                clinic=clinic,
                start_date=start_date,
                end_date=end_date,
                facility=facility,
            )

        from apps.organization.models import DepartmentDutyType
        from apps.organization.services import RosterAvailabilityService

        duty_type_ids = list(
            DepartmentDutyType.objects.filter(
                clinic=clinic,
                category='clinic',
                is_active=True,
            ).values_list('id', flat=True)
        )

        if not duty_type_ids:
            return {'practitioners': [], 'slots_by_practitioner': {}, 'all_slots': []}

        practitioners = {}
        slots_by_practitioner: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        all_slots: List[Dict[str, Any]] = []

        for duty_type_id in duty_type_ids:
            result = RosterAvailabilityService.compute_clinic_available_slots(
                duty_type_id=duty_type_id,
                start_date=start_date,
                end_date=end_date,
                facility=facility,
            )

            for practitioner in result.get('practitioners', []):
                practitioners[practitioner['id']] = practitioner

            for practitioner_id, slots in result.get('slots_by_practitioner', {}).items():
                slots_by_practitioner[practitioner_id].extend(slots)

            all_slots.extend(result.get('all_slots', []))

        all_slots.sort(key=lambda slot: slot['start'])
        return {
            'practitioners': list(practitioners.values()),
            'slots_by_practitioner': dict(slots_by_practitioner),
            'all_slots': all_slots,
        }

    @classmethod
    def validate_pool_booking(
        cls,
        clinic,
        start_time: datetime,
        end_time: datetime,
        facility=None,
        exclude_appointment_id: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Validate a pool-clinic booking against published roster capacity and overbook policy.
        """
        if clinic.booking_mode != clinic.BookingMode.CLINIC_POOL:
            return True, None

        date_str = timezone.localtime(start_time).date().isoformat() if timezone.is_aware(start_time) else start_time.date().isoformat()
        slot_payload = cls._compute_pool_windows(
            clinic=clinic,
            start_date=date_str,
            end_date=date_str,
            facility=facility,
            exclude_appointment_id=exclude_appointment_id,
        )

        matching_windows = cls._matching_slots(slot_payload.get('all_slots') or [], start_time, end_time)
        if not matching_windows:
            return False, 'No published roster clinic session exists for this time.'

        window = matching_windows[0]
        cap = window.get('capacity') or {}
        remaining = cap.get('remaining')
        try:
            remaining = int(remaining)
        except (TypeError, ValueError):
            remaining = 0

        if remaining > 0:
            return True, None
        return False, 'Clinic slot capacity reached for this session.'

    @classmethod
    def assign_pool_practitioner_at_check_in(cls, appointment, assigned_by=None):
        """
        Assign the least-loaded on-duty practitioner at check-in for pool clinics.
        """
        clinic = appointment.clinic
        if not clinic:
            raise ValueError('Clinic is required for pool assignment.')
        if clinic.booking_mode != clinic.BookingMode.CLINIC_POOL:
            raise ValueError('Pool assignment is only supported for clinic-pool mode.')
        if appointment.practitioner_id:
            return appointment.practitioner

        # Try to resolve on-duty practitioners for this time window from the roster.
        # If none exist, leave the appointment unassigned; capacity is handled at booking time.
        from apps.organization.models import DepartmentDutyType, RosterEntry
        from apps.organization.services import DepartmentRosterService
        from apps.organization.models import StaffUnitAssignment

        at_datetime = appointment.start_time
        local_at = cls._local_naive(at_datetime)
        check_date = local_at.date()

        duty_type_ids = list(
            DepartmentDutyType.objects.filter(
                clinic=clinic,
                category='clinic',
                is_active=True,
            ).values_list('id', flat=True)
        )
        if not duty_type_ids:
            return None

        date_candidates = [check_date, check_date - timedelta(days=1)]
        entries = (
            RosterEntry.objects.filter(
                duty_type_id__in=duty_type_ids,
                date__in=date_candidates,
                status='published',
            )
            .select_related('duty_type')
            .only('id', 'date', 'duty_type_id', 'team_id', 'practitioner_id', 'start_time', 'end_time', 'duty_type__start_time', 'duty_type__end_time', 'duty_type__is_24_hour')
        )

        candidate_ids = set()
        team_ids = set()
        for entry in entries:
            duty_type = entry.duty_type
            start_t = entry.start_time or duty_type.start_time
            end_t = entry.end_time or duty_type.end_time
            if not DepartmentRosterService._duty_window_contains(  # noqa: SLF001 (shared logic)
                at_datetime=appointment.start_time,
                entry_date=entry.date,
                start_time=start_t,
                end_time=end_t,
                is_24_hour=duty_type.is_24_hour,
            ):
                continue
            if entry.practitioner_id:
                candidate_ids.add(entry.practitioner_id)
            if entry.team_id:
                team_ids.add(entry.team_id)

        if team_ids:
            today = timezone.localdate()
            assignments = StaffUnitAssignment.objects.filter(
                unit_id__in=team_ids,
                is_active=True,
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            ).values_list('practitioner_id', flat=True)
            candidate_ids.update(assignments)

        candidate_ids = list(candidate_ids)
        if not candidate_ids:
            return None

        tz = timezone.get_current_timezone()
        if timezone.is_aware(appointment.start_time):
            local_start = timezone.localtime(appointment.start_time, tz)
        else:
            local_start = timezone.make_aware(appointment.start_time, tz)
        day_start = timezone.make_aware(datetime.combine(local_start.date(), time.min), tz)
        day_end = day_start + timedelta(days=1)

        load_rows = (
            Appointment.objects.filter(
                clinic=clinic,
                practitioner_id__in=candidate_ids,
                status__in=cls.ACTIVE_BOOKING_STATUSES,
                start_time__gte=day_start,
                start_time__lt=day_end,
            )
            .values('practitioner_id')
            .annotate(total=Count('id'))
        )
        load_map = {str(row['practitioner_id']): row['total'] for row in load_rows}
        sorted_candidates = sorted(
            candidate_ids,
            key=lambda practitioner_id: (load_map.get(str(practitioner_id), 0), str(practitioner_id))
        )

        selected_id = None
        for practitioner_id in sorted_candidates:
            if ConflictPreventionService.check_practitioner_availability(
                practitioner_id=str(practitioner_id),
                start_time=appointment.start_time,
                end_time=appointment.end_time,
                exclude_appointment_id=str(appointment.id),
            ):
                selected_id = practitioner_id
                break

        if selected_id is None:
            return None

        now = timezone.now()
        appointment.practitioner_id = selected_id
        appointment.assignment_status = Appointment.AssignmentStatus.ASSIGNED
        appointment.assignment_source = Appointment.AssignmentSource.CHECK_IN
        appointment.assigned_at = now
        if assigned_by:
            appointment.updated_by = assigned_by

        update_fields = [
            'practitioner', 'assignment_status', 'assignment_source',
            'assigned_at', 'updated_at',
        ]
        if assigned_by:
            update_fields.append('updated_by')
        appointment.save(update_fields=update_fields)
        return appointment.practitioner

    @classmethod
    def get_active_pool_clinic_ids(cls, facility, department=None, at_datetime=None) -> set:
        """
        Return clinic IDs with active published pool roster sessions at a specific time.
        """
        from apps.organization.models import RosterEntry

        at_datetime = at_datetime or timezone.now()
        check_date = at_datetime.date()
        check_time = at_datetime.time()

        entries = RosterEntry.objects.filter(
            date=check_date,
            status='published',
            duty_type__category='clinic',
            duty_type__is_active=True,
            duty_type__clinic__is_active=True,
            duty_type__clinic__facility=facility,
            duty_type__clinic__booking_mode='clinic_pool',
        ).select_related('duty_type', 'duty_type__clinic')

        if department is not None:
            entries = entries.filter(department=department)

        clinic_ids = set()
        for entry in entries:
            duty_type = entry.duty_type
            start_time = entry.start_time or duty_type.start_time
            end_time = entry.end_time or duty_type.end_time
            if cls._time_matches(start_time, end_time, check_time, duty_type.is_24_hour):
                if duty_type.clinic_id:
                    clinic_ids.add(str(duty_type.clinic_id))
        return clinic_ids


class ConflictPreventionService:
    """
    Service for preventing scheduling conflicts.
    """

    @staticmethod
    def check_slot_availability(slot_id: str) -> bool:
        """
        Check if a slot is available (free).

        Slot validation is handled locally; FHIR slot lookups are not used.
        """
        return True

    @staticmethod
    def check_practitioner_availability(
        practitioner_id: str,
        start_time: datetime,
        end_time: datetime,
        exclude_appointment_id: Optional[str] = None
    ) -> bool:
        """
        Check if a practitioner is available during a time period.

        Args:
            practitioner_id: Local PractitionerProfile ID
            start_time: Start time of the period
            end_time: End time of the period
            exclude_appointment_id: Optional appointment ID to exclude

        Returns:
            True if the practitioner is available, False otherwise
        """
        queryset = Appointment.objects.filter(
            practitioner_id=practitioner_id,
            status__in=['booked', 'arrived', 'fulfilled'],
            start_time__lt=end_time,
            end_time__gt=start_time,
        )
        if exclude_appointment_id:
            queryset = queryset.exclude(id=exclude_appointment_id)

        return not queryset.exists()

    @staticmethod
    def check_patient_availability(
        patient_id: str,
        start_time: datetime,
        end_time: datetime,
        exclude_appointment_id: Optional[str] = None
    ) -> bool:
        """
        Check if a patient is available during a time period.

        Args:
            patient_id: Local PatientProfile ID
            start_time: Start time of the period
            end_time: End time of the period
            exclude_appointment_id: Optional appointment ID to exclude

        Returns:
            True if the patient is available, False otherwise
        """
        queryset = Appointment.objects.filter(
            patient_id=patient_id,
            status__in=['booked', 'arrived', 'fulfilled'],
            start_time__lt=end_time,
            end_time__gt=start_time,
        )
        if exclude_appointment_id:
            queryset = queryset.exclude(id=exclude_appointment_id)

        return not queryset.exists()

    @staticmethod
    def book_appointment(
        patient_id: str,
        practitioner_id: str,
        clinic_id: str,
        start_time: datetime,
        end_time: datetime,
        appointment_type_id: str,
        facility,
        source: str = 'scheduled',
        slot_reference: Optional[str] = None,
        description: Optional[str] = None,
        comment: Optional[str] = None,
        created_by=None,
    ) -> Tuple[bool, Dict[str, Any]]:
        """
        Book an appointment with conflict prevention.

        Args:
            patient_id: Local PatientProfile ID
            practitioner_id: Local PractitionerProfile ID
            clinic_id: Clinic ID
            start_time: Start time of the appointment
            end_time: End time of the appointment
            appointment_type_id: AppointmentType ID
            facility: Facility instance for scoping
            source: Appointment source
            slot_reference: Optional slot reference
            description: Optional description of the appointment
            comment: Optional comment about the appointment
            created_by: User creating the appointment

        Returns:
            Tuple of (success, result) where result is the appointment or error message
        """
        try:
            if start_time >= end_time:
                return False, {"error": "Start time must be before end time"}

            # Check practitioner availability
            if not ConflictPreventionService.check_practitioner_availability(
                practitioner_id, start_time, end_time
            ):
                return False, {"error": "The practitioner is not available during this time"}

            # Check patient availability
            if not ConflictPreventionService.check_patient_availability(
                patient_id, start_time, end_time
            ):
                return False, {"error": "The patient already has an appointment during this time"}

            # Get appointment type
            try:
                appointment_type = AppointmentType.objects.get(id=appointment_type_id)
            except AppointmentType.DoesNotExist:
                return False, {"error": f"Appointment type with ID {appointment_type_id} not found"}

            appointment = Appointment.objects.create(
                facility=facility,
                patient_id=patient_id,
                practitioner_id=practitioner_id,
                clinic_id=clinic_id,
                appointment_type=appointment_type,
                status='booked',
                source=source,
                start_time=start_time,
                end_time=end_time,
                reason=description,
                notes=comment,
                slot_reference=slot_reference,
                created_by=created_by,
                updated_by=created_by,
            )

            return True, appointment

        except Exception as e:
            logger.error(f"Error booking appointment: {str(e)}")
            return False, {"error": str(e)}


class AppointmentTypeService:
    """
    Service for managing appointment types.
    """

    @staticmethod
    def get_appointment_types(category: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get all appointment types, optionally filtered by category.

        Args:
            category: Optional category to filter by

        Returns:
            List of appointment types
        """
        queryset = AppointmentType.objects.filter(is_active=True)

        if category:
            queryset = queryset.filter(category=category)

        return list(queryset.values())

    @staticmethod
    def create_appointment_type(
        name: str,
        duration_minutes: int,
        category: str,
        description: Optional[str] = None,
        color: Optional[str] = None,
        created_by_id: Optional[str] = None
    ) -> AppointmentType:
        """
        Create a new appointment type.

        Args:
            name: Name of the appointment type
            duration_minutes: Duration in minutes
            category: Category (in_person, telemedicine, walk_in, recurring)
            description: Optional description
            color: Optional color code
            created_by_id: Optional user ID who created the appointment type

        Returns:
            The created AppointmentType
        """
        appointment_type = AppointmentType.objects.create(
            name=name,
            duration_minutes=duration_minutes,
            category=category,
            description=description,
            color=color or "#1976D2",
            created_by_id=created_by_id,
            updated_by_id=created_by_id
        )

        return appointment_type
