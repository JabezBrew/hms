import pytest
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.ai.models import AIArtifact, AISession
from apps.core.tests.factories import DefaultFacilityFactory, FacilityFactory
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory


def _auth_client(user, facility):
    client = APIClient()
    token = AccessToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


def _enable_deployment_features(settings, *features):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        **{feature: True for feature in features},
    }


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_DRAFT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_create_ai_session_with_patient_context():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    client = _auth_client(doctor, facility)
    response = client.post(
        '/api/ai/sessions/',
        {'feature': 'note_draft', 'patient_id': str(patient.id), 'request_context': {'template': 'soap'}},
        format='json',
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data['feature'] == 'note_draft'
    assert str(response.data['patient']) == str(patient.id)


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_DRAFT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_create_ai_session_rejects_cross_facility_patient():
    facility_a = FacilityFactory(code='ALPHA')
    facility_b = FacilityFactory(code='BRAVO')

    doctor = DoctorUserFactory(primary_facility=facility_a)
    doctor.facilities.add(facility_a)

    patient_other_facility = PatientProfileFactory(
        facility=facility_b,
        user__primary_facility=facility_b,
    )

    client = _auth_client(doctor, facility_a)
    response = client.post(
        '/api/ai/sessions/',
        {'feature': 'note_draft', 'patient_id': str(patient_other_facility.id)},
        format='json',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert 'patient_id' in response.data


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_DRAFT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_artifact_accept_is_user_scoped():
    facility = DefaultFacilityFactory()
    owner = DoctorUserFactory(primary_facility=facility)
    owner.facilities.add(facility)
    other_user = DoctorUserFactory(primary_facility=facility)
    other_user.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    session = AISession.objects.create(
        facility=facility,
        user=owner,
        patient=patient,
        feature='note_draft',
        status='completed',
        request_context_hash='x' * 64,
    )
    artifact = AIArtifact.objects.create(
        session=session,
        artifact_type='note_draft',
        payload_json={'result': {}},
        schema_version='1.0',
    )

    other_client = _auth_client(other_user, facility)
    response = other_client.post(f'/api/ai/artifacts/{artifact.id}/accept/', {}, format='json')

    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_DRAFT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_observability_summary_admin_only(default_facility):
    admin = DoctorUserFactory(user_type='admin', is_staff=True, is_superuser=True, primary_facility=default_facility)
    admin.facilities.add(default_facility)
    doctor = DoctorUserFactory(primary_facility=default_facility)
    doctor.facilities.add(default_facility)

    admin_client = _auth_client(admin, default_facility)
    doctor_client = _auth_client(doctor, default_facility)

    forbidden = doctor_client.get('/api/ai/observability/summary/')
    allowed = admin_client.get('/api/ai/observability/summary/')

    assert forbidden.status_code == status.HTTP_403_FORBIDDEN
    assert allowed.status_code == status.HTTP_200_OK
    assert 'sessions' in allowed.data


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_OMNI_NL_ENABLED=True,
)
def test_omni_execute_preview_rejects_unapproved_target_route(default_facility, settings):
    _enable_deployment_features(settings, 'ai_omni_nl')
    doctor = DoctorUserFactory(primary_facility=default_facility)
    doctor.facilities.add(default_facility)
    client = _auth_client(doctor, default_facility)

    response = client.post(
        '/api/ai/omni/execute-preview/',
        {
            'text': 'open admin',
            'intent': {
                'intent_type': 'navigate.unknown',
                'target_route': {'path': '/admin/users', 'query': {}},
                'confidence': 0.99,
            },
        },
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    result = response.data['result']
    assert result['preview']['allowed'] is False
    assert result['intent']['target_route'] is None
