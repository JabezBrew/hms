"""
Signals for dashboard cache invalidation and realtime updates.
"""

from __future__ import annotations

from typing import Optional

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from apps.core.security import normalize_facility_code
from apps.wards.models import Admission

from .realtime import (
    invalidate_admin_dashboard,
    invalidate_inpatient_dashboard,
    invalidate_nurse_dashboard,
    invalidate_reception_dashboard,
)


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


def _ward_scope_from_admission(instance) -> Optional[str]:
    bed = getattr(instance, "bed", None)
    ward_id = getattr(bed, "ward_id", None) if bed else None
    if not ward_id:
        ward_id = getattr(instance, "bed__ward_id", None)
    return str(ward_id) if ward_id else None


def _resolve_active_ward_scope(facility_id, patient_id) -> Optional[str]:
    if not facility_id or not patient_id:
        return None
    ward_id = Admission.objects.filter(
        facility_id=facility_id,
        patient_id=patient_id,
        status="admitted",
    ).values_list("bed__ward_id", flat=True).first()
    return str(ward_id) if ward_id else None


def _invalidate_nurse_for_facility_code(facility_code: Optional[str], reason: str, ward_scope: Optional[str] = None) -> None:
    code = normalize_facility_code(facility_code)
    if not code:
        return
    invalidate_nurse_dashboard(code, reason=reason, ward_scope=ward_scope)


def _invalidate_inpatient_for_facility_code(
    facility_code: Optional[str],
    practitioner_id: Optional[str],
    reason: str,
) -> None:
    code = normalize_facility_code(facility_code)
    if not code or not practitioner_id:
        return
    invalidate_inpatient_dashboard(code, practitioner_id, reason=reason)


def _invalidate_reception_for_facility_code(
    facility_code: Optional[str],
    reason: str,
    *,
    include_appointments: bool = False,
    target_date=None,
) -> None:
    code = normalize_facility_code(facility_code)
    if not code:
        return
    invalidate_reception_dashboard(
        code,
        reason=reason,
        include_appointments=include_appointments,
        target_date=target_date,
    )


@receiver(post_save, sender="users.PatientProfile")
@receiver(post_delete, sender="users.PatientProfile")
def invalidate_admin_dashboard_on_patient_change(sender, instance, **kwargs):
    _invalidate_admin_for_facility_code(_normalize_facility_code_from_obj(instance), "patient_changed")


@receiver(post_save, sender="wards.Bed")
@receiver(post_delete, sender="wards.Bed")
def invalidate_admin_dashboard_on_bed_change(sender, instance, **kwargs):
    _invalidate_admin_for_facility_code(_normalize_facility_code_from_obj(instance), "bed_changed")
    current_ward_scope = str(instance.ward_id) if getattr(instance, "ward_id", None) else None
    previous_ward_scope = getattr(instance, "_previous_ward_scope", None)
    _invalidate_nurse_for_facility_code(
        _normalize_facility_code_from_obj(instance),
        "bed_changed",
        ward_scope=current_ward_scope,
    )
    if previous_ward_scope and previous_ward_scope != current_ward_scope:
        _invalidate_nurse_for_facility_code(
            _normalize_facility_code_from_obj(instance),
            "bed_changed",
            ward_scope=previous_ward_scope,
        )


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
    _invalidate_nurse_for_facility_code(
        facility_code,
        "ward_changed",
        ward_scope=str(instance.id),
    )


@receiver(post_save, sender="wards.Admission")
@receiver(post_delete, sender="wards.Admission")
def invalidate_admin_dashboard_on_admission_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    _invalidate_admin_for_facility_code(facility_code, "admission_changed")

    current_ward_scope = _ward_scope_from_admission(instance)
    previous_ward_scope = getattr(instance, "_previous_ward_scope", None)
    _invalidate_nurse_for_facility_code(facility_code, "admission_changed", ward_scope=current_ward_scope)
    if previous_ward_scope and previous_ward_scope != current_ward_scope:
        _invalidate_nurse_for_facility_code(facility_code, "admission_changed", ward_scope=previous_ward_scope)

    current_practitioner_id = str(instance.admitting_doctor_id) if getattr(instance, "admitting_doctor_id", None) else None
    previous_practitioner_id = getattr(instance, "_previous_admitting_doctor_id", None)
    _invalidate_inpatient_for_facility_code(
        facility_code,
        current_practitioner_id,
        "admission_changed",
    )
    if previous_practitioner_id and previous_practitioner_id != current_practitioner_id:
        _invalidate_inpatient_for_facility_code(
            facility_code,
            previous_practitioner_id,
            "admission_changed",
        )


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
    _invalidate_reception_for_facility_code(
        code,
        "appointment_changed",
        include_appointments=True,
        target_date=appointment_date,
    )


@receiver(pre_save, sender="wards.Admission")
def capture_previous_admission_dashboard_scope(sender, instance, **kwargs):
    if not instance.pk:
        return

    previous = sender.objects.filter(pk=instance.pk).values(
        "admitting_doctor_id",
        "bed__ward_id",
    ).first()
    if not previous:
        return

    previous_practitioner_id = previous.get("admitting_doctor_id")
    previous_ward_id = previous.get("bed__ward_id")
    if previous_practitioner_id:
        instance._previous_admitting_doctor_id = str(previous_practitioner_id)
    if previous_ward_id:
        instance._previous_ward_scope = str(previous_ward_id)


@receiver(pre_save, sender="wards.Bed")
def capture_previous_bed_dashboard_scope(sender, instance, **kwargs):
    if not instance.pk:
        return
    previous_ward_id = sender.objects.filter(pk=instance.pk).values_list("ward_id", flat=True).first()
    if previous_ward_id:
        instance._previous_ward_scope = str(previous_ward_id)


@receiver(post_save, sender="nursing.NursingAlert")
@receiver(post_delete, sender="nursing.NursingAlert")
def invalidate_nurse_dashboard_on_alert_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    ward_scope = _resolve_active_ward_scope(
        getattr(instance, "facility_id", None),
        getattr(instance, "patient_id", None),
    )
    _invalidate_nurse_for_facility_code(facility_code, "alert_changed", ward_scope=ward_scope)


@receiver(post_save, sender="nursing.NursingTask")
@receiver(post_delete, sender="nursing.NursingTask")
def invalidate_nurse_dashboard_on_task_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    ward_scope = _resolve_active_ward_scope(
        getattr(instance, "facility_id", None),
        getattr(instance, "patient_id", None),
    )
    _invalidate_nurse_for_facility_code(facility_code, "task_changed", ward_scope=ward_scope)


@receiver(post_save, sender="nursing.MedicationAdministration")
@receiver(post_delete, sender="nursing.MedicationAdministration")
def invalidate_nurse_dashboard_on_medication_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    ward_scope = _resolve_active_ward_scope(
        getattr(instance, "facility_id", None),
        getattr(instance, "patient_id", None),
    )
    _invalidate_nurse_for_facility_code(
        facility_code,
        "medication_administration_changed",
        ward_scope=ward_scope,
    )
