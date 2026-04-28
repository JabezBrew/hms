from __future__ import annotations

from typing import Any

from django.conf import settings
from rest_framework.exceptions import PermissionDenied

from apps.ai import constants


def get_feature_flag_setting_name(feature: str) -> str:
    return constants.FEATURE_FLAG_SETTING_BY_FEATURE.get(feature, 'AI_ENABLED')


def is_ai_enabled() -> bool:
    return bool(getattr(settings, 'AI_ENABLED', False))


def is_feature_enabled(feature: str) -> bool:
    if not is_ai_enabled():
        return False
    setting_name = get_feature_flag_setting_name(feature)
    return bool(getattr(settings, setting_name, False))


def ensure_feature_enabled(feature: str) -> None:
    if not is_feature_enabled(feature):
        raise PermissionDenied('AI feature is currently disabled for this deployment.')


def get_access_scope_for_feature(feature: str) -> str | None:
    return constants.FEATURE_ACCESS_SCOPE.get(feature)


def requires_confirmation(intent_type: str | None) -> bool:
    if not intent_type:
        return True

    normalized = str(intent_type).strip().lower().replace('-', '_')
    return any(normalized.startswith(prefix) for prefix in constants.SENSITIVE_OMNI_ACTION_PREFIXES)


def confidence_band(confidence: float | None, *, feature: str | None = None) -> str:
    if confidence is None:
        return 'needs_review'

    if feature == constants.FEATURE_OMNI_NL and confidence < 0.65:
        return 'fallback'

    if confidence < 0.70:
        return 'needs_review'
    if confidence < 0.85:
        return 'advisory'
    return 'normal'


def build_response_envelope(
    *,
    feature: str,
    result: dict[str, Any] | list[Any] | str,
    confidence: float | None = None,
    citations: list[dict[str, Any]] | None = None,
    requires_human_review: bool = True,
    schema_version: str = '1.0',
) -> dict[str, Any]:
    if citations is None:
        citations = []

    return {
        'schema_version': schema_version,
        'feature': feature,
        'confidence': confidence,
        'confidence_band': confidence_band(confidence, feature=feature),
        'citations': citations,
        'result': result,
        'requires_human_review': requires_human_review,
    }


def evaluate_lint_issues(issues: list[dict[str, Any]]) -> dict[str, Any]:
    severities = {str(issue.get('severity', '')).lower() for issue in issues}

    return {
        'can_save_draft': True,
        'can_finalize': 'critical' not in severities,
        'requires_major_acknowledgement': 'major' in severities,
    }
