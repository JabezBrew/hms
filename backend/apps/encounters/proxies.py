"""
FHIR Proxy for Encounter resources.
"""
from typing import Dict, List, Optional, Any
from datetime import datetime
from django.utils import timezone
import logging

from apps.fhir_client.client import fhir_client
from apps.fhir_client.utils import (
    generate_fhir_id, create_reference, create_period, create_coding,
    create_codeable_concept
)
from apps.users.models import PatientProfile, PractitionerProfile

logger = logging.getLogger(__name__)


class EncounterProxy:
    """
    Proxy for FHIR Encounter resource.
    """
    @staticmethod
    def create(
        patient_id: str,
        practitioner_id: Optional[str] = None,
        encounter_type: str = "inpatient",
        status: str = "in-progress",
        reason: Optional[str] = None,
        service_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        location: Optional[str] = None,
        admission_source: Optional[str] = None,
        careteam_id: Optional[str] = None,
        account_id: Optional[str] = None,
        appointment_id: Optional[str] = None,
        diagnosis_refs: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Create a new FHIR Encounter resource.

        Args:
            patient_id: FHIR Patient resource ID
            practitioner_id: Optional FHIR Practitioner resource ID
            encounter_type: Type of encounter (inpatient, outpatient, emergency)
            status: Encounter status (planned, in-progress, finished, cancelled)
            reason: Optional reason for the encounter
            service_type: Optional service type
            start_time: Optional start time (defaults to now)
            location: Optional location
            admission_source: Optional admission source
            careteam_id: Optional FHIR CareTeam resource ID
            account_id: Optional FHIR Account resource ID
            appointment_id: Optional FHIR Appointment resource ID
            diagnosis_refs: Optional list of FHIR Condition resource references

        Returns:
            The created FHIR Encounter resource
        """
        # Map encounter type to FHIR class code
        encounter_class_map = {
            "inpatient": {"code": "IMP", "display": "inpatient encounter"},
            "outpatient": {"code": "AMB", "display": "ambulatory"},
            "emergency": {"code": "EMER", "display": "emergency"}
        }

        class_code = encounter_class_map.get(encounter_type, {"code": "IMP", "display": "inpatient encounter"})

        # Look up patient name
        patient_name = "Unknown Patient"
        try:
            patient = PatientProfile.objects.get(fhir_patient_id=patient_id)
            patient_name = patient.user.get_full_name() or "Unknown Patient"
        except PatientProfile.DoesNotExist:
            logger.warning(f"Patient with FHIR ID {patient_id} not found")

        # Create encounter data
        encounter_data = {
            "resourceType": "Encounter",
            "id": generate_fhir_id(),
            "status": status,
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": class_code["code"],
                "display": class_code["display"]
            },
            "subject": create_reference("Patient", patient_id, display=patient_name),
            "period": create_period(
                start=(start_time or timezone.now()).isoformat()
            )
        }

        # Add practitioner if available
        if practitioner_id:
            # Look up practitioner name
            practitioner_name = "Unknown Practitioner"
            try:
                practitioner = PractitionerProfile.objects.get(fhir_practitioner_id=practitioner_id)
                practitioner_name = practitioner.staff.user.get_full_name() or "Unknown Practitioner"
            except PractitionerProfile.DoesNotExist:
                logger.warning(f"Practitioner with FHIR ID {practitioner_id} not found")

            encounter_data["participant"] = [
                {
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
                    ],
                    "individual": create_reference("Practitioner", practitioner_id, display=practitioner_name)
                }
            ]

        # Add optional fields if provided
        if reason:
            encounter_data["reasonCode"] = [{"text": reason}]

        if service_type:
            encounter_data["serviceType"] = {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/service-type",
                        "code": "124",  # General Practice
                        "display": service_type
                    }
                ],
                "text": service_type
            }

        if location:
            encounter_data["location"] = [
                {
                    "status": "active",
                    "location": {
                        "display": location
                    }
                }
            ]

        if admission_source:
            encounter_data["hospitalization"] = {
                "admitSource": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/admit-source",
                            "code": admission_source
                        }
                    ]
                }
            }

        if careteam_id:
            encounter_data["careTeam"] = [create_reference("CareTeam", careteam_id)]

        if account_id:
            encounter_data["account"] = [create_reference("Account", account_id)]

        if appointment_id:
            encounter_data["basedOn"] = [create_reference("Appointment", appointment_id)]

        if diagnosis_refs:
            encounter_data["diagnosis"] = [
                {
                    "condition": create_reference("Condition", ref)
                } for ref in diagnosis_refs
            ]

        # Create the encounter in FHIR
        return fhir_client.create_resource("Encounter", encounter_data)

    @staticmethod
    def get(encounter_id: str) -> Dict[str, Any]:
        """
        Get a FHIR Encounter resource by ID.

        Args:
            encounter_id: FHIR Encounter resource ID

        Returns:
            The FHIR Encounter resource
        """
        return fhir_client.get_resource("Encounter", encounter_id)

    @staticmethod
    def update(
        encounter_id: str,
        status: Optional[str] = None,
        end_time: Optional[datetime] = None,
        discharge_disposition: Optional[str] = None,
        destination: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Update a FHIR Encounter resource.

        Args:
            encounter_id: FHIR Encounter resource ID
            status: Optional new status
            end_time: Optional end time
            discharge_disposition: Optional discharge disposition
            destination: Optional destination after discharge

        Returns:
            The updated FHIR Encounter resource
        """
        # Get the existing encounter
        encounter = fhir_client.get_resource("Encounter", encounter_id)

        # Update fields if provided
        if status:
            encounter["status"] = status

        if end_time:
            if "period" not in encounter:
                encounter["period"] = {}
            encounter["period"]["end"] = end_time.isoformat()

        if discharge_disposition or destination:
            if "hospitalization" not in encounter:
                encounter["hospitalization"] = {}

            if discharge_disposition:
                encounter["hospitalization"]["dischargeDisposition"] = {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/discharge-disposition",
                            "code": discharge_disposition
                        }
                    ]
                }

            if destination:
                encounter["hospitalization"]["destination"] = {
                    "display": destination
                }

        # Update the encounter in FHIR
        return fhir_client.update_resource("Encounter", encounter_id, encounter)

    @staticmethod
    def delete(encounter_id: str) -> Dict[str, Any]:
        """
        Delete a FHIR Encounter resource.

        Args:
            encounter_id: FHIR Encounter resource ID

        Returns:
            Empty dict or operation outcome
        """
        return fhir_client.delete_resource("Encounter", encounter_id)

    @staticmethod
    def search(
        patient_id: Optional[str] = None,
        practitioner_id: Optional[str] = None,
        status: Optional[str] = None,
        date: Optional[str] = None,
        encounter_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Search for FHIR Encounter resources.

        Args:
            patient_id: Optional FHIR Patient resource ID
            practitioner_id: Optional FHIR Practitioner resource ID
            status: Optional encounter status
            date: Optional date in YYYY-MM-DD format or with prefixes (ge, le, etc.)
            encounter_type: Optional encounter type (inpatient, outpatient, emergency)

        Returns:
            Bundle of matching FHIR Encounter resources
        """
        params = {}

        if patient_id:
            params["patient"] = f"Patient/{patient_id}"

        if practitioner_id:
            params["practitioner"] = f"Practitioner/{practitioner_id}"

        if status:
            params["status"] = status

        if date:
            params["date"] = date

        if encounter_type:
            # Map encounter type to FHIR class code
            encounter_class_map = {
                "inpatient": "IMP",
                "outpatient": "AMB",
                "emergency": "EMER"
            }
            class_code = encounter_class_map.get(encounter_type)
            if class_code:
                params["class"] = class_code

        return fhir_client.search_resources("Encounter", params)
