"""
Encounter services for automatic encounter management.

This module provides utilities for finding or creating active encounters
for patients, ensuring clinical entries are always properly linked.
"""
from django.utils import timezone
from django.db import transaction
from django.db.models import Q

from .models import Encounter


def get_or_create_active_encounter(
    patient,
    practitioner=None,
    encounter_type=None,
    reason=None,
    created_by=None
):
    """
    Find an active encounter for a patient or create a new one.

    Uses select_for_update to prevent race conditions when creating encounters.

    Logic:
    1. If patient has an active inpatient admission, return that admission's encounter
    2. If patient has a planned encounter today (transition to in-progress), return it
    3. If patient has an active outpatient/emergency encounter today, return it
    4. Otherwise, create a new encounter

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

    today = timezone.now().date()
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
                encounter_type='inpatient',
                status='in-progress',
                start_time=active_admission.admission_date,
                admission=active_admission,
                reason=reason or "Inpatient admission",
                location=active_admission.bed.ward.name if active_admission.bed else None,
                created_by=created_by,
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
            'start_time__date': today,
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
            'start_time__date': today,
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

        # Rule 4: Create new encounter
        encounter = Encounter.objects.create(
            patient=patient,
            facility=patient.facility,
            practitioner=practitioner,
            encounter_type=effective_type,
            status='in-progress',
            start_time=timezone.now(),
            reason=reason or 'Clinical documentation',
            created_by=created_by,
        )
        return encounter, True


def get_active_encounter_for_patient(patient):
    """
    Get the currently active encounter for a patient, if any exists.

    Unlike get_or_create_active_encounter, this does NOT create a new encounter.

    Args:
        patient: PatientProfile instance

    Returns:
        Encounter instance or None
    """
    from apps.wards.models import Admission

    today = timezone.now().date()

    # Check for active inpatient admission first
    # Order by admission_date desc to get most recent
    active_admission = Admission.objects.filter(
        patient=patient,
        status='admitted'
    ).select_related('encounter').order_by('-admission_date').first()

    if active_admission and hasattr(active_admission, 'encounter') and active_admission.encounter:
        return active_admission.encounter

    # Check for active outpatient encounter today (in-progress or planned)
    return Encounter.objects.filter(
        patient=patient,
        status__in=['in-progress', 'planned'],
        start_time__date=today,
        encounter_type__in=['outpatient', 'emergency'],
    ).first()


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
