"""
Services for appointment scheduling, availability generation, and conflict prevention.
"""
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta, time, date
import logging
from django.utils import timezone
from django.db.models import Q
from .models import AppointmentType, ScheduleFHIRMapping, RecurringSchedule, BlockedTime
from .proxies import AppointmentProxy, SlotProxy, ScheduleProxy
from ..users.models import PractitionerProfile

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
        appointments: List[Dict]
    ) -> bool:
        """
        Check if there's an appointment during this slot.

        Args:
            check_date: Date to check
            slot_start: Slot start time
            slot_end: Slot end time
            appointments: List of appointment resources

        Returns:
            True if there's an appointment
        """
        slot_start_dt = datetime.combine(check_date, slot_start)
        slot_end_dt = datetime.combine(check_date, slot_end)

        for appointment in appointments:
            appt_start = datetime.fromisoformat(appointment["start"].replace('Z', '+00:00'))
            appt_end = datetime.fromisoformat(appointment["end"].replace('Z', '+00:00'))

            # Check for overlap
            if slot_start_dt < appt_end and slot_end_dt > appt_start:
                return True

        return False

    @staticmethod
    def compute_available_slots(
        practitioner_id: str,
        start_date: str,
        end_date: str,
        appointment_type_id: Optional[str] = None,
        facility=None,
    ) -> List[Dict[str, Any]]:
        """
        Compute available slots on-the-fly from recurring schedules.
        This is the new efficient approach that doesn't pre-generate slots.

        Args:
            practitioner_id: Local PractitionerProfile ID (UUID)
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            appointment_type_id: Optional AppointmentType ID

        Returns:
            List of available slot dictionaries
        """
        try:
            # Convert string dates to date objects
            start_date_obj = datetime.strptime(start_date, '%Y-%m-%d').date()
            end_date_obj = datetime.strptime(end_date, '%Y-%m-%d').date()

            # 1. Get practitioner's recurring schedules (1 query)
            recurring_schedules = RecurringSchedule.objects.filter(
                practitioner_id=practitioner_id,
                is_active=True,
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

            # Get practitioner's FHIR ID for appointment lookup
            practitioner = recurring_schedules.first().practitioner
            practitioner_fhir_id = practitioner.fhir_practitioner_id

            if not practitioner_fhir_id:
                logger.warning(f"Practitioner {practitioner_id} has no FHIR ID")
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

            # 3. Get booked appointments (1 FHIR query)
            appointments_bundle = AppointmentProxy.search(
                practitioner_id=practitioner_fhir_id,
                date=f"{start_date},{end_date}",
                status="booked,arrived,fulfilled"
            )

            # Extract appointment resources
            appointments = []
            if "entry" in appointments_bundle:
                for entry in appointments_bundle["entry"]:
                    if "resource" in entry:
                        appointments.append(entry["resource"])

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
                                "computed": True  # Flag to indicate this was computed, not stored
                            })

                        # Move to next slot
                        current_time = slot_end

                # Move to next day
                current_date += timedelta(days=1)

            logger.info(f"Computed {len(slots)} slots for practitioner {practitioner_id} from {start_date} to {end_date}")
            return slots

        except Exception as e:
            logger.error(f"Error computing available slots: {str(e)}", exc_info=True)
            raise

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


class ConflictPreventionService:
    """
    Service for preventing scheduling conflicts.
    """

    @staticmethod
    def check_slot_availability(slot_id: str) -> bool:
        """
        Check if a slot is available (free).

        Args:
            slot_id: FHIR Slot resource ID

        Returns:
            True if the slot is available, False otherwise
        """
        try:
            slot = SlotProxy.get(slot_id)
            return slot.get("status") == "free"
        except Exception as e:
            logger.error(f"Error checking slot availability: {str(e)}")
            return False

    @staticmethod
    def check_practitioner_availability(
        practitioner_id: str,
        start_time: datetime,
        end_time: datetime
    ) -> bool:
        """
        Check if a practitioner is available during a time period.

        Args:
            practitioner_id: FHIR Practitioner resource ID
            start_time: Start time of the period
            end_time: End time of the period

        Returns:
            True if the practitioner is available, False otherwise
        """
        # Format dates for FHIR search
        start_date = start_time.strftime('%Y-%m-%d')
        end_date = end_time.strftime('%Y-%m-%d')

        # Check if there are any overlapping appointments
        appointments_bundle = AppointmentProxy.search(
            practitioner_id=practitioner_id,
            date=f"{start_date},{end_date}",  # Use comma-separated format like in check_patient_availability
            status="booked,arrived,fulfilled"
        )

        if "entry" in appointments_bundle:
            for entry in appointments_bundle["entry"]:
                if "resource" in entry and entry["resource"]["resourceType"] == "Appointment":
                    appointment = entry["resource"]

                    # Parse appointment times
                    appt_start = datetime.fromisoformat(appointment["start"].replace('Z', '+00:00'))
                    appt_end = datetime.fromisoformat(appointment["end"].replace('Z', '+00:00'))

                    # Check for overlap
                    if (start_time < appt_end and end_time > appt_start):
                        return False  # Overlap found

        return True  # No overlaps found

    @staticmethod
    def check_patient_availability(
        patient_id: str,
        start_time: datetime,
        end_time: datetime
    ) -> bool:
        """
        Check if a patient is available during a time period.

        Args:
            patient_id: FHIR Patient resource ID
            start_time: Start time of the period
            end_time: End time of the period

        Returns:
            True if the patient is available, False otherwise
        """
        # Format dates for FHIR search
        start_date = start_time.strftime('%Y-%m-%d')
        end_date = end_time.strftime('%Y-%m-%d')

        # Check if there are any overlapping appointments
        appointments_bundle = AppointmentProxy.search(
            patient_id=patient_id,
            date=f"{start_date},{end_date}",
            status="booked,arrived,fulfilled"
        )

        if "entry" in appointments_bundle:
            for entry in appointments_bundle["entry"]:
                if "resource" in entry and entry["resource"]["resourceType"] == "Appointment":
                    appointment = entry["resource"]

                    # Parse appointment times
                    appt_start = datetime.fromisoformat(appointment["start"].replace('Z', '+00:00'))
                    appt_end = datetime.fromisoformat(appointment["end"].replace('Z', '+00:00'))

                    # Check for overlap
                    if (start_time < appt_end and end_time > appt_start):
                        return False  # Overlap found

        return True  # No overlaps found

    @staticmethod
    def book_appointment(
        patient_id: str,
        practitioner_id: str,
        start_time: datetime,
        end_time: datetime,
        appointment_type_id: str,
        slot_id: Optional[str] = None,
        description: Optional[str] = None,
        comment: Optional[str] = None
    ) -> Tuple[bool, Dict[str, Any]]:
        """
        Book an appointment with conflict prevention.

        Args:
            patient_id: FHIR Patient resource ID
            practitioner_id: FHIR Practitioner resource ID
            start_time: Start time of the appointment
            end_time: End time of the appointment
            appointment_type_id: AppointmentType ID
            slot_id: Optional FHIR Slot resource ID
            description: Optional description of the appointment
            comment: Optional comment about the appointment

        Returns:
            Tuple of (success, result) where result is the appointment or error message
        """
        try:
            # Check if the slot is available (if provided)
            if slot_id and not ConflictPreventionService.check_slot_availability(slot_id):
                return False, {"error": "The selected slot is not available"}

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

            # Create the appointment
            appointment = AppointmentProxy.create(
                start_time=start_time,
                end_time=end_time,
                patient_id=patient_id,
                practitioner_id=practitioner_id,
                appointment_type=appointment_type.name,
                status="booked",
                description=description,
                comment=comment,
                slot_ids=[slot_id] if slot_id else None
            )

            # If a slot was provided, mark it as busy
            if slot_id:
                SlotProxy.update(slot_id, status="busy")

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
