from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Optional


@dataclass(frozen=True)
class PSPCreateIntentResult:
    provider_reference: str
    checkout_url: Optional[str] = None
    expires_at: Optional[datetime] = None


@dataclass(frozen=True)
class PSPParsedWebhook:
    provider_reference: Optional[str]
    client_reference: Optional[str]
    status: str
    paid_amount: Optional[Decimal] = None
    fee_amount: Optional[Decimal] = None
    paid_at: Optional[datetime] = None
    event_type: Optional[str] = None

