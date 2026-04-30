from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.admissions.models import AdmissionCase, AdmissionTask, BedReservation
from apps.billing.models import FacilityBillingSettings
from apps.clinical_notes.models import NoteEntry, NoteTemplate
from apps.core.features import require_feature
from apps.core.security import ACTIVE_ADMISSION_STATUSES
from apps.encounters.models import Encounter
from apps.notifications.models import InboxItem
from apps.organization.services import UnitHierarchyService
from apps.wards.models import Admission, BedAllocationLog


CLINICAL_REQUESTER_ROLES = {'admin', 'doctor', 'physician', 'practitioner', 'inpatient_doctor'}
REGISTRATION_ROLES = {'admin', 'receptionist'}
PLACEMENT_ROLES = {'admin', 'head_nurse', 'nurse', 'nurse_practitioner'}
FINANCIAL_ROLES = {'admin', 'billing'}
NURSING_ROLES = {'admin', 'nurse', 'head_nurse', 'nurse_practitioner'}
ADVISORY_ROLE_DEFAULTS = {
    AdmissionTask.TaskType.PHARMACY_MED_REC: 'pharmacist',
    AdmissionTask.TaskType.BASELINE_LAB_FOLLOWUP: 'lab_technician',
    AdmissionTask.TaskType.INFECTION_CONTROL: 'nurse',
    AdmissionTask.TaskType.DIETARY: 'admin',
    AdmissionTask.TaskType.SOCIAL_WORK: 'admin',
    AdmissionTask.TaskType.TRANSPORT: 'admin',
    AdmissionTask.TaskType.DOCUMENTS: 'admin',
    AdmissionTask.TaskType.OTHER: 'admin',
}
ROLE_ACTION_URLS = {
    'billing': '/billing/admissions',
    'receptionist': '/admissions/requests',
    'nurse': '/nursing/admissions',
    'head_nurse': '/nursing/admissions',
    'nurse_practitioner': '/nursing/admissions',
    'pharmacist': '/notifications/inbox',
    'lab_technician': '/notifications/inbox',
    'admin': '/notifications/inbox',
}


def _require_enabled_feature(feature_key, facility):
    require_feature(feature_key, facility=facility)


@dataclass
class FinancialRequirement:
    required: bool
    minimum_amount: Decimal
    minimum_percentage: Decimal


def _coerce_datetime(value):
    if value is None:
        return None
    if hasattr(value, 'tzinfo'):
        return value
    if isinstance(value, str):
        return parse_datetime(value)
    return None


def _task_title(task: AdmissionTask) -> str:
    return f"{task.case.patient.user.get_full_name()} · {task.get_task_type_display()}"


def _task_summary(task: AdmissionTask) -> str:
    snapshot = task.snapshot or {}
    if task.task_type == AdmissionTask.TaskType.FINANCIAL_CLEARANCE:
        amount = snapshot.get('minimum_amount') or '0.00'
        pct = snapshot.get('minimum_percentage') or '0.00'
        return f"Deposit required: {amount} · {pct}% minimum"
    if task.task_type == AdmissionTask.TaskType.PLACEMENT:
        return snapshot.get('bed_label') or 'Bed assignment pending'
    if task.task_type == AdmissionTask.TaskType.REGISTRATION_COMPLETION:
        missing = snapshot.get('missing_fields') or []
        if missing:
            return f"Missing: {', '.join(missing)}"
    if task.notes:
        return task.notes[:200]
    return task.get_task_type_display()


def _task_action_url(task: AdmissionTask) -> str:
    base = ROLE_ACTION_URLS.get(task.assigned_role) or '/notifications/inbox'
    separator = '&' if '?' in base else '?'
    return f"{base}{separator}case={task.case_id}"


def sync_admission_task_inbox_item(task: AdmissionTask) -> None:
    if not task.assigned_role:
        return

    status_map = {
        AdmissionTask.Status.PENDING: InboxItem.ItemStatus.UNREAD,
        AdmissionTask.Status.COMPLETED: InboxItem.ItemStatus.DONE,
        AdmissionTask.Status.NOT_REQUIRED: InboxItem.ItemStatus.DISMISSED,
        AdmissionTask.Status.ACKNOWLEDGED_UNRESOLVED: InboxItem.ItemStatus.ACKNOWLEDGED,
        AdmissionTask.Status.CANCELLED: InboxItem.ItemStatus.DISMISSED,
    }
    inbox_status = status_map.get(task.status, InboxItem.ItemStatus.UNREAD)
    is_read = inbox_status in {
        InboxItem.ItemStatus.DONE,
        InboxItem.ItemStatus.DISMISSED,
        InboxItem.ItemStatus.ACKNOWLEDGED,
    }

    InboxItem.objects.update_or_create(
        facility=task.case.facility,
        recipient_role=task.assigned_role,
        recipient_user=None,
        source_type=InboxItem.SourceType.ADMISSION,
        source_id=task.id,
        dedupe_key=f"admission_task:{task.id}:{task.assigned_role}",
        defaults={
            'patient': task.case.patient,
            'title': _task_title(task),
            'summary': _task_summary(task),
            'action_url': _task_action_url(task),
            'priority': InboxItem.PriorityLevel.URGENT if task.blocking else InboxItem.PriorityLevel.NORMAL,
            'status': inbox_status,
            'is_action_required': task.status == AdmissionTask.Status.PENDING,
            'is_read': is_read,
            'occurred_at': task.completed_at or task.acknowledged_at or task.updated_at or timezone.now(),
        },
    )


def _ensure_task(
    case: AdmissionCase,
    *,
    task_type: str,
    phase: str,
    assigned_role: str,
    blocking: bool,
    notes: str = '',
    snapshot: dict | None = None,
    status: str | None = None,
    actor=None,
):
    defaults = {
        'phase': phase,
        'assigned_role': assigned_role or '',
        'blocking': blocking,
        'notes': notes or '',
        'snapshot': snapshot or {},
    }
    if actor:
        defaults['created_by'] = actor
    if status:
        defaults['status'] = status
        if status in {AdmissionTask.Status.PENDING, AdmissionTask.Status.NOT_REQUIRED}:
            defaults['completed_by'] = None
            defaults['completed_at'] = None
            defaults['acknowledged_by'] = None
            defaults['acknowledged_at'] = None
    task, _ = AdmissionTask.objects.update_or_create(
        case=case,
        task_type=task_type,
        defaults=defaults,
    )
    sync_admission_task_inbox_item(task)
    return task


def _preserve_completed_status(case: AdmissionCase, task_type: str, calculated_status: str) -> str:
    existing_status = case.tasks.filter(task_type=task_type).values_list('status', flat=True).first()
    if existing_status == AdmissionTask.Status.COMPLETED:
        return AdmissionTask.Status.COMPLETED
    if existing_status == AdmissionTask.Status.ACKNOWLEDGED_UNRESOLVED:
        return AdmissionTask.Status.ACKNOWLEDGED_UNRESOLVED
    return calculated_status


def _registration_snapshot(case: AdmissionCase) -> dict:
    patient = case.patient
    user = patient.user
    missing = []
    if not getattr(user, 'first_name', '').strip():
        missing.append('first_name')
    if not getattr(user, 'last_name', '').strip():
        missing.append('last_name')
    if not getattr(patient, 'medical_record_number', '').strip():
        missing.append('mrn')
    return {'missing_fields': missing}


def _registration_complete(case: AdmissionCase) -> bool:
    return len(_registration_snapshot(case)['missing_fields']) == 0


def _financial_requirement(case: AdmissionCase) -> FinancialRequirement:
    try:
        settings = FacilityBillingSettings.objects.get(facility=case.facility)
    except FacilityBillingSettings.DoesNotExist:
        return FinancialRequirement(False, Decimal('0.00'), Decimal('0.00'))
    return FinancialRequirement(
        required=bool(settings.require_deposit_for_admission),
        minimum_amount=settings.minimum_deposit_amount,
        minimum_percentage=settings.minimum_deposit_percentage,
    )


def _current_reservation(case: AdmissionCase):
    return case.bed_reservations.filter(status=BedReservation.Status.ACTIVE).select_related('bed__ward').first()


def _medical_order_snapshot(case: AdmissionCase) -> dict:
    draft = case.draft_payload or {}
    summary = (
        draft.get('admission_notes')
        or draft.get('admission_reason')
        or draft.get('chief_complaint')
        or ''
    ).strip()
    return {
        'admission_type': case.requested_admission_type,
        'summary_present': bool(summary),
    }


def _medical_order_ready(case: AdmissionCase) -> bool:
    snapshot = _medical_order_snapshot(case)
    return bool(snapshot['admission_type'])


def _placement_snapshot(case: AdmissionCase) -> dict:
    reservation = _current_reservation(case)
    bed = reservation.bed if reservation else case.requested_bed
    if not bed:
        return {}
    return {
        'bed_id': str(bed.id),
        'bed_number': bed.bed_number,
        'ward_id': str(bed.ward_id),
        'ward_name': bed.ward.name,
        'bed_label': f"{bed.ward.name} · Bed {bed.bed_number}",
    }


def _admission_documentation_ready(case: AdmissionCase) -> bool:
    draft = case.draft_payload or {}
    return bool((draft.get('admission_note') or '').strip())


def _get_or_create_admission_template(facility):
    template = NoteTemplate.objects.filter(
        facility=facility,
        category='admission',
        is_active=True,
    ).first()
    if template:
        return template
    return NoteTemplate.objects.create(
        facility=facility,
        title='Admission Note',
        category='admission',
        visibility='public',
        is_active=True,
        structure={
            'sections': [
                {'name': 'Admission Reason', 'type': 'text'},
                {'name': 'Admission Note', 'type': 'text'},
            ]
        },
    )


def _maybe_create_admission_note(case: AdmissionCase, encounter: Encounter):
    draft = case.draft_payload or {}
    note_text = (draft.get('admission_note') or '').strip()
    if not note_text:
        return None
    practitioner = case.admitting_practitioner
    if not practitioner:
        return None

    template = _get_or_create_admission_template(case.facility)
    return NoteEntry.objects.create(
        template=template,
        patient=case.patient,
        facility=case.facility,
        encounter=encounter,
        practitioner=practitioner,
        data={
            'Admission Reason': (draft.get('admission_notes') or draft.get('admission_reason') or '').strip(),
            'Admission Note': note_text,
            '_metadata': {
                'admission_case_id': str(case.id),
                'admission_source': case.admission_source,
            },
        },
    )


def sync_case_tasks(case: AdmissionCase, *, actor=None):
    medical_status = _preserve_completed_status(
        case,
        AdmissionTask.TaskType.MEDICAL_ADMISSION_ORDER,
        (
        AdmissionTask.Status.COMPLETED
        if _medical_order_ready(case)
        else AdmissionTask.Status.PENDING
        ),
    )
    _ensure_task(
        case,
        task_type=AdmissionTask.TaskType.MEDICAL_ADMISSION_ORDER,
        phase=AdmissionTask.Phase.PRE_ACTIVATION,
        assigned_role='doctor',
        blocking=True,
        snapshot=_medical_order_snapshot(case),
        status=medical_status,
        actor=actor,
    )

    placement_status = (
        AdmissionTask.Status.COMPLETED
        if case.admission_id or _current_reservation(case)
        else AdmissionTask.Status.PENDING
    )
    _ensure_task(
        case,
        task_type=AdmissionTask.TaskType.PLACEMENT,
        phase=AdmissionTask.Phase.PRE_ACTIVATION,
        assigned_role='nurse',
        blocking=True,
        snapshot=_placement_snapshot(case),
        status=placement_status,
        actor=actor,
    )

    registration_snapshot = _registration_snapshot(case)
    registration_status = _preserve_completed_status(
        case,
        AdmissionTask.TaskType.REGISTRATION_COMPLETION,
        (
        AdmissionTask.Status.NOT_REQUIRED
        if _registration_complete(case)
        else AdmissionTask.Status.PENDING
        ),
    )
    _ensure_task(
        case,
        task_type=AdmissionTask.TaskType.REGISTRATION_COMPLETION,
        phase=AdmissionTask.Phase.PRE_ACTIVATION,
        assigned_role='receptionist',
        blocking=True,
        snapshot=registration_snapshot,
        status=registration_status,
        actor=actor,
    )

    financial_requirement = _financial_requirement(case)
    financial_status = _preserve_completed_status(
        case,
        AdmissionTask.TaskType.FINANCIAL_CLEARANCE,
        (
        AdmissionTask.Status.NOT_REQUIRED
        if not financial_requirement.required
        else AdmissionTask.Status.PENDING
        ),
    )
    _ensure_task(
        case,
        task_type=AdmissionTask.TaskType.FINANCIAL_CLEARANCE,
        phase=AdmissionTask.Phase.PRE_ACTIVATION,
        assigned_role='billing',
        blocking=True,
        snapshot={
            'minimum_amount': str(financial_requirement.minimum_amount),
            'minimum_percentage': str(financial_requirement.minimum_percentage),
        },
        status=financial_status,
        actor=actor,
    )

    update_case_status(case)
    return case


def _seed_post_activation_tasks(case: AdmissionCase, *, actor=None, note_created=False):
    _ensure_task(
        case,
        task_type=AdmissionTask.TaskType.NURSING_INTAKE,
        phase=AdmissionTask.Phase.POST_ACTIVATION,
        assigned_role='nurse',
        blocking=True,
        status=AdmissionTask.Status.PENDING,
        actor=actor,
    )
    documentation_status = (
        AdmissionTask.Status.COMPLETED if note_created or _admission_documentation_ready(case)
        else AdmissionTask.Status.PENDING
    )
    _ensure_task(
        case,
        task_type=AdmissionTask.TaskType.ADMISSION_DOCUMENTATION,
        phase=AdmissionTask.Phase.POST_ACTIVATION,
        assigned_role='doctor',
        blocking=True,
        status=documentation_status,
        actor=actor,
    )

    draft = case.draft_payload or {}
    if draft.get('medications'):
        _ensure_task(
            case,
            task_type=AdmissionTask.TaskType.PHARMACY_MED_REC,
            phase=AdmissionTask.Phase.POST_ACTIVATION,
            assigned_role=ADVISORY_ROLE_DEFAULTS[AdmissionTask.TaskType.PHARMACY_MED_REC],
            blocking=False,
            snapshot={'medication_count': len(draft.get('medications') or [])},
            status=AdmissionTask.Status.PENDING,
            actor=actor,
        )
    if draft.get('labs'):
        _ensure_task(
            case,
            task_type=AdmissionTask.TaskType.BASELINE_LAB_FOLLOWUP,
            phase=AdmissionTask.Phase.POST_ACTIVATION,
            assigned_role=ADVISORY_ROLE_DEFAULTS[AdmissionTask.TaskType.BASELINE_LAB_FOLLOWUP],
            blocking=False,
            snapshot={'lab_count': len(draft.get('labs') or [])},
            status=AdmissionTask.Status.PENDING,
            actor=actor,
        )
    if draft.get('isolation_required'):
        _ensure_task(
            case,
            task_type=AdmissionTask.TaskType.INFECTION_CONTROL,
            phase=AdmissionTask.Phase.POST_ACTIVATION,
            assigned_role=ADVISORY_ROLE_DEFAULTS[AdmissionTask.TaskType.INFECTION_CONTROL],
            blocking=False,
            snapshot={'isolation_required': True},
            status=AdmissionTask.Status.PENDING,
            actor=actor,
        )


def update_case_status(case: AdmissionCase) -> AdmissionCase:
    if case.cancelled_at:
        next_status = AdmissionCase.Status.CANCELLED
        ready_for_activation_at = case.ready_for_activation_at
    elif case.completed_at:
        next_status = AdmissionCase.Status.COMPLETED
        ready_for_activation_at = case.ready_for_activation_at
    elif case.activated_at:
        next_status = AdmissionCase.Status.INTAKE_IN_PROGRESS
        ready_for_activation_at = case.ready_for_activation_at
    else:
        unresolved_pre = case.tasks.filter(
            phase=AdmissionTask.Phase.PRE_ACTIVATION,
            blocking=True,
            status=AdmissionTask.Status.PENDING,
        ).exists()
        next_status = (
            AdmissionCase.Status.AWAITING_CLEARANCE
            if unresolved_pre
            else AdmissionCase.Status.READY_FOR_ACTIVATION
        )
        ready_for_activation_at = case.ready_for_activation_at
        if not unresolved_pre and ready_for_activation_at is None:
            ready_for_activation_at = timezone.now()
        if unresolved_pre:
            ready_for_activation_at = None

    updates = []
    if case.status != next_status:
        case.status = next_status
        updates.append('status')
    if case.ready_for_activation_at != ready_for_activation_at:
        case.ready_for_activation_at = ready_for_activation_at
        updates.append('ready_for_activation_at')
    if updates:
        updates.append('updated_at')
        case.save(update_fields=updates)
    return case


def _release_reservation(reservation: BedReservation, *, actor=None, status=BedReservation.Status.RELEASED):
    bed = reservation.bed
    if bed.status == 'reserved':
        previous_status = bed.status
        bed.status = 'available'
        if actor:
            bed.updated_by = actor
        bed.save(update_fields=['status', 'updated_at', 'updated_by'] if actor else ['status', 'updated_at'])
        BedAllocationLog.objects.create(
            bed=bed,
            facility=bed.facility,
            previous_status=previous_status,
            new_status='available',
            notes='Admission bed reservation released.',
            created_by=actor,
        )
    reservation.status = status
    reservation.released_at = timezone.now()
    if actor:
        reservation.updated_by = actor
        reservation.save(update_fields=['status', 'released_at', 'updated_by', 'updated_at'])
    else:
        reservation.save(update_fields=['status', 'released_at', 'updated_at'])


def _resolve_department_team(*, case: AdmissionCase):
    if case.primary_team_id:
        return case.primary_team
    bed = case.requested_bed
    if not bed:
        return None
    try:
        from apps.organization.models import UnitWardAllocation

        allocation = UnitWardAllocation.objects.filter(
            ward=bed.ward,
            is_active=True,
        ).select_related('unit').first()
        return allocation.unit if allocation else None
    except Exception:
        return None


def _build_case_payload(case: AdmissionCase, payload: dict | None) -> dict:
    draft = dict(case.draft_payload or {})
    if payload:
        draft.update({k: v for k, v in payload.items() if v is not None})
    return draft


@transaction.atomic
def start_admission_case(
    *,
    patient,
    facility,
    actor,
    payload: dict | None = None,
    source_encounter=None,
    requested_ward=None,
    requested_bed=None,
    requested_for_at=None,
    admission_source='',
    urgency='',
    requested_admission_type='',
    admitting_practitioner=None,
):
    _require_enabled_feature('inpatient_admissions', facility)
    active_admission_exists = Admission.objects.filter(
        patient=patient,
        facility=facility,
        status__in=ACTIVE_ADMISSION_STATUSES,
    ).exists()
    if active_admission_exists:
        raise ValueError('Patient already has an active admission.')

    case = AdmissionCase.objects.filter(
        patient=patient,
        facility=facility,
        admission__isnull=True,
    ).exclude(
        status__in=[AdmissionCase.Status.COMPLETED, AdmissionCase.Status.CANCELLED],
    ).order_by('-requested_at').first()

    if not case:
        case = AdmissionCase.objects.create(
            patient=patient,
            facility=facility,
            source_encounter=source_encounter,
            requested_by=actor,
            requested_ward=requested_ward,
            requested_bed=requested_bed,
            admitting_practitioner=admitting_practitioner,
            admission_source=admission_source or '',
            urgency=urgency or AdmissionCase.Urgency.ROUTINE,
            requested_admission_type=requested_admission_type or 'elective',
            requested_for_at=_coerce_datetime(requested_for_at),
            draft_payload=payload or {},
        )
    else:
        case.source_encounter = source_encounter or case.source_encounter
        case.requested_ward = requested_ward or case.requested_ward
        case.requested_bed = requested_bed or case.requested_bed
        case.admitting_practitioner = admitting_practitioner or case.admitting_practitioner
        if admission_source:
            case.admission_source = admission_source
        if urgency:
            case.urgency = urgency
        if requested_admission_type:
            case.requested_admission_type = requested_admission_type
        if requested_for_at:
            case.requested_for_at = _coerce_datetime(requested_for_at)
        case.draft_payload = _build_case_payload(case, payload)
        case.save(
            update_fields=[
                'source_encounter',
                'requested_ward',
                'requested_bed',
                'admitting_practitioner',
                'admission_source',
                'urgency',
                'requested_admission_type',
                'requested_for_at',
                'draft_payload',
                'updated_at',
            ]
        )

    case.primary_team = _resolve_department_team(case=case)
    case.save(update_fields=['primary_team', 'updated_at'])
    sync_case_tasks(case, actor=actor)
    return case


@transaction.atomic
def reserve_bed_for_case(*, case: AdmissionCase, actor, bed, expires_at=None):
    _require_enabled_feature('bed_management', case.facility)
    if case.cancelled_at or case.completed_at:
        raise ValueError('Cannot reserve a bed for a closed admission case.')
    if case.activated_at:
        raise ValueError('Admission case is already activated.')
    if bed.facility_id != case.facility_id:
        raise ValueError('Bed does not belong to the same facility as the admission case.')
    if bed.status in {'occupied', 'maintenance'}:
        raise ValueError(f'Bed {bed.bed_number} is not available for reservation.')
    patient_gender = getattr(case.patient.user, 'gender', None)
    gender_restriction = bed.effective_gender_restriction
    if gender_restriction == 'male_only' and patient_gender != 'M':
        raise ValueError(f'Bed {bed.bed_number} is restricted to male patients.')
    if gender_restriction == 'female_only' and patient_gender != 'F':
        raise ValueError(f'Bed {bed.bed_number} is restricted to female patients.')

    active_reservation = _current_reservation(case)
    if active_reservation and active_reservation.bed_id != bed.id:
        _release_reservation(active_reservation, actor=actor)

    other_active = BedReservation.objects.filter(
        bed=bed,
        status=BedReservation.Status.ACTIVE,
    ).exclude(case=case).first()
    if other_active:
        raise ValueError(f'Bed {bed.bed_number} is already reserved.')

    reservation = BedReservation.objects.filter(
        case=case,
        bed=bed,
        status=BedReservation.Status.ACTIVE,
    ).first()
    if not reservation:
        reservation = BedReservation.objects.create(
            case=case,
            bed=bed,
            expires_at=_coerce_datetime(expires_at),
            created_by=actor,
            updated_by=actor,
        )
        previous_status = bed.status
        if previous_status != 'reserved':
            bed.status = 'reserved'
            bed.updated_by = actor
            bed.save(update_fields=['status', 'updated_at', 'updated_by'])
            BedAllocationLog.objects.create(
                bed=bed,
                facility=bed.facility,
                previous_status=previous_status,
                new_status='reserved',
                notes='Admission bed reservation created.',
                created_by=actor,
            )

    case.requested_bed = bed
    case.requested_ward = bed.ward
    case.primary_team = _resolve_department_team(case=case)
    case.save(update_fields=['requested_bed', 'requested_ward', 'primary_team', 'updated_at'])
    sync_case_tasks(case, actor=actor)
    return case


def _sync_encounter_to_fhir_async(encounter):
    try:
        from apps.encounters.tasks import sync_encounter_to_fhir

        sync_encounter_to_fhir.delay(str(encounter.id))
    except Exception:
        pass


def _activate_from_source_encounter(*, case: AdmissionCase, admission: Admission, actor):
    encounter = case.source_encounter
    if not encounter:
        return None
    location = admission.bed.ward.name if admission.bed else 'Waiting List'
    department_unit = None
    if admission.bed and admission.bed.ward and admission.bed.ward.department:
        department_unit = UnitHierarchyService.get_department_unit_for_core_department(
            admission.bed.ward.department,
            facility=case.facility,
        )

    encounter.encounter_type = 'inpatient'
    encounter.status = 'in-progress' if admission.bed else 'planned'
    encounter.admission = admission
    encounter.location = location
    encounter.service_type = f"Admission to {location}"
    encounter.admission_source = case.admission_source or encounter.admission_source or 'direct'
    encounter.practitioner = case.admitting_practitioner or encounter.practitioner
    encounter.updated_by = actor
    if department_unit:
        encounter.department = department_unit
    encounter.save()

    if admission.bed:
        from apps.organization.services import TeamAssignmentService

        TeamAssignmentService.reassign_team_on_bed_assignment(
            encounter=encounter,
            bed=admission.bed,
        )

    _sync_encounter_to_fhir_async(encounter)
    return encounter


def _create_inpatient_encounter(*, case: AdmissionCase, admission: Admission, actor):
    department_unit = None
    if admission.bed and admission.bed.ward and admission.bed.ward.department:
        department_unit = UnitHierarchyService.get_department_unit_for_core_department(
            admission.bed.ward.department,
            facility=case.facility,
        )

    encounter = Encounter.objects.create(
        patient=case.patient,
        facility=case.facility,
        practitioner=case.admitting_practitioner,
        department=department_unit,
        primary_team=case.primary_team,
        admitted_by_team=case.primary_team,
        encounter_type='inpatient',
        status='in-progress',
        start_time=admission.admission_date,
        reason=(case.draft_payload or {}).get('admission_notes') or (case.draft_payload or {}).get('admission_reason') or '',
        service_type=f"Admission to {admission.bed.ward.name}" if admission.bed else 'Admission',
        location=admission.bed.ward.name if admission.bed else None,
        admission_source=case.admission_source or 'direct',
        admission=admission,
        created_by=actor,
        updated_by=actor,
    )

    from apps.organization.services import TeamAssignmentService

    TeamAssignmentService.assign_initial_team(
        encounter=encounter,
        team=case.primary_team,
        use_roster=True,
        context='inpatient',
    )
    if admission.bed:
        TeamAssignmentService.reassign_team_on_bed_assignment(
            encounter=encounter,
            bed=admission.bed,
        )

    _sync_encounter_to_fhir_async(encounter)
    return encounter


@transaction.atomic
def activate_admission_case(*, case: AdmissionCase, actor, activated_at=None):
    _require_enabled_feature('bed_management', case.facility)
    if case.cancelled_at or case.completed_at:
        raise ValueError('Cannot activate a closed admission case.')
    if case.activated_at or case.admission_id:
        raise ValueError('Admission case is already activated.')

    unresolved = list(
        case.tasks.filter(
            phase=AdmissionTask.Phase.PRE_ACTIVATION,
            blocking=True,
            status=AdmissionTask.Status.PENDING,
        ).values_list('task_type', flat=True)
    )
    if unresolved:
        raise ValueError(f'Admission case still has activation blockers: {", ".join(unresolved)}')

    reservation = _current_reservation(case)
    bed = reservation.bed if reservation else case.requested_bed
    if not bed:
        raise ValueError('Admission activation requires a reserved or assigned bed.')
    if bed.status == 'reserved' and (not reservation or reservation.bed_id != bed.id):
        raise ValueError(f'Bed {bed.bed_number} is reserved for another admission case.')
    if bed.status not in {'available', 'reserved'}:
        raise ValueError(f'Bed {bed.bed_number} is not available for activation.')

    activated_dt = _coerce_datetime(activated_at) or timezone.now()
    admission = Admission.objects.create(
        patient=case.patient,
        bed=bed,
        facility=case.facility,
        admission_date=activated_dt,
        expected_discharge_date=None,
        status='admitted',
        admission_type=case.requested_admission_type or 'elective',
        admission_notes=(case.draft_payload or {}).get('admission_notes') or (case.draft_payload or {}).get('admission_reason') or '',
        admitting_doctor=case.admitting_practitioner,
        primary_team=case.primary_team,
        created_by=actor,
        updated_by=actor,
    )

    encounter = None
    if case.source_encounter and case.source_encounter.encounter_type == 'emergency' and case.source_encounter.status in {'planned', 'in-progress'}:
        encounter = _activate_from_source_encounter(case=case, admission=admission, actor=actor)
    if encounter is None:
        encounter = _create_inpatient_encounter(case=case, admission=admission, actor=actor)

    note = _maybe_create_admission_note(case, encounter)

    admission.fhir_encounter_id = str(encounter.id)
    admission.save(update_fields=['fhir_encounter_id'])

    previous_status = 'reserved' if reservation else 'available'
    BedAllocationLog.objects.create(
        bed=bed,
        facility=case.facility,
        previous_status=previous_status,
        new_status='occupied',
        admission=admission,
        notes='Admission case activated.',
        created_by=actor,
    )

    if reservation:
        reservation.status = BedReservation.Status.CONSUMED
        reservation.released_at = activated_dt
        reservation.updated_by = actor
        reservation.save(update_fields=['status', 'released_at', 'updated_by', 'updated_at'])

    case.admission = admission
    case.activated_at = activated_dt
    metadata = dict(case.metadata or {})
    if note:
        metadata['admission_note_id'] = str(note.id)
    case.metadata = metadata
    case.save(update_fields=['admission', 'activated_at', 'metadata', 'updated_at'])

    _seed_post_activation_tasks(case, actor=actor, note_created=bool(note))
    update_case_status(case)
    return case


@transaction.atomic
def complete_registration(case: AdmissionCase, *, actor, notes=''):
    task = case.tasks.get(task_type=AdmissionTask.TaskType.REGISTRATION_COMPLETION)
    task.status = AdmissionTask.Status.COMPLETED
    task.notes = notes or task.notes
    task.completed_by = actor
    task.completed_at = timezone.now()
    task.save(update_fields=['status', 'notes', 'completed_by', 'completed_at', 'updated_at'])
    sync_admission_task_inbox_item(task)
    update_case_status(case)
    return case


@transaction.atomic
def clear_financial(case: AdmissionCase, *, actor, notes=''):
    task = case.tasks.get(task_type=AdmissionTask.TaskType.FINANCIAL_CLEARANCE)
    task.status = AdmissionTask.Status.COMPLETED
    task.notes = notes or task.notes
    task.completed_by = actor
    task.completed_at = timezone.now()
    task.save(update_fields=['status', 'notes', 'completed_by', 'completed_at', 'updated_at'])
    sync_admission_task_inbox_item(task)
    update_case_status(case)
    return case


@transaction.atomic
def complete_admission_task(*, task: AdmissionTask, actor, notes=''):
    if task.status in {AdmissionTask.Status.COMPLETED, AdmissionTask.Status.NOT_REQUIRED}:
        return task.case
    task.status = AdmissionTask.Status.COMPLETED
    task.notes = notes or task.notes
    task.completed_by = actor
    task.completed_at = timezone.now()
    task.save(update_fields=['status', 'notes', 'completed_by', 'completed_at', 'updated_at'])
    sync_admission_task_inbox_item(task)
    update_case_status(task.case)
    return task.case


@transaction.atomic
def acknowledge_admission_task(*, task: AdmissionTask, actor, notes=''):
    if task.blocking:
        raise ValueError('Blocking admission tasks cannot be acknowledged as unresolved.')
    task.status = AdmissionTask.Status.ACKNOWLEDGED_UNRESOLVED
    task.notes = notes or task.notes
    task.acknowledged_by = actor
    task.acknowledged_at = timezone.now()
    task.save(update_fields=['status', 'notes', 'acknowledged_by', 'acknowledged_at', 'updated_at'])
    sync_admission_task_inbox_item(task)
    update_case_status(task.case)
    return task.case


@transaction.atomic
def add_advisory_task(*, case: AdmissionCase, actor, task_type, assigned_role=None, notes='', snapshot=None):
    if task_type in {
        AdmissionTask.TaskType.MEDICAL_ADMISSION_ORDER,
        AdmissionTask.TaskType.PLACEMENT,
        AdmissionTask.TaskType.REGISTRATION_COMPLETION,
        AdmissionTask.TaskType.FINANCIAL_CLEARANCE,
        AdmissionTask.TaskType.NURSING_INTAKE,
        AdmissionTask.TaskType.ADMISSION_DOCUMENTATION,
    }:
        raise ValueError('Use the system workflow for blocking admission tasks.')
    task = _ensure_task(
        case,
        task_type=task_type,
        phase=AdmissionTask.Phase.POST_ACTIVATION if case.activated_at else AdmissionTask.Phase.PRE_ACTIVATION,
        assigned_role=assigned_role or ADVISORY_ROLE_DEFAULTS.get(task_type, 'admin'),
        blocking=False,
        notes=notes,
        snapshot=snapshot or {},
        status=AdmissionTask.Status.PENDING,
        actor=actor,
    )
    update_case_status(case)
    return task


@transaction.atomic
def complete_intake(case: AdmissionCase, *, actor):
    _require_enabled_feature('nursing_workflows', case.facility)
    if not case.activated_at:
        raise ValueError('Admission case has not been activated.')
    blocking_post = list(
        case.tasks.filter(
            phase=AdmissionTask.Phase.POST_ACTIVATION,
            blocking=True,
            status=AdmissionTask.Status.PENDING,
        ).values_list('task_type', flat=True)
    )
    if blocking_post:
        raise ValueError(f'Admission intake blockers remain: {", ".join(blocking_post)}')
    case.completed_at = timezone.now()
    case.save(update_fields=['completed_at', 'updated_at'])
    update_case_status(case)
    return case


@transaction.atomic
def cancel_admission_case(case: AdmissionCase, *, actor, reason=''):
    if case.admission_id or case.activated_at:
        raise ValueError('Activated admission cases cannot be cancelled.')
    reservation = _current_reservation(case)
    if reservation:
        _release_reservation(reservation, actor=actor, status=BedReservation.Status.CANCELLED)
    case.cancelled_at = timezone.now()
    case.cancel_reason = reason or case.cancel_reason
    case.save(update_fields=['cancelled_at', 'cancel_reason', 'updated_at'])
    case.tasks.exclude(status=AdmissionTask.Status.CANCELLED).update(status=AdmissionTask.Status.CANCELLED)
    for task in case.tasks.all():
        sync_admission_task_inbox_item(task)
    update_case_status(case)
    return case


@transaction.atomic
def submit_legacy_admission_request(
    *,
    patient,
    facility,
    actor,
    bed,
    requested_ward=None,
    admission_date,
    expected_discharge_date=None,
    admission_type='elective',
    admission_notes='',
    admitting_doctor=None,
    source_encounter=None,
):
    payload = {
        'admission_notes': admission_notes or '',
        'submitted_via_legacy_create': True,
    }
    case = start_admission_case(
        patient=patient,
        facility=facility,
        actor=actor,
        payload=payload,
        source_encounter=source_encounter,
        requested_ward=bed.ward if bed else requested_ward,
        requested_bed=bed,
        requested_for_at=admission_date,
        admission_source='emergency' if source_encounter else 'direct',
        requested_admission_type=admission_type or 'elective',
        admitting_practitioner=admitting_doctor,
    )
    if expected_discharge_date:
        case.draft_payload = _build_case_payload(
            case,
            {'expected_discharge_date': expected_discharge_date.isoformat() if hasattr(expected_discharge_date, 'isoformat') else expected_discharge_date},
        )
        case.save(update_fields=['draft_payload', 'updated_at'])
    if bed:
        reserve_bed_for_case(case=case, actor=actor, bed=bed)
    try:
        case = activate_admission_case(case=case, actor=actor, activated_at=admission_date)
        activated = True
    except ValueError:
        activated = False
        update_case_status(case)
    return case, activated
