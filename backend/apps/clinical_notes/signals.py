"""
Signal handlers for syncing clinical data to TimelineEvent.

These signals ensure the denormalized TimelineEvent table stays in sync
with source models (NoteEntry, Prescription) for efficient timeline queries.
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from .models import NoteEntry, Prescription, TimelineEvent, NoteEntryVersion


def _get_note_summary(note):
    """Extract a short summary from note data for search/preview."""
    data = note.data or {}

    # Try common summary fields
    for key in ['chief_complaint', 'summary', 'subjective', 'assessment', 'diagnosis']:
        if key in data and data[key]:
            text = str(data[key])
            return text[:500] if len(text) > 500 else text

    # Fall back to first non-empty field
    for key, value in data.items():
        if value and isinstance(value, str) and len(value) > 10:
            return value[:500] if len(value) > 500 else value

    return ''


def _get_note_search_text(note):
    """Build searchable text from note data."""
    parts = []

    # Add template title
    if note.template:
        parts.append(note.template.title)

    # Add all text values from data
    data = note.data or {}
    for value in data.values():
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    parts.extend(str(v) for v in item.values() if isinstance(v, str))

    return ' '.join(parts)


@receiver(post_save, sender=NoteEntry)
def sync_note_to_timeline(sender, instance, created, **kwargs):
    """Sync NoteEntry to TimelineEvent on save."""
    # Get version count
    version_count = NoteEntryVersion.objects.filter(note_entry=instance).count()

    # Get author info
    author_name = ''
    author_id = None
    if instance.practitioner and instance.practitioner.staff:
        staff = instance.practitioner.staff
        if staff.user:
            author_name = staff.user.get_full_name()
            author_id = staff.user.id

    TimelineEvent.objects.update_or_create(
        source_model='NoteEntry',
        source_id=instance.id,
        defaults={
            'patient': instance.patient,
            'encounter': instance.encounter,
            'event_type': 'note',
            'event_subtype': instance.template.category if instance.template else '',
            'timestamp': instance.created_at,
            'title': instance.template.title if instance.template else 'Clinical Note',
            'content_summary': _get_note_summary(instance),
            'author_name': author_name,
            'author_id': author_id,
            'is_critical': False,
            'status': '',
            'has_edits': version_count > 0,
            'version_count': version_count,
            'template_id': instance.template.id if instance.template else None,
            'template_title': instance.template.title if instance.template else '',
            'search_text': _get_note_search_text(instance),
        }
    )


@receiver(post_delete, sender=NoteEntry)
def delete_note_timeline_event(sender, instance, **kwargs):
    """Delete TimelineEvent when NoteEntry is deleted."""
    TimelineEvent.objects.filter(
        source_model='NoteEntry',
        source_id=instance.id
    ).delete()


@receiver(post_save, sender=Prescription)
def sync_prescription_to_timeline(sender, instance, created, **kwargs):
    """Sync Prescription to TimelineEvent on save."""
    # Get author info
    author_name = ''
    author_id = None
    if instance.prescribed_by and instance.prescribed_by.staff:
        staff = instance.prescribed_by.staff
        if staff.user:
            author_name = staff.user.get_full_name()
            author_id = staff.user.id

    # Build summary
    summary = f"{instance.medication_name} {instance.dosage}"
    if instance.frequency:
        summary += f" {instance.get_frequency_display()}"
    if instance.route:
        summary += f" ({instance.get_route_display()})"

    # Build search text
    search_parts = [
        instance.medication_name,
        instance.dosage,
        instance.instructions or '',
        instance.reason or '',
    ]

    TimelineEvent.objects.update_or_create(
        source_model='Prescription',
        source_id=instance.id,
        defaults={
            'patient': instance.patient,
            'encounter': instance.encounter,
            'event_type': 'prescription',
            'event_subtype': instance.status,
            'timestamp': instance.created_at,
            'title': f"Rx: {instance.medication_name}",
            'content_summary': summary,
            'author_name': author_name,
            'author_id': author_id,
            'is_critical': instance.frequency == 'stat',
            'status': instance.status,
            'has_edits': False,
            'version_count': 0,
            'template_id': None,
            'template_title': '',
            'search_text': ' '.join(search_parts),
        }
    )


@receiver(post_delete, sender=Prescription)
def delete_prescription_timeline_event(sender, instance, **kwargs):
    """Delete TimelineEvent when Prescription is deleted."""
    TimelineEvent.objects.filter(
        source_model='Prescription',
        source_id=instance.id
    ).delete()
