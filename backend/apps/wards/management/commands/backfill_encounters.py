"""
Management command to backfill encounters for orphaned clinical entries.

This command finds all NoteEntry, VitalSigns, and Prescription records that
don't have an encounter linked and assigns them to appropriate encounters.

Logic:
1. For each orphaned entry, check if patient had an active inpatient admission
   at the time the entry was created - if so, use that admission's encounter
2. If no inpatient admission, check for an existing outpatient encounter on the
   same day by the same practitioner
3. If still no encounter, create a new outpatient encounter for that day

Usage:
    python manage.py backfill_encounters          # Dry run (default)
    python manage.py backfill_encounters --apply  # Actually apply changes
    python manage.py backfill_encounters --verbose  # Show detailed output
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from datetime import datetime, time

from apps.clinical_notes.models import NoteEntry, Prescription
from apps.nursing.models import VitalSigns
from apps.wards.models import Encounter, Admission


class Command(BaseCommand):
    help = 'Backfill encounters for orphaned clinical entries (notes, vitals, prescriptions)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            default=False,
            help='Actually apply the changes (default is dry run)',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            default=False,
            help='Show detailed output for each entry',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']
        verbose = options['verbose']

        if not apply_changes:
            self.stdout.write(self.style.WARNING(
                '\n=== DRY RUN MODE ===\n'
                'No changes will be made. Use --apply to actually update records.\n'
            ))

        # Statistics
        stats = {
            'notes': {'found': 0, 'linked_existing': 0, 'created_new': 0, 'errors': 0},
            'vitals': {'found': 0, 'linked_existing': 0, 'created_new': 0, 'errors': 0},
            'prescriptions': {'found': 0, 'linked_existing': 0, 'created_new': 0, 'errors': 0},
        }

        # Process each entry type
        self.stdout.write('\n--- Processing Note Entries ---')
        self._process_notes(stats['notes'], apply_changes, verbose)

        self.stdout.write('\n--- Processing Vital Signs ---')
        self._process_vitals(stats['vitals'], apply_changes, verbose)

        self.stdout.write('\n--- Processing Prescriptions ---')
        self._process_prescriptions(stats['prescriptions'], apply_changes, verbose)

        # Print summary
        self._print_summary(stats, apply_changes)

    def _find_or_create_encounter_for_entry(self, patient, practitioner, entry_datetime, reason, apply_changes):
        """
        Find or create an encounter for an orphaned entry.

        Returns:
            tuple: (Encounter, created: bool, action: str)
        """
        entry_date = entry_datetime.date()

        # Check for active inpatient admission at the time of entry
        admission = Admission.objects.filter(
            patient=patient,
            admission_date__lte=entry_datetime,
        ).filter(
            # Either still admitted or discharged after the entry was created
            Q(status='admitted') |
            Q(actual_discharge_date__gte=entry_datetime)
        ).select_related('encounter').first()

        if admission:
            if hasattr(admission, 'encounter') and admission.encounter:
                return admission.encounter, False, 'linked_to_admission'

            # Admission exists but no encounter - create one if applying
            if apply_changes:
                encounter = Encounter.objects.create(
                    patient=patient,
                    practitioner=admission.admitting_doctor,
                    encounter_type='inpatient',
                    status='in-progress' if admission.status == 'admitted' else 'finished',
                    start_time=admission.admission_date,
                    end_time=admission.actual_discharge_date,
                    admission=admission,
                    reason=reason,
                    location=admission.bed.ward.name if admission.bed else None,
                )
                return encounter, True, 'created_for_admission'
            return None, True, 'would_create_for_admission'

        # Check for existing outpatient encounter on the same day
        filters = {
            'patient': patient,
            'start_time__date': entry_date,
            'encounter_type__in': ['outpatient', 'emergency'],
        }

        # Prefer same practitioner's encounter if available
        if practitioner:
            existing = Encounter.objects.filter(**filters, practitioner=practitioner).first()
            if existing:
                return existing, False, 'linked_to_existing_same_practitioner'

        # Try any encounter on that day
        existing = Encounter.objects.filter(**filters).first()
        if existing:
            return existing, False, 'linked_to_existing_other_practitioner'

        # Create new outpatient encounter
        if apply_changes:
            # Set start_time to beginning of day for historical entries
            start_time = datetime.combine(entry_date, time(9, 0))  # 9 AM
            start_time = timezone.make_aware(start_time) if timezone.is_naive(start_time) else start_time

            encounter = Encounter.objects.create(
                patient=patient,
                practitioner=practitioner,
                encounter_type='outpatient',
                status='finished',  # Historical entries are finished
                start_time=start_time,
                end_time=start_time,  # Same day
                reason=reason,
            )
            return encounter, True, 'created_new_outpatient'

        return None, True, 'would_create_new_outpatient'

    def _process_notes(self, stats, apply_changes, verbose):
        """Process orphaned note entries."""
        orphaned = NoteEntry.objects.filter(encounter__isnull=True).select_related(
            'patient', 'practitioner', 'template'
        )
        stats['found'] = orphaned.count()

        for note in orphaned:
            if not note.patient:
                stats['errors'] += 1
                if verbose:
                    self.stdout.write(self.style.ERROR(f'  Note {note.id}: No patient linked, skipping'))
                continue

            try:
                encounter, created, action = self._find_or_create_encounter_for_entry(
                    patient=note.patient,
                    practitioner=note.practitioner,
                    entry_datetime=note.created_at,
                    reason=f'Clinical note: {note.template.title if note.template else "Unknown"}',
                    apply_changes=apply_changes
                )

                if apply_changes and encounter:
                    note.encounter = encounter
                    note.save(update_fields=['encounter'])

                if created:
                    stats['created_new'] += 1
                else:
                    stats['linked_existing'] += 1

                if verbose:
                    self.stdout.write(f'  Note {note.id}: {action}')

            except Exception as e:
                stats['errors'] += 1
                self.stdout.write(self.style.ERROR(f'  Note {note.id}: Error - {str(e)}'))

    def _process_vitals(self, stats, apply_changes, verbose):
        """Process orphaned vital signs."""
        orphaned = VitalSigns.objects.filter(encounter__isnull=True).select_related(
            'patient', 'recorded_by'
        )
        stats['found'] = orphaned.count()

        for vital in orphaned:
            if not vital.patient:
                stats['errors'] += 1
                if verbose:
                    self.stdout.write(self.style.ERROR(f'  Vital {vital.id}: No patient linked, skipping'))
                continue

            try:
                encounter, created, action = self._find_or_create_encounter_for_entry(
                    patient=vital.patient,
                    practitioner=vital.recorded_by,
                    entry_datetime=vital.recorded_at,
                    reason='Vital signs recording',
                    apply_changes=apply_changes
                )

                if apply_changes and encounter:
                    vital.encounter = encounter
                    vital.save(update_fields=['encounter'])

                if created:
                    stats['created_new'] += 1
                else:
                    stats['linked_existing'] += 1

                if verbose:
                    self.stdout.write(f'  Vital {vital.id}: {action}')

            except Exception as e:
                stats['errors'] += 1
                self.stdout.write(self.style.ERROR(f'  Vital {vital.id}: Error - {str(e)}'))

    def _process_prescriptions(self, stats, apply_changes, verbose):
        """Process orphaned prescriptions."""
        orphaned = Prescription.objects.filter(encounter__isnull=True).select_related(
            'patient', 'prescribed_by'
        )
        stats['found'] = orphaned.count()

        for rx in orphaned:
            if not rx.patient:
                stats['errors'] += 1
                if verbose:
                    self.stdout.write(self.style.ERROR(f'  Rx {rx.id}: No patient linked, skipping'))
                continue

            try:
                encounter, created, action = self._find_or_create_encounter_for_entry(
                    patient=rx.patient,
                    practitioner=rx.prescribed_by,
                    entry_datetime=rx.created_at,
                    reason=f'Prescription: {rx.medication_name}',
                    apply_changes=apply_changes
                )

                if apply_changes and encounter:
                    rx.encounter = encounter
                    rx.save(update_fields=['encounter'])

                if created:
                    stats['created_new'] += 1
                else:
                    stats['linked_existing'] += 1

                if verbose:
                    self.stdout.write(f'  Rx {rx.id}: {action}')

            except Exception as e:
                stats['errors'] += 1
                self.stdout.write(self.style.ERROR(f'  Rx {rx.id}: Error - {str(e)}'))

    def _print_summary(self, stats, apply_changes):
        """Print summary of operations."""
        self.stdout.write('\n' + '=' * 50)
        self.stdout.write(self.style.SUCCESS('SUMMARY'))
        self.stdout.write('=' * 50)

        total_found = sum(s['found'] for s in stats.values())
        total_linked = sum(s['linked_existing'] for s in stats.values())
        total_created = sum(s['created_new'] for s in stats.values())
        total_errors = sum(s['errors'] for s in stats.values())

        self.stdout.write(f'\nOrphaned entries found:')
        self.stdout.write(f'  - Notes:         {stats["notes"]["found"]}')
        self.stdout.write(f'  - Vitals:        {stats["vitals"]["found"]}')
        self.stdout.write(f'  - Prescriptions: {stats["prescriptions"]["found"]}')
        self.stdout.write(f'  - TOTAL:         {total_found}')

        action_word = 'Updated' if apply_changes else 'Would update'
        self.stdout.write(f'\n{action_word}:')
        self.stdout.write(f'  - Linked to existing encounters: {total_linked}')
        self.stdout.write(f'  - Created new encounters:        {total_created}')
        self.stdout.write(f'  - Errors/skipped:                {total_errors}')

        if not apply_changes and total_found > 0:
            self.stdout.write(self.style.WARNING(
                f'\nRun with --apply to actually update {total_found} records.'
            ))
        elif apply_changes and total_found > 0:
            self.stdout.write(self.style.SUCCESS(
                f'\nSuccessfully processed {total_found - total_errors} entries.'
            ))
