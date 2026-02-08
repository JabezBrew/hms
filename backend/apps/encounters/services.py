"""
Encounter services for automatic encounter management.

This module provides utilities for finding or creating active encounters
for patients, ensuring clinical entries are always properly linked.
"""
from datetime import datetime, time, timedelta

from django.utils import timezone
from django.db import transaction
from django.db.models import Q, Max

from .models import Encounter, OutpatientVisit, TriageQueue
from apps.organization.services import UnitHierarchyService


def get_or_create_active_encounter(
    patient,
    practitioner=None,
    encounter_type=None,
    reason=None,
    created_by=None
):
    """
    Find an active encounter for a patient.

    Uses select_for_update to prevent race conditions when transitioning encounters.

    Logic:
    1. If patient has an active inpatient admission, return that admission's encounter
    2. If patient has a planned encounter today (transition to in-progress), return it
    3. If patient has an active outpatient/emergency encounter today, return it
    4. Otherwise, raise an error (explicit check-in required)

    Args:
        patient: PatientProfile instance
        practitioner: PractitionerProfile instance (optional)
        encounter_type: 'inpatient', 'outpatient', or 'emergency' (optional, defaults to 'outpatient')
        reason: Reason for the encounter (optional)
        created_by: User who is creating the encounter (optional, for audit)

    Returns:
        tuple: (Encounter instance, bool created)
    """
    # Import here to avoid circular imports
    from apps.wards.models import Admission

    now = timezone.now()
    start_of_day = timezone.make_aware(datetime.combine(now.date(), time.min))
    end_of_day = start_of_day + timedelta(days=1)
    effective_type = encounter_type or 'outpatient'

    # Use transaction with select_for_update to prevent race conditions
    with transaction.atomic():
        # Rule 1: Check for active inpatient admission
        # If patient is admitted, ALL entries should go to the admission's encounter
        # Order by admission_date desc to get the most recent if multiple exist
        active_admission = Admission.objects.filter(
            patient=patient,
            status='admitted'
        ).select_related('encounter').order_by('-admission_date').first()

        if active_admission:
            # Get or create the encounter for this admission
            if hasattr(active_admission, 'encounter') and active_admission.encounter:
                return active_admission.encounter, False

            # Edge case: Admission exists but no encounter linked (shouldn't happen but handle it)
            encounter = Encounter.objects.create(
                patient=patient,
                facility=patient.facility,
                practitioner=active_admission.admitting_doctor,
                department=UnitHierarchyService.get_department_unit_for_core_department(
                    active_admission.bed.ward.department if active_admission.bed else None,
                    facility=patient.facility
                ),
                encounter_type='inpatient',
                status='in-progress',
                start_time=active_admission.admission_date,
                admission=active_admission,
                reason=reason or "Inpatient admission",
                location=active_admission.bed.ward.name if active_admission.bed else None,
                created_by=created_by,
            )
            from apps.organization.services import TeamAssignmentService
            TeamAssignmentService.assign_initial_team(encounter=encounter, use_roster=True, context='inpatient')
            if active_admission.bed:
                TeamAssignmentService.reassign_team_on_bed_assignment(
                    encounter=encounter,
                    bed=active_admission.bed
                )
            return encounter, True

        # Build filters for outpatient/emergency encounters
        type_filter = ['outpatient', 'emergency']
        if effective_type == 'emergency':
            # For emergency, prefer matching type but fall back to any
            type_filter = ['emergency', 'outpatient']

        # Rule 2: Check for planned encounter today (transition it to in-progress)
        # Use select_for_update to lock the row and prevent race conditions
        planned_filters = {
            'patient': patient,
            'status': 'planned',
            'start_time__gte': start_of_day,
            'start_time__lt': end_of_day,
            'encounter_type__in': type_filter,
        }

        # Prefer same practitioner's planned encounter
        if practitioner:
            planned_encounter = (
                Encounter.objects
                .select_for_update(skip_locked=True)
                .filter(**planned_filters, practitioner=practitioner)
                .first()
            )
            if planned_encounter:
                # Transition from planned to in-progress
                planned_encounter.status = 'in-progress'
                if reason and not planned_encounter.reason:
                    planned_encounter.reason = reason
                planned_encounter.save(update_fields=['status', 'reason', 'updated_at'])
                return planned_encounter, False

        # Check any planned encounter today
        planned_encounter = (
            Encounter.objects
            .select_for_update(skip_locked=True)
            .filter(**planned_filters)
            .first()
        )
        if planned_encounter:
            planned_encounter.status = 'in-progress'
            if reason and not planned_encounter.reason:
                planned_encounter.reason = reason
            planned_encounter.save(update_fields=['status', 'reason', 'updated_at'])
            return planned_encounter, False

        # Rule 3: Check for active (in-progress) outpatient/emergency encounter today
        active_filters = {
            'patient': patient,
            'status': 'in-progress',
            'start_time__gte': start_of_day,
            'start_time__lt': end_of_day,
            'encounter_type__in': type_filter,
        }

        # If practitioner is provided, prefer same practitioner's encounter
        if practitioner:
            practitioner_encounter = (
                Encounter.objects
                .select_for_update(skip_locked=True)
                .filter(**active_filters, practitioner=practitioner)
                .first()
            )
            if practitioner_encounter:
                return practitioner_encounter, False

        # Check for any active encounter today (different practitioner)
        any_encounter = (
            Encounter.objects
            .select_for_update(skip_locked=True)
            .filter(**active_filters)
            .first()
        )
        if any_encounter:
            return any_encounter, False

        # Rule 4: Do not auto-create encounters (explicit check-in required)
        raise ValueError(
            "No active encounter found for patient. Start a visit/check-in before creating clinical entries."
        )


def get_active_encounter_for_patient(patient, encounter_type=None, clinic=None):
    """
    Get the currently active encounter for a patient, if any exists.

    Unlike get_or_create_active_encounter, this does NOT create a new encounter.

    Args:
        patient: PatientProfile instance
        encounter_type: Optional encounter type filter
        clinic: Optional clinic filter

    Returns:
        Encounter instance or None
    """
    from apps.wards.models import Admission

    now = timezone.now()
    start_of_day = timezone.make_aware(datetime.combine(now.date(), time.min))
    end_of_day = start_of_day + timedelta(days=1)

    # Check for active inpatient admission first
    # Order by admission_date desc to get most recent
    active_admission = Admission.objects.filter(
        patient=patient,
        status='admitted'
    ).select_related('encounter').order_by('-admission_date').first()

    if active_admission and hasattr(active_admission, 'encounter') and active_admission.encounter:
        if encounter_type in [None, 'inpatient']:
            return active_admission.encounter

    type_filter = ['outpatient', 'emergency']
    if encounter_type:
        type_filter = [encounter_type]

    filters = {
        'patient': patient,
        'status__in': ['in-progress', 'planned'],
        'start_time__gte': start_of_day,
        'start_time__lt': end_of_day,
        'encounter_type__in': type_filter,
    }
    if clinic:
        filters['clinic'] = clinic

    return Encounter.objects.filter(**filters).first()


def ensure_encounter_for_entry(
    patient,
    practitioner=None,
    encounter_id=None,
    reason=None,
    encounter_type=None,
    created_by=None
):
    """
    Ensure an entry has an encounter to link to.

    This is the main function to use when creating clinical entries (notes, vitals, prescriptions).
    Explicit check-in is required for outpatient encounters.

    Args:
        patient: PatientProfile instance
        practitioner: PractitionerProfile instance (optional)
        encounter_id: UUID of existing encounter (optional) - if provided, validates and returns it
        reason: Reason for encounter if creating new one (optional)
        encounter_type: 'inpatient', 'outpatient', or 'emergency' (optional)
        created_by: User who is creating the encounter (optional, for audit)

    Returns:
        tuple: (Encounter instance, bool created)

    Raises:
        ValueError: If encounter_id is provided but encounter doesn't exist,
                   doesn't match patient, or is in a terminal state (finished/cancelled)
    """
    # If encounter_id provided, validate and return it
    if encounter_id:
        try:
            encounter = Encounter.objects.get(id=encounter_id)

            # Validate encounter belongs to the same patient
            if encounter.patient_id != patient.id:
                raise ValueError(
                    f"Encounter {encounter_id} belongs to a different patient"
                )

            # Validate encounter is not in a terminal state
            if encounter.status in ['finished', 'cancelled']:
                raise ValueError(
                    f"Cannot add entries to {encounter.status} encounter {encounter_id}"
                )

            return encounter, False
        except Encounter.DoesNotExist:
            raise ValueError(f"Encounter {encounter_id} not found")

    # No encounter_id provided, find or create one
    return get_or_create_active_encounter(
        patient=patient,
        practitioner=practitioner,
        encounter_type=encounter_type,
        reason=reason,
        created_by=created_by,
    )


class VisitService:
    """Service for managing outpatient visit lifecycle."""

    @staticmethod
    def _next_queue_number(clinic, date=None):
        date = date or timezone.now().date()
        start_dt = timezone.make_aware(
            datetime.combine(date, time.min),
            timezone.get_current_timezone()
        )
        end_dt = start_dt + timedelta(days=1)
        latest = (
            OutpatientVisit.objects
            .select_for_update()
            .filter(clinic=clinic, checked_in_at__gte=start_dt, checked_in_at__lt=end_dt)
            .aggregate(max_queue=Max('queue_number'))
        )
        current = latest.get('max_queue') or 0
        return current + 1

    @staticmethod
    @transaction.atomic
    def create_visit(encounter, appointment, checked_in_by=None):
        if encounter.encounter_type != 'outpatient':
            raise ValueError("Outpatient visit can only be created for outpatient encounters.")
        if appointment.id != encounter.appointment_id:
            raise ValueError("Encounter must reference the appointment.")
        if hasattr(encounter, 'outpatient_visit'):
            return encounter.outpatient_visit

        queue_number = VisitService._next_queue_number(encounter.clinic)
        return OutpatientVisit.objects.create(
            appointment=appointment,
            encounter=encounter,
            clinic=encounter.clinic,
            queue_number=queue_number,
            checked_in_by=checked_in_by,
        )

    @staticmethod
    def add_to_waiting(visit):
        if visit.visit_status != OutpatientVisit.VisitStatus.CHECKED_IN:
            raise ValueError(f"Cannot move to waiting from {visit.visit_status}")
        visit.visit_status = OutpatientVisit.VisitStatus.WAITING
        visit.save(update_fields=['visit_status', 'updated_at'])
        return visit

    @staticmethod
    def call_patient(visit):
        if visit.visit_status != OutpatientVisit.VisitStatus.WAITING:
            raise ValueError(f"Cannot call patient from {visit.visit_status}")
        visit.visit_status = OutpatientVisit.VisitStatus.CALLED
        visit.called_at = timezone.now()
        visit.save(update_fields=['visit_status', 'called_at', 'updated_at'])
        return visit

    @staticmethod
    def start_consultation(visit):
        allowed = {
            OutpatientVisit.VisitStatus.CALLED,
            OutpatientVisit.VisitStatus.CHECKED_IN,
            OutpatientVisit.VisitStatus.ON_HOLD,
        }
        if visit.visit_status not in allowed:
            raise ValueError(f"Cannot start consultation from {visit.visit_status}")
        visit.visit_status = OutpatientVisit.VisitStatus.IN_PROGRESS
        if not visit.consultation_started_at:
            visit.consultation_started_at = timezone.now()
        visit.save(update_fields=['visit_status', 'consultation_started_at', 'updated_at'])
        return visit

    @staticmethod
    def put_on_hold(visit):
        if visit.visit_status != OutpatientVisit.VisitStatus.IN_PROGRESS:
            raise ValueError(f"Cannot put on hold from {visit.visit_status}")
        visit.visit_status = OutpatientVisit.VisitStatus.ON_HOLD
        visit.save(update_fields=['visit_status', 'updated_at'])
        return visit

    @staticmethod
    def end_consultation(visit):
        if visit.visit_status != OutpatientVisit.VisitStatus.IN_PROGRESS:
            raise ValueError(f"Cannot end consultation from {visit.visit_status}")
        visit.visit_status = OutpatientVisit.VisitStatus.READY_CHECKOUT
        visit.consultation_ended_at = timezone.now()
        visit.save(update_fields=['visit_status', 'consultation_ended_at', 'updated_at'])

        if visit.encounter.appointment_id:
            visit.encounter.appointment.status = 'fulfilled'
            visit.encounter.appointment.save(update_fields=['status', 'updated_at'])

        return visit

    @staticmethod
    def get_checkout_requirements(encounter):
        requirements = {
            'consultation_completed': encounter.outpatient_visit.consultation_ended_at is not None,
        }

        if hasattr(encounter, 'prescriptions'):
            requirements['prescriptions_handled'] = not encounter.prescriptions.filter(
                status='pending'
            ).exists()

        if hasattr(encounter, 'lab_orders'):
            requirements['lab_orders_cleared'] = not encounter.lab_orders.filter(
                status='pending'
            ).exists()

        if hasattr(encounter, 'invoices'):
            requirements['billing_cleared'] = not encounter.invoices.filter(
                status='pending'
            ).exists()

        return requirements

    @staticmethod
    @transaction.atomic
    def checkout(visit, checked_out_by=None, force=False):
        allowed = {
            OutpatientVisit.VisitStatus.READY_CHECKOUT,
            OutpatientVisit.VisitStatus.IN_PROGRESS,
        }
        if visit.visit_status not in allowed:
            raise ValueError(f"Cannot checkout from {visit.visit_status}")

        if not force:
            requirements = VisitService.get_checkout_requirements(visit.encounter)
            failed = [name for name, ok in requirements.items() if ok is False]
            if failed:
                raise ValueError(f"Checkout requirements not met: {', '.join(failed)}")

        visit.visit_status = OutpatientVisit.VisitStatus.CHECKED_OUT
        visit.checked_out_at = timezone.now()
        visit.checked_out_by = checked_out_by
        if not visit.consultation_ended_at:
            visit.consultation_ended_at = timezone.now()
        visit.save(update_fields=[
            'visit_status', 'checked_out_at', 'checked_out_by',
            'consultation_ended_at', 'updated_at'
        ])

        visit.encounter.status = 'finished'
        visit.encounter.end_time = timezone.now()
        visit.encounter.save(update_fields=['status', 'end_time', 'updated_at'])

        if visit.encounter.appointment_id:
            visit.encounter.appointment.status = 'fulfilled'
            visit.encounter.appointment.save(update_fields=['status', 'updated_at'])

        return visit

    @staticmethod
    def mark_no_show(visit):
        allowed = {
            OutpatientVisit.VisitStatus.WAITING,
            OutpatientVisit.VisitStatus.CHECKED_IN,
        }
        if visit.visit_status not in allowed:
            raise ValueError(f"Cannot mark no-show from {visit.visit_status}")
        visit.visit_status = OutpatientVisit.VisitStatus.NO_SHOW
        visit.save(update_fields=['visit_status', 'updated_at'])

        if visit.encounter.appointment_id:
            visit.encounter.appointment.status = 'noshow'
            visit.encounter.appointment.save(update_fields=['status', 'updated_at'])

        return visit

    @staticmethod
    def get_waiting_room(clinic, date=None):
        date = date or timezone.now().date()
        start_dt = timezone.make_aware(
            datetime.combine(date, time.min),
            timezone.get_current_timezone()
        )
        end_dt = start_dt + timedelta(days=1)
        return OutpatientVisit.objects.filter(
            clinic=clinic,
            visit_status__in=[
                OutpatientVisit.VisitStatus.WAITING,
                OutpatientVisit.VisitStatus.CALLED,
            ],
            checked_in_at__gte=start_dt,
            checked_in_at__lt=end_dt,
        ).select_related('encounter__patient__user').order_by('queue_number')


class TriageService:
    """Service for managing the walk-in triage workflow."""

    @staticmethod
    def add_to_queue(patient, facility, chief_complaint='', priority='routine', added_by=None):
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)
        existing = TriageQueue.objects.filter(
            patient=patient,
            facility=facility,
            status__in=[TriageQueue.Status.WAITING, TriageQueue.Status.TRIAGED],
            created_at__gte=today_start,
            created_at__lt=today_end,
        ).first()
        if existing:
            raise ValueError("Patient already in triage queue")

        return TriageQueue.objects.create(
            patient=patient,
            facility=facility,
            chief_complaint=chief_complaint,
            priority=priority,
            status=TriageQueue.Status.WAITING,
        )

    @staticmethod
    def triage_patient(entry, priority, notes='', triaged_by=None):
        if entry.status != TriageQueue.Status.WAITING:
            raise ValueError(f"Cannot triage from status {entry.status}")

        entry.priority = priority
        entry.triage_notes = notes
        entry.triaged_by = triaged_by
        entry.triaged_at = timezone.now()
        entry.status = TriageQueue.Status.TRIAGED
        entry.save(update_fields=['priority', 'triage_notes', 'triaged_by', 'triaged_at', 'status', 'updated_at'])
        return entry

    @staticmethod
    @transaction.atomic
    def assign_to_clinic(entry, clinic, appointment_type, start_time, practitioner=None, assigned_by=None):
        if entry.status != TriageQueue.Status.TRIAGED:
            raise ValueError(f"Cannot assign from status {entry.status}")

        from apps.appointments.services import ConflictPreventionService, AvailabilityService
        from apps.appointments.models import Appointment

        end_time = start_time + timedelta(minutes=appointment_type.duration_minutes)

        if practitioner:
            if not AvailabilityService.is_slot_available(practitioner, start_time, end_time, facility=entry.facility):
                raise ValueError("Practitioner is not available for that time.")
            if not ConflictPreventionService.check_practitioner_availability(
                practitioner.id, start_time, end_time
            ):
                raise ValueError("Practitioner already has an appointment during this time.")

        if not ConflictPreventionService.check_patient_availability(
            entry.patient.id, start_time, end_time
        ):
            raise ValueError("Patient already has an appointment during this time.")

        appointment = Appointment.objects.create(
            facility=entry.facility,
            patient=entry.patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=appointment_type,
            status='booked',
            source='walk_in',
            start_time=start_time,
            end_time=end_time,
            reason=entry.chief_complaint or 'Walk-in visit',
            assignment_status=(
                Appointment.AssignmentStatus.ASSIGNED
                if practitioner else Appointment.AssignmentStatus.PENDING
            ),
            assignment_source=(
                Appointment.AssignmentSource.BOOKING
                if practitioner else None
            ),
            assigned_at=(timezone.now() if practitioner else None),
            created_by=assigned_by,
            updated_by=assigned_by,
        )

        entry.assigned_clinic = clinic
        entry.assigned_practitioner = practitioner
        entry.assigned_at = timezone.now()
        entry.status = TriageQueue.Status.ASSIGNED
        entry.appointment = appointment
        entry.save(update_fields=[
            'assigned_clinic', 'assigned_practitioner', 'assigned_at',
            'status', 'appointment', 'updated_at'
        ])

        return appointment

    @staticmethod
    def cancel(entry):
        if entry.status == TriageQueue.Status.ASSIGNED:
            raise ValueError("Cannot cancel assigned entry")
        entry.status = TriageQueue.Status.CANCELLED
        entry.save(update_fields=['status', 'updated_at'])
        return entry

    @staticmethod
    def get_queue(facility, status=None, priority=None):
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)
        queryset = TriageQueue.objects.filter(
            facility=facility,
            created_at__gte=today_start,
            created_at__lt=today_end,
        ).select_related('patient__user', 'assigned_clinic')

        if status:
            queryset = queryset.filter(status=status)
        else:
            queryset = queryset.exclude(status=TriageQueue.Status.CANCELLED)

        if priority:
            queryset = queryset.filter(priority=priority)

        return queryset
