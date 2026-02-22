from .base import ASRProvider, ProviderResponse


class NoopASRProvider(ASRProvider):
    """Safe default provider used until a real provider is configured."""

    def transcribe(self, audio_uri: str, *, language=None, timeout_ms=None) -> ProviderResponse:  # noqa: D401
        return ProviderResponse(
            payload={
                'status': 'not_configured',
                'message': 'ASR provider is not configured for this environment.',
                'audio_uri': audio_uri,
            },
            input_tokens=0,
            output_tokens=0,
            latency_ms=0,
            model_name='noop-asr',
        )
