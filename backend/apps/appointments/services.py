"""
Services for appointment scheduling, availability generation, and conflict prevention.
"""
from collections import defaultdict
from typing import Dict, List, Optional, Any, Tuple, TYPE_CHECKING
from datetime import datetime, timedelta, time, date
import logging
from django.utils import timezone
from django.db.models import Q, Count
from .models import Appointment, AppointmentType, ScheduleFHIRMapping, RecurringSchedule, BlockedTime
from .proxies import SlotProxy, ScheduleProxy
from ..users.models import PractitionerProfile

if TYPE_CHECKING:
    from apps.users.models import User

logger = logging.getLogger(__name__)


class AvailabilityService:
    """
    Service for generating and managing practitioner availability.
    """

    @staticmethod
    def _add_minutes_to_time(base_time: time, minutes: int) -> time:
        """
        Add minutes to a time object.

        Args:
            base_time: Base time
            minutes: Minutes to add

        Returns:
            New time object
        """
        dummy_date = date.today()
        dt = datetime.combine(dummy_date, base_time)
        dt += timedelta(minutes=minutes)
        return dt.time()

    @staticmethod
    def _time_in_range(check_time: time, start_time: time, end_time: time) -> bool:
        """
        Check if a time falls within a range.

        Args:
            check_time: Time to check
            start_time: Range start
            end_time: Range end

        Returns:
            True if check_time is in range
        """
        if start_time <= end_time:
            return start_time <= check_time < end_time
        else:  # Range crosses midnight
            return check_time >= start_time or check_time < end_time

    @staticmethod
    def _times_overlap(start1: time, end1: time, start2: time, end2: time) -> bool:
        """
        Check if two time ranges overlap.

        Args:
            start1, end1: First time range
            start2, end2: Second time range

        Returns:
            True if ranges overlap
        """
        return start1 < end2 and end1 > start2

    @staticmethod
    def _is_in_break(slot_start: time, slot_end: time, breaks: List[Dict]) -> bool:
        """
        Check if a slot overlaps with any break period.

        Args:
            slot_start: Slot start time
            slot_end: Slot end time
            breaks: List of break periods

        Returns:
            True if slot overlaps with a break
        """
        for break_period in breaks:
            break_start = datetime.strptime(break_period['start'], '%H:%M').time()
            break_end = datetime.strptime(break_period['end'], '%H:%M').time()

            if AvailabilityService._times_overlap(slot_start, slot_end, break_start, break_end):
                return True

        return False

    @staticmethod
    def _is_blocked(
        check_date: date,
        slot_start: time,
        slot_end: time,
        blocked_times: List['BlockedTime']
    ) -> bool:
        """
        Check if a slot is blocked by a BlockedTime entry.

        Args:
            check_date: Date to check
            slot_start: Slot start time
            slot_end: Slot end time
            blocked_times: List of BlockedTime objects

        Returns:
            True if slot is blocked
        """
        for blocked in blocked_times:
            if blocked.date != check_date:
                continue

            if blocked.is_all_day:
                return True

            if AvailabilityService._times_overlap(slot_start, slot_end, blocked.start_time, blocked.end_time):
                return True

        return False

    @staticmethod
    def _has_appointment(
        check_date: date,
        slot_start: time,
        slot_end: time,
        appointments: List[Appointment]
    ) -> bool:
        """
        Check if there's an appointment during this slot.

        Args:
            check_date: Date to check
            slot_start: Slot start time
            slot_end: Slot end time
            appointments: List of appointment records

        Returns:
            True if there's an appointment
        """
        slot_start_dt = datetime.combine(check_date, slot_start)
        slot_end_dt = datetime.combine(check_date, slot_end)

        for appointment in appointments:
            appt_start = appointment.start_time
            appt_end = appointment.end_time

            # Check for overlap
            if slot_start_dt < appt_end and slot_end_dt > appt_start:
                return True

        return False

    @staticmethod
    def is_slot_available(
        practitioner: PractitionerProfile,
        start_time: datetime,
        end_time: datetime,
        facility=None
    ) -> bool:
        """
        Check if a practitioner has an available slot in schedule.
        """
        check_date = start_time.date()
        day_of_week = check_date.weekday()

        schedules = RecurringSchedule.objects.filter(
            practitioner=practitioner,
            is_active=True,
            active_from__lte=check_date
        ).filter(
            Q(active_to__isnull=True) | Q(active_to__gte=check_date)
        )
        if facility is not None:
            schedules = schedules.filter(facility=facility)

        if not schedules.exists():
            return False

        blocked_times = BlockedTime.objects.filter(
            practitioner=practitioner,
            date=check_date
        )
        if facility is not None:
            blocked_times = blocked_times.filter(facility=facility)
        blocked_times = list(blocked_times)

        for schedule in schedules:
            if day_of_week not in schedule.days_of_week:
                continue
            if not AvailabilityService._time_in_range(
                start_time.time(), schedule.start_time, schedule.end_time
            ):
                continue
            if not AvailabilityService._time_in_range(
                end_time.time(), schedule.start_time, schedule.end_time
            ):
                continue
            if AvailabilityService._is_in_break(start_time.time(), end_time.time(), schedule.breaks):
                continue
            if AvailabilityService._is_blocked(
                check_date, start_time.time(), end_time.time(), blocked_times
            ):
                continue
            return True

        return False

    @staticmethod
    def compute_available_slots(
        practitioner_id: str,
        start_date: str,
        end_date: str,
        appointment_type_id: Optional[str] = None,
        facility=None,
        use_roster: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """
        Compute available slots on-the-fly.

        This method supports dual-mode availability:
        1. Roster-based: Derives slots from published RosterEntry records with clinic-type duties
        2. RecurringSchedule-based: Legacy approach using RecurringSchedule records

        During the migration period, roster-based availability takes precedence. If no roster
        entries are found, it falls back to RecurringSchedule.

        Args:
            practitioner_id: Local PractitionerProfile ID (UUID)
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            appointment_type_id: Optional AppointmentType ID
            facility: Optional facility for scoping
            use_roster: Explicit control over which source to use:
                        None = auto (roster first, fallback to schedule)
                        True = roster only
                        False = schedule only

        Returns:
            List of available slot dictionaries
        """
        try:
            # Import RosterAvailabilityService here to avoid circular imports
            from apps.organization.services import RosterAvailabilityService

            # Try roster-based availability first (unless explicitly disabled)
            if use_roster is not False:
                # Check if practitioner has roster-based availability
                has_roster = RosterAvailabilityService.has_roster_availability(
                    practitioner_id=practitioner_id,
                    start_date=start_date,
                    end_date=end_date,
                    facility=facility
                )

                if has_roster or use_roster is True:
                    roster_slots = RosterAvailabilityService.compute_available_slots(
                        practitioner_id=practitioner_id,
                        start_date=start_date,
                        end_date=end_date,
                        facility=facility,
                        appointment_type_id=appointment_type_id,
                    )

                    if roster_slots:
                        logger.info(
                            f"Using roster-based availability: {len(roster_slots)} slots "
                            f"for practitioner {practitioner_id}"
                        )
                        return roster_slots

                    if use_roster is True:
                        # Explicit roster mode but no slots found
                        logger.info(f"No roster-based slots found for practitioner {practitioner_id}")
                        return []

            # Fall back to RecurringSchedule-based availability
            return AvailabilityService._compute_slots_from_recurring_schedule(
                practitioner_id=practitioner_id,
                start_date=start_date,
                end_date=end_date,
                facility=facility,
            )

        except Exception as e:
            logger.error(f"Error computing available slots: {str(e)}", exc_info=True)
            raise

    @staticmethod
    def _compute_slots_from_recurring_schedule(
        practitioner_id: str,
        start_date: str,
        end_date: str,
        facility=None,
    ) -> List[Dict[str, Any]]:
        """
        Compute available slots from RecurringSchedule records.

        This is the legacy approach that will be deprecated once all schedules
        are migrated to roster-based availability.

        Args:
            practitioner_id: Local PractitionerProfile ID (UUID)
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            facility: Optional facility for scoping

        Returns:
            List of available slot dictionaries
        """
        # Convert string dates to date objects
        start_date_obj = datetime.strptime(start_date, '%Y-%m-%d').date()
        end_date_obj = datetime.strptime(end_date, '%Y-%m-%d').date()

        # 1. Get practitioner's recurring schedules (1 query)
        recurring_schedules = RecurringSchedule.objects.filter(
            practitioner_id=practitioner_id,
            is_active=True,
            migrated_to_roster=False,  # Exclude migrated schedules
            active_from__lte=end_date_obj
        )
        if facility is not None:
            recurring_schedules = recurring_schedules.filter(facility=facility)
        recurring_schedules = recurring_schedules.filter(
            Q(active_to__isnull=True) | Q(active_to__gte=start_date_obj)
        ).prefetch_related('practitioner')

        if not recurring_schedules.exists():
            logger.info(f"No active recurring schedules found for practitioner {practitioner_id}")
            return []

        # 2. Get blocked times (1 query)
        blocked_times = BlockedTime.objects.filter(
            practitioner_id=practitioner_id,
            date__gte=start_date_obj,
            date__lte=end_date_obj
        )
        if facility is not None:
            blocked_times = blocked_times.filter(facility=facility)
        blocked_times = list(blocked_times)

        # 3. Get booked appointments (local source of truth)
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
        if facility is not None:
            appointments = appointments.filter(facility=facility)
        appointments = list(appointments)

        # 4. Compute slots in memory
        slots = []
        current_date = start_date_obj

        while current_date <= end_date_obj:
            day_of_week = current_date.weekday()  # 0=Monday, 6=Sunday

            # Find schedules for this day
            for schedule in recurring_schedules:
                if day_of_week not in schedule.days_of_week:
                    continue

                # Generate time slots for this schedule
                current_time = schedule.start_time

                while current_time < schedule.end_time:
                    # Calculate slot end time
                    slot_end = AvailabilityService._add_minutes_to_time(
                        current_time,
                        schedule.slot_duration
                    )

                    # Ensure slot doesn't go beyond schedule end time
                    if slot_end > schedule.end_time:
                        break

                    # Check if slot is valid (not in break, not blocked, not booked)
                    is_in_break = AvailabilityService._is_in_break(
                        current_time, slot_end, schedule.breaks
                    )

                    is_blocked = AvailabilityService._is_blocked(
                        current_date, current_time, slot_end, blocked_times
                    )

                    has_appointment = AvailabilityService._has_appointment(
                        current_date, current_time, slot_end, appointments
                    )

                    # Only add slot if it's not in a break
                    if not is_in_break:
                        # Determine slot status
                        if is_blocked:
                            status = "busy-unavailable"
                        elif has_appointment:
                            status = "busy"
                        else:
                            status = "free"

                        # Create slot dictionary
                        slot_start_dt = datetime.combine(current_date, current_time)
                        slot_end_dt = datetime.combine(current_date, slot_end)

                        slots.append({
                            "id": f"computed-{practitioner_id}-{slot_start_dt.isoformat()}",
                            "resourceType": "Slot",
                            "status": status,
                            "start": slot_start_dt.isoformat(),
                            "end": slot_end_dt.isoformat(),
                            "schedule": {
                                "reference": f"Schedule/{schedule.id}"
                            },
                            "computed": True,  # Flag to indicate this was computed, not stored
                            "source": "recurring_schedule"  # Indicate source for debugging
                        })

                    # Move to next slot
                    current_time = slot_end

            # Move to next day
            current_date += timedelta(days=1)

        logger.info(f"Computed {len(slots)} slots from RecurringSchedule for practitioner {practitioner_id} from {start_date} to {end_date}")
        return slots

    @staticmethod
    def generate_slots_for_date(
        practitioner_id: str,
        target_date: date,
        user: Optional['User'] = None,
        facility=None,
    ) -> Dict[str, Any]:
        """
        Generate slots for a specific date based on recurring schedules.

        Args:
            practitioner_id: Practitioner ID
            target_date: Date to generate slots for
            user: User generating the slots

        Returns:
            Dictionary with schedule_id and number of slots created
        """
        try:
            # Find active recurring schedules for this practitioner and date
            day_of_week = target_date.weekday()  # 0=Monday, 6=Sunday

            recurring_schedules = RecurringSchedule.objects.filter(
                practitioner_id=practitioner_id,
                is_active=True,
                days_of_week__contains=[day_of_week],
                active_from__lte=target_date
            )
            if facility is not None:
                recurring_schedules = recurring_schedules.filter(facility=facility)
            recurring_schedules = recurring_schedules.filter(
                Q(active_to__isnull=True) | Q(active_to__gte=target_date)
            )

            if not recurring_schedules.exists():
                return {"slots_created": 0, "message": "No active recurring schedules found for this date"}

            # Create FHIR Schedule for this date
            practitioner = recurring_schedules.first().practitioner
            schedule = ScheduleProxy.create(
                practitioner_id=practitioner.fhir_practitioner_id,
                start_date=target_date.strftime('%Y-%m-%d'),
                end_date=target_date.strftime('%Y-%m-%d')
            )

            # Generate slots for each recurring schedule
            slots_created = 0

            for recurring_schedule in recurring_schedules:
                # Calculate slot times based on start time, end time, and duration
                current_time = recurring_schedule.start_time
                end_time = recurring_schedule.end_time
                breaks = recurring_schedule.breaks or []

                while current_time < end_time:
                    # Calculate slot end time
                    slot_end_time = (
                        datetime.combine(target_date, current_time) + 
                        timedelta(minutes=recurring_schedule.slot_duration)
                    ).time()

                    # Ensure slot doesn't go beyond the schedule end time
                    if slot_end_time > end_time:
                        break

                    # Check if slot overlaps with any break
                    is_break_time = False
                    for break_period in breaks:
                        break_start = datetime.strptime(break_period['start'], '%H:%M').time()
                        break_end = datetime.strptime(break_period['end'], '%H:%M').time()
                        
                        # Check for overlap: (StartA < EndB) and (EndA > StartB)
                        if current_time < break_end and slot_end_time > break_start:
                            is_break_time = True
                            # Move current time to end of break to avoid checking invalid slots
                            if slot_end_time < break_end:
                                current_time = break_end
                            else:
                                # If the slot completely covers the break or extends beyond, 
                                # we just skip this slot and move by duration (or to break end)
                                # But simpler to just skip this slot and increment by duration
                                # However, to be efficient, if we are inside a break, we should jump out of it.
                                # If current_time is inside break, jump to break_end
                                if current_time >= break_start:
                                    current_time = break_end
                            break
                    
                    if is_break_time:
                        # If we adjusted current_time inside the loop, continue to next iteration
                        # But we need to make sure we don't get stuck if we didn't adjust it enough
                        # The logic above tries to adjust. 
                        # Let's double check: if we just found an overlap, and didn't move current_time,
                        # we must move it.
                        # Simplest approach: if overlap, just increment by duration (standard) 
                        # OR jump to break end. Jumping to break end is better.
                        # Re-evaluating the jump logic above.
                        
                        # If we are here, it means we found an overlap and potentially moved current_time.
                        # If we moved current_time, we should continue the outer while loop.
                        # If we didn't move it (e.g. slot overlaps but starts before break), 
                        # we should probably just skip this slot.
                        
                        # Let's refine the jump logic:
                        # If slot overlaps break:
                        # 1. If slot starts before break and ends in/after break -> Skip slot, move to next slot time? 
                        #    Or should we cut the slot short? Requirement says "rigid slots", so probably skip.
                        # 2. If slot starts in break -> Move start to break end.
                        
                        # Let's stick to the simple skip for now, but with optimization:
                        # If start time is within a break, move to end of break.
                        pass # Logic handled inside the break loop or just skip
                    else:
                        # Create FHIR Slot
                        start_datetime = datetime.combine(target_date, current_time)
                        end_datetime = datetime.combine(target_date, slot_end_time)

                        SlotProxy.create(
                            schedule_id=schedule["id"],
                            start_time=start_datetime,
                            end_time=end_datetime
                        )
                        slots_created += 1

                        # Move to next slot
                        current_time = slot_end_time

            # Create mapping record
            mapping = ScheduleFHIRMapping.objects.create(
                fhir_schedule_id=schedule["id"],
                practitioner=practitioner,
                start_date=target_date,
                end_date=target_date,
                slots_count=slots_created,
                created_by=user
            )

            return {
                "schedule_id": schedule["id"],
                "slots_created": slots_created,
                "mapping_id": str(mapping.id)
            }

        except Exception as e:
            logger.error(f"Error generating slots for date: {str(e)}")
            raise

    @staticmethod
    def batch_generate_slots_for_next_n_days(
        days: int = 14,
        user: Optional['User'] = None,
        facility=None,
    ) -> Dict[str, Any]:
        """
        Generate slots for all practitioners for the next N days.

        Note: This method should be converted to a Celery task in the future
        to handle batch generation asynchronously.

        Args:
            days: Number of days to generate slots for
            user: User generating the slots

        Returns:
            Dictionary with results
        """
        start_date = timezone.now().date()
        end_date = start_date + timedelta(days=days)

        results = {
            "total_practitioners": 0,
            "total_days": days,
            "total_slots_created": 0,
            "details": []
        }

        # Get all practitioners with active recurring schedules
        practitioners = PractitionerProfile.objects.filter(
            recurring_schedules__is_active=True
        )
        if facility is not None:
            practitioners = practitioners.filter(recurring_schedules__facility=facility)
        practitioners = practitioners.distinct()

        results["total_practitioners"] = practitioners.count()

        # Generate slots for each practitioner for each day
        for practitioner in practitioners:
            practitioner_result = {
                "practitioner_id": str(practitioner.id),
                "days_processed": 0,
                "slots_created": 0
            }

            current_date = start_date
            while current_date <= end_date:
                try:
                    # Check if slots already exist for this date
                    existing_schedules = ScheduleFHIRMapping.objects.filter(
                        practitioner=practitioner,
                        start_date=current_date,
                        status='active'
                    )

                    if not existing_schedules.exists():
                        # Generate slots for this date
                        result = AvailabilityService.generate_slots_for_date(
                            practitioner_id=str(practitioner.id),
                            target_date=current_date,
                            user=user,
                            facility=facility,
                        )

                        practitioner_result["slots_created"] += result["slots_created"]
                        results["total_slots_created"] += result["slots_created"]

                    practitioner_result["days_processed"] += 1

                except Exception as e:
                    logger.error(f"Error generating slots for practitioner {practitioner.id} on {current_date}: {str(e)}")

                current_date += timedelta(days=1)

            results["details"].append(practitioner_result)

        return results

    @staticmethod
    def get_available_slots(
        practitioner_id: str,
        start_date: str,
        end_date: str,
        appointment_type_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get available slots for a practitioner in a date range.

        Args:
            practitioner_id: FHIR Practitioner resource ID
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            appointment_type_id: Optional AppointmentType ID to filter by duration

        Returns:
            List of available slots
        """
        # Convert string dates to date objects
        start_date_obj = datetime.strptime(start_date, '%Y-%m-%d').date()
        end_date_obj = datetime.strptime(end_date, '%Y-%m-%d').date()
        
        logger.debug(f"Getting slots for date range: {start_date} to {end_date}")

        # Get schedules for the practitioner
        schedules_bundle = ScheduleProxy.search(
            practitioner_id=practitioner_id,
            start_date=start_date,
            end_date=end_date,
            active=True
        )
        logger.debug(f"Found schedules: {schedules_bundle}")

        available_slots = []
        if "entry" in schedules_bundle:
            import concurrent.futures

            def fetch_slots(schedule_entry):
                if "resource" not in schedule_entry or schedule_entry["resource"]["resourceType"] != "Schedule":
                    return []
                
                schedule_id = schedule_entry["resource"]["id"]
                logger.debug(f"Searching slots for schedule: {schedule_id}")
                
                slots_bundle = SlotProxy.search(
                    schedule_id=schedule_id,
                    start_date=start_date,
                    end_date=end_date,
                    status="free"
                )
                
                found_slots = []
                if "entry" in slots_bundle:
                    for slot_entry in slots_bundle["entry"]:
                        if "resource" in slot_entry:
                            found_slots.append(slot_entry["resource"])
                return found_slots

            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                future_to_schedule = {
                    executor.submit(fetch_slots, entry): entry 
                    for entry in schedules_bundle["entry"]
                }
                
                for future in concurrent.futures.as_completed(future_to_schedule):
                    try:
                        slots = future.result()
                        for slot in slots:
                            slot_start = datetime.fromisoformat(slot["start"].replace('Z', '+00:00'))
                            # Add explicit date filtering here
                            slot_date = slot_start.date()
                            if start_date_obj <= slot_date <= end_date_obj:
                                available_slots.append(slot)
                            else:
                                logger.debug(f"Filtering out slot with date {slot_date} outside range {start_date_obj} to {end_date_obj}")
                    except Exception as e:
                        logger.error(f"Error fetching slots for schedule: {e}")

        return available_slots
        return available_slots


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
        base_capacity_by_window: Dict[tuple, int] = {}
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
                    key = (slot_start_dt.isoformat(), slot_end_dt.isoformat())
                    base_capacity_by_window[key] = base_capacity_by_window.get(key, 0) + cap_per_window

                current_time = slot_end

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
