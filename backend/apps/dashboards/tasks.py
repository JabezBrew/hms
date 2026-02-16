"""
Celery tasks for dashboard caching.
"""
import logging

from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.appointments.proxies import AppointmentProxy
from apps.core.cache_utils import facility_cache_key_for_code
from apps.core.models import Facility
from apps.users.models import PatientProfile
from .appointment_cache import (
    extract_patient_fhir_id,
    filter_appointments_by_patient_ids,
    project_appointment_for_cache,
)

logger = logging.getLogger(__name__)
ADMIN_DASHBOARD_PREWARM_LOCK_KEY = "dashboards:admin:appointments:prewarm:lock"


def _filter_appointments_by_facility(appointments, facility):
    if not facility:
        return []
    patient_ids = {
        extract_patient_fhir_id(appt)
        for appt in appointments
        if extract_patient_fhir_id(appt)
    }
    if not patient_ids:
        return []
    allowed_ids = set(
        PatientProfile.objects.filter(
            fhir_patient_id__in=patient_ids,
            facility=facility,
        ).values_list("fhir_patient_id", flat=True)
    )
    return filter_appointments_by_patient_ids(appointments, allowed_ids)


def _cache_appointments(facility_code: str, cache_key: str, appointments: list) -> None:
    stale_cache_key = f"{cache_key}_stale"
    cache_key = facility_cache_key_for_code(facility_code, cache_key)
    stale_cache_key = facility_cache_key_for_code(facility_code, stale_cache_key)
    cache.set(cache_key, appointments, timeout=60)
    cache.set(stale_cache_key, appointments, timeout=600)


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

    cache_key = f"admin_dashboard_appointments_{date_str}"
    _cache_appointments(facility_code, cache_key, count)


@shared_task(bind=True, ignore_result=True)
def refresh_admin_dashboard_appointments_for_all_facilities(self) -> None:
    lock_timeout = max(
        30,
        int(getattr(settings, "ADMIN_DASHBOARD_PREWARM_INTERVAL_SECONDS", 60)) - 5,
    )
    try:
        lock_acquired = cache.add(
            ADMIN_DASHBOARD_PREWARM_LOCK_KEY,
            timezone.now().isoformat(),
            timeout=lock_timeout,
        )
    except Exception as exc:
        logger.warning("Failed to acquire admin dashboard prewarm lock: %s", exc)
        lock_acquired = True

    if not lock_acquired:
        logger.debug("Skipped admin dashboard prewarm because lock is already held.")
        return

    today = timezone.now().date().isoformat()
    facilities = Facility.objects.filter(is_active=True).only('id', 'code')
    for facility in facilities.iterator():
        refresh_admin_dashboard_appointments.delay(
            facility_id=str(facility.id),
            facility_code=facility.code,
            date_str=today,
        )


@shared_task(bind=True, ignore_result=True)
def refresh_facility_dashboard_appointments(self, facility_id: str, facility_code: str, date_str: str) -> None:
    facility = Facility.objects.filter(id=facility_id).first()
    if not facility:
        logger.warning("Facility not found for dashboard refresh")
        return

    try:
        bundle = AppointmentProxy.search(date=date_str)
        appointments = [
            entry.get("resource")
            for entry in bundle.get("entry", [])
            if entry.get("resource")
        ] if bundle else []
        filtered = _filter_appointments_by_facility(appointments, facility)
        projected = [
            projected_appt
            for appt in filtered
            if (projected_appt := project_appointment_for_cache(appt))
        ]
    except Exception as exc:
        logger.warning("Failed to refresh facility appointments: %s", exc)
        return

    cache_key = f"facility_dashboard_appointments_{date_str}"
    _cache_appointments(facility_code, cache_key, projected)


@shared_task(bind=True, ignore_result=True)
def refresh_doctor_dashboard_appointments(
    self,
    facility_id: str,
    facility_code: str,
    practitioner_id: str,
    date_str: str,
) -> None:
    facility = Facility.objects.filter(id=facility_id).first()
    if not facility:
        logger.warning("Facility not found for doctor dashboard refresh")
        return

    try:
        bundle = AppointmentProxy.search(practitioner_id=practitioner_id, date=date_str)
        appointments = [
            entry.get("resource")
            for entry in bundle.get("entry", [])
            if entry.get("resource")
        ] if bundle else []
        filtered = _filter_appointments_by_facility(appointments, facility)
        projected = [
            projected_appt
            for appt in filtered
            if (projected_appt := project_appointment_for_cache(appt))
        ]
    except Exception as exc:
        logger.warning("Failed to refresh doctor appointments: %s", exc)
        return

    cache_key = f"doctor_dashboard_appointments_{practitioner_id}_{date_str}"
    _cache_appointments(facility_code, cache_key, projected)
