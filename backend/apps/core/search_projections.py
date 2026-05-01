"""
Search projection sync helpers for non-patient entity types.

Each sync_* function builds and upserts a single projection row.
Called from post_save signals via transaction.on_commit so projection
writes never roll back the parent transaction.
"""
from __future__ import annotations

from django.core.cache import cache
from django.utils import timezone

from apps.core.cache_utils import facility_cache_key_for_code

# Similarity threshold shared across non-patient projection lookups.
OMNI_TRIGRAM_THRESHOLD = 0.25

_READY_CACHE_TTL = 300


def _ready_cache_key(projection: str, facility) -> str:
    code = getattr(facility, 'code', None) or ''
    return facility_cache_key_for_code(code, f'search_index_ready__{projection}')


def mark_projection_ready(projection: str, facility) -> None:
    if facility is None:
        return
    cache.set(_ready_cache_key(projection, facility), '1', timeout=_READY_CACHE_TTL)


def projection_ready(projection: str, facility, index_model) -> bool:
    """
    Returns True if the projection has at least one row for this facility.
    Cached; falls back to a single EXISTS query and caches the result.
    """
    if facility is None:
        return False
    key = _ready_cache_key(projection, facility)
    cached = cache.get(key)
    if cached is not None:
        return cached == '1'
    ready = index_model.objects.filter(facility=facility).exists()
    cache.set(key, '1' if ready else '0', timeout=_READY_CACHE_TTL)
    return ready


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------

def _build_staff_search_document(staff) -> str:
    user = getattr(staff, 'user', None)
    parts = [
        getattr(user, 'first_name', '') or '',
        getattr(user, 'last_name', '') or '',
        getattr(staff, 'employee_id', '') or '',
        getattr(staff, 'department', '') or '',
        getattr(staff, 'position', '') or '',
    ]
    return " ".join(p.strip().lower() for p in parts if p and p.strip())


def sync_staff_search_index(staff):
    from apps.users.models import StaffSearchIndex

    facility = getattr(staff, 'primary_facility', None)
    if facility is None:
        StaffSearchIndex.objects.filter(staff=staff).delete()
        return None

    payload = {
        'facility': facility,
        'search_document': _build_staff_search_document(staff),
        'employee_id': (getattr(staff, 'employee_id', '') or '').strip(),
        'department': (getattr(staff, 'department', '') or '').strip(),
        'updated_at': timezone.now(),
    }
    index, _ = StaffSearchIndex.objects.update_or_create(
        staff=staff,
        defaults=payload,
    )
    mark_projection_ready('staff', facility)
    return index


# ---------------------------------------------------------------------------
# Ward
# ---------------------------------------------------------------------------

def _build_ward_search_document(ward) -> str:
    parts = [
        getattr(ward, 'name', '') or '',
        ward.get_ward_type_display() if hasattr(ward, 'get_ward_type_display') else (getattr(ward, 'ward_type', '') or ''),
        getattr(ward, 'description', '') or '',
    ]
    return " ".join(p.strip().lower() for p in parts if p and p.strip())


def sync_ward_search_index(ward):
    from apps.wards.models import WardSearchIndex

    facility = getattr(ward, 'facility', None)
    if facility is None:
        WardSearchIndex.objects.filter(ward=ward).delete()
        return None

    payload = {
        'facility': facility,
        'search_document': _build_ward_search_document(ward),
        'ward_type': (getattr(ward, 'ward_type', '') or '').strip(),
        'is_active': getattr(ward, 'is_active', True),
        'updated_at': timezone.now(),
    }
    index, _ = WardSearchIndex.objects.update_or_create(
        ward=ward,
        defaults=payload,
    )
    mark_projection_ready('wards', facility)
    return index


# ---------------------------------------------------------------------------
# Admission
# ---------------------------------------------------------------------------

def _build_admission_search_document(admission) -> str:
    patient = getattr(admission, 'patient', None)
    user = getattr(patient, 'user', None) if patient else None
    bed = getattr(admission, 'bed', None)
    ward = getattr(bed, 'ward', None) if bed else None
    parts = [
        getattr(user, 'first_name', '') or '' if user else '',
        getattr(user, 'last_name', '') or '' if user else '',
        getattr(patient, 'medical_record_number', '') or '' if patient else '',
        getattr(ward, 'name', '') or '' if ward else '',
        getattr(bed, 'bed_number', '') or '' if bed else '',
        admission.get_status_display() if hasattr(admission, 'get_status_display') else (getattr(admission, 'status', '') or ''),
    ]
    return " ".join(p.strip().lower() for p in parts if p and p.strip())


def sync_admission_search_index(admission):
    from apps.wards.models import AdmissionSearchIndex

    facility = getattr(admission, 'facility', None)
    if facility is None:
        AdmissionSearchIndex.objects.filter(admission=admission).delete()
        return None

    payload = {
        'facility': facility,
        'search_document': _build_admission_search_document(admission),
        'status': (getattr(admission, 'status', '') or '').strip(),
        'admission_date': getattr(admission, 'admission_date', None),
        'updated_at': timezone.now(),
    }
    index, _ = AdmissionSearchIndex.objects.update_or_create(
        admission=admission,
        defaults=payload,
    )
    mark_projection_ready('admissions', facility)
    return index


# ---------------------------------------------------------------------------
# Appointment
# ---------------------------------------------------------------------------

def _build_appointment_search_document(appointment) -> str:
    patient = getattr(appointment, 'patient', None)
    user = getattr(patient, 'user', None) if patient else None
    practitioner = getattr(appointment, 'practitioner', None)
    prac_staff = getattr(practitioner, 'staff', None) if practitioner else None
    prac_user = getattr(prac_staff, 'user', None) if prac_staff else None
    clinic = getattr(appointment, 'clinic', None)
    appt_type = getattr(appointment, 'appointment_type', None)
    parts = [
        getattr(user, 'first_name', '') or '' if user else '',
        getattr(user, 'last_name', '') or '' if user else '',
        getattr(patient, 'medical_record_number', '') or '' if patient else '',
        getattr(prac_user, 'first_name', '') or '' if prac_user else '',
        getattr(prac_user, 'last_name', '') or '' if prac_user else '',
        getattr(clinic, 'name', '') or '' if clinic else '',
        getattr(appt_type, 'name', '') or '' if appt_type else '',
    ]
    return " ".join(p.strip().lower() for p in parts if p and p.strip())


def sync_appointment_search_index(appointment):
    from apps.appointments.models import AppointmentSearchIndex

    facility = getattr(appointment, 'facility', None)
    if facility is None:
        AppointmentSearchIndex.objects.filter(appointment=appointment).delete()
        return None

    payload = {
        'facility': facility,
        'search_document': _build_appointment_search_document(appointment),
        'status': (getattr(appointment, 'status', '') or '').strip(),
        'start_time': getattr(appointment, 'start_time', None),
        'updated_at': timezone.now(),
    }
    index, _ = AppointmentSearchIndex.objects.update_or_create(
        appointment=appointment,
        defaults=payload,
    )
    mark_projection_ready('appointments', facility)
    return index


# ---------------------------------------------------------------------------
# Encounter
# ---------------------------------------------------------------------------

def _build_encounter_search_document(encounter) -> str:
    patient = getattr(encounter, 'patient', None)
    user = getattr(patient, 'user', None) if patient else None
    practitioner = getattr(encounter, 'practitioner', None)
    prac_staff = getattr(practitioner, 'staff', None) if practitioner else None
    prac_user = getattr(prac_staff, 'user', None) if prac_staff else None
    parts = [
        getattr(user, 'first_name', '') or '' if user else '',
        getattr(user, 'last_name', '') or '' if user else '',
        getattr(patient, 'medical_record_number', '') or '' if patient else '',
        getattr(prac_user, 'first_name', '') or '' if prac_user else '',
        getattr(prac_user, 'last_name', '') or '' if prac_user else '',
        getattr(encounter, 'reason', '') or '',
        getattr(encounter, 'location', '') or '',
    ]
    return " ".join(p.strip().lower() for p in parts if p and p.strip())


def sync_encounter_search_index(encounter):
    from apps.encounters.models import EncounterSearchIndex

    facility = getattr(encounter, 'facility', None)
    if facility is None:
        EncounterSearchIndex.objects.filter(encounter=encounter).delete()
        return None

    payload = {
        'facility': facility,
        'search_document': _build_encounter_search_document(encounter),
        'status': (getattr(encounter, 'status', '') or '').strip(),
        'start_time': getattr(encounter, 'start_time', None),
        'updated_at': timezone.now(),
    }
    index, _ = EncounterSearchIndex.objects.update_or_create(
        encounter=encounter,
        defaults=payload,
    )
    mark_projection_ready('encounters', facility)
    return index
