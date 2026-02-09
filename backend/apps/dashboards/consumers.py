"""
WebSocket consumers for dashboard live updates.

Dashboards use push invalidation (not full data payloads) to keep UI fresh while
keeping request paths fast and avoiding PHI in WebSocket messages.
"""

from __future__ import annotations

import logging
from datetime import datetime
from urllib.parse import parse_qs
from typing import Optional

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.contrib.auth.models import AnonymousUser

from apps.core.security import get_user_facility_codes, normalize_facility_code
from apps.users.models import PractitionerProfile
from apps.wards.models import WardStaffAssignment
from .realtime import (
    admin_dashboard_group_name,
    inpatient_dashboard_group_name,
    nurse_dashboard_group_name,
    reception_dashboard_group_name,
)

logger = logging.getLogger(__name__)


def _user_role(user) -> str:
    return str(getattr(user, "user_type", None) or getattr(user, "role", None) or "").lower()


def _is_admin_actor(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return bool(
        _user_role(user) == "admin"
        or getattr(user, "is_staff", False)
        or getattr(user, "is_superuser", False)
    )


def _is_nurse_actor(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return _user_role(user) in {"nurse", "head_nurse", "nurse_practitioner", "admin"}


def _is_reception_actor(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return _user_role(user) in {"receptionist", "admin_staff", "admin"}


def _is_inpatient_actor(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return _user_role(user) in {"doctor", "physician", "practitioner", "admin"}


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
        allow_cross_facility and _user_role(user) == "admin"
    ):
        return False
    return True


@database_sync_to_async
def _resolve_practitioner_id(user) -> Optional[str]:
    practitioner_id = PractitionerProfile.objects.filter(
        staff__user=user
    ).values_list("id", flat=True).first()
    return str(practitioner_id) if practitioner_id else None


@database_sync_to_async
def _has_ward_assignment(user, ward_id: str) -> bool:
    if _is_admin_actor(user):
        return True
    practitioner = PractitionerProfile.objects.filter(staff__user=user).only("id").first()
    if not practitioner:
        return False
    return WardStaffAssignment.objects.filter(
        ward_id=ward_id,
        practitioner_id=practitioner.id,
        is_active=True,
    ).exists()


def _parse_ward_scope(scope) -> str:
    query_string = scope.get("query_string", b"").decode("utf-8")
    params = parse_qs(query_string)
    ward = (params.get("ward", []) or [None])[0]
    if not ward:
        return "all"
    ward_value = str(ward).strip()
    return ward_value if ward_value else "all"


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

    async def receive_json(self, content):
        if content.get("type") == "ping":
            await self.send_json(
                {
                    "type": "pong",
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )

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


class NurseDashboardConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for nurse dashboard invalidations.
    Scope:
    - facility
    - optional ward filter (query: ?ward=<ward_id>), default "all"
    """

    async def connect(self):
        self.user = self.scope.get("user", AnonymousUser())
        if not getattr(self.user, "is_authenticated", False):
            await self.close(code=4001)
            return

        if not _is_nurse_actor(self.user):
            await self.close(code=4003)
            return

        facility_code = normalize_facility_code(self.scope.get("facility_code"))
        if not facility_code:
            await self.close(code=4000)
            return

        if not await _can_access_facility(self.user, facility_code):
            await self.close(code=4003)
            return

        ward_scope = _parse_ward_scope(self.scope)
        if ward_scope != "all" and not await _has_ward_assignment(self.user, ward_scope):
            await self.close(code=4003)
            return

        self.facility_code = facility_code
        self.ward_scope = ward_scope
        self.group_name = nurse_dashboard_group_name(facility_code, ward_scope)
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        subprotocol = _preferred_subprotocol(self.scope)
        if subprotocol:
            await self.accept(subprotocol=subprotocol)
        else:
            await self.accept()

        await self.send_json(
            {
                "type": "connection.established",
                "dashboard": "nurse",
                "facility_code": facility_code,
                "ward_scope": ward_scope,
                "group": self.group_name,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content):
        if content.get("type") == "ping":
            await self.send_json(
                {
                    "type": "pong",
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )

    async def dashboard_invalidate(self, event):
        await self.send_json(
            {
                "type": "dashboard.invalidate",
                "dashboard": event.get("dashboard"),
                "facility_code": event.get("facility_code"),
                "reason": event.get("reason"),
                "ward_scope": event.get("ward_scope"),
                "timestamp": datetime.utcnow().isoformat(),
            }
        )


class InpatientDashboardConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for inpatient dashboard invalidations.
    Scope:
    - facility
    - practitioner profile derived from authenticated user
    """

    async def connect(self):
        self.user = self.scope.get("user", AnonymousUser())
        if not getattr(self.user, "is_authenticated", False):
            await self.close(code=4001)
            return

        if not _is_inpatient_actor(self.user):
            await self.close(code=4003)
            return

        facility_code = normalize_facility_code(self.scope.get("facility_code"))
        if not facility_code:
            await self.close(code=4000)
            return

        if not await _can_access_facility(self.user, facility_code):
            await self.close(code=4003)
            return

        practitioner_id = await _resolve_practitioner_id(self.user)
        if not practitioner_id:
            await self.close(code=4003)
            return

        self.facility_code = facility_code
        self.practitioner_id = practitioner_id
        self.group_name = inpatient_dashboard_group_name(facility_code, practitioner_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        subprotocol = _preferred_subprotocol(self.scope)
        if subprotocol:
            await self.accept(subprotocol=subprotocol)
        else:
            await self.accept()

        await self.send_json(
            {
                "type": "connection.established",
                "dashboard": "inpatient",
                "facility_code": facility_code,
                "practitioner_id": practitioner_id,
                "group": self.group_name,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content):
        if content.get("type") == "ping":
            await self.send_json(
                {
                    "type": "pong",
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )

    async def dashboard_invalidate(self, event):
        await self.send_json(
            {
                "type": "dashboard.invalidate",
                "dashboard": event.get("dashboard"),
                "facility_code": event.get("facility_code"),
                "reason": event.get("reason"),
                "practitioner_id": event.get("practitioner_id"),
                "timestamp": datetime.utcnow().isoformat(),
            }
        )


class ReceptionDashboardConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for reception dashboard invalidations.
    Scope:
    - facility
    """

    async def connect(self):
        self.user = self.scope.get("user", AnonymousUser())
        if not getattr(self.user, "is_authenticated", False):
            await self.close(code=4001)
            return

        if not _is_reception_actor(self.user):
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
        self.group_name = reception_dashboard_group_name(facility_code)
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        subprotocol = _preferred_subprotocol(self.scope)
        if subprotocol:
            await self.accept(subprotocol=subprotocol)
        else:
            await self.accept()

        await self.send_json(
            {
                "type": "connection.established",
                "dashboard": "reception",
                "facility_code": facility_code,
                "group": self.group_name,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content):
        if content.get("type") == "ping":
            await self.send_json(
                {
                    "type": "pong",
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )

    async def dashboard_invalidate(self, event):
        await self.send_json(
            {
                "type": "dashboard.invalidate",
                "dashboard": event.get("dashboard"),
                "facility_code": event.get("facility_code"),
                "reason": event.get("reason"),
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
