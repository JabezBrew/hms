from datetime import date

import pytest
from rest_framework import status
from rest_framework_simplejwt.tokens import AccessToken

from apps.mpi.services import resolve_patient_identity
from apps.users.tests.factories import AdminUserFactory, PatientProfileFactory


@pytest.mark.django_db
def test_create_cross_facility_referral(api_client):
    admin = AdminUserFactory()
    token = AccessToken.for_user(admin)
    api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

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

    response = api_client.post(
        '/api/consent/referrals/',
        {
            'patient_identity_id': str(identity.id),
            'target_facility_code': 'TARGET',
            'reason_code': 'CARDIO',
        },
        format='json',
        HTTP_X_FACILITY_CODE='TEST',
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data['source_facility_code'] == 'TEST'
    assert response.data['target_facility_code'] == 'TARGET'


@pytest.mark.django_db
def test_create_consent_grant_and_issue_token(api_client):
    admin = AdminUserFactory()
    token = AccessToken.for_user(admin)
    api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

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

    response = api_client.post(
        '/api/consent/grants/',
        {
            'patient_identity_id': str(identity.id),
            'target_facility_code': 'TARGET',
            'scope': 'full_record',
            'reason': 'Referral to cardiology',
        },
        format='json',
        HTTP_X_FACILITY_CODE='TEST',
    )

    assert response.status_code == status.HTTP_201_CREATED
    consent_id = response.data['id']
    assert response.data['status'] == 'active'

    token_response = api_client.post(
        f'/api/consent/grants/{consent_id}/issue_token/',
        {
            'target_facility_code': 'TARGET',
            'ttl_seconds': 3600,
        },
        format='json',
        HTTP_X_FACILITY_CODE='TEST',
    )

    assert token_response.status_code == status.HTTP_201_CREATED
    assert token_response.data['token']
