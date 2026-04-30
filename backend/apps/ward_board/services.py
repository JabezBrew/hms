from __future__ import annotations

from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Case, Count, Exists, IntegerField, Min, OuterRef, Q, Value, When
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.core.features import feature_enabled
from apps.core.security import (
    ACTIVE_ADMISSION_STATUSES,
    CLINICAL_PATIENT_ACCESS_USER_TYPES,
    check_clinical_access,
    get_user_facility_codes,
    is_cross_facility_admin,
    scope_queryset_to_clinical_access,
)
from apps.ward_board.models import (
    WardBoardAcknowledgement,
    WardBoardTask,
    WardBoardTaskEvent,
)


BOARD_USER_TYPES = CLINICAL_PATIENT_ACCESS_USER_TYPES | {'admin'}
BOARD_OWNER_ROLES = BOARD_USER_TYPES
SAFE_CHANGED_FIELDS = {
    'category',
    'priority',
    'status',
    'owner_user',
    'owner_role',
    'due_at',
    'ward',
    'admission',
    'source_type',
    'source_id',
}
SAFE_EVENT_KEYS = {
    'category',
    'priority',
    'status',
    'owner_user_id',
    'owner_role',
    'due_at',
    'source_type',
    'source_id',
    'changed_fields',
    'previous_status',
    'new_status',
    'reason_present',
    'note_present',
    'acknowledgement_id',
    'ward_id',
    'admission_id',
}


def ensure_board_user(user):
    if not user or not getattr(user, 'is_authenticated', False):
        raise PermissionDenied('Authentication required.')
    if getattr(user, 'user_type', None) not in BOARD_USER_TYPES:
        raise PermissionDenied('Ward board access requires a clinical role.')


def ensure_patient_clinical_access(user, patient):
    ensure_board_user(user)
    check_clinical_access(user, patient)


def _serialize_safe_value(value):
    if value is None:
        return None
    if isinstance(value, (UUID, datetime)):
        return value.isoformat() if isinstance(value, datetime) else str(value)
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple, set)):
        return [_serialize_safe_value(item) for item in value]
    return str(value)


def _safe_event_metadata(metadata):
    metadata = metadata or {}
    safe = {}
    for key in SAFE_EVENT_KEYS:
        if key not in metadata:
            continue
        value = metadata[key]
        if key == 'changed_fields':
            value = sorted(str(field) for field in value if field in SAFE_CHANGED_FIELDS)
        safe[key] = _serialize_safe_value(value)
    return safe


def record_task_event(task, event_type, *, actor=None, metadata=None):
    return WardBoardTaskEvent.objects.create(
        task=task,
        facility=task.facility,
        event_type=event_type,
        actor=actor if getattr(actor, 'is_authenticated', False) else None,
        metadata=_safe_event_metadata(metadata),
    )


def _ward_facility_id(ward):
    if not ward:
        return None
    department = getattr(ward, 'department', None)
    return getattr(department, 'facility_id', None)


def _validate_task_context(*, facility, patient, admission=None, ward=None):
    if not facility:
        raise PermissionDenied('Facility context is required.')
    if patient.facility_id != facility.id:
        raise PermissionDenied('Patient does not belong to the active facility.')

    resolved_ward = ward
    if admission:
        if admission.facility_id != facility.id:
            raise PermissionDenied('Admission does not belong to the active facility.')
        if admission.patient_id != patient.id:
            raise ValidationError({'admission_id': 'Admission does not belong to the selected patient.'})
        if not resolved_ward and admission.bed_id:
            resolved_ward = admission.bed.ward
        if resolved_ward and admission.bed_id and admission.bed.ward_id != resolved_ward.id:
            raise ValidationError({'ward_id': 'Ward does not match the active admission bed.'})

    if resolved_ward and _ward_facility_id(resolved_ward) != facility.id:
        raise PermissionDenied('Ward does not belong to the active facility.')

    return resolved_ward


def _validate_owner(*, facility, owner_user=None, owner_role=''):
    owner_role = (owner_role or '').strip()
    if bool(owner_user) == bool(owner_role):
        raise ValidationError({'owner': 'Provide exactly one of owner_user_id or owner_role.'})

    if owner_role and owner_role not in BOARD_OWNER_ROLES:
        raise ValidationError({'owner_role': 'Owner role is not allowed on the clinical ward board.'})

    if owner_user:
        owner_type = getattr(owner_user, 'user_type', None)
        if owner_type not in BOARD_USER_TYPES:
            raise ValidationError({'owner_user_id': 'Owner user must have a clinical ward-board role.'})
        if not is_cross_facility_admin(owner_user) and facility.code not in get_user_facility_codes(owner_user):
            raise PermissionDenied('Owner user does not belong to the active facility.')

    return owner_role


def user_can_act_on_task(user, task):
    if getattr(user, 'user_type', None) == 'admin':
        return True
    if task.owner_user_id and task.owner_user_id == getattr(user, 'id', None):
        return True
    return bool(task.owner_role and task.owner_role == getattr(user, 'user_type', None))


def ensure_task_actor(user, task):
    ensure_patient_clinical_access(user, task.patient)
    if not user_can_act_on_task(user, task):
        raise PermissionDenied('You do not own this ward-board task.')


def _task_event_metadata(task):
    return {
        'category': task.category,
        'priority': task.priority,
        'status': task.status,
        'owner_user_id': task.owner_user_id,
        'owner_role': task.owner_role,
        'due_at': task.due_at,
        'source_type': task.source_type,
        'source_id': task.source_id,
        'ward_id': task.ward_id,
        'admission_id': task.admission_id,
    }


@transaction.atomic
def create_task(
    *,
    facility,
    actor,
    patient,
    action_text,
    category=WardBoardTask.Category.OTHER,
    priority=WardBoardTask.Priority.ROUTINE,
    ward=None,
    admission=None,
    owner_user=None,
    owner_role='',
    due_at=None,
    contingency_text='',
    source_type=WardBoardTask.SourceType.MANUAL,
    source_id='',
):
    ensure_patient_clinical_access(actor, patient)
    ward = _validate_task_context(
        facility=facility,
        patient=patient,
        admission=admission,
        ward=ward,
    )
    owner_role = _validate_owner(
        facility=facility,
        owner_user=owner_user,
        owner_role=owner_role,
    )
    task = WardBoardTask.objects.create(
        facility=facility,
        ward=ward,
        admission=admission,
        patient=patient,
        category=category,
        priority=priority,
        owner_user=owner_user,
        owner_role=owner_role,
        due_at=due_at,
        action_text=action_text,
        contingency_text=contingency_text or '',
        source_type=source_type,
        source_id=str(source_id or ''),
        created_by=actor,
        updated_by=actor,
    )
    record_task_event(
        task,
        WardBoardTaskEvent.EventType.CREATE,
        actor=actor,
        metadata=_task_event_metadata(task),
    )
    return task


@transaction.atomic
def update_task(task, *, actor, facility, **fields):
    ensure_patient_clinical_access(actor, task.patient)
    if task.is_terminal:
        raise ValidationError({'status': 'Completed and cancelled tasks cannot be edited.'})

    if 'status' in fields and fields['status'] in WardBoardTask.TERMINAL_STATUSES:
        raise ValidationError({'status': 'Use the complete or cancel action for terminal states.'})

    owner_user = fields.get('owner_user', task.owner_user)
    owner_role = fields.get('owner_role', task.owner_role)
    if 'owner_user' in fields or 'owner_role' in fields:
        fields['owner_role'] = _validate_owner(
            facility=facility,
            owner_user=owner_user,
            owner_role=owner_role,
        )

    admission = fields.get('admission', task.admission)
    ward = fields.get('ward', task.ward)
    patient = fields.get('patient', task.patient)
    fields['ward'] = _validate_task_context(
        facility=facility,
        patient=patient,
        admission=admission,
        ward=ward,
    )

    changed_fields = []
    for field, value in fields.items():
        if field not in {
            'category',
            'priority',
            'status',
            'owner_user',
            'owner_role',
            'due_at',
            'action_text',
            'contingency_text',
            'ward',
            'admission',
        }:
            continue
        if getattr(task, field) != value:
            setattr(task, field, value)
            changed_fields.append(field)

    if not changed_fields:
        return task

    if task.status == WardBoardTask.Status.ESCALATED and not task.escalated_at:
        task.escalated_at = timezone.now()

    task.updated_by = actor
    task.save()
    event_type = (
        WardBoardTaskEvent.EventType.ASSIGN
        if {'owner_user', 'owner_role'} & set(changed_fields)
        else WardBoardTaskEvent.EventType.UPDATE
    )
    record_task_event(
        task,
        event_type,
        actor=actor,
        metadata={
            'changed_fields': changed_fields,
            **_task_event_metadata(task),
        },
    )
    return task


@transaction.atomic
def acknowledge_task(task, *, actor, note=''):
    ensure_patient_clinical_access(actor, task.patient)
    if task.status == WardBoardTask.Status.CANCELLED:
        raise ValidationError({'status': 'Cancelled tasks cannot be acknowledged.'})

    acknowledgement, created = WardBoardAcknowledgement.objects.get_or_create(
        task=task,
        user=actor,
        defaults={
            'facility': task.facility,
            'note': note or '',
        },
    )
    if created:
        record_task_event(
            task,
            WardBoardTaskEvent.EventType.ACKNOWLEDGE,
            actor=actor,
            metadata={
                'acknowledgement_id': acknowledgement.id,
                'note_present': bool(note),
            },
        )
    return acknowledgement


@transaction.atomic
def complete_task(task, *, actor, note=''):
    ensure_task_actor(actor, task)
    if task.is_terminal:
        raise ValidationError({'status': 'Task is already terminal.'})

    previous_status = task.status
    task.status = WardBoardTask.Status.COMPLETED
    task.completed_by = actor
    task.completed_at = timezone.now()
    task.updated_by = actor
    task.save(update_fields=['status', 'completed_by', 'completed_at', 'updated_by', 'updated_at'])
    record_task_event(
        task,
        WardBoardTaskEvent.EventType.COMPLETE,
        actor=actor,
        metadata={
            'previous_status': previous_status,
            'new_status': task.status,
            'note_present': bool(note),
        },
    )
    return task


@transaction.atomic
def cancel_task(task, *, actor, reason):
    ensure_task_actor(actor, task)
    if task.is_terminal:
        raise ValidationError({'status': 'Task is already terminal.'})

    previous_status = task.status
    task.status = WardBoardTask.Status.CANCELLED
    task.cancellation_reason = reason or ''
    task.cancelled_by = actor
    task.cancelled_at = timezone.now()
    task.updated_by = actor
    task.save(update_fields=[
        'status',
        'cancellation_reason',
        'cancelled_by',
        'cancelled_at',
        'updated_by',
        'updated_at',
    ])
    record_task_event(
        task,
        WardBoardTaskEvent.EventType.CANCEL,
        actor=actor,
        metadata={
            'previous_status': previous_status,
            'new_status': task.status,
            'reason_present': bool(reason),
        },
    )
    return task


@transaction.atomic
def escalate_task(task, *, actor, priority=None, owner_user=None, owner_role=None, due_at=None, note=''):
    ensure_patient_clinical_access(actor, task.patient)
    if task.is_terminal:
        raise ValidationError({'status': 'Completed and cancelled tasks cannot be escalated.'})

    changed_fields = ['status']
    previous_status = task.status
    task.status = WardBoardTask.Status.ESCALATED
    task.escalated_at = timezone.now()

    if priority and task.priority != priority:
        task.priority = priority
        changed_fields.append('priority')
    if due_at and task.due_at != due_at:
        task.due_at = due_at
        changed_fields.append('due_at')
    if owner_user is not None or owner_role is not None:
        normalized_owner_role = _validate_owner(
            facility=task.facility,
            owner_user=owner_user,
            owner_role=owner_role or '',
        )
        task.owner_user = owner_user
        task.owner_role = normalized_owner_role
        changed_fields.extend(['owner_user', 'owner_role'])

    task.updated_by = actor
    task.save()
    record_task_event(
        task,
        WardBoardTaskEvent.EventType.ESCALATE,
        actor=actor,
        metadata={
            'changed_fields': changed_fields,
            'previous_status': previous_status,
            'new_status': task.status,
            'priority': task.priority,
            'owner_user_id': task.owner_user_id,
            'owner_role': task.owner_role,
            'due_at': task.due_at,
            'note_present': bool(note),
        },
    )
    return task


def base_task_queryset(facility, user):
    ensure_board_user(user)
    queryset = WardBoardTask.objects.filter(facility=facility).select_related(
        'facility',
        'ward__department',
        'admission__bed__ward',
        'patient__user',
        'owner_user',
        'created_by',
        'updated_by',
        'completed_by',
        'cancelled_by',
    )
    return scope_queryset_to_clinical_access(queryset, user, patient_lookup='patient')


def active_admission_queryset(facility, user, *, ward_id=None):
    ensure_board_user(user)
    queryset = (
        _admission_model().objects.filter(
            facility=facility,
            status__in=ACTIVE_ADMISSION_STATUSES,
        )
        .select_related('patient__user', 'bed__ward__department')
        .order_by('bed__ward__name', 'bed__bed_number', '-admission_date')
    )
    queryset = scope_queryset_to_clinical_access(queryset, user, patient_lookup='patient')
    if ward_id:
        queryset = queryset.filter(bed__ward_id=ward_id)
    return queryset


def filter_active_admissions_for_board(queryset, facility, user, *, view='', search=''):
    """
    Apply interactive ward-board filters before pagination.

    Search uses the indexed patient search projection instead of ad-hoc name
    filters on the wider patient/user join graph.
    """
    search = str(search or '').strip()
    if search:
        from apps.patients.models import PatientSearchIndex

        patient_search = PatientSearchIndex.objects.filter(
            facility=facility,
            patient_profile_id=OuterRef('patient_id'),
        ).filter(
            Q(search_document__icontains=search)
            | Q(full_name__icontains=search)
            | Q(medical_record_number__icontains=search)
            | Q(nhis_id__icontains=search)
        )
        queryset = queryset.alias(
            patient_search_match=Exists(patient_search),
        ).filter(
            Q(patient_search_match=True)
            | Q(bed__bed_number__iexact=search)
        )

    view = str(view or '').strip().lower()
    if view == 'results':
        if not feature_enabled('laboratory', facility=facility):
            return queryset.none()
        from apps.laboratory.models import LabOrder, LabOrderStatus

        pending_labs = LabOrder.objects.filter(
            facility=facility,
            patient_id=OuterRef('patient_id'),
            status__in=[
                LabOrderStatus.ORDERED,
                LabOrderStatus.COLLECTED,
                LabOrderStatus.RECEIVED,
                LabOrderStatus.PROCESSING,
            ],
        )
        return queryset.alias(has_pending_labs=Exists(pending_labs)).filter(has_pending_labs=True)

    if view == 'discharge':
        if not feature_enabled('discharge_workflows', facility=facility):
            return queryset.none()
        from apps.discharge.models import DischargeCase, DischargeTask

        discharge_work = DischargeTask.objects.filter(
            case__facility=facility,
            case__admission_id=OuterRef('pk'),
            status=DischargeTask.Status.PENDING,
        ).exclude(
            case__status__in=[DischargeCase.Status.FINALIZED, DischargeCase.Status.CANCELLED],
        )
        return queryset.alias(has_discharge_work=Exists(discharge_work)).filter(has_discharge_work=True)

    if view == 'my-work':
        owner_filter = Q(owner_user=user)
        user_type = getattr(user, 'user_type', None)
        if user_type:
            owner_filter |= Q(owner_role=user_type)
        assigned_tasks = (
            WardBoardTask.objects.filter(
                facility=facility,
                admission_id=OuterRef('pk'),
            )
            .exclude(status__in=WardBoardTask.TERMINAL_STATUSES)
            .filter(owner_filter)
        )
        return queryset.alias(has_my_work=Exists(assigned_tasks)).filter(has_my_work=True)

    if view == 'by-urgency':
        now = timezone.now()
        urgent_tasks = (
            WardBoardTask.objects.filter(
                facility=facility,
                admission_id=OuterRef('pk'),
                priority__in=[WardBoardTask.Priority.URGENT, WardBoardTask.Priority.STAT],
            )
            .exclude(status__in=WardBoardTask.TERMINAL_STATUSES)
        )
        overdue_tasks = (
            WardBoardTask.objects.filter(
                facility=facility,
                admission_id=OuterRef('pk'),
                due_at__lt=now,
            )
            .exclude(status__in=WardBoardTask.TERMINAL_STATUSES)
        )

        from apps.nursing.models import NursingAlert

        active_alerts = NursingAlert.objects.filter(
            facility=facility,
            patient_id=OuterRef('patient_id'),
            is_acknowledged=False,
        )
        return queryset.annotate(
            has_active_alert=Exists(active_alerts),
            has_urgent_task=Exists(urgent_tasks),
            has_overdue_task=Exists(overdue_tasks),
            urgency_rank=Case(
                When(has_active_alert=True, then=Value(0)),
                When(has_urgent_task=True, then=Value(1)),
                When(has_overdue_task=True, then=Value(2)),
                default=Value(9),
                output_field=IntegerField(),
            ),
        ).order_by('urgency_rank', 'bed__ward__name', 'bed__bed_number', '-admission_date')

    return queryset


def _admission_model():
    from apps.wards.models import Admission

    return Admission


def _map_counts(queryset, field_name):
    return {
        row[field_name]: row['count']
        for row in queryset.values(field_name).annotate(count=Count('id'))
    }


def _board_task_stats(facility, admission_ids):
    now = timezone.now()
    rows = (
        WardBoardTask.objects.filter(
            facility=facility,
            admission_id__in=admission_ids,
        )
        .exclude(status__in=WardBoardTask.TERMINAL_STATUSES)
        .values('admission_id')
        .annotate(
            open_task_count=Count('id'),
            urgent_task_count=Count(
                'id',
                filter=Q(priority__in=[WardBoardTask.Priority.URGENT, WardBoardTask.Priority.STAT]),
            ),
            overdue_task_count=Count('id', filter=Q(due_at__lt=now)),
            next_due_at=Min('due_at', filter=Q(due_at__isnull=False)),
        )
    )
    return {row['admission_id']: row for row in rows}


def build_board_patient_rows(admissions, facility):
    admissions = list(admissions)
    admission_ids = [admission.id for admission in admissions]
    patient_ids = [admission.patient_id for admission in admissions]

    board_stats = _board_task_stats(facility, admission_ids)

    from apps.nursing.models import NursingAlert, NursingTask

    nursing_task_counts = _map_counts(
        NursingTask.objects.filter(
            facility=facility,
            patient_id__in=patient_ids,
        ).exclude(status__in=['completed', 'cancelled']),
        'patient_id',
    )
    alert_counts = _map_counts(
        NursingAlert.objects.filter(
            facility=facility,
            patient_id__in=patient_ids,
            is_acknowledged=False,
        ),
        'patient_id',
    )

    discharge_task_counts = {}
    if feature_enabled('discharge_workflows', facility=facility):
        from apps.discharge.models import DischargeCase, DischargeTask

        discharge_task_counts = _map_counts(
            DischargeTask.objects.filter(
                case__facility=facility,
                case__admission_id__in=admission_ids,
                status=DischargeTask.Status.PENDING,
            ).exclude(case__status__in=[DischargeCase.Status.FINALIZED, DischargeCase.Status.CANCELLED]),
            'case__admission_id',
        )

    lab_counts = {}
    if feature_enabled('laboratory', facility=facility):
        from apps.laboratory.models import LabOrder, LabOrderStatus

        lab_counts = _map_counts(
            LabOrder.objects.filter(
                facility=facility,
                patient_id__in=patient_ids,
                status__in=[
                    LabOrderStatus.ORDERED,
                    LabOrderStatus.COLLECTED,
                    LabOrderStatus.RECEIVED,
                    LabOrderStatus.PROCESSING,
                ],
            ),
            'patient_id',
        )

    rows = []
    for admission in admissions:
        patient = admission.patient
        bed = admission.bed
        ward = bed.ward if bed else None
        stats = board_stats.get(admission.id, {})
        rows.append({
            'patient_id': patient.id,
            'patient_name': patient.user.get_full_name(),
            'medical_record_number': patient.medical_record_number,
            'admission_id': admission.id,
            'admission_status': admission.status,
            'ward_id': ward.id if ward else None,
            'ward_name': ward.name if ward else None,
            'bed_number': bed.bed_number if bed else None,
            'open_task_count': stats.get('open_task_count', 0),
            'urgent_task_count': stats.get('urgent_task_count', 0),
            'overdue_task_count': stats.get('overdue_task_count', 0),
            'next_due_at': stats.get('next_due_at'),
            'nursing_task_count': nursing_task_counts.get(patient.id, 0),
            'active_alert_count': alert_counts.get(patient.id, 0),
            'discharge_task_count': discharge_task_counts.get(admission.id, 0),
            'open_lab_order_count': lab_counts.get(patient.id, 0),
        })
    return rows


def build_patient_snapshot(patient, facility, user):
    ensure_patient_clinical_access(user, patient)
    if patient.facility_id != facility.id:
        raise PermissionDenied('Patient does not belong to the active facility.')

    Admission = _admission_model()
    admission = (
        Admission.objects.filter(
            facility=facility,
            patient=patient,
            status__in=ACTIVE_ADMISSION_STATUSES,
        )
        .select_related('bed__ward__department', 'patient__user')
        .order_by('-admission_date')
        .first()
    )
    tasks = (
        WardBoardTask.objects.filter(facility=facility, patient=patient)
        .exclude(status__in=WardBoardTask.TERMINAL_STATUSES)
        .select_related('patient__user', 'ward__department', 'owner_user')
        .order_by('due_at', '-priority', '-created_at')[:25]
    )
    events = (
        WardBoardTaskEvent.objects.filter(facility=facility, task__patient=patient)
        .select_related('actor')
        .order_by('-created_at')[:25]
    )

    rows = build_board_patient_rows([admission], facility) if admission else []
    summary = rows[0] if rows else {
        'patient_id': patient.id,
        'patient_name': patient.user.get_full_name(),
        'medical_record_number': patient.medical_record_number,
        'admission_id': None,
        'admission_status': None,
        'ward_id': None,
        'ward_name': None,
        'bed_number': None,
        'open_task_count': 0,
        'urgent_task_count': 0,
        'overdue_task_count': 0,
        'next_due_at': None,
        'nursing_task_count': 0,
        'active_alert_count': 0,
        'discharge_task_count': 0,
        'open_lab_order_count': 0,
    }
    return {
        **summary,
        'tasks': list(tasks),
        'events': list(events),
    }
