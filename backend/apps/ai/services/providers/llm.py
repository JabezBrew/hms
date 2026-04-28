from .base import LLMProvider, ProviderResponse


class NoopLLMProvider(LLMProvider):
    """Safe default provider used until a real provider is configured."""

    def generate(self, prompt: str, *, context=None, timeout_ms=None) -> ProviderResponse:  # noqa: D401
        return ProviderResponse(
            payload={
                'status': 'not_configured',
                'message': 'LLM provider is not configured for this environment.',
            },
            input_tokens=0,
            output_tokens=0,
            latency_ms=0,
            model_name='noop',
        )
