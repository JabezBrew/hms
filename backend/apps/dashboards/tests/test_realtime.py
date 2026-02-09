import pytest
from django.core.cache import cache

from apps.core.cache_utils import facility_cache_key_for_code
from apps.dashboards.realtime import (
    admin_dashboard_group_name,
    admin_dashboard_projection_cache_key,
    doctor_clinic_projection_cache_key,
    doctor_my_work_projection_cache_key,
    invalidate_doctor_dashboard,
    inpatient_dashboard_projection_cache_key,
    invalidate_inpatient_dashboard,
    invalidate_nurse_dashboard,
    invalidate_reception_dashboard,
    invalidate_admin_dashboard,
    nurse_dashboard_projection_cache_key,
    reception_dashboard_projection_cache_key,
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


@pytest.mark.django_db
def test_invalidate_nurse_dashboard_clears_scoped_projection_cache_and_broadcasts(monkeypatch):
    facility_code = "ACM"
    all_scope_key = nurse_dashboard_projection_cache_key(facility_code, "all")
    ward_scope_key = nurse_dashboard_projection_cache_key(facility_code, "ward-1")
    cache.set(all_scope_key, {"urgent": {"count": 3}}, timeout=60)
    cache.set(ward_scope_key, {"urgent": {"count": 2}}, timeout=60)

    calls = []

    class FakeChannelLayer:
        async def group_send(self, group, payload):
            calls.append((group, payload))

    monkeypatch.setattr("apps.dashboards.realtime.get_channel_layer", lambda: FakeChannelLayer())

    sent = invalidate_nurse_dashboard(facility_code, ward_scope="ward-1", reason="task_changed")
    assert sent is True
    assert cache.get(all_scope_key) is None
    assert cache.get(ward_scope_key) is None
    assert len(calls) == 2

    groups = {group for group, _payload in calls}
    assert groups == {
        "dashboards_nurse_facility_ACM_all",
        "dashboards_nurse_facility_ACM_ward-1",
    }
    for _, payload in calls:
        assert payload["dashboard"] == "nurse"
        assert payload["facility_code"] == "ACM"
        assert payload["reason"] == "task_changed"
        assert payload["ward_scope"] == "ward-1"

    sent_again = invalidate_nurse_dashboard(facility_code, ward_scope="ward-1", reason="task_changed")
    assert sent_again is False


@pytest.mark.django_db
def test_invalidate_doctor_dashboard_clears_scoped_caches_and_broadcasts(monkeypatch):
    facility_code = "ACM"
    practitioner_id = "PRACT-123"
    from datetime import date
    target_date = date(2026, 2, 9)

    my_work_key = doctor_my_work_projection_cache_key(facility_code, practitioner_id, target_date)
    clinic_key = doctor_clinic_projection_cache_key(facility_code, practitioner_id, target_date)
    today_key = facility_cache_key_for_code(
        facility_code,
        f"doctor_dashboard_appointments_{practitioner_id}_{target_date.isoformat()}",
    )
    stale_key = facility_cache_key_for_code(
        facility_code,
        f"doctor_dashboard_appointments_{practitioner_id}_{target_date.isoformat()}_stale",
    )

    cache.set(my_work_key, {"upcoming": []}, timeout=60)
    cache.set(clinic_key, {"appointments": []}, timeout=60)
    cache.set(today_key, [{"id": "1"}], timeout=60)
    cache.set(stale_key, [{"id": "1"}], timeout=60)

    calls = []

    class FakeChannelLayer:
        async def group_send(self, group, payload):
            calls.append((group, payload))

    monkeypatch.setattr("apps.dashboards.realtime.get_channel_layer", lambda: FakeChannelLayer())

    sent = invalidate_doctor_dashboard(
        facility_code,
        practitioner_id,
        reason="appointment_changed",
        include_appointments=True,
        target_date=target_date,
    )
    assert sent is True
    assert cache.get(my_work_key) is None
    assert cache.get(clinic_key) is None
    assert cache.get(today_key) is None
    assert cache.get(stale_key) is None
    assert len(calls) == 1

    group, payload = calls[0]
    assert group == "dashboards_doctor_facility_ACM_practitioner_PRACT-123"
    assert payload["dashboard"] == "doctor"
    assert payload["facility_code"] == "ACM"
    assert payload["reason"] == "appointment_changed"
    assert payload["practitioner_id"] == practitioner_id
    assert payload["target_date"] == "2026-02-09"


@pytest.mark.django_db
def test_invalidate_inpatient_dashboard_clears_scoped_projection_cache_and_broadcasts(monkeypatch):
    facility_code = "ACM"
    practitioner_id = "9f188f8b-a29d-4e51-8aa8-fbb35274df97"
    projection_key = inpatient_dashboard_projection_cache_key(facility_code, practitioner_id)
    cache.set(projection_key, {"my_patients": []}, timeout=60)

    calls = []

    class FakeChannelLayer:
        async def group_send(self, group, payload):
            calls.append((group, payload))

    monkeypatch.setattr("apps.dashboards.realtime.get_channel_layer", lambda: FakeChannelLayer())

    sent = invalidate_inpatient_dashboard(
        facility_code,
        practitioner_id,
        reason="admission_changed",
    )
    assert sent is True
    assert cache.get(projection_key) is None
    assert len(calls) == 1
    group, payload = calls[0]
    assert group == "dashboards_inpatient_facility_ACM_practitioner_9f188f8b-a29d-4e51-8aa8-fbb35274df97"
    assert payload["dashboard"] == "inpatient"
    assert payload["facility_code"] == "ACM"
    assert payload["reason"] == "admission_changed"
    assert payload["practitioner_id"] == practitioner_id


@pytest.mark.django_db
def test_invalidate_reception_dashboard_clears_projection_and_appointments_cache(monkeypatch):
    facility_code = "ACM"
    projection_key = reception_dashboard_projection_cache_key(facility_code)
    cache.set(projection_key, {"stats": {"total_today": 5}}, timeout=60)

    today_key = facility_cache_key_for_code(facility_code, "facility_dashboard_appointments_2026-02-09")
    stale_key = facility_cache_key_for_code(facility_code, "facility_dashboard_appointments_2026-02-09_stale")
    cache.set(today_key, [{"id": "1"}], timeout=60)
    cache.set(stale_key, [{"id": "1"}], timeout=60)

    calls = []

    class FakeChannelLayer:
        async def group_send(self, group, payload):
            calls.append((group, payload))

    monkeypatch.setattr("apps.dashboards.realtime.get_channel_layer", lambda: FakeChannelLayer())
    from datetime import date

    sent = invalidate_reception_dashboard(
        facility_code,
        reason="appointment_changed",
        include_appointments=True,
        target_date=date(2026, 2, 9),
    )
    assert sent is True
    assert cache.get(projection_key) is None
    assert cache.get(today_key) is None
    assert cache.get(stale_key) is None
    assert len(calls) == 1
    group, payload = calls[0]
    assert group == "dashboards_reception_facility_ACM"
    assert payload["dashboard"] == "reception"
    assert payload["facility_code"] == "ACM"
    assert payload["reason"] == "appointment_changed"
