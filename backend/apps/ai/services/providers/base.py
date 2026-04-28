from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ProviderResponse:
    payload: dict[str, Any]
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    model_name: str = ''


class LLMProvider(ABC):
    @abstractmethod
    def generate(self, prompt: str, *, context: dict[str, Any] | None = None, timeout_ms: int | None = None) -> ProviderResponse:
        raise NotImplementedError


class ASRProvider(ABC):
    @abstractmethod
    def transcribe(self, audio_uri: str, *, language: str | None = None, timeout_ms: int | None = None) -> ProviderResponse:
        raise NotImplementedError
