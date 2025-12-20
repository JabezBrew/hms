"""
Nursing services for medication administration workflow.
"""
from datetime import datetime, timedelta, time
from django.utils import timezone
from django.db import transaction
from .models import MedicationAdministration, TreatmentSheetEntry, SupplyRequest


# Default administration times for different frequencies
# Times are in 24-hour format, representing typical hospital medication rounds
FREQUENCY_SCHEDULES = {
    'once': [],  # Single dose, scheduled at start_date
    'daily': [time(9, 0)],  # 9 AM
    'bid': [time(9, 0), time(21, 0)],  # 9 AM, 9 PM
    'tid': [time(8, 0), time(14, 0), time(20, 0)],  # 8 AM, 2 PM, 8 PM
    'qid': [time(8, 0), time(12, 0), time(17, 0), time(21, 0)],  # 8 AM, 12 PM, 5 PM, 9 PM
    'q4h': [time(6, 0), time(10, 0), time(14, 0), time(18, 0), time(22, 0), time(2, 0)],
    'q6h': [time(6, 0), time(12, 0), time(18, 0), time(0, 0)],
    'q8h': [time(6, 0), time(14, 0), time(22, 0)],
    'q12h': [time(8, 0), time(20, 0)],
    'qhs': [time(21, 0)],  # At bedtime (9 PM)
    'weekly': [time(9, 0)],  # Weekly at 9 AM
    'stat': [],  # Immediately - scheduled at creation time
    'prn': [],  # As needed - no scheduled times, created on demand
}


def get_scheduled_times_for_frequency(frequency):
    """
    Get the list of scheduled times for a given frequency.
    Returns list of time objects.
    """
    return FREQUENCY_SCHEDULES.get(frequency.lower(), [time(9, 0)])


def generate_mar_entries_for_prescription(prescription, days=None, start_date=None, created_by=None):
    """
    Generate Medication Administration Record entries for a prescription.

    Args:
        prescription: The Prescription instance
        days: Number of days to generate (defaults to prescription.duration_days or 7)
        start_date: Start date for generation (defaults to prescription.start_date)
        created_by: User who triggered the generation

    Returns:
        List of created MedicationAdministration instances
    """
    if prescription.status not in ['active', 'on_hold']:
        return []

    # Determine date range
    if start_date is None:
        start_date = prescription.start_date or timezone.now().date()

    if days is None:
        days = prescription.duration_days or 7  # Default to 7 days if no duration

    # Don't exceed prescription end date
    if prescription.end_date:
        max_date = prescription.end_date
        actual_days = min(days, (max_date - start_date).days + 1)
    else:
        actual_days = days

    # Get frequency schedule
    frequency = prescription.frequency.lower()
    scheduled_times = get_scheduled_times_for_frequency(frequency)

    # Handle special frequencies
    if frequency == 'stat':
        # STAT: single dose immediately
        scheduled_times = [timezone.now().time()]
        actual_days = 1
    elif frequency == 'once':
        # Single dose at 9 AM on start date
        scheduled_times = [time(9, 0)]
        actual_days = 1
    elif frequency == 'prn':
        # PRN (as needed): Don't auto-generate, nurses create as needed
        return []
    elif frequency == 'weekly':
        # Weekly: only on start date's weekday
        actual_days = (actual_days // 7) + 1  # Number of weeks

    created_entries = []

    with transaction.atomic():
        current_date = start_date

        for day_offset in range(actual_days):
            if frequency == 'weekly':
                current_date = start_date + timedelta(weeks=day_offset)
            else:
                current_date = start_date + timedelta(days=day_offset)

            # Check if we've passed the end date
            if prescription.end_date and current_date > prescription.end_date:
                break

            for sched_time in scheduled_times:
                # Create datetime for scheduled time
                scheduled_datetime = timezone.make_aware(
                    datetime.combine(current_date, sched_time)
                ) if timezone.is_naive(datetime.combine(current_date, sched_time)) else datetime.combine(current_date, sched_time)

                # Check if entry already exists for this prescription/time
                existing = MedicationAdministration.objects.filter(
                    prescription=prescription,
                    scheduled_time=scheduled_datetime
                ).exists()

                if not existing:
                    mar_entry = MedicationAdministration.objects.create(
                        patient=prescription.patient,
                        medication_name=prescription.medication_name,
                        dosage=prescription.dosage,
                        route=prescription.get_route_display(),
                        frequency=prescription.get_frequency_display(),
                        scheduled_time=scheduled_datetime,
                        status='scheduled',
                        prescribed_by=prescription.prescribed_by,
                        prescription=prescription,
                        created_by=created_by,
                        is_dispensed=False,
                    )
                    created_entries.append(mar_entry)

    return created_entries


def generate_daily_mar_entries(date=None, created_by=None):
    """
    Generate MAR entries for all active prescriptions for a specific date.
    Typically called by a scheduled task.

    Args:
        date: Date to generate for (defaults to today)
        created_by: User who triggered the generation

    Returns:
        Dictionary with counts by prescription
    """
    from apps.clinical_notes.models import Prescription

    if date is None:
        date = timezone.now().date()

    # Get all active prescriptions
    active_prescriptions = Prescription.objects.filter(
        status='active'
    ).filter(
        start_date__lte=date
    ).filter(
        # Either no end date or end date is in the future
        end_date__isnull=True
    ) | Prescription.objects.filter(
        status='active',
        start_date__lte=date,
        end_date__gte=date
    )

    results = {
        'date': str(date),
        'prescriptions_processed': 0,
        'entries_created': 0,
        'details': []
    }

    for prescription in active_prescriptions:
        entries = generate_mar_entries_for_prescription(
            prescription,
            days=1,
            start_date=date,
            created_by=created_by
        )
        results['prescriptions_processed'] += 1
        results['entries_created'] += len(entries)
        if entries:
            results['details'].append({
                'prescription_id': str(prescription.id),
                'medication': prescription.medication_name,
                'entries_created': len(entries)
            })

    return results


# Note: Pharmacy-related functions (dispense_medication, get_pending_dispensing,
# get_dispensed_ready_for_admin) have been moved to apps.pharmacy.services


# ============================================================================
# Treatment Sheet Services
# ============================================================================


def calculate_daily_doses(frequency):
    """
    Calculate the number of daily doses based on frequency string.

    Args:
        frequency: Frequency string (e.g., 'bid', 'tid', 'q6h')

    Returns:
        Integer number of daily doses
    """
    frequency_lower = frequency.lower()

    if 'bid' in frequency_lower or 'twice' in frequency_lower:
        return 2
    elif 'tid' in frequency_lower or 'three' in frequency_lower:
        return 3
    elif 'qid' in frequency_lower or 'four' in frequency_lower:
        return 4
    elif 'q4h' in frequency_lower:
        return 6
    elif 'q6h' in frequency_lower:
        return 4
    elif 'q8h' in frequency_lower:
        return 3
    elif 'q12h' in frequency_lower:
        return 2
    elif 'daily' in frequency_lower or 'once' in frequency_lower:
        return 1

    return 1  # Default to once daily


def create_treatment_entry_with_mar(treatment_data, created_by=None):
    """
    Create a treatment sheet entry and generate initial MAR entries.

    Args:
        treatment_data: Dictionary of treatment entry fields
        created_by: User who created the entry

    Returns:
        Created TreatmentSheetEntry instance
    """
    with transaction.atomic():
        # Create treatment entry
        entry = TreatmentSheetEntry.objects.create(**treatment_data, created_by=created_by)

        # Generate MAR entries using existing logic
        # If linked to prescription, use that; otherwise create a mock object
        if entry.prescription:
            mar_entries = generate_mar_entries_for_prescription(
                entry.prescription,
                days=entry.duration_days or 3,
                start_date=entry.start_datetime.date(),
                created_by=created_by
            )
        else:
            # Create MAR entries directly for treatment entry without prescription
            frequency_lower = entry.frequency.lower()
            scheduled_times = get_scheduled_times_for_frequency(frequency_lower)

            days = entry.duration_days or 3
            start_date = entry.start_datetime.date()
            mar_entries = []

            for day_offset in range(days):
                current_date = start_date + timedelta(days=day_offset)

                # Check if we've passed end date
                if entry.end_datetime and current_date > entry.end_datetime.date():
                    break

                for sched_time in scheduled_times:
                    scheduled_datetime = timezone.make_aware(
                        datetime.combine(current_date, sched_time)
                    ) if timezone.is_naive(datetime.combine(current_date, sched_time)) else datetime.combine(current_date, sched_time)

                    mar_entry = MedicationAdministration.objects.create(
                        patient=entry.patient,
                        medication_name=entry.medication_name,
                        dosage=entry.dosage,
                        route=entry.route,
                        frequency=entry.frequency,
                        scheduled_time=scheduled_datetime,
                        status='scheduled',
                        prescribed_by=entry.ordered_by,
                        treatment_entry=entry,
                        created_by=created_by,
                        is_dispensed=False,
                    )
                    mar_entries.append(mar_entry)

        # Link MAR entries to treatment entry (if they were created from prescription)
        if entry.prescription:
            for mar_entry in mar_entries:
                mar_entry.treatment_entry = entry
                mar_entry.save()

        # Update total_doses_ordered
        entry.total_doses_ordered = len(mar_entries)
        entry.save()

        return entry


def calculate_supply_needed(entry, days=3):
    """
    Calculate doses needed for next N days based on treatment entry frequency.

    Args:
        entry: TreatmentSheetEntry instance
        days: Number of days to calculate for

    Returns:
        Integer number of doses needed
    """
    daily_doses = calculate_daily_doses(entry.frequency)
    return daily_doses * days


def create_supply_request(treatment_entry, quantity, requested_by, notes=''):
    """
    Create a supply request for a treatment entry.

    Args:
        treatment_entry: TreatmentSheetEntry instance
        quantity: Number of doses requested
        requested_by: PractitionerProfile who requested
        notes: Optional notes

    Returns:
        Created SupplyRequest instance
    """
    supply_request = SupplyRequest.objects.create(
        treatment_entry=treatment_entry,
        quantity_requested=quantity,
        requested_by=requested_by,
        notes=notes
    )
    return supply_request


# Note: Pharmacy-related supply request functions (dispense_supply_request,
# reject_supply_request, get_pending_supply_requests) have been moved to
# apps.pharmacy.services


def get_treatment_sheet_by_admission(admission_id):
    """
    Get all active treatment sheet entries for an admission.

    Args:
        admission_id: Admission UUID

    Returns:
        QuerySet of TreatmentSheetEntry entries
    """
    return TreatmentSheetEntry.objects.filter(
        admission_id=admission_id,
        status='active'
    ).select_related(
        'patient',
        'patient__user',
        'ordered_by',
        'ordered_by__staff',
        'ordered_by__staff__user'
    ).prefetch_related(
        'supply_requests',
        'dose_administrations'
    ).order_by('-start_datetime')


def update_administered_count(treatment_entry):
    """
    Update the total_doses_administered count for a treatment entry.
    Should be called after a MAR entry is marked as administered.

    Args:
        treatment_entry: TreatmentSheetEntry instance

    Returns:
        Updated count
    """
    administered_count = MedicationAdministration.objects.filter(
        treatment_entry=treatment_entry,
        status='administered'
    ).count()

    treatment_entry.total_doses_administered = administered_count
    treatment_entry.save()

    return administered_count
