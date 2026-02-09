"""
Realtime helpers for dashboard cache invalidation and push notifications.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache

from apps.core.cache_utils import facility_cache_key_for_code
from apps.core.security import normalize_facility_code

logger = logging.getLogger(__name__)

ADMIN_DASHBOARD_PROJECTION_VERSION = 1
ADMIN_DASHBOARD_PROJECTION_KEY = f"admin_dashboard_projection_v{ADMIN_DASHBOARD_PROJECTION_VERSION}"
ADMIN_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS = 2


def admin_dashboard_group_name(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return f"dashboards_admin_facility_{code}" if code else "dashboards_admin_facility_unknown"


def admin_dashboard_projection_cache_key(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, ADMIN_DASHBOARD_PROJECTION_KEY)


def _admin_dashboard_invalidation_lock_key(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, "admin_dashboard_invalidate_lock")


def _admin_dashboard_appointments_cache_key(facility_code: str, target_date: date) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"admin_dashboard_appointments_{target_date.isoformat()}")


def _admin_dashboard_appointments_stale_cache_key(facility_code: str, target_date: date) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"admin_dashboard_appointments_{target_date.isoformat()}_stale")


def invalidate_admin_dashboard(
    facility_code: Optional[str],
    *,
    reason: str = "data_changed",
    include_appointments: bool = False,
    target_date: Optional[date] = None,
) -> bool:
    """
    Invalidate admin dashboard projection cache and notify connected clients.
    Returns True when a broadcast was sent, False when throttled/skipped.
    """
    code = normalize_facility_code(facility_code)
    if not code:
        return False

    cache.delete(admin_dashboard_projection_cache_key(code))
    if include_appointments:
        appt_date = target_date or date.today()
        cache.delete(_admin_dashboard_appointments_cache_key(code, appt_date))
        cache.delete(_admin_dashboard_appointments_stale_cache_key(code, appt_date))

    # Coalesce bursts of writes into one websocket invalidation.
    if not cache.add(
        _admin_dashboard_invalidation_lock_key(code),
        "1",
        timeout=ADMIN_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS,
    ):
        return False

    channel_layer = get_channel_layer()
    if not channel_layer:
        return False

    try:
        async_to_sync(channel_layer.group_send)(
            admin_dashboard_group_name(code),
            {
                "type": "dashboard.invalidate",
                "dashboard": "admin",
                "facility_code": code,
                "reason": reason,
            },
        )
        return True
    except Exception:
        logger.exception("Failed to broadcast admin dashboard invalidation")
        return False

