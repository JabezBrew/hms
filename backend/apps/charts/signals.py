from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.charts.models import ChartEntry
from apps.charts.seeding import ensure_system_templates_for_facility
from apps.core.models import Facility


def _resolve_timeline_encounter(entry):
    if entry.assignment.encounter_id:
        return entry.assignment.encounter

    admission = entry.assignment.admission
    if not admission or not admission.fhir_encounter_id:
        return None

    from apps.encounters.models import Encounter

    return Encounter.objects.filter(id=admission.fhir_encounter_id).first()


def _summarize_body_map(value):
    if not isinstance(value, dict):
        return None

    region = value.get('region')
    side = value.get('side')
    surface = value.get('surface')
    parts = [part for part in [surface, side, region] if part]
    return " ".join(parts) if parts else None


def _summarize_chart_entry(entry):
    template = entry.assignment.template
    display_parts = []

    for field in template.fields.order_by('display_order'):
        value = entry.data.get(field.field_key)
        if value in (None, '', []):
            continue

        if field.field_type == 'body_map':
            rendered = _summarize_body_map(value)
        elif field.field_type == 'paired' and isinstance(value, dict):
            rendered = "/".join(str(value.get(part.get('key'), '—')) for part in (field.config or {}).get('fields', []))
        else:
            rendered = value

        if rendered in (None, ''):
            continue

        display_parts.append(f"{field.name}: {rendered}")
        if len(display_parts) == 3:
            break

    if not display_parts:
        return f"{template.name} entry recorded"

    return " | ".join(display_parts)


@receiver(post_save, sender=Facility)
def seed_system_chart_templates(sender, instance, created, raw=False, **kwargs):
    if raw or not created:
        return

    def seed_templates():
        ensure_system_templates_for_facility(instance)

    transaction.on_commit(seed_templates)


@receiver(post_save, sender=ChartEntry)
def sync_chart_entry_to_timeline(sender, instance, created, **kwargs):
    from apps.clinical_notes.models import TimelineEvent

    encounter = _resolve_timeline_encounter(instance)
    author_name = ''
    author_id = None
    if instance.recorded_by and getattr(instance.recorded_by, 'staff', None) and instance.recorded_by.staff.user:
        author_name = instance.recorded_by.staff.user.get_full_name()
        author_id = instance.recorded_by.staff.user.id

    content_summary = _summarize_chart_entry(instance)
    search_parts = [
        instance.assignment.template.name,
        content_summary,
        instance.notes or '',
    ]

    def sync_event():
        TimelineEvent.objects.update_or_create(
            source_model='ChartEntry',
            source_id=instance.id,
            defaults={
                'patient': instance.assignment.patient,
                'encounter': encounter,
                'event_type': 'chart',
                'event_subtype': instance.assignment.template.system_key or instance.assignment.template.category,
                'timestamp': instance.observation_datetime,
                'title': instance.assignment.template.name,
                'content_summary': content_summary[:500],
                'author_name': author_name,
                'author_id': author_id,
                'is_critical': instance.has_critical_values,
                'status': instance.assignment.status,
                'has_edits': False,
                'version_count': 0,
                'template_id': instance.assignment.template_id,
                'template_title': instance.assignment.template.name,
                'search_text': ' '.join(part for part in search_parts if part),
            },
        )

    transaction.on_commit(sync_event)


@receiver(post_delete, sender=ChartEntry)
def delete_chart_entry_timeline_event(sender, instance, **kwargs):
    from apps.clinical_notes.models import TimelineEvent

    TimelineEvent.objects.filter(
        source_model='ChartEntry',
        source_id=instance.id,
    ).delete()
