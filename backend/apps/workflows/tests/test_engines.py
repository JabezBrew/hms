"""
Workflow engines tests for workflows app.

Tests for:
- ConsultationEngine
- WardRoundEngine
- DischargeEngine
- ClinicalNoteEngine
- BaseWorkflowEngine
"""
import pytest
from datetime import date, timedelta
from unittest.mock import patch, MagicMock
from django.utils import timezone
from django.db import transaction

from apps.workflows.models import (
    ClinicalWorkflow, ConsultationWorkflow, ClinicalNoteWorkflow,
    WardRoundWorkflow, DischargeWorkflow,
    WorkflowStatus, WorkflowType, ClinicalNoteType
)
from apps.workflows.engines import (
    BaseWorkflowEngine, ConsultationEngine, WardRoundEngine,
    DischargeEngine, ClinicalNoteEngine
)
from apps.discharge.models import DischargeCase
from apps.clinical_notes.models import NoteEntry, NoteTemplateRevision, Prescription
from apps.clinical_notes.tests.factories import NoteTemplateFactory
from apps.users.tests.factories import (
    PatientProfileFactory, DoctorUserFactory, PractitionerProfileFactory
)
from apps.wards.tests.factories import AdmissionFactory
from apps.encounters.tests.factories import EncounterFactory
from .factories import (
    ClinicalWorkflowFactory, ConsultationWorkflowFactory,
    WardRoundWorkflowFactory,
    DischargeWorkflowFactory
)


# =============================================================================
# BaseWorkflowEngine Tests
# =============================================================================

@pytest.mark.tier1
class TestBaseWorkflowEngine:
    """Tests for BaseWorkflowEngine."""

    def test_save_draft_updates_context(self, db):
        """Test save_draft updates workflow context."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS,
            context_data={}
        )

        BaseWorkflowEngine.save_draft(
            workflow,
            {'new_field': 'new_value'}
        )

        workflow.refresh_from_db()
        assert workflow.context_data['new_field'] == 'new_value'

    def test_save_draft_preserves_existing_context(self, db):
        """Test save_draft preserves existing context data."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS,
            context_data={'existing': 'data'}
        )

        BaseWorkflowEngine.save_draft(
            workflow,
            {'new_field': 'new_value'}
        )

        workflow.refresh_from_db()
        assert workflow.context_data['existing'] == 'data'
        assert workflow.context_data['new_field'] == 'new_value'

    def test_cancel_workflow(self, db):
        """Test cancel_workflow sets status to cancelled."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS
        )

        BaseWorkflowEngine.cancel_workflow(workflow)

        workflow.refresh_from_db()
        assert workflow.status == WorkflowStatus.CANCELLED


# =============================================================================
# ConsultationEngine Tests
# =============================================================================

@pytest.mark.tier1
class TestConsultationEngine:
    """Tests for ConsultationEngine."""

    def test_start_consultation(self, db):
        """Test starting a consultation workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=user,
            patient_id=patient.id
        )

        assert 'workflow' in result
        assert 'consultation_data' in result
        assert result['workflow'].workflow_type == WorkflowType.CONSULTATION
        assert result['workflow'].status == WorkflowStatus.IN_PROGRESS
        assert result['workflow'].patient == patient
        assert result['workflow'].user == user

    def test_start_consultation_with_appointment(self, db):
        """Test starting consultation with appointment ID."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=user,
            patient_id=patient.id,
            appointment_id='apt-123'
        )

        assert result['consultation_data'].appointment_id == 'apt-123'
        assert result['workflow'].context_data['appointment_id'] == 'apt-123'

    def test_start_consultation_with_initial_data(self, db):
        """Test starting consultation with initial data."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=user,
            patient_id=patient.id,
            initial_data={'reason': 'Follow-up visit'}
        )

        assert result['workflow'].context_data['reason'] == 'Follow-up visit'

    def test_start_consultation_invalid_patient(self, db):
        """Test starting consultation with invalid patient raises error."""
        user = DoctorUserFactory()
        import uuid

        with pytest.raises(ValueError) as exc_info:
            ConsultationEngine.start(
                user=user,
                patient_id=uuid.uuid4()
            )

        assert 'not found' in str(exc_info.value)

    def test_start_consultation_loads_prep_data(self, db):
        """Test starting consultation loads patient prep data."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=user,
            patient_id=patient.id
        )

        prep_data = result['workflow'].context_data.get('prep_data', {})
        assert 'patient_name' in prep_data
        assert 'patient_id' in prep_data

    def test_update_step_updates_context(self, db):
        """Test update_step updates workflow context."""
        consultation = ConsultationWorkflowFactory()
        workflow = consultation.workflow
        workflow.status = WorkflowStatus.IN_PROGRESS
        workflow.save()

        result = ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'chief_complaint': 'Headache'},
            consultation_fields={'chief_complaint': 'Headache'}
        )

        assert result['workflow'].context_data['chief_complaint'] == 'Headache'
        assert result['consultation_data'].chief_complaint == 'Headache'

    def test_update_step_marks_complete(self, db):
        """Test update_step marks current step as complete."""
        consultation = ConsultationWorkflowFactory()
        workflow = consultation.workflow
        workflow.status = WorkflowStatus.IN_PROGRESS
        workflow.current_step = 1
        workflow.steps_completed = []
        workflow.save()

        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'data': 'value'}
        )

        assert 1 in workflow.steps_completed

    def test_update_step_advances_to_next(self, db):
        """Test update_step advances to next step when specified."""
        consultation = ConsultationWorkflowFactory()
        workflow = consultation.workflow
        workflow.status = WorkflowStatus.IN_PROGRESS
        workflow.current_step = 1
        workflow.save()

        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'data': 'value'},
            next_step=2
        )

        assert workflow.current_step == 2

    def test_start_consultation_from_referral(self, db):
        """Test starting consultation from a referral."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=user,
            patient_id=patient.id,
            initial_data={
                'referral_id': 'ref-123',
                'referral_reason': 'Chest pain evaluation',
                'referral_clinical_summary': 'Patient with chest pain'
            }
        )

        prep_data = result['workflow'].context_data.get('prep_data', {})
        assert prep_data.get('chief_complaint') == 'Chest pain evaluation'


# =============================================================================
# WardRoundEngine Tests
# =============================================================================

@pytest.mark.tier1
class TestWardRoundEngine:
    """Tests for WardRoundEngine."""

    @patch('apps.workflows.engines.Admission')
    @patch('apps.workflows.engines.PatientProfile')
    def test_start_ward_round(self, mock_patient, mock_admission, db):
        """Test starting a ward round workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Mock patient lookup
        mock_patient.objects.get.return_value = patient

        # Mock admission with bed and ward
        mock_bed = MagicMock()
        mock_bed.ward.name = 'Ward A'
        mock_bed.bed_number = '101'
        mock_bed.id = 'bed-123'

        mock_ward = MagicMock()
        mock_ward.name = 'Ward A'
        mock_ward.id = 'ward-123'
        mock_bed.ward = mock_ward

        mock_admission_obj = MagicMock()
        mock_admission_obj.id = 'admission-123'
        mock_admission_obj.patient = patient
        mock_admission_obj.bed = mock_bed
        mock_admission_obj.admission_date = timezone.now()
        mock_admission_obj.status = 'admitted'
        mock_admission_obj.admission_notes = None  # Prevent MagicMock from being serialized
        mock_admission.objects.select_related.return_value.get.return_value = mock_admission_obj

        result = WardRoundEngine.start(
            user=user,
            patient_id=patient.id,
            admission_id='admission-123'
        )

        assert 'workflow' in result
        assert 'ward_round_data' in result
        assert result['workflow'].workflow_type == WorkflowType.WARD_ROUND

    def test_update_ward_round_step(self, db):
        """Test updating ward round step."""
        ward_round = WardRoundWorkflowFactory()
        workflow = ward_round.workflow
        workflow.status = WorkflowStatus.IN_PROGRESS
        workflow.save()

        WardRoundEngine.update_step(
            workflow=workflow,
            step_number=1,
            step_data={
                'overnight_events': 'Patient stable overnight',
                'nursing_concerns': 'None'
            }
        )

        ward_round.refresh_from_db()
        assert ward_round.overnight_events == 'Patient stable overnight'


# =============================================================================
# DischargeEngine Tests
# =============================================================================

@pytest.mark.tier1
class TestDischargeEngine:
    """Tests for DischargeEngine."""

    @patch('apps.workflows.engines.Admission')
    @patch('apps.workflows.engines.PatientProfile')
    def test_start_discharge(self, mock_patient, mock_admission, db):
        """Test starting a discharge workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Mock patient lookup
        mock_patient.objects.get.return_value = patient

        # Mock admission with bed
        mock_bed = MagicMock()
        mock_bed.ward.name = 'Ward A'

        mock_admission_obj = MagicMock()
        mock_admission_obj.patient = patient
        mock_admission_obj.bed = mock_bed
        mock_admission_obj.admission_date = timezone.now() - timedelta(days=3)
        mock_admission.objects.select_related.return_value.get.return_value = mock_admission_obj

        result = DischargeEngine.start(
            user=user,
            patient_id=patient.id,
            admission_id='admission-123'
        )

        assert 'workflow' in result
        assert 'discharge_data' in result
        assert result['workflow'].workflow_type == WorkflowType.DISCHARGE

    def test_update_discharge_step(self, db):
        """Test updating discharge step."""
        discharge = DischargeWorkflowFactory()
        workflow = discharge.workflow
        workflow.status = WorkflowStatus.IN_PROGRESS
        workflow.save()

        DischargeEngine.update_step(
            workflow=workflow,
            step_number=1,
            step_data={
                'discharge_disposition': 'Home',
                'discharge_criteria_met': ['Vitals stable', 'Ambulating']
            }
        )

        discharge.refresh_from_db()
        assert discharge.discharge_disposition == 'Home'
        assert len(discharge.discharge_criteria_met) == 2

    def test_complete_submits_medical_discharge_for_clearance(self, db):
        """Test completing the workflow creates a discharge case and keeps the stay active."""
        doctor = DoctorUserFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor)
        patient = PatientProfileFactory(facility=doctor.primary_facility)
        admission = AdmissionFactory(
            patient=patient,
            facility=doctor.primary_facility,
            bed__ward__department__facility=doctor.primary_facility,
            admitting_doctor=practitioner,
            status='admitted',
        )
        encounter = EncounterFactory(
            patient=patient,
            facility=doctor.primary_facility,
            practitioner=practitioner,
            encounter_type='inpatient',
            admission=admission,
            status='in-progress',
            created_by=doctor,
        )

        result = DischargeEngine.start(
            user=doctor,
            patient_id=patient.id,
            admission_id=admission.id,
        )
        workflow = result['workflow']

        completion = DischargeEngine.complete(
            workflow=workflow,
            final_data={
                'discharge_disposition': 'home',
                'discharge_date': timezone.now().isoformat(),
                'medications_reconciled': True,
                'discharge_prescriptions': [
                    {
                        'medication_name': 'Paracetamol',
                        'dosage': '500mg',
                        'frequency': 'daily',
                        'instructions': 'Take after meals',
                    }
                ],
                'warning_signs': 'Return for worsening pain.',
                'follow_up_appointments': 'Orthopedic review in 1 week.',
                'discharge_summary': 'Patient improved and is medically fit for discharge.',
                'patient_education_complete': True,
                'discharge_instructions_given': True,
            },
            idempotency_key='engine-clearance-test',
        )

        admission.refresh_from_db()
        encounter.refresh_from_db()
        case = DischargeCase.objects.get(admission=admission)

        assert completion['success'] is True
        assert completion['discharge_case_id'] == str(case.id)
        assert completion['admission_status'] == 'pending_discharge'
        assert admission.status == 'pending_discharge'
        assert admission.actual_discharge_date is None
        assert admission.bed.status == 'occupied'
        assert encounter.status == 'in-progress'
        assert Prescription.objects.filter(discharge_case=case).count() == 1


# =============================================================================
# ClinicalNoteEngine Tests
# =============================================================================

@pytest.mark.tier1
class TestClinicalNoteEngine:
    """Tests for ClinicalNoteEngine."""

    def test_start_progress_note(self, db):
        """Test starting a progress note workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ClinicalNoteEngine.start(
            user=user,
            patient_id=patient.id,
            note_type='progress'
        )

        assert 'workflow' in result
        assert 'clinical_note_data' in result
        assert result['workflow'].workflow_type == WorkflowType.CLINICAL_NOTE
        assert result['clinical_note_data'].note_type == 'progress'
        assert result['workflow'].total_steps == 3

    def test_start_soap_note(self, db):
        """Test starting a SOAP note workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ClinicalNoteEngine.start(
            user=user,
            patient_id=patient.id,
            note_type='soap'
        )

        assert result['clinical_note_data'].note_type == 'soap'
        assert result['workflow'].total_steps == 4

    def test_start_procedure_note(self, db):
        """Test starting a procedure note workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ClinicalNoteEngine.start(
            user=user,
            patient_id=patient.id,
            note_type='procedure'
        )

        assert result['clinical_note_data'].note_type == 'procedure'
        assert result['workflow'].total_steps == 3

    def test_start_phone_note(self, db):
        """Test starting a phone note workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ClinicalNoteEngine.start(
            user=user,
            patient_id=patient.id,
            note_type='phone'
        )

        assert result['clinical_note_data'].note_type == 'phone'
        assert result['workflow'].total_steps == 3

    def test_start_invalid_note_type(self, db):
        """Test starting note with invalid type raises error."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        with pytest.raises(ValueError) as exc_info:
            ClinicalNoteEngine.start(
                user=user,
                patient_id=patient.id,
                note_type='invalid_type'
            )

        assert 'Invalid note type' in str(exc_info.value)

    def test_start_note_invalid_patient(self, db):
        """Test starting note with invalid patient raises error."""
        user = DoctorUserFactory()
        import uuid

        with pytest.raises(ValueError) as exc_info:
            ClinicalNoteEngine.start(
                user=user,
                patient_id=uuid.uuid4(),
                note_type='progress'
            )

        assert 'not found' in str(exc_info.value)

    def test_note_type_step_configurations(self, db):
        """Test all note types have step configurations."""
        expected_types = [
            'progress', 'soap', 'procedure', 'phone',
            'general', 'admission', 'discharge', 'nursing',
            'consultation', 'custom'
        ]

        for note_type in expected_types:
            assert note_type in ClinicalNoteEngine.NOTE_TYPE_STEPS
            config = ClinicalNoteEngine.NOTE_TYPE_STEPS[note_type]
            assert 'steps' in config
            assert 'total_steps' in config
            assert len(config['steps']) == config['total_steps']

    def test_update_clinical_note_step(self, db):
        """Test updating clinical note step."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ClinicalNoteEngine.start(
            user=user,
            patient_id=patient.id,
            note_type='progress'
        )

        workflow = result['workflow']

        updated = ClinicalNoteEngine.update_step(
            workflow=workflow,
            step_data={'chief_complaint': 'Follow-up visit'},
            note_fields={'chief_complaint': 'Follow-up visit'}
        )

        assert updated['clinical_note_data'].chief_complaint == 'Follow-up visit'

    def test_complete_from_final_data_without_step_updates(self, db):
        """Completing does not require prior per-step PATCH persistence."""
        patient = PatientProfileFactory()
        facility = patient.facility
        user = DoctorUserFactory(primary_facility=facility)
        practitioner = PractitionerProfileFactory(
            staff__user=user,
            staff__primary_facility=facility,
        )
        EncounterFactory(
            patient=patient,
            facility=facility,
            practitioner=practitioner,
            status='in-progress',
            encounter_type='outpatient',
            created_by=user,
        )
        template = NoteTemplateFactory(
            facility=facility,
            created_by=user,
            updated_by=user,
            structure={
                'sections': [
                    {'name': 'Subjective', 'type': 'text', 'required': True},
                    {'name': 'Assessment', 'type': 'text', 'required': True},
                    {'name': 'Plan', 'type': 'text', 'required': False},
                ],
            },
        )
        revision = NoteTemplateRevision.objects.create(
            template=template,
            facility=facility,
            version=1,
            status='published',
            mode='written',
            content=template.structure,
            created_by=user,
            published_by=user,
            published_at=timezone.now(),
        )
        workflow = ClinicalNoteEngine.start(
            user=user,
            patient_id=patient.id,
            note_type='soap',
            initial_data={
                'template_id': str(template.id),
                'template_revision_id': str(revision.id),
            },
        )['workflow']
        final_data = {
            'Subjective': 'Patient reports improved pain.',
            'Assessment': 'Stable clinical status.',
            'Plan': 'Continue current management.',
        }

        result = ClinicalNoteEngine.complete(
            workflow=workflow,
            final_data=final_data,
        )

        assert result['success'] is True
        note = NoteEntry.objects.get(id=result['note_id'])
        assert note.facility == facility
        assert note.patient == patient
        assert note.template == template
        assert note.template_revision == revision
        assert note.data == final_data

    def test_complete_is_idempotent_after_success(self, db):
        """Retrying a completed workflow returns cached result without duplicate notes."""
        patient = PatientProfileFactory()
        facility = patient.facility
        user = DoctorUserFactory(primary_facility=facility)
        practitioner = PractitionerProfileFactory(
            staff__user=user,
            staff__primary_facility=facility,
        )
        EncounterFactory(
            patient=patient,
            facility=facility,
            practitioner=practitioner,
            status='in-progress',
            encounter_type='outpatient',
            created_by=user,
        )
        template = NoteTemplateFactory(
            facility=facility,
            created_by=user,
            updated_by=user,
        )
        revision = NoteTemplateRevision.objects.create(
            template=template,
            facility=facility,
            version=1,
            status='published',
            mode='written',
            content=template.structure,
            created_by=user,
            published_by=user,
            published_at=timezone.now(),
        )
        workflow = ClinicalNoteEngine.start(
            user=user,
            patient_id=patient.id,
            note_type='progress',
            initial_data={
                'template_id': str(template.id),
                'template_revision_id': str(revision.id),
            },
        )['workflow']

        first_result = ClinicalNoteEngine.complete(
            workflow=workflow,
            final_data={
                'Chief Complaint': 'Follow-up visit',
                'Assessment': 'Improving',
                'Plan': 'Review in one week',
            },
        )
        workflow.refresh_from_db()
        second_result = ClinicalNoteEngine.complete(
            workflow=workflow,
            final_data={
                'Chief Complaint': 'Retried request should not create another note',
            },
        )

        assert second_result == first_result
        assert NoteEntry.objects.filter(id=first_result['note_id']).count() == 1
        assert NoteEntry.objects.filter(patient=patient, template=template).count() == 1


# =============================================================================
# Engine Validation Tests
# =============================================================================

@pytest.mark.tier1
class TestEngineValidation:
    """Tests for workflow engine validation."""

    def test_consultation_requires_patient(self, db):
        """Test consultation requires a valid patient."""
        user = DoctorUserFactory()

        with pytest.raises(ValueError):
            ConsultationEngine.start(
                user=user,
                patient_id=None
            )

# =============================================================================
# Engine Integration Tests
# =============================================================================

@pytest.mark.tier1
class TestEngineIntegration:
    """Integration tests for workflow engines."""

    def test_consultation_full_workflow(self, db):
        """Test complete consultation workflow flow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Start workflow
        result = ConsultationEngine.start(
            user=user,
            patient_id=patient.id
        )
        workflow = result['workflow']

        # Step 1: Chief Complaint
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'chief_complaint': 'Headache'},
            consultation_fields={'chief_complaint': 'Headache'},
            next_step=2
        )

        # Step 2: HPI/ROS
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'hpi': 'Headache for 3 days'},
            consultation_fields={
                'hpi': 'Headache for 3 days',
                'ros': 'Otherwise negative'
            },
            next_step=3
        )

        # Step 3: Physical Exam
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'physical_exam': 'Normal neurological exam'},
            consultation_fields={'physical_exam': 'Normal neurological exam'},
            next_step=4
        )

        # Step 4: Assessment
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'assessment': 'Tension headache'},
            consultation_fields={'assessment': 'Tension headache'},
            next_step=5
        )

        # Step 5: Plan
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'plan': 'Ibuprofen PRN'},
            consultation_fields={'plan': 'Ibuprofen PRN'}
        )

        # Verify progression
        workflow.refresh_from_db()
        assert workflow.current_step == 5
        assert len(workflow.steps_completed) == 5

    def test_clinical_note_workflow_progression(self, db):
        """Test clinical note workflow progression."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Start SOAP note
        result = ClinicalNoteEngine.start(
            user=user,
            patient_id=patient.id,
            note_type='soap'
        )
        workflow = result['workflow']

        # Progress through steps
        steps_data = [
            {'subjective': 'Patient feels better'},
            {'objective': 'Vitals normal'},
            {'assessment': 'Improving'},
            {'plan': 'Continue current meds'}
        ]

        for i, step_data in enumerate(steps_data, start=1):
            ClinicalNoteEngine.update_step(
                workflow=workflow,
                step_data=step_data,
                next_step=i + 1 if i < len(steps_data) else None
            )

        workflow.refresh_from_db()
        assert len(workflow.steps_completed) == 4
