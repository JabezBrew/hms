from __future__ import annotations

import json
import logging
import hmac
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional
from urllib.parse import urljoin

import requests
from django.conf import settings
from django.utils import timezone

from .base import PSPAdapter, PSPConfigurationError
from .types import PSPCreateIntentResult, PSPParsedWebhook

logger = logging.getLogger(__name__)


def _to_decimal(value) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (ValueError, TypeError, InvalidOperation):
        return None


def _parse_epoch(value) -> Optional[datetime]:
    """
    Hubtel docs have shown `expiresAt` as an epoch-like integer.
    Be tolerant: accept seconds or milliseconds.
    """
    if value in (None, "", 0, "0"):
        return None
    try:
        ts = int(value)
    except (ValueError, TypeError):
        return None
    # Heuristic: > 10^12 is likely milliseconds.
    if ts > 10**12:
        ts = ts // 1000
    try:
        return timezone.make_aware(datetime.fromtimestamp(ts))
    except Exception:
        return None


class HubtelAdapter(PSPAdapter):
    provider = "hubtel"

    def __init__(self):
        self.base_url = getattr(settings, "HUBTEL_API_BASE_URL", "") or ""
        self.client_id = getattr(settings, "HUBTEL_CLIENT_ID", "") or ""
        self.client_secret = getattr(settings, "HUBTEL_CLIENT_SECRET", "") or ""
        self.webhook_secret = getattr(settings, "HUBTEL_WEBHOOK_SECRET", "") or ""

        # PSP calls are in request path; keep timeouts tight.
        self.timeout_seconds = getattr(settings, "HUBTEL_HTTP_TIMEOUT_SECONDS", 8)

    def _require_config(self) -> None:
        if not self.base_url:
            raise PSPConfigurationError("HUBTEL_API_BASE_URL is not configured.")
        if not self.client_id or not self.client_secret:
            raise PSPConfigurationError("HUBTEL_CLIENT_ID/SECRET are not configured.")

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
        Hubtel Request Money (Paylink) API.

        We intentionally avoid including PHI in `title`/`description`.
        """
        self._require_config()

        url = urljoin(self.base_url.rstrip("/") + "/", f"request-money/{mobile_number}")
        payload = {
            "amount": float(amount),
            "title": title,
            "description": description,
            "clientReference": client_reference,
            "callbackUrl": callback_url,
        }
        if cancellation_url:
            payload["cancellationUrl"] = cancellation_url

        resp = requests.post(
            url,
            json=payload,
            auth=(self.client_id, self.client_secret),
            timeout=self.timeout_seconds,
        )
        try:
            data = resp.json()
        except Exception:
            data = None

        if resp.status_code >= 400:
            # SECURITY: Never log request payload or response payload (may include personal data).
            response_code = None
            try:
                response_code = (data or {}).get("responseCode")
            except Exception:
                response_code = None
            logger.warning(
                "Hubtel create intent failed (status=%s, responseCode=%s)",
                resp.status_code,
                response_code,
            )
            raise RuntimeError("Hubtel create intent request failed.")

        # Expected: { message, responseCode, data: { paylinkId, paylinkUrl, expiresAt } }
        inner = (data or {}).get("data") or {}
        provider_reference = inner.get("paylinkId") or inner.get("paylinkID") or inner.get("id")
        if not provider_reference:
            raise RuntimeError("Hubtel response missing paylinkId.")

        checkout_url = inner.get("paylinkUrl") or inner.get("paylinkURL") or inner.get("url")
        expires_at = _parse_epoch(inner.get("expiresAt"))
        return PSPCreateIntentResult(
            provider_reference=str(provider_reference),
            checkout_url=str(checkout_url) if checkout_url else None,
            expires_at=expires_at,
        )

    def verify_webhook(self, request) -> bool:
        """
        Hubtel callbacks may not always include signatures. To make this safe:
        - If HUBTEL_WEBHOOK_SECRET is configured, require it as a query param token.
        - Otherwise, accept the callback only when DEBUG=True.
        """
        if not self.webhook_secret:
            return bool(settings.DEBUG)
        token = (getattr(request, "query_params", {}) or {}).get("token") or request.GET.get("token")
        return bool(token) and hmac.compare_digest(str(token), str(self.webhook_secret))

    def parse_webhook(self, *, body_bytes: bytes, headers: dict) -> PSPParsedWebhook:
        try:
            payload = json.loads(body_bytes.decode("utf-8"))
        except Exception as e:
            raise RuntimeError("Invalid JSON webhook payload") from e

        data = payload.get("data") or {}
        status_raw = str(data.get("status") or payload.get("status") or "").strip().lower()

        # Provider-agnostic status mapping.
        if status_raw in {"success", "successful", "paid", "completed", "complete", "succeeded"}:
            status = "succeeded"
        elif status_raw in {"failed", "failure", "error"}:
            status = "failed"
        elif status_raw in {"cancelled", "canceled"}:
            status = "cancelled"
        elif status_raw in {"expired"}:
            status = "expired"
        elif status_raw in {"pending", "processing"}:
            status = "pending"
        else:
            # Unknown statuses are treated as pending to avoid false negatives.
            status = "pending"

        provider_reference = data.get("paylinkId") or data.get("paylinkID") or data.get("id")
        client_reference = data.get("clientReference") or payload.get("clientReference")

        paid_amount = _to_decimal(data.get("amount") or payload.get("amount"))
        currency = data.get("currency") or payload.get("currency")
        fee_amount = _to_decimal(data.get("fee") or data.get("fees") or payload.get("fee"))

        # Some payloads include dates, others do not. We don't assume a schema here.
        paid_at = None

        event_type = data.get("paymentType") or payload.get("paymentType")

        return PSPParsedWebhook(
            provider_reference=str(provider_reference) if provider_reference else None,
            client_reference=str(client_reference) if client_reference else None,
            status=status,
            paid_amount=paid_amount,
            currency=str(currency).upper() if currency else None,
            fee_amount=fee_amount,
            paid_at=paid_at,
            event_type=str(event_type) if event_type else None,
        )
