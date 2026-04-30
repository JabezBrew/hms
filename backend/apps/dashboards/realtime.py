"""
Realtime helpers for dashboard cache invalidation and push notifications.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from typing import Optional

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from django.utils import timezone

from apps.core.cache_utils import facility_cache_key_for_code
from apps.core.security import normalize_facility_code

logger = logging.getLogger(__name__)

ADMIN_DASHBOARD_PROJECTION_VERSION = 1
ADMIN_DASHBOARD_PROJECTION_KEY = f"admin_dashboard_projection_v{ADMIN_DASHBOARD_PROJECTION_VERSION}"
DOCTOR_MY_WORK_PROJECTION_VERSION = 1
DOCTOR_CLINIC_PROJECTION_VERSION = 1
NURSE_DASHBOARD_PROJECTION_VERSION = 1
INPATIENT_DASHBOARD_PROJECTION_VERSION = 1
RECEPTION_DASHBOARD_PROJECTION_VERSION = 1
WARD_TASK_BOARD_PROJECTION_VERSION = 1

DOCTOR_MY_WORK_PROJECTION_KEY = f"doctor_my_work_projection_v{DOCTOR_MY_WORK_PROJECTION_VERSION}"
DOCTOR_CLINIC_PROJECTION_KEY = f"doctor_clinic_projection_v{DOCTOR_CLINIC_PROJECTION_VERSION}"
NURSE_DASHBOARD_PROJECTION_KEY = f"nurse_dashboard_projection_v{NURSE_DASHBOARD_PROJECTION_VERSION}"
INPATIENT_DASHBOARD_PROJECTION_KEY = f"inpatient_dashboard_projection_v{INPATIENT_DASHBOARD_PROJECTION_VERSION}"
RECEPTION_DASHBOARD_PROJECTION_KEY = f"reception_dashboard_projection_v{RECEPTION_DASHBOARD_PROJECTION_VERSION}"
WARD_TASK_BOARD_PROJECTION_KEY = f"ward_task_board_projection_v{WARD_TASK_BOARD_PROJECTION_VERSION}"

ADMIN_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS = 2
DOCTOR_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS = 2
NURSE_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS = 2
INPATIENT_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS = 2
RECEPTION_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS = 2
WARD_TASK_BOARD_INVALIDATION_DEBOUNCE_SECONDS = 2

SAFE_GROUP_TOKEN_PATTERN = re.compile(r"[^A-Za-z0-9_.-]+")


def _safe_group_token(value: Optional[str], *, fallback: str = "unknown") -> str:
    if not value:
        return fallback
    token = SAFE_GROUP_TOKEN_PATTERN.sub("_", str(value).strip())
    return token or fallback


def admin_dashboard_group_name(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return f"dashboards_admin_facility_{code}" if code else "dashboards_admin_facility_unknown"


def admin_dashboard_projection_cache_key(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, ADMIN_DASHBOARD_PROJECTION_KEY)


def _admin_dashboard_v2_summary_cache_key(facility_code: str, window: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"admin_v2_summary_{window}")


def _admin_dashboard_v2_capacity_cache_key(facility_code: str, window: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"admin_v2_capacity_{window}")


def _admin_dashboard_v2_workforce_cache_key(facility_code: str, window: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"admin_v2_workforce_{window}")


def _admin_dashboard_v2_compliance_cache_key(facility_code: str, window: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"admin_v2_compliance_{window}")


def _admin_dashboard_invalidation_lock_key(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, "admin_dashboard_invalidate_lock")


def _admin_dashboard_appointments_cache_key(facility_code: str, target_date: date) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"admin_dashboard_appointments_{target_date.isoformat()}")


def _admin_dashboard_appointments_stale_cache_key(facility_code: str, target_date: date) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"admin_dashboard_appointments_{target_date.isoformat()}_stale")


def doctor_dashboard_group_name(facility_code: str, practitioner_id: str) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    if not code:
        return f"dashboards_doctor_facility_unknown_practitioner_{practitioner_token}"
    return f"dashboards_doctor_facility_{code}_practitioner_{practitioner_token}"


def doctor_my_work_projection_cache_key(facility_code: str, practitioner_id: str, target_date: date) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    return facility_cache_key_for_code(
        code,
        f"{DOCTOR_MY_WORK_PROJECTION_KEY}_{practitioner_token}_{target_date.isoformat()}",
    )


def doctor_clinic_projection_cache_key(facility_code: str, practitioner_id: str, target_date: date) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    return facility_cache_key_for_code(
        code,
        f"{DOCTOR_CLINIC_PROJECTION_KEY}_{practitioner_token}_{target_date.isoformat()}",
    )


def _doctor_dashboard_invalidation_lock_key(
    facility_code: str,
    practitioner_id: str,
    target_date: date,
) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    return facility_cache_key_for_code(
        code,
        f"doctor_dashboard_invalidate_lock_{practitioner_token}_{target_date.isoformat()}",
    )


def _doctor_dashboard_appointments_cache_key(
    facility_code: str,
    practitioner_id: str,
    target_date: date,
) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    return facility_cache_key_for_code(
        code,
        f"doctor_dashboard_appointments_{practitioner_token}_{target_date.isoformat()}",
    )


def _doctor_dashboard_appointments_stale_cache_key(
    facility_code: str,
    practitioner_id: str,
    target_date: date,
) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    return facility_cache_key_for_code(
        code,
        f"doctor_dashboard_appointments_{practitioner_token}_{target_date.isoformat()}_stale",
    )


def nurse_dashboard_group_name(facility_code: str, ward_scope: Optional[str] = None) -> str:
    code = normalize_facility_code(facility_code)
    scope = _safe_group_token(ward_scope, fallback="all")
    if not code:
        return f"dashboards_nurse_facility_unknown_{scope}"
    return f"dashboards_nurse_facility_{code}_{scope}"


def nurse_dashboard_projection_cache_key(facility_code: str, ward_scope: Optional[str] = None) -> str:
    code = normalize_facility_code(facility_code)
    scope = _safe_group_token(ward_scope, fallback="all")
    return facility_cache_key_for_code(code, f"{NURSE_DASHBOARD_PROJECTION_KEY}_{scope}")


def _nurse_dashboard_invalidation_lock_key(facility_code: str, ward_scope: Optional[str] = None) -> str:
    code = normalize_facility_code(facility_code)
    scope = _safe_group_token(ward_scope, fallback="all")
    return facility_cache_key_for_code(code, f"nurse_dashboard_invalidate_lock_{scope}")


def ward_task_board_group_name(facility_code: str, ward_scope: Optional[str] = None) -> str:
    code = normalize_facility_code(facility_code)
    scope = _safe_group_token(ward_scope, fallback="all")
    if not code:
        return f"ward_task_board_facility_unknown_{scope}"
    return f"ward_task_board_facility_{code}_{scope}"


def ward_task_board_projection_cache_key(facility_code: str, ward_scope: Optional[str] = None) -> str:
    code = normalize_facility_code(facility_code)
    scope = _safe_group_token(ward_scope, fallback="all")
    return facility_cache_key_for_code(code, f"{WARD_TASK_BOARD_PROJECTION_KEY}_{scope}")


def _ward_task_board_invalidation_lock_key(facility_code: str, ward_scope: Optional[str] = None) -> str:
    code = normalize_facility_code(facility_code)
    scope = _safe_group_token(ward_scope, fallback="all")
    return facility_cache_key_for_code(code, f"ward_task_board_invalidate_lock_{scope}")


def inpatient_dashboard_group_name(facility_code: str, practitioner_id: str) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    if not code:
        return f"dashboards_inpatient_facility_unknown_practitioner_{practitioner_token}"
    return f"dashboards_inpatient_facility_{code}_practitioner_{practitioner_token}"


def inpatient_dashboard_projection_cache_key(facility_code: str, practitioner_id: str) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    return facility_cache_key_for_code(
        code,
        f"{INPATIENT_DASHBOARD_PROJECTION_KEY}_{practitioner_token}",
    )


def _inpatient_dashboard_invalidation_lock_key(facility_code: str, practitioner_id: str) -> str:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    return facility_cache_key_for_code(
        code,
        f"inpatient_dashboard_invalidate_lock_{practitioner_token}",
    )


def reception_dashboard_group_name(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return f"dashboards_reception_facility_{code}" if code else "dashboards_reception_facility_unknown"


def reception_dashboard_projection_cache_key(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, RECEPTION_DASHBOARD_PROJECTION_KEY)


def _reception_dashboard_invalidation_lock_key(facility_code: str) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, "reception_dashboard_invalidate_lock")


def _reception_dashboard_appointments_cache_key(facility_code: str, target_date: date) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"facility_dashboard_appointments_{target_date.isoformat()}")


def _reception_dashboard_appointments_stale_cache_key(facility_code: str, target_date: date) -> str:
    code = normalize_facility_code(facility_code)
    return facility_cache_key_for_code(code, f"facility_dashboard_appointments_{target_date.isoformat()}_stale")


def _broadcast_dashboard_invalidation(
    *,
    group_name: str,
    lock_key: str,
    debounce_seconds: int,
    payload: dict,
) -> bool:
    if not cache.add(lock_key, "1", timeout=debounce_seconds):
        return False

    channel_layer = get_channel_layer()
    if not channel_layer:
        return False

    try:
        async_to_sync(channel_layer.group_send)(
            group_name,
            payload,
        )
        return True
    except Exception:
        logger.exception("Failed to broadcast dashboard invalidation")
        return False


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
    for window in ("now", "today", "7d"):
        cache.delete(_admin_dashboard_v2_summary_cache_key(code, window))
        cache.delete(_admin_dashboard_v2_capacity_cache_key(code, window))
        cache.delete(_admin_dashboard_v2_workforce_cache_key(code, window))
        cache.delete(_admin_dashboard_v2_compliance_cache_key(code, window))
    if include_appointments:
        appt_date = target_date or date.today()
        cache.delete(_admin_dashboard_appointments_cache_key(code, appt_date))
        cache.delete(_admin_dashboard_appointments_stale_cache_key(code, appt_date))

    return _broadcast_dashboard_invalidation(
        group_name=admin_dashboard_group_name(code),
        lock_key=_admin_dashboard_invalidation_lock_key(code),
        debounce_seconds=ADMIN_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS,
        payload={
            "type": "dashboard.invalidate",
            "dashboard": "admin",
            "facility_code": code,
            "reason": reason,
        },
    )


def invalidate_nurse_dashboard(
    facility_code: Optional[str],
    *,
    ward_scope: Optional[str] = None,
    reason: str = "data_changed",
) -> bool:
    code = normalize_facility_code(facility_code)
    if not code:
        return False

    normalized_ward_scope = _safe_group_token(ward_scope, fallback="all")
    cache.delete(nurse_dashboard_projection_cache_key(code, "all"))
    if normalized_ward_scope != "all":
        cache.delete(nurse_dashboard_projection_cache_key(code, normalized_ward_scope))

    broadcasts = []
    payload = {
        "type": "dashboard.invalidate",
        "dashboard": "nurse",
        "facility_code": code,
        "reason": reason,
        "ward_scope": normalized_ward_scope,
    }
    broadcasts.append(
        _broadcast_dashboard_invalidation(
            group_name=nurse_dashboard_group_name(code, "all"),
            lock_key=_nurse_dashboard_invalidation_lock_key(code, "all"),
            debounce_seconds=NURSE_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS,
            payload=payload,
        )
    )
    if normalized_ward_scope != "all":
        broadcasts.append(
            _broadcast_dashboard_invalidation(
                group_name=nurse_dashboard_group_name(code, normalized_ward_scope),
                lock_key=_nurse_dashboard_invalidation_lock_key(code, normalized_ward_scope),
                debounce_seconds=NURSE_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS,
                payload=payload,
            )
        )

    return any(broadcasts)


def invalidate_ward_task_board(
    facility_code: Optional[str],
    *,
    ward_scope: Optional[str] = None,
    reason: str = "data_changed",
) -> bool:
    """
    Invalidate ward clinical task board projections and notify subscribed clients.

    The WebSocket payload is intentionally PHI-free. Clients refetch board data
    through access-controlled HTTPS endpoints.
    """
    code = normalize_facility_code(facility_code)
    if not code:
        return False

    normalized_ward_scope = _safe_group_token(ward_scope, fallback="all")
    cache.delete(ward_task_board_projection_cache_key(code, "all"))
    if normalized_ward_scope != "all":
        cache.delete(ward_task_board_projection_cache_key(code, normalized_ward_scope))

    payload = {
        "type": "ward_board.invalidate",
        "facility_code": code,
        "ward_scope": normalized_ward_scope,
        "reason": reason,
        "timestamp": timezone.now().isoformat(),
    }
    broadcasts = [
        _broadcast_dashboard_invalidation(
            group_name=ward_task_board_group_name(code, "all"),
            lock_key=_ward_task_board_invalidation_lock_key(code, "all"),
            debounce_seconds=WARD_TASK_BOARD_INVALIDATION_DEBOUNCE_SECONDS,
            payload=payload,
        )
    ]
    if normalized_ward_scope != "all":
        broadcasts.append(
            _broadcast_dashboard_invalidation(
                group_name=ward_task_board_group_name(code, normalized_ward_scope),
                lock_key=_ward_task_board_invalidation_lock_key(code, normalized_ward_scope),
                debounce_seconds=WARD_TASK_BOARD_INVALIDATION_DEBOUNCE_SECONDS,
                payload=payload,
            )
        )

    return any(broadcasts)


def invalidate_doctor_dashboard(
    facility_code: Optional[str],
    practitioner_id: Optional[str],
    *,
    reason: str = "data_changed",
    include_appointments: bool = False,
    target_date: Optional[date] = None,
) -> bool:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    if not code or practitioner_token == "unknown":
        return False

    scoped_date = target_date or date.today()
    cache.delete(doctor_my_work_projection_cache_key(code, practitioner_token, scoped_date))
    cache.delete(doctor_clinic_projection_cache_key(code, practitioner_token, scoped_date))
    if include_appointments:
        cache.delete(_doctor_dashboard_appointments_cache_key(code, practitioner_token, scoped_date))
        cache.delete(_doctor_dashboard_appointments_stale_cache_key(code, practitioner_token, scoped_date))

    return _broadcast_dashboard_invalidation(
        group_name=doctor_dashboard_group_name(code, practitioner_token),
        lock_key=_doctor_dashboard_invalidation_lock_key(code, practitioner_token, scoped_date),
        debounce_seconds=DOCTOR_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS,
        payload={
            "type": "dashboard.invalidate",
            "dashboard": "doctor",
            "facility_code": code,
            "reason": reason,
            "practitioner_id": practitioner_token,
            "target_date": scoped_date.isoformat(),
        },
    )


def invalidate_inpatient_dashboard(
    facility_code: Optional[str],
    practitioner_id: Optional[str],
    *,
    reason: str = "data_changed",
) -> bool:
    code = normalize_facility_code(facility_code)
    practitioner_token = _safe_group_token(practitioner_id)
    if not code or practitioner_token == "unknown":
        return False

    cache.delete(inpatient_dashboard_projection_cache_key(code, practitioner_token))
    return _broadcast_dashboard_invalidation(
        group_name=inpatient_dashboard_group_name(code, practitioner_token),
        lock_key=_inpatient_dashboard_invalidation_lock_key(code, practitioner_token),
        debounce_seconds=INPATIENT_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS,
        payload={
            "type": "dashboard.invalidate",
            "dashboard": "inpatient",
            "facility_code": code,
            "reason": reason,
            "practitioner_id": practitioner_token,
        },
    )


def invalidate_reception_dashboard(
    facility_code: Optional[str],
    *,
    reason: str = "data_changed",
    include_appointments: bool = False,
    target_date: Optional[date] = None,
) -> bool:
    code = normalize_facility_code(facility_code)
    if not code:
        return False

    cache.delete(reception_dashboard_projection_cache_key(code))
    if include_appointments:
        appt_date = target_date or date.today()
        cache.delete(_reception_dashboard_appointments_cache_key(code, appt_date))
        cache.delete(_reception_dashboard_appointments_stale_cache_key(code, appt_date))

    return _broadcast_dashboard_invalidation(
        group_name=reception_dashboard_group_name(code),
        lock_key=_reception_dashboard_invalidation_lock_key(code),
        debounce_seconds=RECEPTION_DASHBOARD_INVALIDATION_DEBOUNCE_SECONDS,
        payload={
            "type": "dashboard.invalidate",
            "dashboard": "reception",
            "facility_code": code,
            "reason": reason,
        },
    )
