"""
FHIR Proxy models for Appointment, Slot, and Schedule resources.
"""
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from django.utils import timezone
from ..fhir_client.client import fhir_client
from ..fhir_client.utils import (
    generate_fhir_id, create_reference, create_period, create_coding,
    create_codeable_concept
)
import logging
from ..users.models import PatientProfile, PractitionerProfile
from ..patients.models import PatientFHIRMapping

logger = logging.getLogger(__name__)

class AppointmentProxy:
    """
    Proxy for FHIR Appointment resource.
    """
    @staticmethod
    def create(
        start_time: datetime,
        end_time: datetime,
        patient_id: str,
        practitioner_id: str,
        appointment_type: str,
        status: str = "proposed",
        description: Optional[str] = None,
        comment: Optional[str] = None,
        slot_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Create a new FHIR Appointment resource.

        Args:
            start_time: Start time of the appointment
            end_time: End time of the appointment
            patient_id: FHIR Patient resource ID
            practitioner_id: FHIR Practitioner resource ID
            appointment_type: Type of appointment (e.g., 'CHECKUP', 'FOLLOWUP')
            status: Appointment status (proposed, pending, booked, arrived, fulfilled, cancelled, etc.)
            description: Optional description of the appointment
            comment: Optional comment about the appointment
            slot_ids: Optional list of FHIR Slot resource IDs

        Returns:
            The created FHIR Appointment resource
        """
        # Create appointment type coding
        appointment_type_coding = create_coding(
            system="http://terminology.hl7.org/CodeSystem/v2-0276",
            code=appointment_type.upper(),
            display=appointment_type
        )

        # Get patient name from database
        patient_name = "Unknown Patient"
        try:
            # First try to find the patient using PatientFHIRMapping
            mapping = PatientFHIRMapping.objects.filter(fhir_patient_id=patient_id).first()
            if mapping and mapping.patient_profile and mapping.patient_profile.user:
                patient_name = f"{mapping.patient_profile.user.first_name} {mapping.patient_profile.user.last_name}"
            else:
                # Fallback to direct lookup in PatientProfile
                patient_profile = PatientProfile.objects.filter(fhir_patient_id=patient_id).first()
                if patient_profile and patient_profile.user:
                    patient_name = f"{patient_profile.user.first_name} {patient_profile.user.last_name}"
        except Exception as e:
            logger.warning(f"Failed to get patient name: {str(e)}")

        # Get practitioner name from database
        practitioner_name = "Unknown Practitioner"
        try:
            practitioner_mapping = PractitionerProfile.objects.filter(fhir_practitioner_id=practitioner_id).first()
            if practitioner_mapping and practitioner_mapping.staff and practitioner_mapping.staff.user:
                practitioner_name = f"Dr. {practitioner_mapping.staff.user.first_name} {practitioner_mapping.staff.user.last_name}"
        except Exception as e:
            logger.warning(f"Failed to get practitioner name: {str(e)}")

        # Create participant list with display names
        participants = [
            {
                "actor": {
                    "reference": f"Patient/{patient_id}",
                    "display": patient_name
                },
                "status": "accepted",
                "type": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                "code": "ATND",
                                "display": "attender"
                            }
                        ]
                    }
                ]
            },
            {
                "actor": {
                    "reference": f"Practitioner/{practitioner_id}",
                    "display": practitioner_name
                },
                "status": "accepted",
                "type": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                "code": "PPRF",
                                "display": "primary performer"
                            }
                        ]
                    }
                ]
            }
        ]

        # Create appointment data
        appointment_data = {
            "resourceType": "Appointment",
            "id": generate_fhir_id(),
            "status": status,
            "appointmentType": {
                "coding": [appointment_type_coding]
            },
            "start": start_time.isoformat(),
            "end": end_time.isoformat(),
            "participant": participants,
            "created": timezone.now().isoformat()
        }

        # Add optional fields if provided
        if description:
            appointment_data["description"] = description

        if comment:
            appointment_data["comment"] = comment

        if slot_ids:
            appointment_data["slot"] = [create_reference("Slot", slot_id) for slot_id in slot_ids]

        # Create the appointment in FHIR
        return fhir_client.create_resource("Appointment", appointment_data)

    @staticmethod
    def get(appointment_id: str) -> Dict[str, Any]:
        """
        Get a FHIR Appointment resource by ID and enhance it with display names.

        Args:
            appointment_id: FHIR Appointment resource ID

        Returns:
            The FHIR Appointment resource with enhanced participant display names
        """
        appointment = fhir_client.get_resource("Appointment", appointment_id)

        # Add display names to participants if missing
        if "participant" in appointment:
            for participant in appointment["participant"]:
                if "actor" in participant and "reference" in participant["actor"]:
                    reference = participant["actor"]["reference"]

                    # Skip if display is already present
                    if "display" in participant["actor"]:
                        continue

                    # Add display name for Patient
                    if reference.startswith("Patient/"):
                        patient_id = reference.split("/")[1]
                        try:
                            # First try to find the patient using PatientFHIRMapping
                            mapping = PatientFHIRMapping.objects.filter(fhir_patient_id=patient_id).first()
                            if mapping and mapping.patient_profile and mapping.patient_profile.user:
                                participant["actor"]["display"] = f"{mapping.patient_profile.user.first_name} {mapping.patient_profile.user.last_name}"
                            else:
                                # Fallback to direct lookup in PatientProfile
                                patient_profile = PatientProfile.objects.filter(fhir_patient_id=patient_id).first()
                                if patient_profile and patient_profile.user:
                                    participant["actor"]["display"] = f"{patient_profile.user.first_name} {patient_profile.user.last_name}"
                        except Exception as e:
                            logger.warning(f"Failed to get patient name: {str(e)}")

                    # Add display name for Practitioner
                    elif reference.startswith("Practitioner/"):
                        practitioner_id = reference.split("/")[1]
                        try:
                            practitioner_mapping = PractitionerProfile.objects.filter(fhir_practitioner_id=practitioner_id).first()
                            if practitioner_mapping and practitioner_mapping.staff and practitioner_mapping.staff.user:
                                participant["actor"]["display"] = f"Dr. {practitioner_mapping.staff.user.first_name} {practitioner_mapping.staff.user.last_name}"
                        except Exception as e:
                            logger.warning(f"Failed to get practitioner name: {str(e)}")

        return appointment

    @staticmethod
    def update(
        appointment_id: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        status: Optional[str] = None,
        description: Optional[str] = None,
        comment: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Update a FHIR Appointment resource.

        Args:
            appointment_id: FHIR Appointment resource ID
            start_time: Optional new start time
            end_time: Optional new end time
            status: Optional new status
            description: Optional new description
            comment: Optional new comment

        Returns:
            The updated FHIR Appointment resource
        """
        # Get the existing appointment
        appointment = fhir_client.get_resource("Appointment", appointment_id)

        # Update fields if provided
        if start_time:
            appointment["start"] = start_time.isoformat()

        if end_time:
            appointment["end"] = end_time.isoformat()

        if status:
            appointment["status"] = status

        if description:
            appointment["description"] = description

        if comment:
            appointment["comment"] = comment

        # Update the appointment in FHIR
        return fhir_client.update_resource("Appointment", appointment_id, appointment)

    @staticmethod
    def delete(appointment_id: str) -> Dict[str, Any]:
        """
        Delete a FHIR Appointment resource.

        Args:
            appointment_id: FHIR Appointment resource ID

        Returns:
            Empty dict or operation outcome
        """
        return fhir_client.delete_resource("Appointment", appointment_id)

    @staticmethod
    def search(
            patient_id: Optional[str] = None,
            practitioner_id: Optional[str] = None,
            date: Optional[str] = None,
            status: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Search for FHIR Appointment resources.

        Args:
            patient_id: Optional FHIR Patient resource ID
            practitioner_id: Optional FHIR Practitioner resource ID
            date: Optional date in YYYY-MM-DD format or with prefixes (ge, le, etc.)
            status: Optional appointment status

        Returns:
            Bundle of matching FHIR Appointment resources with enhanced participant display names
        """
        params = {}

        if patient_id:
            params["patient"] = f"Patient/{patient_id}"

        if practitioner_id:
            params["practitioner"] = f"Practitioner/{practitioner_id}"

        if date:
            # Handle date prefixes (ge, le, etc.) and remove any spaces
            # Check if the date has a prefix like 'ge' or 'le'
            prefixes = ['ge', 'le', 'gt', 'lt', 'eq']

            if any(date.startswith(prefix) for prefix in prefixes):
                # Extract the prefix and date value
                for prefix in prefixes:
                    if date.startswith(prefix):
                        # Remove any spaces between the prefix and date value
                        prefix_len = len(prefix)
                        date_value = date[prefix_len:].strip()
                        params["date"] = f"{prefix}{date_value}"
                        break
            elif ',' in date:
                # Handle comma-separated date range
                date_parts = [part.strip() for part in date.split(',')]
                processed_parts = []

                for part in date_parts:
                    for prefix in prefixes:
                        if part.startswith(prefix):
                            # Remove any spaces between the prefix and date value
                            prefix_len = len(prefix)
                            date_value = part[prefix_len:].strip()
                            processed_parts.append(f"{prefix}{date_value}")
                            break
                    else:
                        # No prefix found, use as is
                        processed_parts.append(part)

                params["date"] = processed_parts
            else:
                # No prefix, use as is
                params["date"] = date

        if status:
            params["status"] = status

        # Get search results
        results = fhir_client.search_resources("Appointment", params)

        # Add display names to participants in search results
        if "entry" in results:
            for entry in results["entry"]:
                if "resource" in entry and entry["resource"]["resourceType"] == "Appointment":
                    appointment = entry["resource"]

                    if "participant" in appointment:
                        for participant in appointment["participant"]:
                            if "actor" in participant and "reference" in participant["actor"]:
                                reference = participant["actor"]["reference"]

                                # Skip if display is already present
                                if "display" in participant["actor"]:
                                    continue

                                # Add display name for Patient
                                if reference.startswith("Patient/"):
                                    patient_id = reference.split("/")[1]
                                    try:
                                        # First try to find the patient using PatientFHIRMapping
                                        mapping = PatientFHIRMapping.objects.filter(fhir_patient_id=patient_id).first()
                                        if mapping and mapping.patient_profile and mapping.patient_profile.user:
                                            participant["actor"]["display"] = f"{mapping.patient_profile.user.first_name} {mapping.patient_profile.user.last_name}"
                                        else:
                                            # Fallback to direct lookup in PatientProfile
                                            patient_profile = PatientProfile.objects.filter(fhir_patient_id=patient_id).first()
                                            print(f'patient_profile: {patient_profile}')
                                            if patient_profile and patient_profile.user:
                                                participant["actor"]["display"] = f"{patient_profile.user.first_name} {patient_profile.user.last_name}"
                                    except Exception as e:
                                        logger.warning(f"Failed to get patient name: {str(e)}")

                                # Add display name for Practitioner
                                elif reference.startswith("Practitioner/"):
                                    practitioner_id = reference.split("/")[1]
                                    try:
                                        practitioner_mapping = PractitionerProfile.objects.filter(fhir_practitioner_id=practitioner_id).first()
                                        if practitioner_mapping and practitioner_mapping.staff and practitioner_mapping.staff.user:
                                            participant["actor"]["display"] = f"Dr. {practitioner_mapping.staff.user.first_name} {practitioner_mapping.staff.user.last_name}"
                                    except Exception as e:
                                        logger.warning(f"Failed to get practitioner name: {str(e)}")

        return results


class SlotProxy:
    """
    Proxy for FHIR Slot resource.
    """
    @staticmethod
    def create(
        schedule_id: str,
        start_time: datetime,
        end_time: datetime,
        status: str = "free"
    ) -> Dict[str, Any]:
        """
        Create a new FHIR Slot resource.
        """
        slot_data = {
            "resourceType": "Slot",
            "status": status,
            "schedule": {
                "reference": f"Schedule/{schedule_id}"
            },
            "start": start_time.astimezone().isoformat(),
            "end": end_time.astimezone().isoformat()
        }

        return fhir_client.create_resource("Slot", slot_data)

    @staticmethod
    def get(slot_id: str) -> Dict[str, Any]:
        """
        Get a FHIR Slot resource by ID.

        Args:
            slot_id: FHIR Slot resource ID

        Returns:
            The FHIR Slot resource
        """
        return fhir_client.get_resource("Slot", slot_id)

    @staticmethod
    def update(
        slot_id: str,
        status: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Update a FHIR Slot resource.

        Args:
            slot_id: FHIR Slot resource ID
            status: Optional new status
            start_time: Optional new start time
            end_time: Optional new end time

        Returns:
            The updated FHIR Slot resource
        """
        # Get the existing slot
        slot = fhir_client.get_resource("Slot", slot_id)

        # Update fields if provided
        if status:
            slot["status"] = status

        if start_time:
            slot["start"] = start_time.isoformat()

        if end_time:
            slot["end"] = end_time.isoformat()

        # Update the slot in FHIR
        return fhir_client.update_resource("Slot", slot_id, slot)

    @staticmethod
    def delete(slot_id: str) -> Dict[str, Any]:
        """
        Delete a FHIR Slot resource.

        Args:
            slot_id: FHIR Slot resource ID

        Returns:
            Empty dict or operation outcome
        """
        return fhir_client.delete_resource("Slot", slot_id)

    @staticmethod
    def search(
        schedule_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        status: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Search for FHIR Slot resources.

        Args:
            schedule_id: Optional FHIR Schedule resource ID
            start_date: Optional start date in YYYY-MM-DD format
            end_date: Optional end date in YYYY-MM-DD format
            status: Optional slot status

        Returns:
            Bundle of matching FHIR Slot resources
        """
        params = {}

        if schedule_id:
            params["schedule"] = f"Schedule/{schedule_id}"

        if start_date and end_date:
            params["date"] = [f"ge{start_date}", f"le{end_date}"]
        elif start_date:
            params["date"] = f"ge{start_date}"
        elif end_date:
            params["date"] = f"le{end_date}"

        if status:
            params["status"] = status

        logger.debug(f"SlotProxy.search params: {params}")
        result = fhir_client.search_resources("Slot", params)
        logger.debug(f"SlotProxy.search result: {result}")
        return result


class ScheduleProxy:
    """
    Proxy for FHIR Schedule resource.
    """
    @staticmethod
    def create(
        practitioner_id: str,
        start_date: str,
        end_date: str,
        service_type: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Create a new FHIR Schedule resource.

        Args:
            practitioner_id: FHIR Practitioner resource ID
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            service_type: Optional list of service type codings

        Returns:
            The created FHIR Schedule resource
        """
        schedule_data = {
            "resourceType": "Schedule",
            "id": generate_fhir_id(),
            "actor": [
                create_reference("Practitioner", practitioner_id)
            ],
            "planningHorizon": create_period(start=start_date, end=end_date),
            "active": True
        }

        if service_type:
            schedule_data["serviceType"] = service_type

        return fhir_client.create_resource("Schedule", schedule_data)

    @staticmethod
    def get(schedule_id: str) -> Dict[str, Any]:
        """
        Get a FHIR Schedule resource by ID.

        Args:
            schedule_id: FHIR Schedule resource ID

        Returns:
            The FHIR Schedule resource
        """
        return fhir_client.get_resource("Schedule", schedule_id)

    @staticmethod
    def update(
        schedule_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        active: Optional[bool] = None
    ) -> Dict[str, Any]:
        """
        Update a FHIR Schedule resource.

        Args:
            schedule_id: FHIR Schedule resource ID
            start_date: Optional new start date
            end_date: Optional new end date
            active: Optional new active status

        Returns:
            The updated FHIR Schedule resource
        """
        # Get the existing schedule
        schedule = fhir_client.get_resource("Schedule", schedule_id)

        # Update fields if provided
        if start_date or end_date:
            planning_horizon = schedule.get("planningHorizon", {})

            if start_date:
                planning_horizon["start"] = start_date

            if end_date:
                planning_horizon["end"] = end_date

            schedule["planningHorizon"] = planning_horizon

        if active is not None:
            schedule["active"] = active

        # Update the schedule in FHIR
        return fhir_client.update_resource("Schedule", schedule_id, schedule)

    @staticmethod
    def delete(schedule_id: str) -> Dict[str, Any]:
        """
        Delete a FHIR Schedule resource.

        Args:
            schedule_id: FHIR Schedule resource ID

        Returns:
            Empty dict or operation outcome
        """
        return fhir_client.delete_resource("Schedule", schedule_id)

    @staticmethod
    def search(
        practitioner_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        active: Optional[bool] = None
    ) -> Dict[str, Any]:
        """
        Search for FHIR Schedule resources in a date range:
          date >= start_date and date <= end_date.

        Args:
            practitioner_id: Optional FHIR Practitioner resource ID
            start_date: Optional 'YYYY-MM-DD'
            end_date: Optional 'YYYY-MM-DD'
            active: Optional active status

        Returns:
            Bundle of matching FHIR Schedule resources
        """
        params = {}
        if practitioner_id:
            params["actor"] = f"Practitioner/{practitioner_id}"

        # If both start and end are given, pass them as multiple date parameters.
        # FHIR interprets date=ge2025-01-01&date=le2025-12-31 as “planningHorizon intersects with that range”.
        if start_date and end_date:
            params["date"] = [f"ge{start_date}", f"le{end_date}"]
        elif start_date:
            params["date"] = f"ge{start_date}"
        elif end_date:
            params["date"] = f"le{end_date}"

        if active is not None:
            params["active"] = str(active).lower()

        return fhir_client.search_resources("Schedule", params)
