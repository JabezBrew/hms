from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.billing.models import Invoice
from apps.billing.services import DraftInvoiceSyncService
from apps.clinical_notes.models import NoteEntry, NoteTemplate, Prescription
from apps.core.features import require_feature
from apps.discharge.models import DischargeCase, DischargeTask
from apps.laboratory.models import LabOrder, LabOrderStatus
from apps.notifications.models import InboxItem
from apps.nursing.models import NursingTask
from apps.organization.services import UnitHierarchyService
from apps.users.models import PractitionerProfile
from apps.wards.models import BedAllocationLog


CLINICAL_SUBMITTER_ROLES = {'admin', 'doctor', 'physician', 'practitioner', 'inpatient_doctor'}
BILLING_ROLES = {'admin', 'billing'}
NURSING_FINALIZER_ROLES = {'admin', 'nurse', 'head_nurse', 'nurse_practitioner'}
ADVISORY_ROLE_DEFAULTS = {
    DischargeTask.TaskType.PHARMACY_FOLLOWUP: 'pharmacist',
    DischargeTask.TaskType.LAB_FOLLOWUP: 'lab_technician',
    DischargeTask.TaskType.IMAGING: 'doctor',
    DischargeTask.TaskType.SOCIAL_WORK: 'admin',
    DischargeTask.TaskType.TRANSPORT: 'admin',
    DischargeTask.TaskType.DOCUMENTS: 'admin',
    DischargeTask.TaskType.OTHER: 'admin',
}
ROLE_ACTION_URLS = {
    'billing': '/billing/discharges',
    'nurse': '/nursing/discharges',
    'head_nurse': '/nursing/discharges',
    'nurse_practitioner': '/nursing/discharges',
    'pharmacist': '/notifications/inbox',
    'lab_technician': '/notifications/inbox',
    'admin': '/notifications/inbox',
}


def _require_enabled_feature(feature_key, facility):
    require_feature(feature_key, facility=facility)


@dataclass
class BillingSummary:
    invoice_count: int
    draft_count: int
    auto_update_count: int
    patient_balance_due: Decimal
    insurance_balance_due: Decimal
    total_balance_due: Decimal


def _coerce_datetime(value, *, fallback=None):
    if value is None:
        return fallback
    if hasattr(value, 'tzinfo'):
        return value
    if isinstance(value, str):
        parsed = parse_datetime(value)
        if parsed is not None:
            return parsed
    return fallback


def _get_user_practitioner(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    try:
        return PractitionerProfile.objects.select_related('staff__user').get(staff__user=user)
    except PractitionerProfile.DoesNotExist:
        return None


def _normalize_frequency(value):
    valid = {choice for choice, _label in Prescription.FREQUENCY_CHOICES}
    normalized = str(value or '').strip().lower()
    return normalized if normalized in valid else 'other'


def _normalize_route(value):
    valid = {choice for choice, _label in Prescription.ROUTE_CHOICES}
    normalized = str(value or '').strip().lower()
    return normalized if normalized in valid else 'oral'


def _build_note_data(*, discharge_summary, follow_up_appointments, medical_ready_at, admission_id):
    return {
        'Discharge Summary': discharge_summary or '',
        'Follow-up Instructions': follow_up_appointments or '',
        '_metadata': {
            'discharge_date': medical_ready_at.isoformat() if medical_ready_at else None,
            'admission_id': str(admission_id) if admission_id else None,
        },
    }


def _get_or_create_discharge_template(facility):
    template = NoteTemplate.objects.filter(
        facility=facility,
        category='discharge',
        is_active=True,
    ).first()
    if template:
        return template
    return NoteTemplate.objects.create(
        facility=facility,
        title='Discharge Summary',
        category='discharge',
        visibility='public',
        is_active=True,
        structure={
            'sections': [
                {'name': 'Discharge Summary', 'type': 'text'},
                {'name': 'Follow-up Instructions', 'type': 'text'},
            ]
        },
    )


def _task_title(task: DischargeTask) -> str:
    return f"{task.case.patient.user.get_full_name()} · {task.get_task_type_display()}"


def _task_summary(task: DischargeTask) -> str:
    snapshot = task.snapshot or {}
    if task.task_type == DischargeTask.TaskType.BILLING_CLEARANCE:
        patient_due = snapshot.get('patient_balance_due')
        invoice_count = snapshot.get('invoice_count')
        return f"Invoices: {invoice_count or 0} · Patient due: {patient_due or '0.00'}"
    if task.task_type == DischargeTask.TaskType.PHARMACY_FOLLOWUP:
        return f"Take-home medications: {snapshot.get('prescription_count', 0)}"
    if task.task_type == DischargeTask.TaskType.LAB_FOLLOWUP:
        return f"Unresolved lab items: {snapshot.get('open_order_count', 0)}"
    if task.notes:
        return task.notes[:200]
    return task.get_task_type_display()


def _task_action_url(task: DischargeTask) -> str:
    base = ROLE_ACTION_URLS.get(task.assigned_role) or '/notifications/inbox'
    separator = '&' if '?' in base else '?'
    return f"{base}{separator}case={task.case_id}"


def sync_discharge_task_inbox_item(task: DischargeTask) -> None:
    if not task.assigned_role:
        return

    status_map = {
        DischargeTask.Status.PENDING: InboxItem.ItemStatus.UNREAD,
        DischargeTask.Status.COMPLETED: InboxItem.ItemStatus.DONE,
        DischargeTask.Status.NOT_REQUIRED: InboxItem.ItemStatus.DISMISSED,
        DischargeTask.Status.ACKNOWLEDGED_UNRESOLVED: InboxItem.ItemStatus.ACKNOWLEDGED,
        DischargeTask.Status.CANCELLED: InboxItem.ItemStatus.DISMISSED,
    }
    inbox_status = status_map.get(task.status, InboxItem.ItemStatus.UNREAD)
    is_action_required = task.status == DischargeTask.Status.PENDING
    is_read = inbox_status in {
        InboxItem.ItemStatus.DONE,
        InboxItem.ItemStatus.DISMISSED,
        InboxItem.ItemStatus.ACKNOWLEDGED,
    }

    InboxItem.objects.update_or_create(
        facility=task.case.facility,
        recipient_role=task.assigned_role,
        recipient_user=None,
        source_type=InboxItem.SourceType.DISCHARGE,
        source_id=task.id,
        dedupe_key=f"discharge_task:{task.id}:{task.assigned_role}",
        defaults={
            'patient': task.case.patient,
            'title': _task_title(task),
            'summary': _task_summary(task),
            'action_url': _task_action_url(task),
            'priority': InboxItem.PriorityLevel.URGENT if task.blocking else InboxItem.PriorityLevel.NORMAL,
            'status': inbox_status,
            'is_action_required': is_action_required,
            'is_read': is_read,
            'occurred_at': task.completed_at or task.acknowledged_at or task.updated_at or timezone.now(),
        },
    )


def _serialize_prescription_snapshot(prescriptions):
    names = [rx.medication_name for rx in prescriptions if rx.medication_name]
    return {
        'prescription_count': len(prescriptions),
        'medications': names[:10],
    }


def _lab_followup_snapshot(admission):
    order_qs = LabOrder.objects.filter(
        facility=admission.facility,
        patient=admission.patient,
        ordered_at__gte=admission.admission_date,
    ).prefetch_related('order_tests__result')

    if getattr(admission, 'encounter', None):
        order_qs = order_qs.filter(encounter=admission.encounter)

    open_orders = []
    unverified_results = 0
    for order in order_qs:
        if order.status not in {LabOrderStatus.COMPLETED, LabOrderStatus.CANCELLED}:
            open_orders.append(order.order_number)
            continue
        for order_test in order.order_tests.all():
            result = getattr(order_test, 'result', None)
            if result and not result.is_verified:
                unverified_results += 1

    return {
        'open_order_count': len(open_orders),
        'open_orders': open_orders[:10],
        'unverified_result_count': unverified_results,
    }


def _ensure_task(
    case: DischargeCase,
    *,
    task_type: str,
    assigned_role: str,
    blocking: bool,
    notes: str = '',
    snapshot: dict | None = None,
    status: str | None = None,
    actor=None,
):
    defaults = {
        'assigned_role': assigned_role or '',
        'blocking': blocking,
        'notes': notes or '',
        'snapshot': snapshot or {},
    }
    if status:
        defaults['status'] = status
        if status in {DischargeTask.Status.PENDING, DischargeTask.Status.NOT_REQUIRED}:
            defaults['completed_by'] = None
            defaults['completed_at'] = None
            defaults['acknowledged_by'] = None
            defaults['acknowledged_at'] = None
    if actor:
        defaults['created_by'] = actor
    task, _created = DischargeTask.objects.update_or_create(
        case=case,
        task_type=task_type,
        defaults=defaults,
    )
    sync_discharge_task_inbox_item(task)
    return task


def _active_billing_task(case: DischargeCase):
    return case.tasks.get(task_type=DischargeTask.TaskType.BILLING_CLEARANCE)


def _active_nursing_task(case: DischargeCase):
    return case.tasks.get(task_type=DischargeTask.TaskType.NURSING_FINALIZATION)


def get_advisory_tasks(case: DischargeCase):
    return case.tasks.filter(blocking=False).order_by('task_type')


def get_unresolved_advisory_tasks(case: DischargeCase):
    return get_advisory_tasks(case).filter(status=DischargeTask.Status.PENDING)


def update_case_status(case: DischargeCase) -> DischargeCase:
    if case.finalized_at:
        next_status = DischargeCase.Status.FINALIZED
    elif case.status == DischargeCase.Status.CANCELLED:
        next_status = DischargeCase.Status.CANCELLED
    elif case.status == DischargeCase.Status.REOPENED:
        next_status = DischargeCase.Status.REOPENED
    else:
        billing_task = case.tasks.filter(task_type=DischargeTask.TaskType.BILLING_CLEARANCE).first()
        if billing_task and billing_task.status == DischargeTask.Status.COMPLETED:
            next_status = DischargeCase.Status.READY_FOR_FINALIZATION
        else:
            next_status = DischargeCase.Status.AWAITING_CLEARANCE

    if case.status != next_status:
        case.status = next_status
        case.save(update_fields=['status', 'updated_at'])
    return case


def build_billing_summary(case: DischargeCase) -> BillingSummary:
    prefetched = getattr(case.admission, '_prefetched_objects_cache', {})
    if 'invoices' in prefetched:
        invoices = sorted(prefetched['invoices'], key=lambda invoice: invoice.created_at)
    else:
        invoices = list(
            case.admission.invoices.prefetch_related('payments').all().order_by('created_at')
        )
    patient_balance_due = sum((invoice.patient_balance_due for invoice in invoices), Decimal('0.00'))
    insurance_balance_due = sum((invoice.insurance_balance_due for invoice in invoices), Decimal('0.00'))
    total_balance_due = sum((invoice.total_balance_due for invoice in invoices), Decimal('0.00'))
    draft_count = sum(1 for invoice in invoices if invoice.status == 'draft')
    auto_update_count = sum(1 for invoice in invoices if invoice.auto_update_enabled)
    return BillingSummary(
        invoice_count=len(invoices),
        draft_count=draft_count,
        auto_update_count=auto_update_count,
        patient_balance_due=patient_balance_due,
        insurance_balance_due=insurance_balance_due,
        total_balance_due=total_balance_due,
    )


def _sync_billing_task_snapshot(case: DischargeCase):
    summary = build_billing_summary(case)
    task = _ensure_task(
        case,
        task_type=DischargeTask.TaskType.BILLING_CLEARANCE,
        assigned_role='billing',
        blocking=True,
        status=DischargeTask.Status.PENDING,
        snapshot={
            'invoice_count': summary.invoice_count,
            'draft_count': summary.draft_count,
            'auto_update_count': summary.auto_update_count,
            'patient_balance_due': str(summary.patient_balance_due),
            'insurance_balance_due': str(summary.insurance_balance_due),
            'total_balance_due': str(summary.total_balance_due),
        },
    )
    return task


@transaction.atomic
def submit_medical_discharge(
    *,
    admission,
    workflow,
    actor,
    medical_ready_at,
    discharge_disposition='',
    discharge_summary='',
    follow_up_appointments='',
    discharge_prescriptions=None,
    notes_snapshot=None,
):
    _require_enabled_feature('discharge_workflows', admission.facility)
    _require_enabled_feature('nursing_workflows', admission.facility)
    practitioner = _get_user_practitioner(actor)
    if practitioner is None:
        practitioner = admission.admitting_doctor
    encounter = getattr(admission, 'encounter', None)
    if encounter is None:
        from apps.encounters.services import get_or_create_active_encounter

        encounter, _ = get_or_create_active_encounter(
            patient=admission.patient,
            practitioner=practitioner,
            encounter_type='inpatient',
            reason='Medical discharge',
            created_by=actor,
        )

    case, _created = DischargeCase.objects.update_or_create(
        admission=admission,
        defaults={
            'facility': admission.facility,
            'patient': admission.patient,
            'encounter': encounter,
            'workflow': workflow,
            'medical_ready_at': medical_ready_at,
            'billing_cutoff_at': medical_ready_at,
            'finalized_at': None,
            'status': DischargeCase.Status.AWAITING_CLEARANCE,
            'discharge_disposition': discharge_disposition or '',
            'submitted_by': actor,
            'cancelled_by': None,
            'cancelled_at': None,
            'cancel_reason': '',
            'reopened_by': None,
            'reopened_at': None,
            'metadata': notes_snapshot or {},
        },
    )

    if practitioner is None:
        raise ValueError('A practitioner profile is required to submit medical discharge.')

    template = _get_or_create_discharge_template(admission.facility)
    note = case.discharge_note
    note_defaults = {
        'template': template,
        'patient': admission.patient,
        'facility': admission.facility,
        'encounter': encounter,
        'practitioner': practitioner,
        'data': _build_note_data(
            discharge_summary=discharge_summary,
            follow_up_appointments=follow_up_appointments,
            medical_ready_at=medical_ready_at,
            admission_id=admission.id,
        ),
    }
    if note:
        for key, value in note_defaults.items():
            setattr(note, key, value)
        note.save()
    else:
        note = NoteEntry.objects.create(**note_defaults)

    case.discharge_note = note
    case.save(update_fields=['discharge_note', 'updated_at'])

    Prescription.objects.filter(discharge_case=case).delete()
    created_prescriptions = []
    for prescription_data in discharge_prescriptions or []:
        medication_name = str(prescription_data.get('medication_name') or '').strip()
        if not medication_name:
            continue
        created_prescriptions.append(
            Prescription.objects.create(
                patient=admission.patient,
                facility=admission.facility,
                prescribed_by=practitioner,
                encounter=encounter,
                discharge_case=case,
                medication_name=medication_name,
                dosage=str(prescription_data.get('dosage') or '').strip(),
                frequency=_normalize_frequency(prescription_data.get('frequency')),
                route=_normalize_route(prescription_data.get('route')),
                instructions=str(prescription_data.get('instructions') or '').strip(),
                reason='Discharge medication',
                status='active',
            )
        )

    admission.status = 'pending_discharge'
    admission.discharge_notes = discharge_summary or admission.discharge_notes
    admission.actual_discharge_date = None
    admission.save(update_fields=['status', 'discharge_notes', 'actual_discharge_date', 'updated_at'])

    billing_service = DraftInvoiceSyncService()
    billing_service.freeze_admission_invoice(
        admission=admission,
        cutoff_at=medical_ready_at,
        actor=actor,
    )

    _sync_billing_task_snapshot(case)
    _ensure_task(
        case,
        task_type=DischargeTask.TaskType.NURSING_FINALIZATION,
        assigned_role='nurse',
        blocking=True,
        status=DischargeTask.Status.PENDING,
        notes='Finalize physical discharge after billing clears.',
    )

    pharmacy_status = DischargeTask.Status.PENDING if created_prescriptions else DischargeTask.Status.NOT_REQUIRED
    _ensure_task(
        case,
        task_type=DischargeTask.TaskType.PHARMACY_FOLLOWUP,
        assigned_role='pharmacist',
        blocking=False,
        snapshot=_serialize_prescription_snapshot(created_prescriptions),
        status=pharmacy_status,
    )

    lab_snapshot = _lab_followup_snapshot(admission)
    lab_status = (
        DischargeTask.Status.PENDING
        if lab_snapshot['open_order_count'] or lab_snapshot['unverified_result_count']
        else DischargeTask.Status.NOT_REQUIRED
    )
    _ensure_task(
        case,
        task_type=DischargeTask.TaskType.LAB_FOLLOWUP,
        assigned_role='lab_technician',
        blocking=False,
        snapshot=lab_snapshot,
        status=lab_status,
    )

    nursing_practitioner = None
    if admission.bed and getattr(admission.bed.ward, 'head_nurse', None):
        nursing_practitioner = admission.bed.ward.head_nurse
    nursing_task = case.nursing_task
    if nursing_task:
        nursing_task.patient = admission.patient
        nursing_task.facility = admission.facility
        nursing_task.task_type = 'discharge'
        nursing_task.description = 'Finalize discharge after billing clearance.'
        nursing_task.scheduled_time = medical_ready_at
        nursing_task.assigned_to = nursing_practitioner
        nursing_task.priority = 'high'
        nursing_task.status = 'pending'
        nursing_task.completion_notes = ''
        nursing_task.completed_time = None
        nursing_task.completed_by = None
        nursing_task.save()
    else:
        nursing_task = NursingTask.objects.create(
            patient=admission.patient,
            facility=admission.facility,
            task_type='discharge',
            description='Finalize discharge after billing clearance.',
            scheduled_time=medical_ready_at,
            assigned_to=nursing_practitioner,
            priority='high',
            status='pending',
            created_by=actor,
        )
    case.nursing_task = nursing_task
    case.save(update_fields=['nursing_task', 'updated_at'])

    update_case_status(case)
    return case


@transaction.atomic
def submit_legacy_discharge(*, admission, actor, discharge_notes=''):
    medical_ready_at = timezone.now()
    return submit_medical_discharge(
        admission=admission,
        workflow=None,
        actor=actor,
        medical_ready_at=medical_ready_at,
        discharge_disposition='home',
        discharge_summary=discharge_notes or '',
        follow_up_appointments='',
        discharge_prescriptions=[],
        notes_snapshot={'legacy_submission': True},
    )


@transaction.atomic
def update_billing_cutoff(*, case: DischargeCase, actor, billing_cutoff_at):
    if case.status == DischargeCase.Status.FINALIZED:
        raise ValueError('Cannot change billing cutoff after finalization.')

    billing_task = _active_billing_task(case)
    if billing_task.status == DischargeTask.Status.COMPLETED:
        raise ValueError('Billing cutoff is locked after billing clearance.')

    if case.admission.invoices.filter(payments__status='posted', payments__payer='patient').exists():
        raise ValueError('Billing cutoff is locked after patient payment is posted.')

    if billing_cutoff_at < case.admission.admission_date:
        raise ValueError('Billing cutoff cannot be earlier than admission time.')

    case.billing_cutoff_at = billing_cutoff_at
    case.save(update_fields=['billing_cutoff_at', 'updated_at'])
    DraftInvoiceSyncService().freeze_admission_invoice(
        admission=case.admission,
        cutoff_at=billing_cutoff_at,
        actor=actor,
    )
    _sync_billing_task_snapshot(case)
    return update_case_status(case)


@transaction.atomic
def clear_billing(*, case: DischargeCase, actor):
    summary = build_billing_summary(case)
    if summary.auto_update_count > 0 or summary.draft_count > 0:
        raise ValueError('All admission-linked invoices must be finalized before billing clearance.')
    if summary.patient_balance_due > Decimal('0.00'):
        raise ValueError('Patient balance must be settled before billing clearance.')

    task = _active_billing_task(case)
    task.status = DischargeTask.Status.COMPLETED
    task.snapshot = {
        'invoice_count': summary.invoice_count,
        'draft_count': summary.draft_count,
        'auto_update_count': summary.auto_update_count,
        'patient_balance_due': str(summary.patient_balance_due),
        'insurance_balance_due': str(summary.insurance_balance_due),
        'total_balance_due': str(summary.total_balance_due),
        'cleared_at': timezone.now().isoformat(),
    }
    task.completed_by = actor
    task.completed_at = timezone.now()
    task.save(update_fields=['status', 'snapshot', 'completed_by', 'completed_at', 'updated_at'])
    sync_discharge_task_inbox_item(task)
    return update_case_status(case)


@transaction.atomic
def add_advisory_task(*, case: DischargeCase, actor, task_type: str, assigned_role: str | None, notes: str = '', snapshot=None):
    if task_type in {
        DischargeTask.TaskType.BILLING_CLEARANCE,
        DischargeTask.TaskType.NURSING_FINALIZATION,
    }:
        raise ValueError('Blocking tasks cannot be created from the advisory task endpoint.')
    role = assigned_role or ADVISORY_ROLE_DEFAULTS.get(task_type) or 'admin'
    task = _ensure_task(
        case,
        task_type=task_type,
        assigned_role=role,
        blocking=False,
        notes=notes,
        snapshot=snapshot or {},
        status=DischargeTask.Status.PENDING,
        actor=actor,
    )
    return task


@transaction.atomic
def complete_advisory_task(*, task: DischargeTask, actor, notes=''):
    if task.blocking:
        raise ValueError('Blocking tasks are completed through their dedicated actions.')
    task.status = DischargeTask.Status.COMPLETED
    task.notes = notes or task.notes
    task.completed_by = actor
    task.completed_at = timezone.now()
    task.save(update_fields=['status', 'notes', 'completed_by', 'completed_at', 'updated_at'])
    sync_discharge_task_inbox_item(task)
    return update_case_status(task.case)


@transaction.atomic
def acknowledge_task(*, task: DischargeTask, actor, notes=''):
    if task.blocking:
        raise ValueError('Blocking tasks cannot be acknowledged as unresolved.')
    task.status = DischargeTask.Status.ACKNOWLEDGED_UNRESOLVED
    task.notes = notes or task.notes
    task.acknowledged_by = actor
    task.acknowledged_at = timezone.now()
    task.save(update_fields=['status', 'notes', 'acknowledged_by', 'acknowledged_at', 'updated_at'])
    sync_discharge_task_inbox_item(task)
    return update_case_status(task.case)


@transaction.atomic
def finalize_discharge(*, case: DischargeCase, actor, finalized_at=None, acknowledge_task_ids=None):
    _require_enabled_feature('bed_management', case.facility)
    _require_enabled_feature('discharge_workflows', case.facility)
    _require_enabled_feature('nursing_workflows', case.facility)
    if case.status == DischargeCase.Status.FINALIZED:
        raise ValueError('Discharge has already been finalized.')
    if case.status == DischargeCase.Status.CANCELLED:
        raise ValueError('Cancelled discharge cases must be resubmitted before finalization.')
    if case.admission.status != 'pending_discharge':
        raise ValueError(f"Admission must be pending discharge before finalization. Current status: {case.admission.status}.")

    billing_task = _active_billing_task(case)
    if billing_task.status != DischargeTask.Status.COMPLETED:
        raise ValueError('Billing clearance is required before nursing finalization.')

    unresolved = list(get_unresolved_advisory_tasks(case))
    acknowledge_ids = {str(task_id) for task_id in (acknowledge_task_ids or [])}
    if unresolved:
        unresolved_ids = {str(task.id) for task in unresolved}
        if unresolved_ids != acknowledge_ids:
            raise ValueError('All unresolved advisory tasks must be explicitly acknowledged before finalization.')
        acknowledged_at = timezone.now()
        for task in unresolved:
            task.status = DischargeTask.Status.ACKNOWLEDGED_UNRESOLVED
            task.acknowledged_by = actor
            task.acknowledged_at = acknowledged_at
            task.save(update_fields=['status', 'acknowledged_by', 'acknowledged_at', 'updated_at'])
            sync_discharge_task_inbox_item(task)

    finalized_at = _coerce_datetime(finalized_at, fallback=timezone.now())
    admission = case.admission
    previous_bed_status = admission.bed.status if admission.bed else None
    admission.discharge_patient(
        discharge_notes=admission.discharge_notes,
        discharge_at=finalized_at,
    )
    if case.encounter:
        case.encounter.finish(
            end_time=finalized_at,
            discharge_disposition=case.discharge_disposition,
        )
    if admission.bed and previous_bed_status:
        BedAllocationLog.objects.create(
            bed=admission.bed,
            facility=admission.facility,
            previous_status=previous_bed_status,
            new_status='available',
            admission=admission,
            notes='Patient discharged from ward after multidisciplinary clearance.',
            created_by=actor,
        )

    if case.nursing_task:
        practitioner = _get_user_practitioner(actor)
        case.nursing_task.status = 'completed'
        case.nursing_task.completed_time = finalized_at
        case.nursing_task.completed_by = practitioner
        case.nursing_task.completion_notes = 'Ward discharge finalized.'
        case.nursing_task.save(update_fields=['status', 'completed_time', 'completed_by', 'completion_notes', 'updated_at'])

    nursing_task = _active_nursing_task(case)
    nursing_task.status = DischargeTask.Status.COMPLETED
    nursing_task.completed_by = actor
    nursing_task.completed_at = finalized_at
    nursing_task.save(update_fields=['status', 'completed_by', 'completed_at', 'updated_at'])
    sync_discharge_task_inbox_item(nursing_task)

    case.finalized_at = finalized_at
    case.status = DischargeCase.Status.FINALIZED
    case.save(update_fields=['finalized_at', 'status', 'updated_at'])
    return case


@transaction.atomic
def cancel_discharge_case(*, case: DischargeCase, actor, reason=''):
    if case.status == DischargeCase.Status.FINALIZED:
        raise ValueError('Finalized discharge cases cannot be cancelled.')

    case.status = DischargeCase.Status.CANCELLED
    case.cancelled_by = actor
    case.cancelled_at = timezone.now()
    case.cancel_reason = reason or ''
    case.save(update_fields=['status', 'cancelled_by', 'cancelled_at', 'cancel_reason', 'updated_at'])

    admission = case.admission
    admission.status = 'admitted'
    admission.actual_discharge_date = None
    admission.save(update_fields=['status', 'actual_discharge_date', 'updated_at'])
    DraftInvoiceSyncService().reopen_admission_invoice(admission=admission, actor=actor)

    case.tasks.update(status=DischargeTask.Status.CANCELLED)
    for task in case.tasks.all():
        sync_discharge_task_inbox_item(task)

    if case.nursing_task and case.nursing_task.status != 'completed':
        case.nursing_task.status = 'cancelled'
        case.nursing_task.save(update_fields=['status', 'updated_at'])

    return case


@transaction.atomic
def reopen_discharge_case(*, case: DischargeCase, actor):
    if case.status == DischargeCase.Status.FINALIZED:
        raise ValueError('Finalized discharge cases cannot be reopened.')

    case.status = DischargeCase.Status.REOPENED
    case.reopened_by = actor
    case.reopened_at = timezone.now()
    case.finalized_at = None
    case.cancelled_by = None
    case.cancelled_at = None
    case.cancel_reason = ''
    case.save(update_fields=[
        'status',
        'reopened_by',
        'reopened_at',
        'finalized_at',
        'cancelled_by',
        'cancelled_at',
        'cancel_reason',
        'updated_at',
    ])

    admission = case.admission
    admission.status = 'admitted'
    admission.actual_discharge_date = None
    admission.save(update_fields=['status', 'actual_discharge_date', 'updated_at'])
    DraftInvoiceSyncService().reopen_admission_invoice(admission=admission, actor=actor)

    case.tasks.filter(blocking=True).update(status=DischargeTask.Status.PENDING, completed_by=None, completed_at=None)
    case.tasks.filter(blocking=False).exclude(
        task_type__in=[DischargeTask.TaskType.PHARMACY_FOLLOWUP, DischargeTask.TaskType.LAB_FOLLOWUP]
    ).update(status=DischargeTask.Status.PENDING)
    for task in case.tasks.all():
        sync_discharge_task_inbox_item(task)

    if case.nursing_task and case.nursing_task.status != 'completed':
        case.nursing_task.status = 'pending'
        case.nursing_task.completed_time = None
        case.nursing_task.completed_by = None
        case.nursing_task.completion_notes = ''
        case.nursing_task.save(update_fields=['status', 'completed_time', 'completed_by', 'completion_notes', 'updated_at'])

    return case
