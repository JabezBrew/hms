from typing import Any


def build_minimal_context_bundle(*, patient_id=None, encounter_id=None, include_fields=None) -> dict[str, Any]:
    include_fields = include_fields or []
    return {
        'patient_id': str(patient_id) if patient_id else None,
        'encounter_id': str(encounter_id) if encounter_id else None,
        'include_fields': include_fields,
    }
