import pytest
from django.core.cache import cache

from apps.core.cache_utils import facility_cache_key_for_code
from apps.core.tests.factories import FacilityFactory
from apps.users.tests.factories import PatientProfileFactory
from apps.dashboards.tasks import refresh_admin_dashboard_appointments_for_all_facilities


@pytest.mark.django_db
def test_refresh_admin_dashboard_prewarm_skips_when_lock_is_held(monkeypatch):
    FacilityFactory(code="LOCK1", is_active=True)

    search_calls = []
    monkeypatch.setattr("apps.dashboards.tasks.cache.add", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(
        "apps.dashboards.tasks.AppointmentProxy.search",
        lambda **kwargs: search_calls.append(kwargs),
    )

    refresh_admin_dashboard_appointments_for_all_facilities.run()

    assert search_calls == []


@pytest.mark.django_db
def test_refresh_admin_dashboard_prewarm_fetches_once_and_caches_active_facilities(monkeypatch):
    facility_one = FacilityFactory(code="ACT1", is_active=True)
    facility_two = FacilityFactory(code="ACT2", is_active=True)
    FacilityFactory(code="OFF1", is_active=False)

    PatientProfileFactory(facility=facility_one, fhir_patient_id="patient-act-1")
    PatientProfileFactory(facility=facility_two, fhir_patient_id="patient-act-2")

    search_calls = []
    cache.clear()
    monkeypatch.setattr("apps.dashboards.tasks.cache.add", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        "apps.dashboards.tasks.AppointmentProxy.search",
        lambda **kwargs: search_calls.append(kwargs) or {
            "entry": [
                {
                    "resource": {
                        "resourceType": "Appointment",
                        "id": "appt-1",
                        "participant": [
                            {"actor": {"reference": "Patient/patient-act-1"}},
                        ],
                    }
                },
                {
                    "resource": {
                        "resourceType": "Appointment",
                        "id": "appt-2",
                        "participant": [
                            {"actor": {"reference": "Patient/patient-act-2"}},
                        ],
                    }
                },
            ]
        },
    )

    refresh_admin_dashboard_appointments_for_all_facilities.run()

    assert len(search_calls) == 1
    date_str = search_calls[0]["date"]
    assert cache.get(facility_cache_key_for_code("ACT1", f"admin_dashboard_appointments_{date_str}")) == 1
    assert cache.get(facility_cache_key_for_code("ACT2", f"admin_dashboard_appointments_{date_str}")) == 1
    assert cache.get(facility_cache_key_for_code("OFF1", f"admin_dashboard_appointments_{date_str}")) is None
