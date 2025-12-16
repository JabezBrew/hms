"""
Management command to backfill TimelineEvent table from existing data.

Usage:
    python manage.py backfill_timeline_events
    python manage.py backfill_timeline_events --clear  # Clear existing events first
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.clinical_notes.models import TimelineEvent, NoteEntry, Prescription, NoteEntryVersion
from apps.nursing.models import VitalSigns
from apps.laboratory.models import LabOrder
from apps.referrals.models import Referral


class Command(BaseCommand):
    help = 'Backfill TimelineEvent table from existing clinical data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear existing timeline events before backfilling',
        )

    def handle(self, *args, **options):
        if options['clear']:
            self.stdout.write('Clearing existing timeline events...')
            TimelineEvent.objects.all().delete()

        stats = {
            'notes': {'created': 0, 'updated': 0},
            'prescriptions': {'created': 0, 'updated': 0},
            'vitals': {'created': 0, 'updated': 0},
            'labs': {'created': 0, 'updated': 0},
            'referrals': {'created': 0, 'updated': 0},
        }

        # Backfill NoteEntry
        self.stdout.write('Backfilling NoteEntry...')
        notes = NoteEntry.objects.select_related(
            'template', 'patient', 'encounter', 'practitioner__staff__user'
        ).all()
        
        for note in notes:
            created, updated = self._sync_note(note)
            if created:
                stats['notes']['created'] += 1
            else:
                stats['notes']['updated'] += 1

        # Backfill Prescription
        self.stdout.write('Backfilling Prescription...')
        prescriptions = Prescription.objects.select_related(
            'patient', 'encounter', 'prescribed_by__staff__user'
        ).all()
        
        for rx in prescriptions:
            created, updated = self._sync_prescription(rx)
            if created:
                stats['prescriptions']['created'] += 1
            else:
                stats['prescriptions']['updated'] += 1

        # Backfill VitalSigns
        self.stdout.write('Backfilling VitalSigns...')
        vitals = VitalSigns.objects.select_related(
            'patient', 'encounter', 'recorded_by__staff__user'
        ).all()
        
        for v in vitals:
            created, updated = self._sync_vitals(v)
            if created:
                stats['vitals']['created'] += 1
            else:
                stats['vitals']['updated'] += 1

        # Backfill LabOrder
        self.stdout.write('Backfilling LabOrder...')
        labs = LabOrder.objects.select_related(
            'patient', 'encounter', 'ordering_provider__staff__user'
        ).prefetch_related('order_tests__test').all()
        
        for lab in labs:
            created, updated = self._sync_lab_order(lab)
            if created:
                stats['labs']['created'] += 1
            else:
                stats['labs']['updated'] += 1

        # Backfill Referral
        self.stdout.write('Backfilling Referral...')
        referrals = Referral.objects.select_related(
            'patient', 'encounter', 'referring_provider__staff__user'
        ).all()
        
        for ref in referrals:
            created, updated = self._sync_referral(ref)
            if created:
                stats['referrals']['created'] += 1
            else:
                stats['referrals']['updated'] += 1

        # Print summary
        self.stdout.write(self.style.SUCCESS('\nBackfill complete!'))
        for model, counts in stats.items():
            self.stdout.write(f"  {model}: {counts['created']} created, {counts['updated']} updated")

    def _get_note_summary(self, note):
        """Extract a short summary from note data."""
        data = note.data or {}
        for key in ['chief_complaint', 'summary', 'subjective', 'assessment', 'diagnosis']:
            if key in data and data[key]:
                text = str(data[key])
                return text[:500] if len(text) > 500 else text
        for key, value in data.items():
            if value and isinstance(value, str) and len(value) > 10:
                return value[:500] if len(value) > 500 else value
        return ''

    def _get_note_search_text(self, note):
        """Build searchable text from note data."""
        parts = []
        if note.template:
            parts.append(note.template.title)
        data = note.data or {}
        for value in data.values():
            if isinstance(value, str):
                parts.append(value)
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        parts.append(item)
        return ' '.join(parts)

    def _sync_note(self, note):
        """Sync a NoteEntry to TimelineEvent."""
        version_count = NoteEntryVersion.objects.filter(note_entry=note).count()

        author_name = ''
        author_id = None
        if note.practitioner and note.practitioner.staff and note.practitioner.staff.user:
            author_name = note.practitioner.staff.user.get_full_name()
            author_id = note.practitioner.staff.user.id

        obj, created = TimelineEvent.objects.update_or_create(
            source_model='NoteEntry',
            source_id=note.id,
            defaults={
                'patient': note.patient,
                'encounter': note.encounter,
                'event_type': 'note',
                'event_subtype': note.template.category if note.template else '',
                'timestamp': note.created_at,
                'title': note.template.title if note.template else 'Clinical Note',
                'content_summary': self._get_note_summary(note),
                'author_name': author_name,
                'author_id': author_id,
                'is_critical': False,
                'status': '',
                'has_edits': version_count > 0,
                'version_count': version_count,
                'template_id': note.template.id if note.template else None,
                'template_title': note.template.title if note.template else '',
                'search_text': self._get_note_search_text(note),
            }
        )
        return created, not created

    def _sync_prescription(self, rx):
        """Sync a Prescription to TimelineEvent."""
        author_name = ''
        author_id = None
        if rx.prescribed_by and rx.prescribed_by.staff and rx.prescribed_by.staff.user:
            author_name = rx.prescribed_by.staff.user.get_full_name()
            author_id = rx.prescribed_by.staff.user.id

        summary = f"{rx.medication_name} {rx.dosage}"
        if rx.frequency:
            summary += f" {rx.get_frequency_display()}"
        if rx.route:
            summary += f" ({rx.get_route_display()})"

        search_parts = [rx.medication_name, rx.dosage, rx.instructions or '', rx.reason or '']

        obj, created = TimelineEvent.objects.update_or_create(
            source_model='Prescription',
            source_id=rx.id,
            defaults={
                'patient': rx.patient,
                'encounter': rx.encounter,
                'event_type': 'prescription',
                'event_subtype': rx.status,
                'timestamp': rx.created_at,
                'title': f"Rx: {rx.medication_name}",
                'content_summary': summary,
                'author_name': author_name,
                'author_id': author_id,
                'is_critical': rx.frequency == 'stat',
                'status': rx.status,
                'has_edits': False,
                'version_count': 0,
                'template_id': None,
                'template_title': '',
                'search_text': ' '.join(search_parts),
            }
        )
        return created, not created

    def _sync_vitals(self, v):
        """Sync VitalSigns to TimelineEvent."""
        author_name = ''
        author_id = None
        if v.recorded_by and v.recorded_by.staff and v.recorded_by.staff.user:
            author_name = v.recorded_by.staff.user.get_full_name()
            author_id = v.recorded_by.staff.user.id

        parts = []
        if v.blood_pressure:
            parts.append(f"BP: {v.blood_pressure}")
        if v.heart_rate:
            parts.append(f"HR: {v.heart_rate}")
        if v.temperature:
            parts.append(f"Temp: {v.temperature}°C")
        if v.oxygen_saturation:
            parts.append(f"SpO2: {v.oxygen_saturation}%")
        if v.respiratory_rate:
            parts.append(f"RR: {v.respiratory_rate}")

        summary = " | ".join(parts) if parts else "Vital signs recorded"
        search_parts = [summary]
        if v.notes:
            search_parts.append(v.notes)

        obj, created = TimelineEvent.objects.update_or_create(
            source_model='VitalSigns',
            source_id=v.id,
            defaults={
                'patient': v.patient,
                'encounter': v.encounter,
                'event_type': 'vitals',
                'event_subtype': 'critical' if v.is_critical else 'normal',
                'timestamp': v.recorded_at,
                'title': 'Vital Signs',
                'content_summary': summary,
                'author_name': author_name,
                'author_id': author_id,
                'is_critical': v.is_critical,
                'status': '',
                'has_edits': False,
                'version_count': 0,
                'template_id': None,
                'template_title': '',
                'search_text': ' '.join(search_parts),
            }
        )
        return created, not created

    def _sync_lab_order(self, lab):
        """Sync LabOrder to TimelineEvent."""
        author_name = ''
        author_id = None
        if lab.ordering_provider and lab.ordering_provider.staff and lab.ordering_provider.staff.user:
            author_name = lab.ordering_provider.staff.user.get_full_name()
            author_id = lab.ordering_provider.staff.user.id

        test_names = [ot.test.short_name for ot in lab.order_tests.all()[:5]]
        if len(test_names) < lab.order_tests.count():
            test_names.append(f"+{lab.order_tests.count() - len(test_names)} more")
        summary = ", ".join(test_names) if test_names else "Lab tests ordered"

        search_parts = [lab.order_number, summary]
        if hasattr(lab, 'clinical_notes') and lab.clinical_notes:
            search_parts.append(lab.clinical_notes)

        obj, created = TimelineEvent.objects.update_or_create(
            source_model='LabOrder',
            source_id=lab.id,
            defaults={
                'patient': lab.patient,
                'encounter': lab.encounter,
                'event_type': 'lab',
                'event_subtype': lab.status,
                'timestamp': lab.created_at,
                'title': f"Lab Order #{lab.order_number}",
                'content_summary': summary,
                'author_name': author_name,
                'author_id': author_id,
                'is_critical': lab.priority == 'stat',
                'status': lab.status,
                'has_edits': False,
                'version_count': 0,
                'template_id': None,
                'template_title': '',
                'search_text': ' '.join(search_parts),
            }
        )
        return created, not created

    def _sync_referral(self, ref):
        """Sync Referral to TimelineEvent."""
        author_name = ''
        author_id = None
        if ref.referring_provider and ref.referring_provider.staff and ref.referring_provider.staff.user:
            author_name = ref.referring_provider.staff.user.get_full_name()
            author_id = ref.referring_provider.staff.user.id

        summary = f"Referral to {ref.referred_to_specialty}"
        if ref.referred_to_department:
            summary = f"Referral to {ref.referred_to_department} ({ref.referred_to_specialty})"

        search_parts = [
            ref.referral_number,
            ref.referred_to_specialty,
            ref.referred_to_department or '',
            ref.reason or '',
        ]

        obj, created = TimelineEvent.objects.update_or_create(
            source_model='Referral',
            source_id=ref.id,
            defaults={
                'patient': ref.patient,
                'encounter': ref.encounter,
                'event_type': 'referral',
                'event_subtype': ref.status,
                'timestamp': ref.created_at,
                'title': f"Referral: {ref.referred_to_specialty}",
                'content_summary': summary,
                'author_name': author_name,
                'author_id': author_id,
                'is_critical': ref.urgency == 'emergency',
                'status': ref.status,
                'has_edits': False,
                'version_count': 0,
                'template_id': None,
                'template_title': '',
                'search_text': ' '.join(search_parts),
            }
        )
        return created, not created
