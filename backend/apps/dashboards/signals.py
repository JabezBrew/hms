"""
Signals for dashboard cache invalidation and realtime updates.
"""

from __future__ import annotations

from typing import Optional

from django.apps import apps
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from apps.core.security import ACTIVE_ADMISSION_STATUSES, normalize_facility_code
from apps.users.models import PractitionerProfile
from apps.wards.models import Admission

from .realtime import (
    invalidate_admin_dashboard,
    invalidate_doctor_dashboard,
    invalidate_inpatient_dashboard,
    invalidate_nurse_dashboard,
    invalidate_reception_dashboard,
    invalidate_ward_task_board,
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
        status__in=ACTIVE_ADMISSION_STATUSES,
    ).values_list("bed__ward_id", flat=True).first()
    return str(ward_id) if ward_id else None


def _invalidate_nurse_for_facility_code(facility_code: Optional[str], reason: str, ward_scope: Optional[str] = None) -> None:
    code = normalize_facility_code(facility_code)
    if not code:
        return
    invalidate_nurse_dashboard(code, reason=reason, ward_scope=ward_scope)


def _invalidate_ward_board_for_facility_code(
    facility_code: Optional[str],
    reason: str,
    ward_scope: Optional[str] = None,
) -> None:
    code = normalize_facility_code(facility_code)
    if not code:
        return
    invalidate_ward_task_board(code, reason=reason, ward_scope=ward_scope)


def _invalidate_doctor_for_facility_code(
    facility_code: Optional[str],
    practitioner_id: Optional[str],
    reason: str,
    *,
    include_appointments: bool = False,
    target_date=None,
) -> None:
    code = normalize_facility_code(facility_code)
    if not code or not practitioner_id:
        return
    invalidate_doctor_dashboard(
        code,
        practitioner_id,
        reason=reason,
        include_appointments=include_appointments,
        target_date=target_date,
    )


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


def _resolve_practitioner_fhir_id_from_appointment(instance) -> Optional[str]:
    practitioner = getattr(instance, "practitioner", None)
    fhir_id = getattr(practitioner, "fhir_practitioner_id", None) if practitioner else None
    if fhir_id:
        return str(fhir_id)

    practitioner_id = getattr(instance, "practitioner_id", None)
    if not practitioner_id:
        return None

    resolved = PractitionerProfile.objects.filter(id=practitioner_id).values_list(
        "fhir_practitioner_id",
        flat=True,
    ).first()
    return str(resolved) if resolved else None


def _invalidate_admin_and_reception_for_appointment_date(
    facility_code: Optional[str],
    target_date,
    *,
    reason: str = "appointment_changed",
) -> None:
    invalidate_admin_dashboard(
        facility_code,
        reason=reason,
        include_appointments=True,
        target_date=target_date,
    )
    _invalidate_reception_for_facility_code(
        facility_code,
        reason,
        include_appointments=True,
        target_date=target_date,
    )


def _ward_scope_from_bed(instance) -> Optional[str]:
    ward_id = getattr(instance, "ward_id", None)
    if not ward_id:
        ward = getattr(instance, "ward", None)
        ward_id = getattr(ward, "id", None) if ward else None
    return str(ward_id) if ward_id else None


def _ward_scope_from_bed_allocation_log(instance) -> Optional[str]:
    bed = getattr(instance, "bed", None)
    ward_id = getattr(bed, "ward_id", None) if bed else None
    if not ward_id:
        admission = getattr(instance, "admission", None)
        if admission:
            return _ward_scope_from_admission(admission)
    return str(ward_id) if ward_id else None


def _ward_scopes_from_transfer(instance) -> tuple[str, ...]:
    scopes = []
    for attr in ("from_admission", "to_admission"):
        admission = getattr(instance, attr, None)
        scope = _ward_scope_from_admission(admission) if admission else None
        if scope and scope not in scopes:
            scopes.append(scope)
    return tuple(scopes)


def _ward_scope_from_lab_order(instance) -> Optional[str]:
    if not instance:
        return None
    return _resolve_active_ward_scope(
        getattr(instance, "facility_id", None),
        getattr(instance, "patient_id", None),
    )


def _lab_order_from_order_test(instance):
    return getattr(instance, "order", None)


def _lab_order_from_result(instance):
    order_test = getattr(instance, "order_test", None)
    if not order_test:
        return None
    return _lab_order_from_order_test(order_test)


def _ward_scope_from_discharge_case(instance) -> Optional[str]:
    if not instance:
        return None
    admission = getattr(instance, "admission", None)
    ward_scope = _ward_scope_from_admission(admission) if admission else None
    if ward_scope:
        return ward_scope
    return _resolve_active_ward_scope(
        getattr(instance, "facility_id", None),
        getattr(instance, "patient_id", None),
    )


def _ward_scope_from_discharge_task(instance) -> Optional[str]:
    case = getattr(instance, "case", None)
    return _ward_scope_from_discharge_case(case) if case else None


def _facility_code_from_discharge_task(instance) -> Optional[str]:
    case = getattr(instance, "case", None)
    return _normalize_facility_code_from_obj(case) if case else None


def _ward_scope_from_board_task(instance) -> Optional[str]:
    for attr in ("ward_scope", "ward_id"):
        value = getattr(instance, attr, None)
        if value:
            return str(value)

    ward = getattr(instance, "ward", None)
    if ward and getattr(ward, "id", None):
        return str(ward.id)

    admission = getattr(instance, "admission", None)
    if admission:
        ward_scope = _ward_scope_from_admission(admission)
        if ward_scope:
            return ward_scope

    return _resolve_active_ward_scope(
        getattr(instance, "facility_id", None),
        getattr(instance, "patient_id", None),
    )


def _board_task_from_related_event(instance):
    return getattr(instance, "task", None)


def _facility_code_from_board_task_related_event(instance) -> Optional[str]:
    task = _board_task_from_related_event(instance)
    return _normalize_facility_code_from_obj(instance) or _normalize_facility_code_from_obj(task)


def _ward_scope_from_board_task_related_event(instance) -> Optional[str]:
    task = _board_task_from_related_event(instance)
    return _ward_scope_from_board_task(task) if task else None


@receiver(post_save, sender="users.PatientProfile")
@receiver(post_delete, sender="users.PatientProfile")
def invalidate_admin_dashboard_on_patient_change(sender, instance, **kwargs):
    _invalidate_admin_for_facility_code(_normalize_facility_code_from_obj(instance), "patient_changed")


@receiver(post_save, sender="wards.Bed")
@receiver(post_delete, sender="wards.Bed")
def invalidate_admin_dashboard_on_bed_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    _invalidate_admin_for_facility_code(facility_code, "bed_changed")
    current_ward_scope = _ward_scope_from_bed(instance)
    previous_ward_scope = getattr(instance, "_previous_ward_scope", None)
    _invalidate_nurse_for_facility_code(
        facility_code,
        "bed_changed",
        ward_scope=current_ward_scope,
    )
    _invalidate_ward_board_for_facility_code(
        facility_code,
        "bed_changed",
        ward_scope=current_ward_scope,
    )
    if previous_ward_scope and previous_ward_scope != current_ward_scope:
        _invalidate_nurse_for_facility_code(
            facility_code,
            "bed_changed",
            ward_scope=previous_ward_scope,
        )
        _invalidate_ward_board_for_facility_code(
            facility_code,
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
    _invalidate_ward_board_for_facility_code(
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
    _invalidate_ward_board_for_facility_code(facility_code, "admission_changed", ward_scope=current_ward_scope)
    if previous_ward_scope and previous_ward_scope != current_ward_scope:
        _invalidate_nurse_for_facility_code(facility_code, "admission_changed", ward_scope=previous_ward_scope)
        _invalidate_ward_board_for_facility_code(facility_code, "admission_changed", ward_scope=previous_ward_scope)

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
    practitioner_fhir_id = _resolve_practitioner_fhir_id_from_appointment(instance)
    if practitioner_fhir_id:
        _invalidate_doctor_for_facility_code(
            code,
            practitioner_fhir_id,
            "appointment_changed",
            include_appointments=True,
            target_date=appointment_date,
        )

    previous_practitioner_fhir_id = getattr(instance, "_previous_practitioner_fhir_id", None)
    previous_appointment_date = getattr(instance, "_previous_appointment_date", None)
    if (
        previous_practitioner_fhir_id
        and previous_appointment_date
        and (
            previous_practitioner_fhir_id != practitioner_fhir_id
            or previous_appointment_date != appointment_date
        )
    ):
        _invalidate_doctor_for_facility_code(
            code,
            previous_practitioner_fhir_id,
            "appointment_changed",
            include_appointments=True,
            target_date=previous_appointment_date,
        )

    today = timezone.localdate()
    if appointment_date == today:
        _invalidate_admin_and_reception_for_appointment_date(
            code,
            appointment_date,
            reason="appointment_changed",
        )

    if previous_appointment_date and previous_appointment_date != appointment_date and previous_appointment_date == today:
        _invalidate_admin_and_reception_for_appointment_date(
            code,
            previous_appointment_date,
            reason="appointment_changed",
        )


@receiver(pre_save, sender="appointments.Appointment")
def capture_previous_appointment_dashboard_scope(sender, instance, **kwargs):
    if not instance.pk:
        return

    previous = sender.objects.filter(pk=instance.pk).select_related("practitioner").first()
    if not previous:
        return

    previous_practitioner_fhir_id = None
    if previous.practitioner and previous.practitioner.fhir_practitioner_id:
        previous_practitioner_fhir_id = str(previous.practitioner.fhir_practitioner_id)
    if previous_practitioner_fhir_id:
        instance._previous_practitioner_fhir_id = previous_practitioner_fhir_id

    if previous.start_time:
        instance._previous_appointment_date = timezone.localtime(previous.start_time).date()


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
    _invalidate_ward_board_for_facility_code(facility_code, "alert_changed", ward_scope=ward_scope)


@receiver(post_save, sender="nursing.NursingTask")
@receiver(post_delete, sender="nursing.NursingTask")
def invalidate_nurse_dashboard_on_task_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    ward_scope = _resolve_active_ward_scope(
        getattr(instance, "facility_id", None),
        getattr(instance, "patient_id", None),
    )
    _invalidate_nurse_for_facility_code(facility_code, "task_changed", ward_scope=ward_scope)
    _invalidate_ward_board_for_facility_code(facility_code, "task_changed", ward_scope=ward_scope)


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
    _invalidate_ward_board_for_facility_code(
        facility_code,
        "medication_administration_changed",
        ward_scope=ward_scope,
    )


@receiver(post_save, sender="wards.BedAllocationLog")
@receiver(post_delete, sender="wards.BedAllocationLog")
def invalidate_ward_board_on_bed_allocation_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    ward_scope = _ward_scope_from_bed_allocation_log(instance)
    _invalidate_ward_board_for_facility_code(facility_code, "bed_allocation_changed", ward_scope=ward_scope)


@receiver(post_save, sender="wards.WardTransfer")
@receiver(post_delete, sender="wards.WardTransfer")
def invalidate_ward_board_on_transfer_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    scopes = _ward_scopes_from_transfer(instance)
    if not scopes:
        _invalidate_ward_board_for_facility_code(facility_code, "ward_transfer_changed")
        return
    for ward_scope in scopes:
        _invalidate_ward_board_for_facility_code(
            facility_code,
            "ward_transfer_changed",
            ward_scope=ward_scope,
        )


@receiver(post_save, sender="laboratory.LabOrder")
@receiver(post_delete, sender="laboratory.LabOrder")
def invalidate_ward_board_on_lab_order_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    ward_scope = _ward_scope_from_lab_order(instance)
    _invalidate_ward_board_for_facility_code(facility_code, "lab_order_changed", ward_scope=ward_scope)


@receiver(post_save, sender="laboratory.LabOrderTest")
@receiver(post_delete, sender="laboratory.LabOrderTest")
def invalidate_ward_board_on_lab_order_test_change(sender, instance, **kwargs):
    order = _lab_order_from_order_test(instance)
    facility_code = _normalize_facility_code_from_obj(instance) or _normalize_facility_code_from_obj(order)
    ward_scope = _ward_scope_from_lab_order(order) if order else None
    _invalidate_ward_board_for_facility_code(facility_code, "lab_order_changed", ward_scope=ward_scope)


@receiver(post_save, sender="laboratory.LabResult")
@receiver(post_delete, sender="laboratory.LabResult")
def invalidate_ward_board_on_lab_result_change(sender, instance, **kwargs):
    order = _lab_order_from_result(instance)
    facility_code = _normalize_facility_code_from_obj(instance) or _normalize_facility_code_from_obj(order)
    ward_scope = _ward_scope_from_lab_order(order) if order else None
    _invalidate_ward_board_for_facility_code(facility_code, "lab_result_changed", ward_scope=ward_scope)


@receiver(post_save, sender="discharge.DischargeCase")
@receiver(post_delete, sender="discharge.DischargeCase")
def invalidate_ward_board_on_discharge_case_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    ward_scope = _ward_scope_from_discharge_case(instance)
    _invalidate_ward_board_for_facility_code(facility_code, "discharge_case_changed", ward_scope=ward_scope)


@receiver(post_save, sender="discharge.DischargeTask")
@receiver(post_delete, sender="discharge.DischargeTask")
def invalidate_ward_board_on_discharge_task_change(sender, instance, **kwargs):
    facility_code = _facility_code_from_discharge_task(instance)
    ward_scope = _ward_scope_from_discharge_task(instance)
    _invalidate_ward_board_for_facility_code(facility_code, "discharge_task_changed", ward_scope=ward_scope)


def invalidate_ward_board_on_board_task_change(sender, instance, **kwargs):
    facility_code = _normalize_facility_code_from_obj(instance)
    ward_scope = _ward_scope_from_board_task(instance)
    _invalidate_ward_board_for_facility_code(facility_code, "board_task_changed", ward_scope=ward_scope)


def invalidate_ward_board_on_board_task_related_event(sender, instance, **kwargs):
    facility_code = _facility_code_from_board_task_related_event(instance)
    ward_scope = _ward_scope_from_board_task_related_event(instance)
    _invalidate_ward_board_for_facility_code(facility_code, "board_task_changed", ward_scope=ward_scope)


def _connect_optional_ward_board_model(model_name, receiver_func, dispatch_uid_prefix):
    try:
        model = apps.get_model("ward_board", model_name)
    except LookupError:
        return
    post_save.connect(
        receiver_func,
        sender=model,
        dispatch_uid=f"{dispatch_uid_prefix}.post_save",
    )
    post_delete.connect(
        receiver_func,
        sender=model,
        dispatch_uid=f"{dispatch_uid_prefix}.post_delete",
    )


_connect_optional_ward_board_model(
    "WardBoardTask",
    invalidate_ward_board_on_board_task_change,
    "dashboards.ward_board_task",
)
_connect_optional_ward_board_model(
    "WardBoardTaskEvent",
    invalidate_ward_board_on_board_task_related_event,
    "dashboards.ward_board_task_event",
)
_connect_optional_ward_board_model(
    "WardBoardAcknowledgement",
    invalidate_ward_board_on_board_task_related_event,
    "dashboards.ward_board_acknowledgement",
)
