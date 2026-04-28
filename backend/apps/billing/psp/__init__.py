from __future__ import annotations

from .base import PSPAdapter
from .hubtel import HubtelAdapter


def get_psp_adapter(provider: str) -> PSPAdapter:
    provider = (provider or "").strip().lower()
    if provider == "hubtel":
        return HubtelAdapter()
    raise ValueError(f"Unsupported PSP provider: {provider}")

