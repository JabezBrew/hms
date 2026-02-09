"""
Signals for dashboard cache invalidation and realtime updates.
"""

from __future__ import annotations

from typing import Optional

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.core.security import normalize_facility_code

from .realtime import invalidate_admin_dashboard


def _normalize_facility_code_from_obj(obj) -> Optional[str]:
    facility = getattr(obj, "facility", None)
    if facility and getattr(facility, "code", None):
        return normalize_facility_code(facility.code)

    facility_code = getattr(obj, "facility_code", None)
    if facility_code:
        return normalize_facility_code(facility_code)

    return None


def _facility_code_from_staff(staff) -> Optional[str]:
    if not staff:
        return None
    facility = getattr(staff, "primary_facility", None)
    if facility and getattr(facility, "code", None):
        return normalize_facility_code(facility.code)
    return None


def _invalidate_admin_for_facility_code(facility_code: Optional[str], reason: str) -> None:
    code = normalize_facility_code(facility_code)
    if not code:
        return
    invalidate_admin_dashboard(code, reason=reason)


@receiver(post_save, sender="users.PatientProfile")
@receiver(post_delete, sender="users.PatientProfile")
def invalidate_admin_dashboard_on_patient_change(sender, instance, **kwargs):
    _invalidate_admin_for_facility_code(_normalize_facility_code_from_obj(instance), "patient_changed")


@receiver(post_save, sender="wards.Bed")
@receiver(post_delete, sender="wards.Bed")
def invalidate_admin_dashboard_on_bed_change(sender, instance, **kwargs):
    _invalidate_admin_for_facility_code(_normalize_facility_code_from_obj(instance), "bed_changed")


@receiver(post_save, sender="wards.Ward")
@receiver(post_delete, sender="wards.Ward")
def invalidate_admin_dashboard_on_ward_change(sender, instance, **kwargs):
    facility_code = None
    try:
        department = getattr(instance, "department", None)
        if department and getattr(department, "facility", None):
            facility_code = normalize_facility_code(department.facility.code)
    except Exception:
        facility_code = None
    _invalidate_admin_for_facility_code(facility_code, "ward_changed")


@receiver(post_save, sender="wards.Admission")
@receiver(post_delete, sender="wards.Admission")
def invalidate_admin_dashboard_on_admission_change(sender, instance, **kwargs):
    _invalidate_admin_for_facility_code(_normalize_facility_code_from_obj(instance), "admission_changed")


@receiver(post_save, sender="users.Staff")
@receiver(post_delete, sender="users.Staff")
def invalidate_admin_dashboard_on_staff_change(sender, instance, **kwargs):
    _invalidate_admin_for_facility_code(_facility_code_from_staff(instance), "staff_changed")


@receiver(post_save, sender="users.PractitionerProfile")
@receiver(post_delete, sender="users.PractitionerProfile")
def invalidate_admin_dashboard_on_practitioner_change(sender, instance, **kwargs):
    staff = getattr(instance, "staff", None)
    _invalidate_admin_for_facility_code(_facility_code_from_staff(staff), "practitioner_changed")


@receiver(post_save, sender="users.User")
def invalidate_admin_dashboard_on_user_change(sender, instance, update_fields=None, **kwargs):
    # Active staff count depends on user.is_active.
    if update_fields is not None and "is_active" not in update_fields:
        return

    staff = getattr(instance, "staff_profile", None)
    _invalidate_admin_for_facility_code(_facility_code_from_staff(staff), "user_active_changed")


@receiver(post_save, sender="appointments.Appointment")
@receiver(post_delete, sender="appointments.Appointment")
def invalidate_admin_dashboard_on_appointment_change(sender, instance, **kwargs):
    code = _normalize_facility_code_from_obj(instance)
    if not code:
        return

    start_time = getattr(instance, "start_time", None)
    if not start_time:
        return

    appointment_date = timezone.localtime(start_time).date()
    today = timezone.localdate()
    if appointment_date != today:
        return

    invalidate_admin_dashboard(
        code,
        reason="appointment_changed",
        include_appointments=True,
        target_date=appointment_date,
    )
