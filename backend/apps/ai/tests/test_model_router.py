from django.test import override_settings

from apps.ai import constants
from apps.ai.services.model_router import ModelRouteRequest, ModelRouter


@override_settings(
    AI_MODEL_REASONER_PRIMARY='gpt-reasoner-main',
    AI_MODEL_REASONER_FALLBACK='gpt-reasoner-fallback',
    AI_MODEL_WRITER_FALLBACK='gpt-writer-fallback',
    AI_MODEL_WRITER_PRIMARY='gpt-writer-main',
    AI_REQUEST_TIMEOUT_MS=8000,
)
def test_router_uses_reasoner_for_chronicle():
    router = ModelRouter()

    resolution = router.route(ModelRouteRequest(feature=constants.FEATURE_CHRONICLE_COPILOT))

    assert resolution.model_role == constants.MODEL_ROLE_REASONER_LARGE
    assert resolution.provider_model_id == 'gpt-reasoner-main'
    assert resolution.fallback_chain == ('gpt-reasoner-fallback', 'gpt-writer-fallback')
    assert resolution.timeout_ms == 8000


@override_settings(
    AI_MODEL_WRITER_PRIMARY='gpt-writer-main',
    AI_MODEL_WRITER_FALLBACK='gpt-writer-fallback',
    AI_MAX_CONTEXT_TOKENS=2000,
)
def test_router_sets_degraded_mode_when_context_exceeds_threshold():
    router = ModelRouter()

    resolution = router.route(
        ModelRouteRequest(
            feature=constants.FEATURE_NOTE_DRAFT,
            context_tokens=3000,
        )
    )

    assert resolution.model_role == constants.MODEL_ROLE_WRITER_MEDIUM
    assert resolution.provider_model_id == 'gpt-writer-main'
    assert resolution.degraded_mode == 'retrieve_then_summarize'
