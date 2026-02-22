from dataclasses import dataclass, field
from typing import Any

from django.conf import settings

from apps.ai import constants


@dataclass(frozen=True)
class ModelRouteRequest:
    feature: str
    task_subtype: str | None = None
    latency_budget_ms: int | None = None
    user_role: str | None = None
    context_tokens: int = 0


@dataclass(frozen=True)
class ModelRouteResolution:
    model_role: str
    provider_model_id: str
    timeout_ms: int
    retry_limit: int
    fallback_chain: tuple[str, ...] = field(default_factory=tuple)
    degraded_mode: str | None = None


def _feature_role(feature: str, task_subtype: str | None = None) -> str:
    if feature == constants.FEATURE_NOTE_DRAFT and task_subtype == 'lint':
        return constants.MODEL_ROLE_VALIDATOR_SMALL
    return constants.FEATURE_PRIMARY_MODEL_ROLE.get(feature, constants.MODEL_ROLE_WRITER_MEDIUM)


def _timeout_for_role(model_role: str) -> int:
    if model_role in {constants.MODEL_ROLE_ASR_MEDICAL, constants.MODEL_ROLE_DIARIZER}:
        return int(getattr(settings, 'AI_REQUEST_TIMEOUT_ASR_MS', 20000))
    return int(getattr(settings, 'AI_REQUEST_TIMEOUT_MS', 8000))


def _model_id_for_role(model_role: str) -> str:
    role_to_setting = {
        constants.MODEL_ROLE_REASONER_LARGE: 'AI_MODEL_REASONER_PRIMARY',
        constants.MODEL_ROLE_WRITER_MEDIUM: 'AI_MODEL_WRITER_PRIMARY',
        constants.MODEL_ROLE_VALIDATOR_SMALL: 'AI_MODEL_VALIDATOR',
        constants.MODEL_ROLE_INTENT_SMALL: 'AI_MODEL_INTENT',
        constants.MODEL_ROLE_EMBEDDING_MODEL: 'AI_MODEL_EMBEDDING',
        constants.MODEL_ROLE_RERANKER_MODEL: 'AI_MODEL_RERANKER',
        constants.MODEL_ROLE_ASR_MEDICAL: 'AI_MODEL_ASR_PRIMARY',
        constants.MODEL_ROLE_DIARIZER: 'AI_MODEL_ASR_PRIMARY',
    }
    setting_name = role_to_setting.get(model_role)
    if not setting_name:
        return 'unknown'
    return str(getattr(settings, setting_name, 'unset') or 'unset')


def _fallback_chain_for_role(model_role: str) -> tuple[str, ...]:
    if model_role == constants.MODEL_ROLE_REASONER_LARGE:
        values = [
            getattr(settings, 'AI_MODEL_REASONER_FALLBACK', ''),
            getattr(settings, 'AI_MODEL_WRITER_FALLBACK', ''),
        ]
    elif model_role == constants.MODEL_ROLE_WRITER_MEDIUM:
        values = [
            getattr(settings, 'AI_MODEL_WRITER_FALLBACK', ''),
            getattr(settings, 'AI_MODEL_REASONER_FALLBACK', ''),
        ]
    elif model_role == constants.MODEL_ROLE_ASR_MEDICAL:
        values = [
            getattr(settings, 'AI_MODEL_ASR_FALLBACK', ''),
        ]
    else:
        values = []

    return tuple(value for value in values if value)


class ModelRouter:
    """Routes feature requests to model roles and concrete provider model IDs."""

    def route(self, route_request: ModelRouteRequest) -> ModelRouteResolution:
        role = _feature_role(route_request.feature, route_request.task_subtype)
        max_context = int(getattr(settings, 'AI_MAX_CONTEXT_TOKENS', 12000))

        degraded_mode = None
        if route_request.context_tokens > max_context:
            degraded_mode = 'retrieve_then_summarize'

        timeout_ms = _timeout_for_role(role)
        if route_request.latency_budget_ms:
            timeout_ms = min(timeout_ms, int(route_request.latency_budget_ms))

        return ModelRouteResolution(
            model_role=role,
            provider_model_id=_model_id_for_role(role),
            timeout_ms=max(1000, timeout_ms),
            retry_limit=2,
            fallback_chain=_fallback_chain_for_role(role),
            degraded_mode=degraded_mode,
        )


def serialize_route_for_audit(resolution: ModelRouteResolution) -> dict[str, Any]:
    return {
        'model_role': resolution.model_role,
        'provider_model_id': resolution.provider_model_id,
        'timeout_ms': resolution.timeout_ms,
        'retry_limit': resolution.retry_limit,
        'fallback_chain': list(resolution.fallback_chain),
        'degraded_mode': resolution.degraded_mode,
    }
