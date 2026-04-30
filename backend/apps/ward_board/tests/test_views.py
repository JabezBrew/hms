import pytest
from django.apps import apps

if not apps.is_installed('apps.ward_board'):
    pytest.skip('apps.ward_board is not registered in INSTALLED_APPS yet.', allow_module_level=True)

from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from apps.core.tests.factories import FacilityFactory
from apps.users.tests.factories import NurseUserFactory, PatientProfileFactory, ReceptionistUserFactory
from apps.ward_board.models import WardBoardTask
from apps.ward_board.views import WardBoardTaskViewSet
from apps.wards.tests.factories import AdmissionFactory


@pytest.mark.django_db
def test_task_list_is_scoped_to_active_facility(default_facility, monkeypatch, settings):
    settings.TEAM_ACCESS_STRICT = False
    monkeypatch.setattr('apps.ward_board.views.require_feature', lambda *_args, **_kwargs: None)
    nurse = NurseUserFactory(primary_facility=default_facility)
    patient = PatientProfileFactory(facility=default_facility)
    other_facility = FacilityFactory(code='WBOTHER', name='Ward Board Other')
    other_patient = PatientProfileFactory(facility=other_facility)

    visible = WardBoardTask.objects.create(
        facility=default_facility,
        patient=patient,
        owner_role='nurse',
        action_text='Visible task.',
        created_by=nurse,
        updated_by=nurse,
    )
    WardBoardTask.objects.create(
        facility=other_facility,
        patient=other_patient,
        owner_role='nurse',
        action_text='Hidden task.',
    )

    factory = APIRequestFactory()
    request = factory.get('/api/ward-board/tasks/', HTTP_X_FACILITY_CODE=default_facility.code)
    force_authenticate(request, user=nurse)
    response = WardBoardTaskViewSet.as_view({'get': 'list'})(request)

    assert response.status_code == status.HTTP_200_OK
    result_ids = {item['id'] for item in response.data['results']}
    assert result_ids == {str(visible.id)}


@pytest.mark.django_db
def test_board_projection_url_returns_active_admissions(default_facility, monkeypatch, settings):
    settings.TEAM_ACCESS_STRICT = False
    monkeypatch.setattr('apps.ward_board.views.require_feature', lambda *_args, **_kwargs: None)
    nurse = NurseUserFactory(primary_facility=default_facility)
    patient = PatientProfileFactory(facility=default_facility)
    AdmissionFactory(
        patient=patient,
        facility=default_facility,
        bed__ward__department__facility=default_facility,
        status='admitted',
    )

    client = APIClient()
    client.force_authenticate(user=nurse)
    response = client.get('/api/ward-board/', HTTP_X_FACILITY_CODE=default_facility.code)

    assert response.status_code == status.HTTP_200_OK
    patient_ids = {row['patient_id'] for row in response.data['results']}
    assert patient_ids == {str(patient.id)}


@pytest.mark.django_db
def test_non_clinical_role_cannot_list_board_tasks(default_facility, monkeypatch):
    monkeypatch.setattr('apps.ward_board.views.require_feature', lambda *_args, **_kwargs: None)
    receptionist = ReceptionistUserFactory(primary_facility=default_facility)

    factory = APIRequestFactory()
    request = factory.get('/api/ward-board/tasks/', HTTP_X_FACILITY_CODE=default_facility.code)
    force_authenticate(request, user=receptionist)
    response = WardBoardTaskViewSet.as_view({'get': 'list'})(request)

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_create_rejects_patient_outside_active_facility(default_facility, monkeypatch, settings):
    settings.TEAM_ACCESS_STRICT = False
    monkeypatch.setattr('apps.ward_board.views.require_feature', lambda *_args, **_kwargs: None)
    nurse = NurseUserFactory(primary_facility=default_facility)
    other_facility = FacilityFactory(code='WBX', name='Ward Board Cross')
    other_patient = PatientProfileFactory(facility=other_facility)

    factory = APIRequestFactory()
    request = factory.post(
        '/api/ward-board/tasks/',
        {
            'patient_id': str(other_patient.id),
            'owner_role': 'nurse',
            'action_text': 'Should not be created.',
        },
        format='json',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )
    force_authenticate(request, user=nurse)
    response = WardBoardTaskViewSet.as_view({'post': 'create'})(request)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert WardBoardTask.objects.count() == 0
