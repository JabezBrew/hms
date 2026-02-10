"""
API regression tests for timeline note metadata and copy-forward section mapping.
"""
import pytest

from apps.clinical_notes.models import NoteTemplate, NoteEntry
from apps.encounters.tests.factories import EncounterFactory


def _build_soap_template(facility, user):
    return NoteTemplate.objects.create(
        facility=facility,
        title='SOAP Note',
        description='SOAP documentation template',
        is_active=True,
        visibility='public',
        category='soap',
        icon='clipboard-list',
        estimated_steps=4,
        is_public=True,
        created_by=user,
        updated_by=user,
        structure={
            'sections': [
                {'name': 'Subjective', 'type': 'text', 'required': False},
                {'name': 'Objective', 'type': 'text', 'required': False},
                {'name': 'Assessment', 'type': 'text', 'required': False},
                {'name': 'Plan', 'type': 'text', 'required': False},
            ]
        },
    )


@pytest.mark.tier1
class TestNoteCopyAndTimelineApi:
    def test_sections_endpoint_matches_legacy_case_mismatched_keys(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
    ):
        patient = patient_profile_factory(facility=default_facility)
        encounter = EncounterFactory(
            patient=patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )
        template = _build_soap_template(default_facility, doctor_user)
        note = NoteEntry.objects.create(
            template=template,
            patient=patient,
            facility=default_facility,
            encounter=encounter,
            practitioner=doctor_practitioner,
            data={
                'subjective': 'Severe headache for 2 days',
                'objective': 'BP 120/80',
            },
        )

        response = doctor_client.get(f'/api/clinical-notes/entries/{note.id}/sections/')

        assert response.status_code == 200
        sections = {item['name']: item for item in response.data}
        assert sections['Subjective']['has_data'] is True
        assert sections['Subjective']['source_key'] == 'subjective'
        assert sections['Objective']['has_data'] is True
        assert sections['Objective']['source_key'] == 'objective'

    def test_clone_endpoint_copies_section_data_when_source_keys_are_legacy_formatted(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
    ):
        patient = patient_profile_factory(facility=default_facility)
        encounter = EncounterFactory(
            patient=patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )
        template = _build_soap_template(default_facility, doctor_user)
        source_note = NoteEntry.objects.create(
            template=template,
            patient=patient,
            facility=default_facility,
            encounter=encounter,
            practitioner=doctor_practitioner,
            data={
                'subjective': 'Nausea and dizziness',
                'objective': 'Pulse 98',
            },
        )

        response = doctor_client.post(
            f'/api/clinical-notes/entries/{source_note.id}/clone/',
            {'sections': ['Subjective']},
            format='json',
        )

        assert response.status_code == 201
        assert response.data['data']['Subjective'] == 'Nausea and dizziness'
        assert 'subjective' not in response.data['data']
        assert response.data['sections_copied'] == ['Subjective']

    def test_patient_timeline_includes_note_author_id_for_edit_visibility(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
    ):
        patient = patient_profile_factory(facility=default_facility)
        encounter = EncounterFactory(
            patient=patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )
        template = _build_soap_template(default_facility, doctor_user)
        note = NoteEntry.objects.create(
            template=template,
            patient=patient,
            facility=default_facility,
            encounter=encounter,
            practitioner=doctor_practitioner,
            data={'Subjective': 'Fever', 'Objective': 'Temp 38.2'},
        )

        response = doctor_client.get(f'/api/clinical-notes/timeline/{patient.id}/')

        assert response.status_code == 200
        timeline_note = next(
            (entry for entry in response.data['results'] if entry['id'] == str(note.id)),
            None,
        )
        assert timeline_note is not None
        assert timeline_note['author_id'] == str(doctor_user.id)
