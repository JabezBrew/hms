"""
Encounter services for automatic encounter management.

This module provides utilities for finding or creating active encounters
for patients, ensuring clinical entries are always properly linked.
"""
from django.utils import timezone
from django.db import transaction

from .models import Encounter, Admission


def get_or_create_active_encounter(patient, practitioner=None, encounter_type=None, reason=None):
    """
    Find an active encounter for a patient or create a new one.

    Logic:
    1. If patient has an active inpatient admission, return that admission's encounter
    2. If patient has an active outpatient encounter today (same practitioner if provided), return it
    3. Otherwise, create a new encounter

    Args:
        patient: PatientProfile instance
        practitioner: PractitionerProfile instance (optional)
        encounter_type: 'inpatient', 'outpatient', or 'emergency' (optional, defaults to 'outpatient')
        reason: Reason for the encounter (optional)

    Returns:
        tuple: (Encounter instance, bool created)
    """
    today = timezone.now().date()

    # Rule 1: Check for active inpatient admission
    # If patient is admitted, ALL entries should go to the admission's encounter
    active_admission = Admission.objects.filter(
        patient=patient,
        status='admitted'
    ).select_related('encounter').first()

    if active_admission:
        # Get or create the encounter for this admission
        if hasattr(active_admission, 'encounter') and active_admission.encounter:
            return active_admission.encounter, False

        # Edge case: Admission exists but no encounter linked (shouldn't happen but handle it)
        with transaction.atomic():
            encounter = Encounter.objects.create(
                patient=patient,
                practitioner=active_admission.admitting_doctor,
                encounter_type='inpatient',
                status='in-progress',
                start_time=active_admission.admission_date,
                admission=active_admission,
                reason=reason or f"Inpatient admission",
                location=active_admission.bed.ward.name if active_admission.bed else None,
            )
            return encounter, True

    # Rule 2: Check for active outpatient/emergency encounter today
    # For outpatient, we want encounters on the same day
    filters = {
        'patient': patient,
        'status': 'in-progress',
        'start_time__date': today,
        'encounter_type__in': ['outpatient', 'emergency'],
    }

    # If practitioner is provided, prefer same practitioner's encounter
    if practitioner:
        practitioner_encounter = Encounter.objects.filter(
            **filters,
            practitioner=practitioner
        ).first()
        if practitioner_encounter:
            return practitioner_encounter, False

    # Check for any active encounter today (different practitioner)
    any_encounter = Encounter.objects.filter(**filters).first()
    if any_encounter:
        return any_encounter, False

    # Rule 3: Create new encounter
    with transaction.atomic():
        encounter = Encounter.objects.create(
            patient=patient,
            practitioner=practitioner,
            encounter_type=encounter_type or 'outpatient',
            status='in-progress',
            start_time=timezone.now(),
            reason=reason or 'Clinical documentation',
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
    today = timezone.now().date()

    # Check for active inpatient admission first
    active_admission = Admission.objects.filter(
        patient=patient,
        status='admitted'
    ).select_related('encounter').first()

    if active_admission and hasattr(active_admission, 'encounter') and active_admission.encounter:
        return active_admission.encounter

    # Check for active outpatient encounter today
    return Encounter.objects.filter(
        patient=patient,
        status='in-progress',
        start_time__date=today,
        encounter_type__in=['outpatient', 'emergency'],
    ).first()


def ensure_encounter_for_entry(patient, practitioner=None, encounter_id=None, reason=None):
    """
    Ensure an entry has an encounter to link to.

    This is the main function to use when creating clinical entries (notes, vitals, prescriptions).

    Args:
        patient: PatientProfile instance
        practitioner: PractitionerProfile instance (optional)
        encounter_id: UUID of existing encounter (optional) - if provided, validates and returns it
        reason: Reason for encounter if creating new one (optional)

    Returns:
        tuple: (Encounter instance, bool created)

    Raises:
        ValueError: If encounter_id is provided but encounter doesn't exist or doesn't match patient
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

            return encounter, False
        except Encounter.DoesNotExist:
            raise ValueError(f"Encounter {encounter_id} not found")

    # No encounter_id provided, find or create one
    return get_or_create_active_encounter(
        patient=patient,
        practitioner=practitioner,
        reason=reason
    )
