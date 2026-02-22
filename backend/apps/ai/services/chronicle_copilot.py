from __future__ import annotations

import re
from typing import Any

from apps.ai import constants
from apps.ai.services.policy import confidence_band


CHRONICLE_REVIEW_MESSAGE_BY_BAND = {
    'needs_review': 'Needs review. Validate against the full chart before acting.',
    'advisory': 'Advisory output. Correlate with exam findings and current plan.',
    'normal': 'Advisory output. Clinical sign-off is still required.',
    'fallback': 'Needs review. Confidence is low, so use standard chart workflow.',
}


def _clip_confidence(value: float) -> float:
    if value < 0.55:
        return 0.55
    if value > 0.95:
        return 0.95
    return round(value, 3)


def estimate_chronicle_confidence(context_bundle: dict[str, Any], *, question: str | None = None) -> float:
    timeline = context_bundle.get('timeline') or []
    active_medications = context_bundle.get('active_medications') or []
    active_problems = context_bundle.get('active_problems') or []
    allergies = context_bundle.get('allergies') or []
    latest_vitals = context_bundle.get('latest_vitals')
    critical_event_count = int(context_bundle.get('critical_event_count') or 0)

    score = 0.62
    score += min(0.16, len(timeline) * 0.015)
    if active_medications:
        score += 0.05
    if active_problems:
        score += 0.05
    if allergies:
        score += 0.03
    if latest_vitals:
        score += 0.06
        if latest_vitals.get('is_critical'):
            score += 0.02
    if critical_event_count:
        score += min(0.03, critical_event_count * 0.01)
    if context_bundle.get('vector_backend') == 'pgvector':
        score += 0.02
    if question and len(question.strip()) >= 12:
        score += 0.01

    return _clip_confidence(score)


def _vitals_sentence(latest_vitals: dict[str, Any] | None) -> str:
    if not latest_vitals:
        return 'No recent vitals are available in this window.'

    parts = []
    if latest_vitals.get('temperature') is not None:
        parts.append(f"Temp {latest_vitals['temperature']} C")
    if latest_vitals.get('heart_rate') is not None:
        parts.append(f"HR {latest_vitals['heart_rate']}")
    if latest_vitals.get('blood_pressure'):
        parts.append(f"BP {latest_vitals['blood_pressure']}")
    if latest_vitals.get('oxygen_saturation') is not None:
        parts.append(f"SpO2 {latest_vitals['oxygen_saturation']}%")

    if not parts:
        return 'Recent vitals exist but have limited structured values.'
    return '; '.join(parts)


def _snapshot_summary(context_bundle: dict[str, Any]) -> str:
    patient = context_bundle.get('patient') or {}
    name = patient.get('name') or 'Patient'
    meds = context_bundle.get('active_medications') or []
    problems = context_bundle.get('active_problems') or []
    allergies = context_bundle.get('allergies') or []

    segments = [f'{name} chart snapshot']
    if problems:
        segments.append(f"active problems include {', '.join(problems[:3])}")
    else:
        segments.append('no active problem list extracted from recent notes')

    if meds:
        segments.append(f'{len(meds)} active medication(s)')
    else:
        segments.append('no active medications listed')

    if allergies:
        segments.append(f"allergies: {', '.join(allergies[:3])}")
    else:
        segments.append('no documented allergies in this context bundle')

    return '. '.join(segments) + '.'


def _recent_changes_summary(context_bundle: dict[str, Any]) -> str:
    timeline = context_bundle.get('timeline') or []
    if not timeline:
        return 'No timeline events found in the selected window.'

    highlights = []
    for entry in timeline[:4]:
        title = entry.get('title') or entry.get('event_type') or 'Event'
        timestamp = entry.get('timestamp') or ''
        if timestamp:
            timestamp = timestamp.replace('T', ' ')[:16]
        details = f"{title} ({timestamp})".strip()
        highlights.append(details)
    return 'Recent events: ' + '; '.join(highlights) + '.'


def _risk_summary(context_bundle: dict[str, Any]) -> str:
    timeline = context_bundle.get('timeline') or []
    critical_events = [entry for entry in timeline if entry.get('is_critical')]
    vitals = context_bundle.get('latest_vitals')

    risk_points: list[str] = []
    if critical_events:
        risk_points.append(f'{len(critical_events)} critical timeline event(s) are present')
    if vitals and vitals.get('is_critical'):
        risk_points.append('latest vitals are marked critical')
    if not risk_points:
        risk_points.append('no critical markers were detected in this retrieval window')
    return '. '.join(risk_points).capitalize() + '.'


def _next_steps(focus: str, context_bundle: dict[str, Any]) -> list[str]:
    base = [
        'Confirm interpretation against the full chart before decisions.',
        'Escalate immediately if there are critical values or deterioration signs.',
    ]
    if focus == 'changes':
        return base + ['Compare with the previous encounter plan and unresolved tasks.']
    if focus == 'rounds':
        return base + ['Document bedside reassessment and update pending orders checklist.']
    return base + ['Capture handoff highlights and outstanding follow-up checks.']


def summarize_chronicle(
    *,
    context_bundle: dict[str, Any],
    focus: str,
    time_window: str,
) -> dict[str, Any]:
    confidence = estimate_chronicle_confidence(context_bundle)
    band = confidence_band(confidence, feature=constants.FEATURE_CHRONICLE_COPILOT)

    summary_blocks = [
        {
            'key': 'snapshot',
            'title': 'Clinical Snapshot',
            'content': _snapshot_summary(context_bundle),
            'priority': 'high',
        },
        {
            'key': 'recent_changes',
            'title': 'Recent Changes',
            'content': _recent_changes_summary(context_bundle),
            'priority': 'high' if focus in {'handoff', 'changes'} else 'medium',
        },
        {
            'key': 'risk_watch',
            'title': 'Risks To Monitor',
            'content': _risk_summary(context_bundle),
            'priority': 'high',
        },
        {
            'key': 'latest_vitals',
            'title': 'Latest Vitals',
            'content': _vitals_sentence(context_bundle.get('latest_vitals')),
            'priority': 'medium',
        },
    ]

    result = {
        'mode': 'summary',
        'focus': focus,
        'time_window': time_window,
        'window': context_bundle.get('window') or {},
        'summary_blocks': summary_blocks,
        'suggested_next_steps': _next_steps(focus, context_bundle),
        'timeline_counts': context_bundle.get('timeline_counts') or {},
        'vector_backend': context_bundle.get('vector_backend') or 'pgvector',
        'review_label': band,
        'review_message': CHRONICLE_REVIEW_MESSAGE_BY_BAND.get(band, CHRONICLE_REVIEW_MESSAGE_BY_BAND['needs_review']),
        'advisory_only': True,
        'safety_notice': 'Advisory summary only. Clinical review is required before treatment decisions.',
    }
    return {
        'result': result,
        'confidence': confidence,
        'citations': (context_bundle.get('citations') or [])[:12],
    }


def _question_tokens(question: str) -> list[str]:
    return [token for token in re.findall(r'[a-z0-9]+', question.lower()) if len(token) >= 4]


def _match_timeline_entries(context_bundle: dict[str, Any], question: str, *, limit: int = 4) -> list[dict[str, Any]]:
    timeline = context_bundle.get('timeline') or []
    if not timeline:
        return []

    tokens = _question_tokens(question)
    if not tokens:
        return timeline[:limit]

    scored = []
    for item in timeline:
        haystack = ' '.join(
            [
                str(item.get('event_type') or ''),
                str(item.get('title') or ''),
                str(item.get('summary') or ''),
            ]
        ).lower()
        score = sum(1 for token in tokens if token in haystack)
        if score > 0:
            scored.append((score, item))

    if not scored:
        return timeline[:limit]

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored[:limit]]


def ask_chronicle(
    *,
    context_bundle: dict[str, Any],
    question: str,
    time_window: str,
) -> dict[str, Any]:
    confidence = estimate_chronicle_confidence(context_bundle, question=question)
    band = confidence_band(confidence, feature=constants.FEATURE_CHRONICLE_COPILOT)
    matched = _match_timeline_entries(context_bundle, question)
    patient = context_bundle.get('patient') or {}
    name = patient.get('name') or 'The patient'
    lower_question = question.lower()

    if 'risk' in lower_question or 'monitor' in lower_question:
        answer = f"{name}: {_risk_summary(context_bundle)} {_vitals_sentence(context_bundle.get('latest_vitals'))}"
    elif 'vital' in lower_question or 'bp' in lower_question or 'heart rate' in lower_question:
        answer = f"{name}: {_vitals_sentence(context_bundle.get('latest_vitals'))}"
    elif 'med' in lower_question or 'drug' in lower_question:
        medications = context_bundle.get('active_medications') or []
        if medications:
            head = ', '.join(f"{item['name']} {item['dosage']}" for item in medications[:3])
            answer = f"{name} has {len(medications)} active medication(s): {head}."
        else:
            answer = f'{name} has no active medication records in this context window.'
    else:
        if matched:
            highlight = '; '.join((item.get('title') or item.get('event_type') or 'Event') for item in matched[:3])
            answer = f"Most relevant chart activity in the {time_window} window: {highlight}."
        else:
            answer = 'There are limited timeline events in this window. Expand the time range or review the full chart.'

    supporting_points = []
    for item in matched[:4]:
        title = item.get('title') or item.get('event_type') or 'Event'
        summary = str(item.get('summary') or '').strip()
        point = f'{title}: {summary}' if summary else title
        supporting_points.append(point[:240])

    result = {
        'mode': 'qa',
        'question': question,
        'time_window': time_window,
        'window': context_bundle.get('window') or {},
        'answer': answer,
        'supporting_points': supporting_points,
        'review_label': band,
        'review_message': CHRONICLE_REVIEW_MESSAGE_BY_BAND.get(band, CHRONICLE_REVIEW_MESSAGE_BY_BAND['needs_review']),
        'advisory_only': True,
        'safety_notice': 'Advisory answer only. Confirm with full chart review before clinical action.',
    }

    if matched:
        citations = [
            {
                'type': 'timeline_event',
                'id': str(item['id']),
                'source_model': item.get('source_model'),
                'source_id': item.get('source_id'),
            }
            for item in matched[:8]
        ]
    else:
        citations = (context_bundle.get('citations') or [])[:8]

    return {
        'result': result,
        'confidence': confidence,
        'citations': citations,
    }
