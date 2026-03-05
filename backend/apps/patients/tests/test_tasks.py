"""Task tests for patients app."""

import pytest

from apps.patients.models import PatientSearch
from apps.patients.tasks import log_patient_search
from apps.users.tests.factories import DoctorUserFactory


pytestmark = [
    pytest.mark.django_db,
    pytest.mark.tier1,
]


def test_log_patient_search_preserves_safe_summary():
    user = DoctorUserFactory()

    log_patient_search(
        str(user.id),
        "patient-search filters=query+ward ordering=-created_at page=1",
        facility_code=user.primary_facility.code,
    )

    search_record = PatientSearch.objects.get(user=user)
    assert search_record.search_query == "patient-search filters=query+ward ordering=-created_at page=1"


def test_log_patient_search_replaces_unsafe_legacy_input():
    user = DoctorUserFactory()

    log_patient_search(
        str(user.id),
        "Jane Doe severe asthma follow-up",
        facility_code=user.primary_facility.code,
    )

    search_record = PatientSearch.objects.get(user=user)
    assert search_record.search_query == "patient-search filters=legacy-input"
