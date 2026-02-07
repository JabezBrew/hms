from __future__ import annotations

from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Optional

from .types import PSPCreateIntentResult, PSPParsedWebhook


class PSPError(RuntimeError):
    pass


class PSPConfigurationError(PSPError):
    pass


class PSPWebhookVerificationError(PSPError):
    pass


class PSPAdapter(ABC):
    provider: str

    @abstractmethod
    def create_intent(
        self,
        *,
        mobile_number: str,
        amount: Decimal,
        client_reference: str,
        callback_url: str,
        title: str,
        description: str,
        cancellation_url: Optional[str] = None,
    ) -> PSPCreateIntentResult:
        """
        Create a PSP intent and return provider correlation details.
        """

    @abstractmethod
    def verify_webhook(self, request) -> bool:
        """
        Return True if webhook request appears authentic for this provider.
        """

    @abstractmethod
    def parse_webhook(self, *, body_bytes: bytes, headers: dict) -> PSPParsedWebhook:
        """
        Parse webhook body/headers into a provider-agnostic event.
        """

