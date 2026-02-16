import pytest

from apps.core.tests.factories import FacilityFactory
from apps.dashboards.tasks import refresh_admin_dashboard_appointments_for_all_facilities


@pytest.mark.django_db
def test_refresh_admin_dashboard_prewarm_skips_when_lock_is_held(monkeypatch):
    FacilityFactory(code="LOCK1", is_active=True)

    enqueued = []
    monkeypatch.setattr("apps.dashboards.tasks.cache.add", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(
        "apps.dashboards.tasks.refresh_admin_dashboard_appointments.delay",
        lambda **kwargs: enqueued.append(kwargs),
    )

    refresh_admin_dashboard_appointments_for_all_facilities.run()

    assert enqueued == []


@pytest.mark.django_db
def test_refresh_admin_dashboard_prewarm_enqueues_only_active_facilities(monkeypatch):
    FacilityFactory(code="ACT1", is_active=True)
    FacilityFactory(code="ACT2", is_active=True)
    FacilityFactory(code="OFF1", is_active=False)

    enqueued = []
    monkeypatch.setattr("apps.dashboards.tasks.cache.add", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        "apps.dashboards.tasks.refresh_admin_dashboard_appointments.delay",
        lambda **kwargs: enqueued.append(kwargs),
    )

    refresh_admin_dashboard_appointments_for_all_facilities.run()

    queued_codes = {item["facility_code"] for item in enqueued}
    assert "ACT1" in queued_codes
    assert "ACT2" in queued_codes
    assert "OFF1" not in queued_codes
