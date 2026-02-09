import pytest
from django.core.cache import cache

from apps.core.cache_utils import facility_cache_key_for_code
from apps.dashboards.realtime import (
    admin_dashboard_group_name,
    admin_dashboard_projection_cache_key,
    invalidate_admin_dashboard,
)


@pytest.mark.django_db
def test_admin_dashboard_group_name_normalizes_facility_code():
    assert admin_dashboard_group_name("acm") == "dashboards_admin_facility_ACM"
    assert admin_dashboard_group_name(" ACM ") == "dashboards_admin_facility_ACM"


@pytest.mark.django_db
def test_invalidate_admin_dashboard_clears_cache_and_broadcasts_once(monkeypatch):
    facility_code = "acm"
    projection_key = admin_dashboard_projection_cache_key(facility_code)
    cache.set(projection_key, {"stats": {"total_patients": 3}}, timeout=60)

    calls = []

    class FakeChannelLayer:
        async def group_send(self, group, payload):
            calls.append((group, payload))

    monkeypatch.setattr("apps.dashboards.realtime.get_channel_layer", lambda: FakeChannelLayer())

    sent = invalidate_admin_dashboard(facility_code, reason="bed_changed")
    assert sent is True
    assert cache.get(projection_key) is None
    assert len(calls) == 1

    group, payload = calls[0]
    assert group == "dashboards_admin_facility_ACM"
    assert payload["type"] == "dashboard.invalidate"
    assert payload["dashboard"] == "admin"
    assert payload["facility_code"] == "ACM"
    assert payload["reason"] == "bed_changed"

    # Debounce lock should suppress immediate duplicate broadcast.
    sent_again = invalidate_admin_dashboard(facility_code, reason="bed_changed")
    assert sent_again is False
    assert len(calls) == 1


@pytest.mark.django_db
def test_invalidate_admin_dashboard_can_clear_appointments_cache(monkeypatch):
    facility_code = "ACM"

    today_key = facility_cache_key_for_code(facility_code, "admin_dashboard_appointments_2026-02-09")
    stale_key = facility_cache_key_for_code(facility_code, "admin_dashboard_appointments_2026-02-09_stale")
    cache.set(today_key, 7, timeout=60)
    cache.set(stale_key, 7, timeout=60)

    class FakeChannelLayer:
        async def group_send(self, group, payload):
            return None

    monkeypatch.setattr("apps.dashboards.realtime.get_channel_layer", lambda: FakeChannelLayer())
    from datetime import date

    invalidate_admin_dashboard(
        facility_code,
        include_appointments=True,
        target_date=date(2026, 2, 9),
    )

    assert cache.get(today_key) is None
    assert cache.get(stale_key) is None

