"""
Pharmacy services for medication dispensing workflow.

This module handles:
- Medication dispensing (releasing from pharmacy stock)
- Supply request processing
- Drug interaction checking (future)
"""
from datetime import timedelta
from django.utils import timezone
from django.db import transaction


def dispense_medication(mar_entry, dispensed_by):
    """
    Mark a MAR entry as dispensed by pharmacy.

    Args:
        mar_entry: MedicationAdministration instance
        dispensed_by: User (pharmacist) who dispensed

    Returns:
        Updated MedicationAdministration instance
    """
    mar_entry.is_dispensed = True
    mar_entry.dispensed_at = timezone.now()
    mar_entry.dispensed_by = dispensed_by
    mar_entry.save()
    return mar_entry


def get_pending_dispensing(patient_id=None, facility=None):
    """
    Get MAR entries awaiting dispensing.

    Args:
        patient_id: Optional filter by patient

    Returns:
        QuerySet of MedicationAdministration entries
    """
    from apps.nursing.models import MedicationAdministration

    # Show ALL undispensed scheduled medications
    # Pharmacy needs to see everything that hasn't been dispensed yet
    # Including overdue ones (they still need to be dispensed or addressed)
    queryset = MedicationAdministration.objects.filter(
        status='scheduled',
        is_dispensed=False,
    ).select_related(
        'patient', 'patient__user',
        'prescription',
        'prescribed_by', 'prescribed_by__staff', 'prescribed_by__staff__user'
    )

    if facility is not None:
        queryset = queryset.filter(facility=facility)

    if patient_id:
        queryset = queryset.filter(patient_id=patient_id)

    return queryset.order_by('scheduled_time')


def get_dispensed_ready_for_admin(patient_id=None, facility=None):
    """
    Get MAR entries that are dispensed and ready for nurse administration.

    Args:
        patient_id: Optional filter by patient

    Returns:
        QuerySet of MedicationAdministration entries
    """
    from apps.nursing.models import MedicationAdministration

    queryset = MedicationAdministration.objects.filter(
        status='scheduled',
        is_dispensed=True,
        scheduled_time__lte=timezone.now() + timedelta(hours=2),  # Due within 2 hours
    ).select_related('patient', 'prescription', 'prescribed_by')

    if facility is not None:
        queryset = queryset.filter(facility=facility)

    if patient_id:
        queryset = queryset.filter(patient_id=patient_id)

    return queryset.order_by('scheduled_time')


def dispense_supply_request(supply_request, quantity_dispensed, dispensed_by):
    """
    Mark a supply request as dispensed and update treatment entry counts.

    Args:
        supply_request: SupplyRequest instance
        quantity_dispensed: Actual quantity dispensed
        dispensed_by: User (pharmacist) who dispensed

    Returns:
        Updated SupplyRequest instance
    """
    with transaction.atomic():
        # Update supply request
        supply_request.status = 'dispensed'
        supply_request.quantity_dispensed = quantity_dispensed
        supply_request.dispensed_by = dispensed_by
        supply_request.dispensed_at = timezone.now()
        supply_request.save()

        # Update treatment entry aggregate counts
        entry = supply_request.treatment_entry
        entry.total_doses_dispensed += quantity_dispensed
        entry.save()

        return supply_request


def reject_supply_request(supply_request, rejection_reason, rejected_by):
    """
    Reject a supply request.

    Args:
        supply_request: SupplyRequest instance
        rejection_reason: Reason for rejection
        rejected_by: User who rejected

    Returns:
        Updated SupplyRequest instance
    """
    supply_request.status = 'rejected'
    supply_request.rejection_reason = rejection_reason
    supply_request.save()
    return supply_request


def get_pending_supply_requests(patient_id=None, admission_id=None, facility=None):
    """
    Get pending supply requests, optionally filtered.

    Args:
        patient_id: Optional filter by patient
        admission_id: Optional filter by admission

    Returns:
        QuerySet of SupplyRequest entries
    """
    from apps.nursing.models import SupplyRequest

    queryset = SupplyRequest.objects.filter(
        status='pending'
    ).select_related(
        'treatment_entry',
        'treatment_entry__patient',
        'treatment_entry__patient__user',
        'treatment_entry__admission',
        'requested_by',
        'requested_by__staff',
        'requested_by__staff__user'
    ).order_by('-requested_at')

    if facility is not None:
        queryset = queryset.filter(facility=facility)

    if patient_id:
        queryset = queryset.filter(treatment_entry__patient_id=patient_id)

    if admission_id:
        queryset = queryset.filter(treatment_entry__admission_id=admission_id)

    return queryset
