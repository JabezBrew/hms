import pytest
from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.clinical_notes.models import NoteTemplate, NoteTemplateRevision
from apps.encounters.tests.factories import EncounterFactory


def _make_client(user, facility):
    header_name = getattr(settings, 'FACILITY_HEADER_NAME', 'X-Facility-Code')
    header_key = f"HTTP_{header_name.upper().replace('-', '_')}"
    token = AccessToken.for_user(user)
    client = APIClient()
    user.primary_facility = facility
    user.save(update_fields=['primary_facility'])
    user.facilities.add(facility)
    credentials = {
        'HTTP_AUTHORIZATION': f'Bearer {token}',
        header_key: facility.code,
        # Keep both common variants to avoid header/env mismatch in test environments.
        'HTTP_X_FACILITY_CODE': facility.code,
        'HTTP_X_FACILITY_ID': str(facility.id),
    }
    client.credentials(**credentials)
    return client


def _create_template_with_revision(user, facility):
    structure = {
        'sections': [
            {
                'name': 'Subjective',
                'type': 'text',
                'required': True,
                'default_text': 'Seen on {{today}} by {{patient_name}}',
            },
            {
                'name': 'Assessment',
                'type': 'text',
                'required': True,
                'default_text': 'Working diagnosis: {{chief_complaint}}',
            },
        ],
    }
    template = NoteTemplate.objects.create(
        facility=facility,
        title='Revisioned SOAP Template',
        description='Template with written starter text',
        is_active=True,
        visibility='public',
        category='soap',
        icon='clipboard-list',
        estimated_steps=2,
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
class TestTemplateRevisionsApi:
    def test_create_template_creates_initial_published_revision(
        self,
        admin_user,
        default_facility,
    ):
        admin_client = _make_client(admin_user, default_facility)
        payload = {
            'title': 'Admission Template',
            'description': 'Admission note starter text',
            'is_active': True,
            'visibility': 'private',
            'category': 'admission',
            'icon': 'user-plus',
            'estimated_steps': 2,
            'template_mode': 'written',
            'structure': {
                'sections': [
                    {
                        'name': 'Admission Summary',
                        'type': 'text',
                        'required': True,
                        'default_text': 'Admitted on {{today}}',
                    },
                    {
                        'name': 'Plan',
                        'type': 'text',
                        'required': True,
                    },
                ]
            },
        }

        response = admin_client.post('/api/clinical-notes/templates/', payload, format='json')

        assert response.status_code == 201
        assert response.data['latest_published_revision_version'] == 1
        assert response.data['latest_published_revision_mode'] == 'written'
        template = NoteTemplate.objects.get(id=response.data['id'])
        revision = template.revisions.get(version=1)
        assert revision.status == 'published'
        assert revision.mode == 'written'

    def test_render_endpoint_resolves_safe_placeholders(
        self,
        admin_user,
        patient_profile_factory,
        default_facility,
    ):
        admin_client = _make_client(admin_user, default_facility)
        template, revision = _create_template_with_revision(admin_user, default_facility)
        patient = patient_profile_factory(facility=default_facility)
        patient.user.first_name = 'Ada'
        patient.user.last_name = 'Lovelace'
        patient.user.save(update_fields=['first_name', 'last_name'])

        response = admin_client.post(
            f'/api/clinical-notes/templates/{template.id}/render/',
            {
                'patient_id': str(patient.id),
                'revision_id': str(revision.id),
                'apply_mode': 'all',
                'extra_tokens': {'chief_complaint': 'Chest pain'},
            },
            format='json',
        )

        assert response.status_code == 200
        assert response.data['revision_id'] == str(revision.id)
        assert response.data['revision_mode'] == 'written'
        assert response.data['rendered_data']['Subjective']
        assert 'Ada Lovelace' in response.data['rendered_data']['Subjective']
        assert timezone.localdate().isoformat() in response.data['rendered_data']['Subjective']
        assert response.data['rendered_data']['Assessment'] == 'Working diagnosis: Chest pain'

    def test_note_creation_links_template_revision_and_version(
        self,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
    ):
        doctor_client = _make_client(doctor_user, default_facility)
        template, revision = _create_template_with_revision(doctor_user, default_facility)
        patient = patient_profile_factory(facility=default_facility)
        encounter = EncounterFactory(
            patient=patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )

        response = doctor_client.post(
            '/api/clinical-notes/entries/',
            {
                'template': str(template.id),
                'patient': str(patient.id),
                'encounter': str(encounter.id),
                'data': {
                    'Subjective': 'Patient feels better',
                    'Assessment': 'Stable',
                },
            },
            format='json',
        )

        assert response.status_code == 201
        assert str(response.data['template_revision']) == str(revision.id)
        assert response.data['template_version'] == 1
