import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.clinical_notes.models import NoteTemplate, NoteTemplateRevision
from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory, ReceptionistUserFactory


def _auth_client(user, facility):
    client = APIClient()
    token = AccessToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


def _create_template_with_revision(*, facility, user, title='AI SOAP Template'):
    structure = {
        'sections': [
            {
                'name': 'Subjective',
                'type': 'text',
                'required': True,
                'default_text': 'Seen on {{today}} by {{patient_name}} for {{chief_complaint}}.',
            },
            {
                'name': 'Assessment',
                'type': 'text',
                'required': True,
                'default_text': 'Clinical assessment to be verified with current findings.',
            },
            {
                'name': 'Plan',
                'type': 'text',
                'required': False,
            },
        ],
    }

    template = NoteTemplate.objects.create(
        facility=facility,
        title=title,
        description='AI note testing template',
        is_active=True,
        visibility='public',
        category='soap',
        icon='file-text',
        estimated_steps=3,
        is_public=True,
        created_by=user,
        updated_by=user,
        structure=structure,
    )
    revision = NoteTemplateRevision.objects.create(
        template=template,
        facility=facility,
        version=1,
        status='published',
        mode='written',
        content=structure,
        created_by=user,
        published_by=user,
        published_at=timezone.now(),
    )
    return template, revision


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_DRAFT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_note_draft_requires_clinical_access():
    facility = DefaultFacilityFactory()
    receptionist = ReceptionistUserFactory(primary_facility=facility)
    receptionist.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    template, revision = _create_template_with_revision(facility=facility, user=receptionist)

    client = _auth_client(receptionist, facility)
    response = client.post(
        '/api/ai/notes/draft/',
        {
            'patient_id': str(patient.id),
            'template_id': str(template.id),
            'template_revision_id': str(revision.id),
            'prompt': 'Headache follow-up',
        },
        format='json',
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_DRAFT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_note_draft_returns_common_envelope_and_section_keyed_draft():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    template, revision = _create_template_with_revision(facility=facility, user=doctor)

    client = _auth_client(doctor, facility)
    response = client.post(
        '/api/ai/notes/draft/',
        {
            'patient_id': str(patient.id),
            'template_id': str(template.id),
            'template_revision_id': str(revision.id),
            'prompt': 'Chest pain follow-up',
        },
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['feature'] == 'note_draft'
    assert response.data['requires_human_review'] is True
    assert response.data['result']['mode'] == 'draft'
    assert response.data['result']['template_revision_id'] == str(revision.id)
    assert response.data['result']['draft']['subjective']
    assert response.data['result']['draft']['assessment']
    assert len(response.data['result']['sections']) == 3
    assert response.data['result']['review_label'] in {'needs_review', 'advisory', 'normal'}
    assert any(item.get('type') == 'note_template_revision' for item in response.data['citations'])


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_DRAFT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_note_draft_rejects_template_revision_mismatch():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    template_a, revision_a = _create_template_with_revision(facility=facility, user=doctor, title='Template A')
    template_b, _ = _create_template_with_revision(facility=facility, user=doctor, title='Template B')

    client = _auth_client(doctor, facility)
    response = client.post(
        '/api/ai/notes/draft/',
        {
            'patient_id': str(patient.id),
            'template_id': str(template_b.id),
            'template_revision_id': str(revision_a.id),
        },
        format='json',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert 'template_revision_id' in response.data

    # Sanity check that the setup was actually mismatched.
    assert template_a.id != template_b.id


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_LINT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_note_lint_requires_clinical_access():
    facility = DefaultFacilityFactory()
    receptionist = ReceptionistUserFactory(primary_facility=facility)
    receptionist.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    template, revision = _create_template_with_revision(facility=facility, user=receptionist)

    client = _auth_client(receptionist, facility)
    response = client.post(
        '/api/ai/notes/lint/',
        {
            'patient_id': str(patient.id),
            'template_id': str(template.id),
            'template_revision_id': str(revision.id),
            'note_data': {'Subjective': 'Brief text'},
        },
        format='json',
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_LINT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_note_lint_enforces_critical_block_and_major_acknowledgement():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    template, revision = _create_template_with_revision(facility=facility, user=doctor)

    client = _auth_client(doctor, facility)
    response = client.post(
        '/api/ai/notes/lint/',
        {
            'patient_id': str(patient.id),
            'template_id': str(template.id),
            'template_revision_id': str(revision.id),
            'note_data': {
                'Subjective': 'todo',
                'Plan': 'Return if symptoms worsen.',
            },
        },
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['feature'] == 'note_lint'
    assert response.data['result']['mode'] == 'lint'
    assert response.data['result']['can_save_draft'] is True
    assert response.data['result']['can_finalize'] is False
    assert response.data['result']['requires_major_acknowledgement'] is True
    assert response.data['result']['issue_counts']['critical'] >= 1
    assert response.data['result']['issue_counts']['major'] >= 1
    assert all('suggested_fix' in issue for issue in response.data['result']['issues'])


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_LINT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_note_lint_allows_finalize_when_only_minor_issues_exist():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    template, revision = _create_template_with_revision(facility=facility, user=doctor)

    client = _auth_client(doctor, facility)
    response = client.post(
        '/api/ai/notes/lint/',
        {
            'patient_id': str(patient.id),
            'template_id': str(template.id),
            'template_revision_id': str(revision.id),
            'note_data': {
                'Subjective': 'Patient reports improved chest discomfort and no new dyspnea since morning rounds.',
                'Assessment': 'Symptoms are improving with stable oxygenation and no acute distress on examination.',
                'Plan': 'Continue current regimen, reassess in six hours, and reinforce return precautions.',
                'LegacySection': 'historical carry-over',
            },
        },
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['result']['can_save_draft'] is True
    assert response.data['result']['can_finalize'] is True
    assert response.data['result']['requires_major_acknowledgement'] is False
    assert response.data['result']['issue_counts']['critical'] == 0
    assert response.data['result']['issue_counts']['major'] == 0
    assert response.data['result']['issue_counts']['minor'] >= 1
