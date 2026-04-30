"""
API regression tests for timeline note metadata and copy-forward section mapping.
"""
import pytest

from apps.charts.models import ChartAssignment, ChartEntry, ChartField, ChartTemplate
from apps.clinical_notes.models import NoteTemplate, NoteEntry, NoteEntryVersion
from apps.clinical_notes.tests.factories import PrescriptionFactory
from apps.encounters.tests.factories import EncounterFactory
from apps.laboratory.tests.factories import (
    LabOrderFactory,
    LabOrderTestFactory,
    LabResultFactory,
    LabSpecimenFactory,
)
from apps.nursing.tests.factories import VitalSignsFactory


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

    def test_clone_endpoint_rejects_copying_phi_to_different_patient(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
    ):
        source_patient = patient_profile_factory(facility=default_facility)
        target_patient = patient_profile_factory(facility=default_facility)
        encounter = EncounterFactory(
            patient=source_patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )
        template = _build_soap_template(default_facility, doctor_user)
        source_note = NoteEntry.objects.create(
            template=template,
            patient=source_patient,
            facility=default_facility,
            encounter=encounter,
            practitioner=doctor_practitioner,
            data={'Subjective': 'Sensitive history'},
        )

        response = doctor_client.post(
            f'/api/clinical-notes/entries/{source_note.id}/clone/',
            {'patient': str(target_patient.id), 'sections': ['Subjective']},
            format='json',
        )

        assert response.status_code == 403
        assert not NoteEntry.objects.filter(patient=target_patient, copied_from=source_note).exists()

    def test_update_rejects_unknown_template_section_without_version_snapshot(
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
            data={'Subjective': 'Original'},
        )

        response = doctor_client.patch(
            f'/api/clinical-notes/entries/{note.id}/',
            {'data': {'Subjective': 'Updated', 'Unexpected': 'Injected'}},
            format='json',
        )

        assert response.status_code == 400
        assert NoteEntryVersion.objects.filter(note_entry=note).count() == 0

    def test_update_validates_template_and_creates_one_version_snapshot(
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
            data={'Subjective': 'Original'},
        )

        response = doctor_client.patch(
            f'/api/clinical-notes/entries/{note.id}/',
            {'data': {'Subjective': 'Updated', '_metadata': {'source': 'test'}}},
            format='json',
        )

        assert response.status_code == 200
        assert response.data['data']['Subjective'] == 'Updated'
        assert NoteEntryVersion.objects.filter(note_entry=note).count() == 1

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
        assert response['X-Deprecated-Endpoint'] == '/api/clinical-notes/chronicle/<patient_id>/timeline/'
        timeline_note = next(
            (entry for entry in response.data['results'] if entry['id'] == str(note.id)),
            None,
        )
        assert timeline_note is not None
        assert timeline_note['author_id'] == str(doctor_user.id)

    def test_patient_timeline_v2_query_budget(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
        django_assert_max_num_queries,
        django_capture_on_commit_callbacks,
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
            data={'Subjective': 'Shortness of breath', 'Assessment': 'Asthma flare'},
        )
        PrescriptionFactory(
            patient=patient,
            facility=default_facility,
            prescribed_by=doctor_practitioner,
            encounter=encounter,
            medication_name='Salbutamol',
            dosage='2 puffs',
            reason='Bronchospasm',
        )
        with django_capture_on_commit_callbacks(execute=True):
            VitalSignsFactory(
                patient=patient,
                facility=default_facility,
                encounter=encounter,
                recorded_by=doctor_practitioner,
                heart_rate=104,
                oxygen_saturation=95,
            )

        with django_assert_max_num_queries(30):
            response = doctor_client.get(f'/api/clinical-notes/chronicle/{patient.id}/timeline/')

        assert response.status_code == 200
        timeline_note = next(
            (entry for entry in response.data['results'] if entry['id'] == str(note.id)),
            None,
        )
        assert timeline_note is not None
        assert timeline_note['author_id'] == str(doctor_user.id)

    def test_chronicle_context_query_budget(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
        django_assert_max_num_queries,
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
        NoteEntry.objects.create(
            template=template,
            patient=patient,
            facility=default_facility,
            encounter=encounter,
            practitioner=doctor_practitioner,
            data={'Assessment': 'Community acquired pneumonia'},
        )
        PrescriptionFactory(
            patient=patient,
            facility=default_facility,
            prescribed_by=doctor_practitioner,
            encounter=encounter,
            medication_name='Azithromycin',
            dosage='500mg',
            reason='Pneumonia',
        )
        VitalSignsFactory(
            patient=patient,
            facility=default_facility,
            encounter=encounter,
            recorded_by=doctor_practitioner,
            heart_rate=92,
            oxygen_saturation=97,
        )

        with django_assert_max_num_queries(24):
            response = doctor_client.get(f'/api/clinical-notes/chronicle/{patient.id}/context/')

        assert response.status_code == 200
        assert response.data['patient']['id'] == str(patient.id)
        assert response.data['latest_vitals']['heart_rate'] == 92

    def test_chronicle_stats_alias_returns_patient_scoped_counts(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
    ):
        patient = patient_profile_factory(facility=default_facility)
        other_patient = patient_profile_factory(facility=default_facility)
        encounter = EncounterFactory(
            patient=patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )
        other_encounter = EncounterFactory(
            patient=other_patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )
        template = _build_soap_template(default_facility, doctor_user)
        NoteEntry.objects.create(
            template=template,
            patient=patient,
            facility=default_facility,
            encounter=encounter,
            practitioner=doctor_practitioner,
            data={'Assessment': 'Hypertension'},
        )
        NoteEntry.objects.create(
            template=template,
            patient=other_patient,
            facility=default_facility,
            encounter=other_encounter,
            practitioner=doctor_practitioner,
            data={'Assessment': 'Other patient note'},
        )
        PrescriptionFactory(
            patient=patient,
            facility=default_facility,
            prescribed_by=doctor_practitioner,
            encounter=encounter,
            medication_name='Amlodipine',
        )
        VitalSignsFactory(
            patient=patient,
            facility=default_facility,
            encounter=encounter,
            recorded_by=doctor_practitioner,
        )

        response = doctor_client.get(f'/api/clinical-notes/chronicle/{patient.id}/stats/')

        assert response.status_code == 200
        assert response.data['counts'] == {
            'notes': 1,
            'prescriptions': 1,
            'vitals': 1,
        }

    def test_patient_timeline_v2_handles_lab_entries_in_all_filter(
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
        lab_order = LabOrderFactory(
            patient=patient,
            facility=default_facility,
            encounter=encounter,
            ordering_provider=doctor_practitioner,
            status='completed',
        )
        order_test = LabOrderTestFactory(order=lab_order, facility=default_facility)
        specimen = LabSpecimenFactory(order=lab_order, facility=default_facility)
        LabResultFactory(
            order_test=order_test,
            specimen=specimen,
            facility=default_facility,
            flag='high',
        )

        response = doctor_client.get(f'/api/clinical-notes/chronicle/{patient.id}/timeline/')

        assert response.status_code == 200
        lab_entry = next(
            (entry for entry in response.data['results'] if entry['id'] == str(lab_order.id)),
            None,
        )
        assert lab_entry is not None
        assert lab_entry['type'] == 'lab'
        assert lab_entry['results'][0]['test_name'] == order_test.test.short_name

    def test_patient_timeline_v2_includes_chart_entries(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
        django_capture_on_commit_callbacks,
    ):
        patient = patient_profile_factory(facility=default_facility)
        encounter = EncounterFactory(
            patient=patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )
        template = ChartTemplate.objects.create(
            facility=default_facility,
            name='Vital Signs Trend Chart',
            description='Encounter vitals monitoring',
            icon='activity',
            visibility='facility',
            category='cardiovascular',
            scope_type='encounter',
            system_key='vital_signs',
            default_interval='hourly',
            created_by=doctor_user,
        )
        ChartField.objects.create(
            template=template,
            name='Blood Pressure',
            field_key='blood_pressure',
            field_type='paired',
            display_order=1,
            config={
                'fields': [
                    {'key': 'systolic', 'label': 'Systolic'},
                    {'key': 'diastolic', 'label': 'Diastolic'},
                ],
                'separator': '/',
            },
        )
        assignment = ChartAssignment.objects.create(
            template=template,
            patient=patient,
            encounter=encounter,
            start_datetime=encounter.start_time,
            status='active',
            ordered_by=doctor_practitioner,
            created_by=doctor_user,
        )

        with django_capture_on_commit_callbacks(execute=True):
            entry = ChartEntry.objects.create(
                assignment=assignment,
                observation_datetime=encounter.start_time,
                data={'blood_pressure': {'systolic': 124, 'diastolic': 82}},
                notes='Pain improved after analgesia',
                recorded_by=doctor_practitioner,
                created_by=doctor_user,
            )

        response = doctor_client.get(f'/api/clinical-notes/chronicle/{patient.id}/timeline/')

        assert response.status_code == 200
        chart_entry = next(
            (item for item in response.data['results'] if item['id'] == str(entry.id)),
            None,
        )
        assert chart_entry is not None
        assert chart_entry['type'] == 'chart'
        assert chart_entry['template_system_key'] == 'vital_signs'
        assert chart_entry['scope_type'] == 'encounter'
        assert chart_entry['assignment_id'] == str(assignment.id)
        assert 'data' not in chart_entry
        assert chart_entry['notes'] == 'Pain improved after analgesia'

    def test_soft_deleted_chart_entries_are_removed_from_timeline(
        self,
        doctor_client,
        doctor_user,
        doctor_practitioner,
        patient_profile_factory,
        default_facility,
        django_capture_on_commit_callbacks,
    ):
        patient = patient_profile_factory(facility=default_facility)
        encounter = EncounterFactory(
            patient=patient,
            facility=default_facility,
            practitioner=doctor_practitioner,
            created_by=doctor_user,
            status='in-progress',
        )
        template = ChartTemplate.objects.create(
            facility=default_facility,
            name='Pain Assessment Chart',
            description='Encounter pain monitoring',
            icon='activity',
            visibility='facility',
            category='pain',
            scope_type='encounter',
            system_key='pain_assessment',
            default_interval='4hourly',
            created_by=doctor_user,
        )
        ChartField.objects.create(
            template=template,
            name='Pain Score',
            field_key='pain_score',
            field_type='scale',
            display_order=1,
            config={'min': 0, 'max': 10},
        )
        assignment = ChartAssignment.objects.create(
            template=template,
            patient=patient,
            encounter=encounter,
            start_datetime=encounter.start_time,
            status='active',
            ordered_by=doctor_practitioner,
            created_by=doctor_user,
        )

        with django_capture_on_commit_callbacks(execute=True):
            entry = ChartEntry.objects.create(
                assignment=assignment,
                observation_datetime=encounter.start_time,
                data={'pain_score': 6},
                recorded_by=doctor_practitioner,
                created_by=doctor_user,
            )

        with django_capture_on_commit_callbacks(execute=True):
            entry.soft_delete(user=doctor_user, reason='Entered in error')

        response = doctor_client.get(f'/api/clinical-notes/chronicle/{patient.id}/timeline/')

        assert response.status_code == 200
        assert all(item['id'] != str(entry.id) for item in response.data['results'])
