from __future__ import annotations

from collections import Counter
from typing import Any

from django.utils import timezone

from apps.ai import constants
from apps.ai.services.policy import confidence_band, evaluate_lint_issues
from apps.clinical_notes.template_utils import (
    build_template_token_values,
    get_structure_sections,
    render_template_defaults,
)


NOTE_DRAFT_REVIEW_MESSAGE_BY_BAND = {
    'needs_review': 'Needs review. Validate each section against bedside findings and source documentation.',
    'advisory': 'Advisory draft. Complete or edit sections before finalizing.',
    'normal': 'Advisory draft with stronger template alignment. Clinical sign-off is still required.',
    'fallback': 'Needs review. Template mapping confidence is limited, so rely on manual note completion.',
}


NOTE_LINT_REVIEW_MESSAGE_BY_BAND = {
    'needs_review': 'Needs review. Lint identified issues that require careful clinician validation.',
    'advisory': 'Advisory lint output. Resolve high-priority issues before finalize/sign.',
    'normal': 'Quality check complete. Minor edits may still improve clarity.',
    'fallback': 'Needs review. Lint confidence is low, so perform manual note QA.',
}


LOW_SIGNAL_TERMS = {
    'todo',
    'tbd',
    'lorem ipsum',
    'placeholder',
    'not documented',
}


def _normalize_section_key(value: Any) -> str:
    text = str(value or '').strip().lower()
    if not text:
        return ''
    normalized = ''.join(ch if ch.isalnum() else '_' for ch in text)
    while '__' in normalized:
        normalized = normalized.replace('__', '_')
    return normalized.strip('_')


def _clip_confidence(score: float) -> float:
    if score < 0.55:
        return 0.55
    if score > 0.95:
        return 0.95
    return round(score, 3)


def _has_meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set)):
        return any(_has_meaningful_value(item) for item in value)
    if isinstance(value, dict):
        return any(_has_meaningful_value(item) for item in value.values())
    return True


def _stringify_value(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        chunks = []
        for key, item in value.items():
            item_text = _stringify_value(item)
            if not item_text:
                continue
            chunks.append(f'{key}: {item_text}')
        return '; '.join(chunks)
    if isinstance(value, (list, tuple, set)):
        chunks = [_stringify_value(item) for item in value]
        return '; '.join(chunk for chunk in chunks if chunk)
    return str(value).strip()


def _build_section_definitions(content: dict[str, Any] | list[Any] | None) -> list[dict[str, Any]]:
    definitions: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for section in get_structure_sections(content):
        if not isinstance(section, dict):
            continue

        title = (section.get('name') or section.get('section') or '').strip()
        if not title:
            continue

        key = _normalize_section_key(section.get('id') or title)
        if not key:
            continue
        if key in seen_keys:
            suffix = 2
            candidate = f'{key}_{suffix}'
            while candidate in seen_keys:
                suffix += 1
                candidate = f'{key}_{suffix}'
            key = candidate
        seen_keys.add(key)

        definitions.append(
            {
                'section_key': key,
                'section_title': title,
                'required': bool(section.get('required', False)),
                'type': str(section.get('type') or 'text').lower(),
            }
        )

    return definitions


def _fallback_section_text(
    *,
    section_title: str,
    patient_name: str,
    prompt: str,
    encounter_id: str | None,
) -> str:
    encounter_phrase = f' for encounter {encounter_id}' if encounter_id else ''
    focus_phrase = f' Focus requested: {prompt.strip()}.' if prompt.strip() else ''
    return (
        f'{section_title}: {patient_name} clinical update{encounter_phrase}. '
        f'Complete this section with verified chart findings.{focus_phrase}'
    ).strip()


def _estimate_draft_confidence(
    *,
    section_count: int,
    rendered_defaults: int,
    has_prompt: bool,
    has_encounter: bool,
) -> float:
    score = 0.64
    score += min(0.16, section_count * 0.03)
    if section_count:
        score += min(0.08, (rendered_defaults / section_count) * 0.08)
    if has_prompt:
        score += 0.03
    if has_encounter:
        score += 0.02
    return _clip_confidence(score)


def build_note_draft(
    *,
    patient,
    template,
    template_revision,
    encounter=None,
    prompt: str = '',
) -> dict[str, Any]:
    content = template_revision.content if isinstance(template_revision.content, (dict, list)) else template.structure
    definitions = _build_section_definitions(content)
    prompt = str(prompt or '').strip()

    token_values = build_template_token_values(
        patient=patient,
        today=timezone.localdate(),
        base_data={'chief_complaint': prompt},
    )
    rendered_defaults = render_template_defaults(
        content,
        token_values=token_values,
        base_data={},
        apply_mode='all',
    )

    patient_name = token_values.get('patient_name') or getattr(patient, 'name', None) or 'Patient'
    encounter_id = str(getattr(encounter, 'id', '') or '').strip() or None

    sections_payload: list[dict[str, Any]] = []
    draft_by_key: dict[str, str] = {}
    draft_by_section: dict[str, str] = {}
    rendered_default_count = 0

    for definition in definitions:
        section_title = definition['section_title']
        section_key = definition['section_key']
        rendered = rendered_defaults.get(section_title)
        rendered_text = _stringify_value(rendered)

        source = 'generated'
        if rendered_text:
            draft_text = rendered_text
            source = 'template_default'
            rendered_default_count += 1
        else:
            draft_text = _fallback_section_text(
                section_title=section_title,
                patient_name=patient_name,
                prompt=prompt,
                encounter_id=encounter_id,
            )

        sections_payload.append(
            {
                'section_key': section_key,
                'section_title': section_title,
                'required': definition['required'],
                'draft_text': draft_text,
                'source': source,
            }
        )
        draft_by_key[section_key] = draft_text
        draft_by_section[section_title] = draft_text

    confidence = _estimate_draft_confidence(
        section_count=len(definitions),
        rendered_defaults=rendered_default_count,
        has_prompt=bool(prompt),
        has_encounter=encounter is not None,
    )
    band = confidence_band(confidence, feature=constants.FEATURE_NOTE_DRAFT)

    result = {
        'mode': 'draft',
        'patient_id': str(patient.id),
        'template_id': str(template.id),
        'template_revision_id': str(template_revision.id),
        'template_revision_version': template_revision.version,
        'template_revision_status': template_revision.status,
        'encounter_id': encounter_id,
        'prompt': prompt,
        'sections': sections_payload,
        'draft': draft_by_key,
        'draft_by_section': draft_by_section,
        'review_label': band,
        'review_message': NOTE_DRAFT_REVIEW_MESSAGE_BY_BAND.get(
            band,
            NOTE_DRAFT_REVIEW_MESSAGE_BY_BAND['needs_review'],
        ),
        'advisory_only': True,
        'safety_notice': 'AI draft only. Clinician review and edit are required before save/finalize.',
    }

    citations = [
        {'type': 'patient', 'id': str(patient.id)},
        {'type': 'note_template', 'id': str(template.id)},
        {'type': 'note_template_revision', 'id': str(template_revision.id)},
    ]
    if encounter_id:
        citations.append({'type': 'encounter', 'id': encounter_id})
    for item in sections_payload[:8]:
        citations.append(
            {
                'type': 'template_section',
                'id': item['section_key'],
                'section': item['section_title'],
            }
        )

    return {
        'result': result,
        'confidence': confidence,
        'citations': citations,
    }


def _coerce_note_data(note_data: Any) -> dict[str, Any]:
    if not isinstance(note_data, dict):
        return {}

    if isinstance(note_data.get('draft'), dict):
        return note_data['draft']

    if isinstance(note_data.get('draft_by_section'), dict):
        return note_data['draft_by_section']

    sections = note_data.get('sections')
    if isinstance(sections, list):
        normalized: dict[str, Any] = {}
        for item in sections:
            if not isinstance(item, dict):
                continue
            section_name = (
                item.get('section_key')
                or item.get('section_title')
                or item.get('section')
                or item.get('name')
            )
            if not section_name:
                continue
            normalized[str(section_name)] = item.get('draft_text') or item.get('value') or ''
        if normalized:
            return normalized

    metadata_keys = {
        'mode',
        'template_id',
        'template_revision_id',
        'template_revision_version',
        'template_revision_status',
        'encounter_id',
        'patient_id',
        'prompt',
        'review_label',
        'review_message',
        'advisory_only',
        'safety_notice',
        'issue_counts',
        'issues',
        'can_save_draft',
        'can_finalize',
        'requires_major_acknowledgement',
    }
    return {key: value for key, value in note_data.items() if key not in metadata_keys}


def _build_lint_issue(
    *,
    severity: str,
    section: str,
    section_key: str,
    message: str,
    suggested_fix: str,
    rule: str,
) -> dict[str, Any]:
    return {
        'severity': severity,
        'section': section,
        'section_key': section_key,
        'message': message,
        'suggested_fix': suggested_fix,
        'rule': rule,
        'blocking': severity == 'critical',
        'requires_acknowledgement': severity == 'major',
    }


def _estimate_lint_confidence(*, issue_counts: Counter, required_total: int, required_present: int) -> float:
    coverage = (required_present / required_total) if required_total else 1.0
    score = 0.88
    score += min(0.04, coverage * 0.04)
    score -= issue_counts.get('critical', 0) * 0.12
    score -= issue_counts.get('major', 0) * 0.05
    score -= issue_counts.get('minor', 0) * 0.02
    return _clip_confidence(score)


def lint_note_draft(
    *,
    template_revision,
    note_data: dict[str, Any],
) -> dict[str, Any]:
    definitions = _build_section_definitions(template_revision.content)
    normalized_note_data = _coerce_note_data(note_data)

    value_map_by_key = {
        _normalize_section_key(key): value
        for key, value in normalized_note_data.items()
    }
    issues: list[dict[str, Any]] = []
    expected_keys: set[str] = set()
    required_total = 0
    required_present = 0

    for definition in definitions:
        section_key = definition['section_key']
        section_title = definition['section_title']
        required = bool(definition['required'])
        expected_keys.add(section_key)
        if required:
            required_total += 1

        value = value_map_by_key.get(section_key)
        value_text = _stringify_value(value)
        has_value = _has_meaningful_value(value_text)
        if has_value and required:
            required_present += 1

        if required and not has_value:
            issues.append(
                _build_lint_issue(
                    severity='critical',
                    section=section_title,
                    section_key=section_key,
                    message=f"Required section '{section_title}' is missing content.",
                    suggested_fix=f"Add clinically verified content to '{section_title}' before finalize/sign.",
                    rule='required_section_missing',
                )
            )
            continue

        if not has_value:
            continue

        lowered = value_text.lower()
        if '{{' in value_text and '}}' in value_text:
            issues.append(
                _build_lint_issue(
                    severity='major',
                    section=section_title,
                    section_key=section_key,
                    message=f"Section '{section_title}' still contains unresolved template tokens.",
                    suggested_fix='Replace template placeholders with actual patient-specific documentation.',
                    rule='unresolved_template_token',
                )
            )

        if len(value_text.strip()) < 25:
            issues.append(
                _build_lint_issue(
                    severity='major' if required else 'minor',
                    section=section_title,
                    section_key=section_key,
                    message=f"Section '{section_title}' appears too brief for clinical clarity.",
                    suggested_fix='Expand with objective findings, assessment rationale, or actionable plan details.',
                    rule='section_too_brief',
                )
            )

        if any(term in lowered for term in LOW_SIGNAL_TERMS):
            issues.append(
                _build_lint_issue(
                    severity='major' if required else 'minor',
                    section=section_title,
                    section_key=section_key,
                    message=f"Section '{section_title}' includes placeholder or non-clinical filler text.",
                    suggested_fix='Replace placeholders with verified chart content or remove non-clinical filler.',
                    rule='low_signal_language',
                )
            )

    for provided_key in value_map_by_key.keys():
        if provided_key in expected_keys or not provided_key:
            continue
        issues.append(
            _build_lint_issue(
                severity='minor',
                section=provided_key,
                section_key=provided_key,
                message=f"'{provided_key}' is not part of the selected template revision.",
                suggested_fix='Map content to a valid template section or remove extra section data.',
                rule='unknown_section',
            )
        )

    issue_counts = Counter(issue['severity'] for issue in issues)
    counts_payload = {
        'critical': int(issue_counts.get('critical', 0)),
        'major': int(issue_counts.get('major', 0)),
        'minor': int(issue_counts.get('minor', 0)),
        'total': len(issues),
    }
    lint_policy = evaluate_lint_issues(issues)

    confidence = _estimate_lint_confidence(
        issue_counts=issue_counts,
        required_total=required_total,
        required_present=required_present,
    )
    band = confidence_band(confidence, feature=constants.FEATURE_NOTE_LINT)

    result = {
        'mode': 'lint',
        'issue_counts': counts_payload,
        'issues': issues,
        'can_save_draft': lint_policy['can_save_draft'],
        'can_finalize': lint_policy['can_finalize'],
        'requires_major_acknowledgement': lint_policy['requires_major_acknowledgement'],
        'review_label': band,
        'review_message': NOTE_LINT_REVIEW_MESSAGE_BY_BAND.get(
            band,
            NOTE_LINT_REVIEW_MESSAGE_BY_BAND['needs_review'],
        ),
        'advisory_only': True,
        'safety_notice': 'Lint guidance only. Human review and sign-off remain mandatory.',
    }

    citations = [
        {'type': 'note_template_revision', 'id': str(template_revision.id)},
    ]
    for issue in issues[:10]:
        citations.append(
            {
                'type': 'note_section',
                'id': issue['section_key'],
                'section': issue['section'],
                'severity': issue['severity'],
            }
        )

    return {
        'result': result,
        'confidence': confidence,
        'citations': citations,
    }
