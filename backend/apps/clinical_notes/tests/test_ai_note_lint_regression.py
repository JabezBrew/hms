import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.clinical_notes.models import NoteTemplate, NoteTemplateRevision
from apps.core.tests.factories import DefaultFacilityFactory
from apps.encounters.tests.factories import EncounterFactory
from apps.users.tests.factories import (
    DoctorUserFactory,
    PatientProfileFactory,
    PractitionerProfileFactory,
    StaffFactory,
)


def _auth_client(user, facility):
    client = APIClient()
    token = AccessToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


def _build_revisioned_template(*, facility, user):
    structure = {
        'sections': [
            {
                'name': 'Subjective',
                'type': 'text',
                'required': True,
            },
            {
                'name': 'Assessment',
                'type': 'text',
                'required': True,
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
        title='Regression SOAP Template',
        description='Template used for AI lint regression tests',
        is_active=True,
        visibility='public',
        category='soap',
        icon='clipboard-list',
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


@pytest.mark.tier1
@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_NOTE_LINT_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_note_creation_is_not_blocked_by_ai_lint_finalize_policy(
):
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)

    staff = StaffFactory(
        user=doctor,
        primary_facility=facility,
        created_by=doctor,
        updated_by=doctor,
    )
    practitioner = PractitionerProfileFactory(
        staff=staff,
        created_by=doctor,
        updated_by=doctor,
    )
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    encounter = EncounterFactory(
        patient=patient,
        facility=facility,
        practitioner=practitioner,
        created_by=doctor,
        status='in-progress',
    )
    template, revision = _build_revisioned_template(facility=facility, user=doctor)
    client = _auth_client(doctor, facility)

    lint_response = client.post(
        '/api/ai/notes/lint/',
        {
            'patient_id': str(patient.id),
            'template_id': str(template.id),
            'template_revision_id': str(revision.id),
            'note_data': {
                'Subjective': 'todo',
            },
        },
        format='json',
    )

    assert lint_response.status_code == 200
    assert lint_response.data['feature'] == 'note_lint'
    assert lint_response.data['result']['can_save_draft'] is True
    assert lint_response.data['result']['can_finalize'] is False
    assert lint_response.data['result']['requires_major_acknowledgement'] is True

    create_response = client.post(
        '/api/clinical-notes/entries/',
        {
            'template': str(template.id),
            'template_revision': str(revision.id),
            'patient': str(patient.id),
            'encounter': str(encounter.id),
            'data': {
                'Subjective': 'Patient reports reduced pain this morning.',
                'Assessment': 'Stable exam findings and improving symptoms.',
                'Plan': 'Continue current treatment and reassess this evening.',
            },
        },
        format='json',
    )

    assert create_response.status_code == 201
    assert str(create_response.data['template']) == str(template.id)
    assert str(create_response.data['template_revision']) == str(revision.id)
