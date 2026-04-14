from celery import shared_task


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

    for field in template.fields.all():
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


@shared_task(
    bind=True,
    ignore_result=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
)
def sync_chart_entry_timeline_event(self, chart_entry_id):
    from apps.charts.models import ChartEntry
    from apps.clinical_notes.models import TimelineEvent

    try:
        entry = ChartEntry.objects.select_related(
            'assignment__template',
            'assignment__patient',
            'assignment__encounter',
            'assignment__admission',
            'recorded_by__staff__user',
        ).prefetch_related(
            'assignment__template__fields',
        ).get(id=chart_entry_id)
    except ChartEntry.DoesNotExist:
        TimelineEvent.objects.filter(source_model='ChartEntry', source_id=chart_entry_id).delete()
        return

    if entry.is_deleted:
        TimelineEvent.objects.filter(source_model='ChartEntry', source_id=entry.id).delete()
        return

    encounter = _resolve_timeline_encounter(entry)
    author_name = ''
    author_id = None
    if entry.recorded_by and getattr(entry.recorded_by, 'staff', None) and entry.recorded_by.staff.user:
        author_name = entry.recorded_by.staff.user.get_full_name()
        author_id = entry.recorded_by.staff.user.id

    content_summary = _summarize_chart_entry(entry)
    search_parts = [
        entry.assignment.template.name,
        content_summary,
        entry.notes or '',
    ]

    TimelineEvent.objects.update_or_create(
        source_model='ChartEntry',
        source_id=entry.id,
        defaults={
            'patient': entry.assignment.patient,
            'encounter': encounter,
            'event_type': 'chart',
            'event_subtype': entry.assignment.template.system_key or entry.assignment.template.category,
            'timestamp': entry.observation_datetime,
            'title': entry.assignment.template.name,
            'content_summary': content_summary[:500],
            'author_name': author_name,
            'author_id': author_id,
            'is_critical': entry.has_critical_values,
            'status': entry.assignment.status,
            'has_edits': False,
            'version_count': 0,
            'template_id': entry.assignment.template_id,
            'template_title': entry.assignment.template.name,
            'search_text': ' '.join(part for part in search_parts if part),
        },
    )
