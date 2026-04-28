from apps.ai.services.model_router import ModelRouteRequest, ModelRouter
from apps.ai.services.providers.llm import NoopLLMProvider


class AIOrchestrator:
    """Stage-0 orchestration entrypoint for routing and provider invocation."""

    def __init__(self, model_router: ModelRouter | None = None):
        self.model_router = model_router or ModelRouter()
        self.llm_provider = NoopLLMProvider()

    def run_generation(self, *, feature: str, prompt: str, context_tokens: int = 0) -> dict:
        route = self.model_router.route(
            ModelRouteRequest(feature=feature, context_tokens=context_tokens),
        )
        provider_result = self.llm_provider.generate(prompt, timeout_ms=route.timeout_ms)
        return {
            'route': {
                'role': route.model_role,
                'model': route.provider_model_id,
                'fallback_chain': list(route.fallback_chain),
                'degraded_mode': route.degraded_mode,
            },
            'provider_result': provider_result.payload,
            'usage': {
                'input_tokens': provider_result.input_tokens,
                'output_tokens': provider_result.output_tokens,
                'latency_ms': provider_result.latency_ms,
            },
        }
