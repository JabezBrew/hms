"""
Nursing services for medication administration workflow.
"""
from datetime import datetime, timedelta, time
from django.utils import timezone
from django.db import transaction
from .models import MedicationAdministration


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


def get_pending_dispensing(patient_id=None):
    """
    Get MAR entries awaiting dispensing.

    Args:
        patient_id: Optional filter by patient

    Returns:
        QuerySet of MedicationAdministration entries
    """
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

    if patient_id:
        queryset = queryset.filter(patient_id=patient_id)

    return queryset.order_by('scheduled_time')


def get_dispensed_ready_for_admin(patient_id=None):
    """
    Get MAR entries that are dispensed and ready for nurse administration.

    Args:
        patient_id: Optional filter by patient

    Returns:
        QuerySet of MedicationAdministration entries
    """
    queryset = MedicationAdministration.objects.filter(
        status='scheduled',
        is_dispensed=True,
        scheduled_time__lte=timezone.now() + timedelta(hours=2),  # Due within 2 hours
    ).select_related('patient', 'prescription', 'prescribed_by')

    if patient_id:
        queryset = queryset.filter(patient_id=patient_id)

    return queryset.order_by('scheduled_time')
