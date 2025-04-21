"""
Services for appointment scheduling, availability generation, and conflict prevention.
"""
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta, time, date
import logging
from django.utils import timezone
from django.db.models import Q
from .models import AppointmentType, ScheduleFHIRMapping, RecurringSchedule
from .proxies import AppointmentProxy, SlotProxy, ScheduleProxy
from ..users.models import PractitionerProfile

logger = logging.getLogger(__name__)


class AvailabilityService:
    """
    Service for generating and managing practitioner availability.
    """


    @staticmethod
    def generate_slots_for_date(
        practitioner_id: str,
        target_date: date,
        user: Optional['User'] = None
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
            ).filter(
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

                while current_time < end_time:
                    # Calculate slot end time
                    slot_end_time = (
                        datetime.combine(target_date, current_time) + 
                        timedelta(minutes=recurring_schedule.slot_duration)
                    ).time()

                    # Ensure slot doesn't go beyond the schedule end time
                    if slot_end_time > end_time:
                        slot_end_time = end_time

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
                template=None,  # No template for recurring schedules
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
        user: Optional['User'] = None
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
        ).distinct()

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
                            user=user
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
            for entry in schedules_bundle["entry"]:
                if "resource" in entry and entry["resource"]["resourceType"] == "Schedule":
                    schedule_id = entry["resource"]["id"]
                    logger.debug(f"Searching slots for schedule: {schedule_id}")
                    
                    slots_bundle = SlotProxy.search(
                        schedule_id=schedule_id,
                        start_date=start_date,
                        end_date=end_date,
                        status="free"
                    )
                    logger.debug(f"Found slots: {slots_bundle}")

                    if "entry" in slots_bundle:
                        for slot_entry in slots_bundle["entry"]:
                            if "resource" in slot_entry:
                                slot = slot_entry["resource"]
                                slot_start = datetime.fromisoformat(slot["start"].replace('Z', '+00:00'))
                                slot_end = datetime.fromisoformat(slot["end"].replace('Z', '+00:00'))
                                
                                # Add explicit date filtering here
                                slot_date = slot_start.date()
                                if start_date_obj <= slot_date <= end_date_obj:
                                    available_slots.append(slot)
                                else:
                                    logger.debug(f"Filtering out slot with date {slot_date} outside range {start_date_obj} to {end_date_obj}")

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
