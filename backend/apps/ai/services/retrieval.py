from __future__ import annotations

import re
from collections import Counter
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.utils import timezone

from apps.clinical_notes.models import NoteEntry, Prescription, TimelineEvent


TIME_WINDOW_PATTERN = re.compile(r'^(?P<value>\d{1,3})(?P<unit>[hdw])$')
DEFAULT_TIME_WINDOW = '24h'
MAX_TIME_WINDOW_HOURS = 24 * 30


def _compute_age(date_of_birth):
    if not date_of_birth:
        return None
    today = timezone.localdate()
    years = today.year - date_of_birth.year
    if (today.month, today.day) < (date_of_birth.month, date_of_birth.day):
        years -= 1
    return years


def _parse_allergies(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []

    text = str(raw_value).strip()
    if not text:
        return []

    for separator in (',', ';', '\n'):
        if separator in text:
            return [item.strip() for item in text.split(separator) if item.strip()]
    return [text]


def _extract_problem_candidates(note: NoteEntry) -> list[str]:
    data = note.data or {}
    assessment = data.get('Assessment')
    if not assessment:
        return []

    problems: list[str] = []
    if isinstance(assessment, dict):
        primary = str(assessment.get('Primary Diagnosis', '')).strip()
        if primary:
            problems.append(primary)
        differential = str(assessment.get('Differential Diagnoses', '')).strip()
        if differential:
            for value in differential.replace('\n', ',').split(','):
                cleaned = value.strip().strip('-').strip('•').strip()
                if cleaned:
                    problems.append(cleaned)
    elif isinstance(assessment, str):
        candidate = assessment.strip().split('.')[0].strip()
        if candidate:
            problems.append(candidate)
    return problems


def _extract_active_problems(notes: list[NoteEntry], *, limit: int = 6) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for note in notes:
        for candidate in _extract_problem_candidates(note):
            normalized = candidate.lower()
            if normalized in seen:
                continue
            seen.add(normalized)
            output.append(candidate)
            if len(output) >= limit:
                return output
    return output


def resolve_time_window(time_window: str | None) -> tuple[str, timezone.datetime, timezone.datetime]:
    normalized = (time_window or DEFAULT_TIME_WINDOW).strip().lower()
    match = TIME_WINDOW_PATTERN.match(normalized)
    if not match:
        normalized = DEFAULT_TIME_WINDOW
        match = TIME_WINDOW_PATTERN.match(normalized)

    value = int(match.group('value'))
    unit = match.group('unit')
    hours = value
    if unit == 'd':
        hours = value * 24
    elif unit == 'w':
        hours = value * 24 * 7

    hours = max(1, min(hours, MAX_TIME_WINDOW_HOURS))
    end_at = timezone.now()
    start_at = end_at - timedelta(hours=hours)
    return normalized, start_at, end_at


def build_minimal_context_bundle(
    *,
    patient,
    start_at,
    end_at,
    encounter_id=None,
    timeline_limit: int = 24,
) -> dict[str, Any]:
    user = patient.user

    timeline_qs = (
        TimelineEvent.objects.filter(
            patient_id=patient.id,
            timestamp__gte=start_at,
            timestamp__lte=end_at,
        )
        .only(
            'id',
            'event_type',
            'event_subtype',
            'source_model',
            'source_id',
            'timestamp',
            'title',
            'content_summary',
            'is_critical',
            'status',
            'encounter_id',
        )
        .order_by('-timestamp')
    )
    if encounter_id:
        timeline_qs = timeline_qs.filter(encounter_id=encounter_id)
    timeline_events = list(timeline_qs[:timeline_limit])

    timeline_items = [
        {
            'id': str(item.id),
            'event_type': item.event_type,
            'event_subtype': item.event_subtype,
            'timestamp': item.timestamp.isoformat(),
            'title': item.title,
            'summary': item.content_summary,
            'is_critical': bool(item.is_critical),
            'status': item.status,
            'source_model': item.source_model,
            'source_id': str(item.source_id),
        }
        for item in timeline_events
    ]
    timeline_counts = Counter(item.event_type for item in timeline_events)

    medications_qs = (
        Prescription.objects.filter(
            patient_id=patient.id,
            facility_id=patient.facility_id,
            status='active',
        )
        .only(
            'id',
            'medication_name',
            'dosage',
            'route',
            'frequency',
            'start_date',
            'end_date',
            'created_at',
        )
        .order_by('-created_at')
    )
    active_medications = list(medications_qs[:8])

    recent_notes = list(
        NoteEntry.objects.filter(
            patient_id=patient.id,
            facility_id=patient.facility_id,
            created_at__gte=end_at - timedelta(days=30),
        )
        .only('id', 'created_at', 'data')
        .order_by('-created_at')[:12]
    )
    active_problems = _extract_active_problems(recent_notes)

    latest_vitals = None
    try:
        from apps.nursing.models import VitalSigns

        vital = (
            VitalSigns.objects.filter(patient_id=patient.id, facility_id=patient.facility_id)
            .only(
                'id',
                'recorded_at',
                'temperature',
                'heart_rate',
                'blood_pressure_systolic',
                'blood_pressure_diastolic',
                'respiratory_rate',
                'oxygen_saturation',
                'is_critical',
            )
            .order_by('-recorded_at')
            .first()
        )
        if vital:
            latest_vitals = {
                'id': str(vital.id),
                'recorded_at': vital.recorded_at.isoformat(),
                'temperature': str(vital.temperature) if vital.temperature is not None else None,
                'heart_rate': vital.heart_rate,
                'blood_pressure': vital.blood_pressure,
                'respiratory_rate': vital.respiratory_rate,
                'oxygen_saturation': vital.oxygen_saturation,
                'is_critical': bool(vital.is_critical),
            }
    except Exception:
        latest_vitals = None

    citations = [
        {
            'type': 'timeline_event',
            'id': str(item.id),
            'source_model': item.source_model,
            'source_id': str(item.source_id),
        }
        for item in timeline_events[:12]
    ]
    citations.insert(0, {'type': 'patient_profile', 'id': str(patient.id)})

    return {
        'window': {
            'start': start_at.isoformat(),
            'end': end_at.isoformat(),
            'encounter_id': str(encounter_id) if encounter_id else None,
        },
        'vector_backend': getattr(settings, 'AI_VECTOR_BACKEND', 'pgvector') or 'pgvector',
        'patient': {
            'id': str(patient.id),
            'mrn': patient.medical_record_number,
            'name': user.get_full_name() if user else 'Unknown Patient',
            'first_name': user.first_name if user else '',
            'last_name': user.last_name if user else '',
            'age': _compute_age(getattr(user, 'date_of_birth', None)),
            'gender': user.gender if user else None,
            'blood_type': patient.blood_group,
        },
        'allergies': _parse_allergies(patient.allergies),
        'active_problems': active_problems,
        'active_medications': [
            {
                'id': str(item.id),
                'name': item.medication_name,
                'dosage': item.dosage,
                'route': item.get_route_display(),
                'frequency': item.get_frequency_display(),
                'start_date': item.start_date.isoformat() if item.start_date else None,
                'end_date': item.end_date.isoformat() if item.end_date else None,
            }
            for item in active_medications
        ],
        'latest_vitals': latest_vitals,
        'timeline': timeline_items,
        'timeline_counts': dict(timeline_counts),
        'critical_event_count': sum(1 for item in timeline_events if item.is_critical),
        'citations': citations,
    }
