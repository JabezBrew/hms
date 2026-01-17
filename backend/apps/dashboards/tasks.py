"""
Celery tasks for dashboard caching.
"""
import logging

from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

from apps.appointments.proxies import AppointmentProxy
from apps.core.cache_utils import facility_cache_key_for_code
from apps.core.models import Facility
from apps.users.models import PatientProfile

logger = logging.getLogger(__name__)


def _extract_patient_fhir_id(appointment):
    participant_data = appointment.get('participant', [])
    for participant in participant_data:
        actor = participant.get('actor', {})
        reference = actor.get('reference', '')
        if reference.startswith('Patient/'):
            return reference.split('/')[-1]
    return None


def _filter_appointments_by_facility(appointments, facility):
    if not facility:
        return []
    patient_ids = {
        _extract_patient_fhir_id(appt)
        for appt in appointments
        if _extract_patient_fhir_id(appt)
    }
    if not patient_ids:
        return []
    allowed_ids = set(
        PatientProfile.objects.filter(
            fhir_patient_id__in=patient_ids,
            facility=facility,
        ).values_list('fhir_patient_id', flat=True)
    )
    return [
        appt for appt in appointments
        if _extract_patient_fhir_id(appt) in allowed_ids
    ]


@shared_task(bind=True, ignore_result=True)
def refresh_admin_dashboard_appointments(self, facility_id: str, facility_code: str, date_str: str) -> None:
    try:
        facility = Facility.objects.filter(id=facility_id).first()
    except Exception as exc:
        logger.warning("Failed to resolve facility for admin dashboard refresh: %s", exc)
        return

    if not facility:
        logger.warning("Facility not found for admin dashboard refresh")
        return

    try:
        bundle = AppointmentProxy.search(date=date_str)
        if not bundle:
            appointments = []
        else:
            appointments = [
                entry.get('resource')
                for entry in bundle.get('entry', [])
                if entry.get('resource')
            ]
        filtered = _filter_appointments_by_facility(appointments, facility)
        count = len(filtered)
    except Exception as exc:
        logger.warning("Failed to refresh admin dashboard appointments: %s", exc)
        return

    cache_key = facility_cache_key_for_code(
        facility_code,
        f"admin_dashboard_appointments_{date_str}",
    )
    stale_cache_key = facility_cache_key_for_code(
        facility_code,
        f"admin_dashboard_appointments_{date_str}_stale",
    )

    cache.set(cache_key, count, timeout=60)
    cache.set(stale_cache_key, count, timeout=600)


@shared_task(bind=True, ignore_result=True)
def refresh_admin_dashboard_appointments_for_all_facilities(self) -> None:
    today = timezone.now().date().isoformat()
    facilities = Facility.objects.filter(is_active=True).only('id', 'code')
    for facility in facilities.iterator():
        refresh_admin_dashboard_appointments.delay(
            facility_id=str(facility.id),
            facility_code=facility.code,
            date_str=today,
        )
