from datetime import timedelta
from uuid import uuid4

import pytest
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.clinical_notes.models import TimelineEvent
from apps.core.tests.factories import DefaultFacilityFactory, FacilityFactory
from apps.encounters.tests.factories import EncounterFactory
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory, ReceptionistUserFactory


def _auth_client(user, facility):
    client = APIClient()
    token = AccessToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


def _create_timeline_event(
    *,
    patient,
    event_type='note',
    title='Clinical update',
    summary='Clinical status reviewed.',
    timestamp=None,
    encounter=None,
    is_critical=False,
    source_model='NoteEntry',
):
    return TimelineEvent.objects.create(
        patient=patient,
        encounter=encounter,
        event_type=event_type,
        event_subtype='ai_test',
        source_model=source_model,
        source_id=uuid4(),
        timestamp=timestamp or timezone.now(),
        title=title,
        content_summary=summary,
        author_name='AI Test',
        is_critical=is_critical,
        status='active',
        search_text=f'{title} {summary}',
    )


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_CHRONICLE_COPILOT_ENABLED=True,
    AI_VECTOR_BACKEND='pgvector',
    TEAM_ACCESS_STRICT=False,
)
def test_chronicle_summarize_requires_clinical_access():
    facility = DefaultFacilityFactory()
    receptionist = ReceptionistUserFactory(primary_facility=facility)
    receptionist.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    _create_timeline_event(patient=patient)

    client = _auth_client(receptionist, facility)
    response = client.post(
        f'/api/ai/chronicle/{patient.id}/summarize/',
        {'time_window': '24h', 'focus': 'handoff'},
        format='json',
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_CHRONICLE_COPILOT_ENABLED=True,
    AI_VECTOR_BACKEND='pgvector',
    TEAM_ACCESS_STRICT=False,
)
def test_chronicle_summarize_returns_envelope_blocks_and_citations():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    _create_timeline_event(
        patient=patient,
        event_type='note',
        title='Progress note',
        summary='Dyspnea improving after bronchodilator.',
        timestamp=timezone.now() - timedelta(hours=3),
    )
    _create_timeline_event(
        patient=patient,
        event_type='lab',
        title='Lab panel',
        summary='CRP remains elevated.',
        timestamp=timezone.now() - timedelta(hours=2),
        is_critical=True,
        source_model='LabOrder',
    )

    client = _auth_client(doctor, facility)
    response = client.post(
        f'/api/ai/chronicle/{patient.id}/summarize/',
        {'time_window': '48h', 'focus': 'handoff'},
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['feature'] == 'chronicle_copilot'
    assert response.data['requires_human_review'] is True
    assert response.data['result']['mode'] == 'summary'
    assert response.data['result']['focus'] == 'handoff'
    assert response.data['result']['vector_backend'] == 'pgvector'
    assert len(response.data['result']['summary_blocks']) >= 3
    assert response.data['result']['review_label'] in {'needs_review', 'advisory', 'normal'}
    assert response.data['result']['safety_notice']
    assert response.data['citations']


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_CHRONICLE_COPILOT_ENABLED=True,
    AI_VECTOR_BACKEND='pgvector',
    TEAM_ACCESS_STRICT=False,
)
def test_chronicle_ask_returns_answer_supporting_points_and_citations():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    _create_timeline_event(
        patient=patient,
        event_type='vitals',
        title='Vitals update',
        summary='Heart rate improved from 122 to 98.',
        timestamp=timezone.now() - timedelta(hours=2),
        source_model='VitalSigns',
    )
    _create_timeline_event(
        patient=patient,
        event_type='prescription',
        title='Medication adjustment',
        summary='Started oral antibiotic and reduced IV fluids.',
        timestamp=timezone.now() - timedelta(hours=1),
        source_model='Prescription',
    )

    client = _auth_client(doctor, facility)
    response = client.post(
        f'/api/ai/chronicle/{patient.id}/ask/',
        {'question': 'What changed and what should we monitor?', 'time_window': '24h'},
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['feature'] == 'chronicle_copilot'
    assert response.data['result']['mode'] == 'qa'
    assert response.data['result']['answer']
    assert isinstance(response.data['result']['supporting_points'], list)
    assert response.data['result']['review_label'] in {'needs_review', 'advisory', 'normal'}
    assert response.data['result']['safety_notice']
    assert response.data['citations']


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_CHRONICLE_COPILOT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_chronicle_endpoints_enforce_facility_scope():
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
        f'/api/ai/chronicle/{patient_other_facility.id}/summarize/',
        {'time_window': '24h', 'focus': 'handoff'},
        format='json',
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_CHRONICLE_COPILOT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_chronicle_summarize_filters_timeline_by_encounter():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    encounter_a = EncounterFactory(patient=patient, facility=facility)
    encounter_b = EncounterFactory(patient=patient, facility=facility)

    _create_timeline_event(
        patient=patient,
        encounter=encounter_a,
        title='Encounter A note',
        summary='Associated with encounter A.',
    )
    _create_timeline_event(
        patient=patient,
        encounter=encounter_b,
        title='Encounter B note',
        summary='Associated with encounter B.',
    )

    client = _auth_client(doctor, facility)
    response = client.post(
        f'/api/ai/chronicle/{patient.id}/summarize/',
        {'time_window': '24h', 'focus': 'changes', 'encounter_id': str(encounter_a.id)},
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    timeline_citations = [item for item in response.data['citations'] if item.get('type') == 'timeline_event']
    assert len(timeline_citations) == 1


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_CHRONICLE_COPILOT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_chronicle_summarize_query_budget():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    for idx in range(4):
        _create_timeline_event(
            patient=patient,
            event_type='note',
            title=f'Progress note {idx}',
            summary='Clinical status update.',
            timestamp=timezone.now() - timedelta(hours=idx + 1),
        )

    client = _auth_client(doctor, facility)
    with CaptureQueriesContext(connection) as ctx:
        response = client.post(
            f'/api/ai/chronicle/{patient.id}/summarize/',
            {'time_window': '24h', 'focus': 'rounds'},
            format='json',
        )

    assert response.status_code == status.HTTP_200_OK
    assert len(ctx) <= 24
