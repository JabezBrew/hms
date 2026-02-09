"""
WebSocket consumers for dashboard live updates.

Dashboards use push invalidation (not full data payloads) to keep UI fresh while
keeping request paths fast and avoiding PHI in WebSocket messages.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.contrib.auth.models import AnonymousUser

from apps.core.security import get_user_facility_codes, normalize_facility_code
from .realtime import admin_dashboard_group_name

logger = logging.getLogger(__name__)


def _is_admin_actor(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return bool(
        getattr(user, "user_type", None) == "admin"
        or getattr(user, "is_staff", False)
        or getattr(user, "is_superuser", False)
    )


def _preferred_subprotocol(scope) -> Optional[str]:
    # NOTE: Keep this aligned with frontend websocket client.
    for offered in scope.get("subprotocols", []) or []:
        if str(offered).lower() == "hms.jwt":
            return offered
    return None


@database_sync_to_async
def _can_access_facility(user, facility_code: str) -> bool:
    allowed_codes = get_user_facility_codes(user)
    allow_cross_facility = getattr(settings, "ALLOW_CROSS_FACILITY_ACCESS", False)
    if allowed_codes and facility_code not in allowed_codes and not (
        allow_cross_facility and getattr(user, "user_type", None) == "admin"
    ):
        return False
    return True


class AdminDashboardConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for admin dashboard invalidations.

    - Joins a facility-scoped admin dashboard group.
    - Sends PHI-free invalidation events.
    """

    async def connect(self):
        self.user = self.scope.get("user", AnonymousUser())
        if not getattr(self.user, "is_authenticated", False):
            await self.close(code=4001)
            return

        if not _is_admin_actor(self.user):
            await self.close(code=4003)
            return

        facility_code = normalize_facility_code(self.scope.get("facility_code"))
        if not facility_code:
            await self.close(code=4000)
            return

        if not await _can_access_facility(self.user, facility_code):
            await self.close(code=4003)
            return

        self.facility_code = facility_code
        self.group_name = admin_dashboard_group_name(facility_code)
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        subprotocol = _preferred_subprotocol(self.scope)
        if subprotocol:
            await self.accept(subprotocol=subprotocol)
        else:
            await self.accept()

        await self.send_json(
            {
                "type": "connection.established",
                "dashboard": "admin",
                "facility_code": facility_code,
                "group": self.group_name,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def dashboard_invalidate(self, event):
        # Keep payload PHI-free. The client refetches via HTTPS.
        await self.send_json(
            {
                "type": "dashboard.invalidate",
                "dashboard": event.get("dashboard"),
                "facility_code": event.get("facility_code"),
                "reason": event.get("reason"),
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
