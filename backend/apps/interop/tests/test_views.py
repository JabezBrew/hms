from datetime import date
from unittest.mock import patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.consent.services import grant_consent, issue_access_token
from apps.mpi.services import resolve_patient_identity
from apps.users.tests.factories import (
    AdminUserFactory,
    DoctorUserFactory,
    PatientProfileFactory,
)


@pytest.mark.django_db
def test_record_export_requires_clinical_access(settings):
    settings.TEAM_ACCESS_STRICT = True
    doctor = DoctorUserFactory()
    client = APIClient()
    client.force_authenticate(user=doctor)

    patient = PatientProfileFactory()
    identity, _ = resolve_patient_identity(
        first_name='Test',
        last_name='Patient',
        date_of_birth=date(1990, 1, 1),
        email='patient@test.com',
        created_by_facility_code='TEST',
        created_by_user_id=doctor.id,
    )
    patient.patient_identity_id = identity.id
    patient.save(update_fields=['patient_identity_id'])

    consent = grant_consent(
        patient_identity=identity,
        source_facility_code='TEST',
        target_facility_code='TARGET',
        created_by_facility_code='TEST',
        created_by_user_id=doctor.id,
    )
    token = issue_access_token(consent, target_facility_code='TARGET')

    payload = {
        'patient_identity_id': str(identity.id),
        'target_facility_code': 'TARGET',
        'consent_token': token,
    }

    with patch('apps.interop.services.build_record_export.delay'):
        response = client.post(
            '/api/interop/exports/',
            payload,
            format='json',
            HTTP_X_FACILITY_CODE='TEST',
            HTTP_X_REQUESTING_FACILITY_CODE='TARGET',
        )

    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_record_export_allows_admin():
    admin = AdminUserFactory()
    client = APIClient()
    client.force_authenticate(user=admin)

    patient = PatientProfileFactory()
    identity, _ = resolve_patient_identity(
        first_name='Test',
        last_name='Patient',
        date_of_birth=date(1990, 1, 1),
        email='patient@test.com',
        created_by_facility_code='TEST',
        created_by_user_id=admin.id,
    )
    patient.patient_identity_id = identity.id
    patient.save(update_fields=['patient_identity_id'])

    consent = grant_consent(
        patient_identity=identity,
        source_facility_code='TEST',
        target_facility_code='TARGET',
        created_by_facility_code='TEST',
        created_by_user_id=admin.id,
    )
    token = issue_access_token(consent, target_facility_code='TARGET')

    payload = {
        'patient_identity_id': str(identity.id),
        'target_facility_code': 'TARGET',
        'consent_token': token,
    }

    with patch('apps.interop.services.build_record_export.delay'):
        response = client.post(
            '/api/interop/exports/',
            payload,
            format='json',
            HTTP_X_FACILITY_CODE='TEST',
            HTTP_X_REQUESTING_FACILITY_CODE='TARGET',
        )

    assert response.status_code == status.HTTP_202_ACCEPTED
