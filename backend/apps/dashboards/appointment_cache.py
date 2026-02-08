"""
Helpers for caching and projecting FHIR appointment data.
Minimize cached PHI and avoid request-thread FHIR calls.
"""
from typing import Any, Dict, Iterable, List, Optional


def extract_patient_fhir_id(appointment: Dict[str, Any]) -> Optional[str]:
    participant_data = appointment.get("participant", []) or []
    for participant in participant_data:
        actor = (participant or {}).get("actor", {}) or {}
        reference = actor.get("reference", "")
        if reference.startswith("Patient/"):
            return reference.split("/")[-1]
    return None


def filter_appointments_by_patient_ids(
    appointments: Iterable[Dict[str, Any]],
    allowed_patient_ids: set[str],
) -> List[Dict[str, Any]]:
    if not allowed_patient_ids:
        return []
    filtered = []
    for appointment in appointments:
        patient_id = extract_patient_fhir_id(appointment)
        if patient_id and patient_id in allowed_patient_ids:
            filtered.append(appointment)
    return filtered


def project_appointment_for_cache(appointment: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return a minimal appointment payload suitable for caching and dashboards.
    """
    if not appointment:
        return {}
    participants = []
    for participant in appointment.get("participant", []) or []:
        actor = (participant or {}).get("actor", {}) or {}
        reference = actor.get("reference", "")
        if not reference:
            continue
        if reference.startswith("Patient/") or reference.startswith("Practitioner/"):
            participants.append(
                {
                    "actor": {
                        "reference": reference,
                        "display": actor.get("display"),
                    },
                    "status": participant.get("status"),
                }
            )
    return {
        "id": appointment.get("id"),
        "status": appointment.get("status"),
        "start": appointment.get("start"),
        "end": appointment.get("end"),
        "description": appointment.get("description"),
        "reasonCode": appointment.get("reasonCode"),
        "appointmentType": appointment.get("appointmentType"),
        "participant": participants,
    }
