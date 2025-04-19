"""
Services for appointment scheduling, availability generation, and conflict prevention.
"""
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta, time
import logging
from django.utils import timezone
from .models import AppointmentType, ScheduleTemplate, ScheduleTimeSlot, ScheduleFHIRMapping
from .proxies import AppointmentProxy, SlotProxy, ScheduleProxy

logger = logging.getLogger(__name__)


class AvailabilityService:
    """
    Service for generating and managing practitioner availability.
    """
    
    @staticmethod
    def generate_schedule_from_template(
        template_id: str,
        start_date: str,
        end_date: str,
        user: Optional['User'] = None
    ) -> Dict[str, Any]:
        """
        Generate a FHIR Schedule and Slots from a ScheduleTemplate.
        
        Args:
            template_id: ScheduleTemplate ID
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            user: User creating the schedule
            
        Returns:
            Dictionary with schedule_id and number of slots created
        """
        try:
            # Get the template
            template = ScheduleTemplate.objects.get(id=template_id)
            
            # Convert string dates to datetime objects
            start_date_obj = datetime.strptime(start_date, '%Y-%m-%d').date()
            end_date_obj = datetime.strptime(end_date, '%Y-%m-%d').date()
            
            if start_date_obj > end_date_obj:
                raise ValueError("Start date must be before end date")
            
            # Create FHIR Schedule
            schedule = ScheduleProxy.create(
                practitioner_id=template.practitioner.fhir_practitioner_id,
                start_date=start_date,
                end_date=end_date
            )
            
            # Generate slots for each day in the range
            current_date = start_date_obj
            slots_created = 0
            
            while current_date <= end_date_obj:
                # Get day of week (0=Monday, 6=Sunday)
                day_of_week = current_date.weekday()
                
                # Find time slots for this day
                time_slots = template.time_slots.filter(day_of_week=day_of_week)
                
                for time_slot in time_slots:
                    # Create datetime objects for start and end times
                    start_datetime = datetime.combine(
                        current_date, 
                        time_slot.start_time
                    )
                    end_datetime = datetime.combine(
                        current_date, 
                        time_slot.end_time
                    )
                    
                    # Create FHIR Slot
                    SlotProxy.create(
                        schedule_id=schedule["id"],
                        start_time=start_datetime,
                        end_time=end_datetime
                    )
                    slots_created += 1
                
                # Move to next day
                current_date += timedelta(days=1)
            
            # Create mapping record
            mapping = ScheduleFHIRMapping.objects.create(
                template=template,
                fhir_schedule_id=schedule["id"],
                practitioner=template.practitioner,
                start_date=start_date_obj,
                end_date=end_date_obj,
                slots_count=slots_created,
                created_by=user
            )
            
            return {
                "schedule_id": schedule["id"],
                "slots_created": slots_created,
                "mapping_id": str(mapping.id)
            }
            
        except ScheduleTemplate.DoesNotExist:
            raise ValueError(f"Schedule template with ID {template_id} not found")
        except Exception as e:
            logger.error(f"Error generating schedule: {str(e)}")
            raise
    
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
        # Get schedules for the practitioner
        schedules_bundle = ScheduleProxy.search(
            practitioner_id=practitioner_id,
            date=f"{start_date},{end_date}",
            active=True
        )
        
        # Extract schedule IDs
        schedule_ids = []
        if "entry" in schedules_bundle:
            for entry in schedules_bundle["entry"]:
                if "resource" in entry and entry["resource"]["resourceType"] == "Schedule":
                    schedule_ids.append(entry["resource"]["id"])
        
        # Get slots for the schedules
        available_slots = []
        for schedule_id in schedule_ids:
            slots_bundle = SlotProxy.search(
                schedule_id=schedule_id,
                start_date=start_date,
                end_date=end_date,
                status="free"
            )
            
            if "entry" in slots_bundle:
                for entry in slots_bundle["entry"]:
                    if "resource" in entry and entry["resource"]["resourceType"] == "Slot":
                        slot = entry["resource"]
                        
                        # If appointment type is specified, check if the slot duration is sufficient
                        if appointment_type_id:
                            try:
                                appointment_type = AppointmentType.objects.get(id=appointment_type_id)
                                slot_start = datetime.fromisoformat(slot["start"].replace('Z', '+00:00'))
                                slot_end = datetime.fromisoformat(slot["end"].replace('Z', '+00:00'))
                                slot_duration = (slot_end - slot_start).total_seconds() / 60
                                
                                if slot_duration < appointment_type.duration_minutes:
                                    continue  # Skip this slot if it's too short
                            except AppointmentType.DoesNotExist:
                                pass  # If appointment type doesn't exist, include all slots
                        
                        available_slots.append(slot)
        
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