import pytest
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from apps.admissions.models import AdmissionCase
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory


@pytest.mark.django_db
def test_start_case_enforces_clinical_access_for_clinical_roles(default_facility, monkeypatch):
    doctor = DoctorUserFactory(primary_facility=default_facility)
    patient = PatientProfileFactory(facility=default_facility, user__primary_facility=default_facility)

    def _deny(*_args, **_kwargs):
        raise PermissionDenied('Team-based access required. Use break-glass to access this patient.')

    monkeypatch.setattr('apps.admissions.views.check_clinical_access', _deny)

    client = APIClient()
    client.force_authenticate(user=doctor)

    response = client.post(
        '/api/admissions/cases/start/',
        {'patient_id': str(patient.id), 'payload': {'admission_note': 'restricted'}},
        format='json',
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert AdmissionCase.objects.count() == 0
