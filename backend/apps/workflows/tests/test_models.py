"""
Model tests for workflows app.

Tests for:
- ClinicalWorkflow model
- ConsultationWorkflow model
- ClinicalNoteWorkflow model
- WardRoundWorkflow model
- AdmissionWorkflow model
- DischargeWorkflow model
- WorkflowTemplate model
"""
import pytest
from datetime import date, timedelta
from django.utils import timezone

from apps.workflows.models import (
    ClinicalWorkflow, ConsultationWorkflow, ClinicalNoteWorkflow,
    WardRoundWorkflow, AdmissionWorkflow, DischargeWorkflow,
    WorkflowTemplate, WorkflowType, WorkflowStatus, ClinicalNoteType
)
from apps.users.tests.factories import PatientProfileFactory, DoctorUserFactory
from .factories import (
    ClinicalWorkflowFactory, InProgressWorkflowFactory, CompletedWorkflowFactory,
    ConsultationWorkflowFactory, ClinicalNoteWorkflowFactory,
    WardRoundWorkflowFactory, AdmissionWorkflowFactory, DischargeWorkflowFactory,
    WorkflowTemplateFactory, ConsultationTemplateFactory
)


# =============================================================================
# ClinicalWorkflow Model Tests
# =============================================================================

@pytest.mark.tier1
class TestClinicalWorkflowModel:
    """Tests for ClinicalWorkflow model."""

    def test_workflow_creation(self, db):
        """Test creating a clinical workflow with all fields."""
        patient = PatientProfileFactory()
        user = DoctorUserFactory()
        workflow = ClinicalWorkflowFactory(
            workflow_type=WorkflowType.CONSULTATION,
            status=WorkflowStatus.DRAFT,
            user=user,
            patient=patient,
            current_step=1,
            total_steps=5
        )

        assert workflow.workflow_type == WorkflowType.CONSULTATION
        assert workflow.status == WorkflowStatus.DRAFT
        assert workflow.user == user
        assert workflow.patient == patient
        assert workflow.current_step == 1
        assert workflow.total_steps == 5

    def test_workflow_string_representation(self, db):
        """Test __str__ returns workflow type, patient name, and status."""
        workflow = ClinicalWorkflowFactory(
            workflow_type=WorkflowType.CONSULTATION,
            status=WorkflowStatus.IN_PROGRESS
        )

        str_repr = str(workflow)
        assert workflow.patient.user.get_full_name() in str_repr
        assert 'Consultation' in str_repr

    def test_all_workflow_types_valid(self, db):
        """Test all workflow type choices can be created."""
        workflow_types = [
            WorkflowType.CONSULTATION,
            WorkflowType.WARD_ROUND,
            WorkflowType.ADMISSION,
            WorkflowType.DISCHARGE,
            WorkflowType.EMERGENCY,
            WorkflowType.CLINICAL_NOTE,
        ]

        for wf_type in workflow_types:
            workflow = ClinicalWorkflowFactory(workflow_type=wf_type)
            assert workflow.workflow_type == wf_type

    def test_all_status_values_valid(self, db):
        """Test all status values can be set."""
        statuses = [
            WorkflowStatus.DRAFT,
            WorkflowStatus.IN_PROGRESS,
            WorkflowStatus.COMPLETED,
            WorkflowStatus.CANCELLED,
        ]

        for status in statuses:
            workflow = ClinicalWorkflowFactory(status=status)
            assert workflow.status == status

    def test_is_complete_true_when_all_steps_completed(self, db):
        """Test is_complete returns True when all steps done."""
        workflow = ClinicalWorkflowFactory(
            total_steps=3,
            steps_completed=[1, 2, 3]
        )

        assert workflow.is_complete() is True

    def test_is_complete_false_when_steps_remaining(self, db):
        """Test is_complete returns False when steps remain."""
        workflow = ClinicalWorkflowFactory(
            total_steps=5,
            steps_completed=[1, 2]
        )

        assert workflow.is_complete() is False

    def test_can_proceed_to_next_step(self, db):
        """Test can_proceed_to_next_step method."""
        workflow = ClinicalWorkflowFactory(
            current_step=3,
            total_steps=5
        )

        assert workflow.can_proceed_to_next_step() is True

    def test_cannot_proceed_past_total_steps(self, db):
        """Test cannot proceed when at last step."""
        workflow = ClinicalWorkflowFactory(
            current_step=5,
            total_steps=5
        )

        assert workflow.can_proceed_to_next_step() is False

    def test_mark_step_complete(self, db):
        """Test marking a step as completed."""
        workflow = ClinicalWorkflowFactory(steps_completed=[])

        workflow.mark_step_complete(1)

        assert 1 in workflow.steps_completed

    def test_mark_step_complete_idempotent(self, db):
        """Test marking same step twice doesn't duplicate."""
        workflow = ClinicalWorkflowFactory(steps_completed=[1])

        workflow.mark_step_complete(1)

        assert workflow.steps_completed.count(1) == 1

    def test_advance_to_step(self, db):
        """Test advancing to a specific step."""
        workflow = ClinicalWorkflowFactory(
            current_step=1,
            total_steps=5
        )

        workflow.advance_to_step(3)

        assert workflow.current_step == 3

    def test_advance_to_step_respects_total(self, db):
        """Test cannot advance beyond total steps."""
        workflow = ClinicalWorkflowFactory(
            current_step=3,
            total_steps=5
        )

        workflow.advance_to_step(10)

        # Should not advance beyond total
        assert workflow.current_step == 3

    def test_complete_workflow(self, db):
        """Test completing a workflow."""
        workflow = ClinicalWorkflowFactory(status=WorkflowStatus.IN_PROGRESS)

        workflow.complete_workflow()

        assert workflow.status == WorkflowStatus.COMPLETED
        assert workflow.completed_at is not None

    def test_workflow_ordering(self, db):
        """Test workflows are ordered by created_at descending."""
        patient = PatientProfileFactory()
        user = DoctorUserFactory()

        workflow1 = ClinicalWorkflowFactory(user=user, patient=patient)
        workflow2 = ClinicalWorkflowFactory(user=user, patient=patient)
        workflow3 = ClinicalWorkflowFactory(user=user, patient=patient)

        workflows = list(ClinicalWorkflow.objects.filter(patient=patient))

        # Most recent should be first
        assert workflows[0] == workflow3
        assert workflows[1] == workflow2
        assert workflows[2] == workflow1

    def test_workflow_indexes(self, db):
        """Test workflow indexes exist."""
        indexes = ClinicalWorkflow._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('user', 'status') in indexed_fields
        assert ('patient', 'workflow_type') in indexed_fields
        assert ('created_at',) in indexed_fields


# =============================================================================
# ConsultationWorkflow Model Tests
# =============================================================================

@pytest.mark.tier1
class TestConsultationWorkflowModel:
    """Tests for ConsultationWorkflow model."""

    def test_consultation_workflow_creation(self, db):
        """Test creating a consultation workflow."""
        consultation = ConsultationWorkflowFactory(
            chief_complaint='Headache',
            hpi='Patient reports headache for 2 days',
            assessment='Tension headache',
            plan='Ibuprofen PRN'
        )

        assert consultation.chief_complaint == 'Headache'
        assert consultation.hpi == 'Patient reports headache for 2 days'
        assert consultation.assessment == 'Tension headache'
        assert consultation.plan == 'Ibuprofen PRN'

    def test_consultation_string_representation(self, db):
        """Test __str__ returns patient name."""
        consultation = ConsultationWorkflowFactory()

        str_repr = str(consultation)
        assert 'Consultation' in str_repr

    def test_consultation_linked_to_workflow(self, db):
        """Test consultation is linked to clinical workflow."""
        consultation = ConsultationWorkflowFactory()

        assert consultation.workflow is not None
        assert consultation.workflow.workflow_type == WorkflowType.CONSULTATION

    def test_consultation_fields_optional(self, db):
        """Test consultation fields are optional."""
        workflow = ClinicalWorkflowFactory(workflow_type=WorkflowType.CONSULTATION)
        consultation = ConsultationWorkflow.objects.create(workflow=workflow)

        assert consultation.chief_complaint == ''
        assert consultation.hpi == ''
        assert consultation.ros == ''
        assert consultation.physical_exam == ''
        assert consultation.assessment == ''
        assert consultation.plan == ''


# =============================================================================
# ClinicalNoteWorkflow Model Tests
# =============================================================================

@pytest.mark.tier1
class TestClinicalNoteWorkflowModel:
    """Tests for ClinicalNoteWorkflow model."""

    def test_clinical_note_workflow_creation(self, db):
        """Test creating a clinical note workflow."""
        note = ClinicalNoteWorkflowFactory(
            note_type=ClinicalNoteType.PROGRESS,
            chief_complaint='Follow up visit',
            assessment='Improving',
            plan='Continue current management'
        )

        assert note.note_type == ClinicalNoteType.PROGRESS
        assert note.chief_complaint == 'Follow up visit'

    def test_all_note_types_valid(self, db):
        """Test all clinical note type choices can be created."""
        note_types = [
            ClinicalNoteType.GENERAL,
            ClinicalNoteType.SOAP,
            ClinicalNoteType.PROGRESS,
            ClinicalNoteType.PROCEDURE,
            ClinicalNoteType.ADMISSION,
            ClinicalNoteType.DISCHARGE,
            ClinicalNoteType.NURSING,
            ClinicalNoteType.CONSULTATION,
            ClinicalNoteType.CUSTOM,
            ClinicalNoteType.PHONE,
        ]

        for note_type in note_types:
            workflow = ClinicalWorkflowFactory(workflow_type=WorkflowType.CLINICAL_NOTE)
            note = ClinicalNoteWorkflow.objects.create(
                workflow=workflow,
                note_type=note_type
            )
            assert note.note_type == note_type

    def test_soap_note_fields(self, db):
        """Test SOAP note specific fields."""
        workflow = ClinicalWorkflowFactory(workflow_type=WorkflowType.CLINICAL_NOTE)
        note = ClinicalNoteWorkflow.objects.create(
            workflow=workflow,
            note_type=ClinicalNoteType.SOAP,
            subjective='Patient reports feeling better',
            objective='Vitals normal',
            assessment='Resolving viral URI',
            plan='Symptomatic treatment'
        )

        assert note.subjective == 'Patient reports feeling better'
        assert note.objective == 'Vitals normal'

    def test_procedure_note_fields(self, db):
        """Test procedure note specific fields."""
        workflow = ClinicalWorkflowFactory(workflow_type=WorkflowType.CLINICAL_NOTE)
        note = ClinicalNoteWorkflow.objects.create(
            workflow=workflow,
            note_type=ClinicalNoteType.PROCEDURE,
            procedure_name='Lumbar puncture',
            indication='Rule out meningitis',
            consent='Verbal consent obtained',
            anesthesia='Local',
            technique='Standard technique',
            complications='None'
        )

        assert note.procedure_name == 'Lumbar puncture'
        assert note.complications == 'None'

    def test_phone_note_fields(self, db):
        """Test phone note specific fields."""
        workflow = ClinicalWorkflowFactory(workflow_type=WorkflowType.CLINICAL_NOTE)
        note = ClinicalNoteWorkflow.objects.create(
            workflow=workflow,
            note_type=ClinicalNoteType.PHONE,
            caller_name='John Smith',
            caller_relationship='Patient',
            callback_number='555-1234',
            reason_for_call='Follow-up on test results',
            urgency='Routine'
        )

        assert note.caller_name == 'John Smith'
        assert note.urgency == 'Routine'


# =============================================================================
# WardRoundWorkflow Model Tests
# =============================================================================

@pytest.mark.tier1
class TestWardRoundWorkflowModel:
    """Tests for WardRoundWorkflow model."""

    def test_ward_round_workflow_creation(self, db):
        """Test creating a ward round workflow."""
        ward_round = WardRoundWorkflowFactory(
            overnight_events='Patient slept well',
            nursing_concerns='None',
            vitals_reviewed=True,
            assessment='Stable',
            plan_notes='Continue current plan'
        )

        assert ward_round.overnight_events == 'Patient slept well'
        assert ward_round.vitals_reviewed is True

    def test_ward_round_string_representation(self, db):
        """Test __str__ returns patient name."""
        ward_round = WardRoundWorkflowFactory()

        str_repr = str(ward_round)
        assert 'Ward Round' in str_repr

    def test_ward_round_discharge_planning(self, db):
        """Test discharge planning fields."""
        ward_round = WardRoundWorkflowFactory(
            discharge_planning_needed=True,
            estimated_discharge=date.today() + timedelta(days=2)
        )

        assert ward_round.discharge_planning_needed is True
        assert ward_round.estimated_discharge is not None

    def test_ward_round_orders_tracking(self, db):
        """Test orders placed tracking."""
        ward_round = WardRoundWorkflowFactory(
            orders_placed=[
                {'type': 'lab', 'name': 'CBC'},
                {'type': 'medication', 'name': 'Aspirin'}
            ]
        )

        assert len(ward_round.orders_placed) == 2


# =============================================================================
# AdmissionWorkflow Model Tests
# =============================================================================

@pytest.mark.tier1
class TestAdmissionWorkflowModel:
    """Tests for AdmissionWorkflow model."""

    def test_admission_workflow_creation(self, db):
        """Test creating an admission workflow."""
        admission = AdmissionWorkflowFactory(
            admission_reason='Chest pain',
            admission_type='emergency',
            chief_complaint='Chest pain radiating to left arm'
        )

        assert admission.admission_reason == 'Chest pain'
        assert admission.admission_type == 'emergency'

    def test_admission_string_representation(self, db):
        """Test __str__ returns patient name."""
        admission = AdmissionWorkflowFactory()

        str_repr = str(admission)
        assert 'Admission' in str_repr

    def test_admission_emergency_contact(self, db):
        """Test emergency contact fields."""
        admission = AdmissionWorkflowFactory(
            emergency_contact_name='Jane Doe',
            emergency_contact_relationship='Spouse',
            emergency_contact_phone='555-1234'
        )

        assert admission.emergency_contact_name == 'Jane Doe'
        assert admission.emergency_contact_relationship == 'Spouse'

    def test_admission_orders(self, db):
        """Test admission order fields."""
        admission = AdmissionWorkflowFactory(
            diet='NPO',
            activity='Strict bed rest',
            vitals_frequency='Q1H',
            medications=[{'name': 'Aspirin', 'dose': '325mg'}],
            labs=[{'name': 'Troponin'}]
        )

        assert admission.diet == 'NPO'
        assert admission.activity == 'Strict bed rest'
        assert len(admission.medications) == 1
        assert len(admission.labs) == 1


# =============================================================================
# DischargeWorkflow Model Tests
# =============================================================================

@pytest.mark.tier1
class TestDischargeWorkflowModel:
    """Tests for DischargeWorkflow model."""

    def test_discharge_workflow_creation(self, db):
        """Test creating a discharge workflow."""
        discharge = DischargeWorkflowFactory(
            discharge_disposition='Home',
            medications_reconciled=True,
            discharge_summary='Patient discharged in stable condition'
        )

        assert discharge.discharge_disposition == 'Home'
        assert discharge.medications_reconciled is True

    def test_discharge_string_representation(self, db):
        """Test __str__ returns patient name."""
        discharge = DischargeWorkflowFactory()

        str_repr = str(discharge)
        assert 'Discharge' in str_repr

    def test_discharge_criteria_met(self, db):
        """Test discharge criteria tracking."""
        discharge = DischargeWorkflowFactory(
            discharge_criteria_met=[
                'Vitals stable for 24 hours',
                'Ambulating independently',
                'Pain controlled with oral medications'
            ]
        )

        assert len(discharge.discharge_criteria_met) == 3

    def test_discharge_instructions(self, db):
        """Test discharge instruction fields."""
        discharge = DischargeWorkflowFactory(
            activity_restrictions='No lifting over 10 lbs',
            diet_instructions='Low sodium diet',
            wound_care='Keep incision clean and dry',
            warning_signs='Return if fever, increased pain'
        )

        assert discharge.activity_restrictions == 'No lifting over 10 lbs'
        assert discharge.wound_care == 'Keep incision clean and dry'

    def test_discharge_education_tracking(self, db):
        """Test patient education tracking."""
        discharge = DischargeWorkflowFactory(
            medication_education_completed=True,
            patient_education_complete=True,
            discharge_instructions_given=True,
            prescriptions_sent=True
        )

        assert discharge.medication_education_completed is True
        assert discharge.patient_education_complete is True


# =============================================================================
# WorkflowTemplate Model Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowTemplateModel:
    """Tests for WorkflowTemplate model."""

    def test_template_creation(self, db):
        """Test creating a workflow template."""
        template = WorkflowTemplateFactory(
            name='Standard Consultation',
            workflow_type=WorkflowType.CONSULTATION,
            specialty='Internal Medicine',
            is_public=True
        )

        assert template.name == 'Standard Consultation'
        assert template.workflow_type == WorkflowType.CONSULTATION
        assert template.is_public is True

    def test_template_string_representation(self, db):
        """Test __str__ returns name and type."""
        template = WorkflowTemplateFactory(
            name='Emergency Admission',
            workflow_type=WorkflowType.ADMISSION
        )

        str_repr = str(template)
        assert 'Emergency Admission' in str_repr
        assert 'Admission' in str_repr

    def test_template_increment_usage(self, db):
        """Test incrementing template usage count."""
        template = WorkflowTemplateFactory(usage_count=5)

        template.increment_usage()

        assert template.usage_count == 6

    def test_template_ordering(self, db):
        """Test templates are ordered by usage count descending."""
        user = DoctorUserFactory()
        template1 = WorkflowTemplateFactory(created_by=user, usage_count=5)
        template2 = WorkflowTemplateFactory(created_by=user, usage_count=10)
        template3 = WorkflowTemplateFactory(created_by=user, usage_count=3)

        templates = list(WorkflowTemplate.objects.filter(created_by=user))

        # Most used should be first
        assert templates[0] == template2
        assert templates[1] == template1
        assert templates[2] == template3

    def test_private_template(self, db):
        """Test private templates."""
        template = WorkflowTemplateFactory(is_public=False)

        assert template.is_public is False

    def test_template_data_storage(self, db):
        """Test template data JSON storage."""
        template = ConsultationTemplateFactory()

        assert 'default_values' in template.template_data
        assert 'sections' in template.template_data


# =============================================================================
# Workflow Context Data Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowContextData:
    """Tests for workflow context_data storage."""

    def test_context_data_update(self, db):
        """Test updating context data."""
        workflow = ClinicalWorkflowFactory(context_data={})

        workflow.context_data['step_1_data'] = {'field': 'value'}
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.context_data['step_1_data']['field'] == 'value'

    def test_context_data_merge(self, db):
        """Test merging context data."""
        workflow = ClinicalWorkflowFactory(
            context_data={'existing': 'data'}
        )

        workflow.context_data.update({'new': 'data'})
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.context_data['existing'] == 'data'
        assert workflow.context_data['new'] == 'data'

    def test_context_data_nested_storage(self, db):
        """Test nested context data storage."""
        workflow = ClinicalWorkflowFactory(
            context_data={
                'prep_data': {
                    'patient_name': 'John Doe',
                    'recent_labs': [{'test': 'CBC', 'result': 'Normal'}]
                }
            }
        )

        assert workflow.context_data['prep_data']['patient_name'] == 'John Doe'
        assert len(workflow.context_data['prep_data']['recent_labs']) == 1


# =============================================================================
# Workflow Relationship Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowRelationships:
    """Tests for workflow model relationships."""

    def test_workflow_cascade_delete_consultation(self, db):
        """Test consultation data is deleted with workflow."""
        consultation = ConsultationWorkflowFactory()
        workflow = consultation.workflow
        consultation_id = consultation.id

        workflow.delete()

        assert not ConsultationWorkflow.objects.filter(id=consultation_id).exists()

    def test_workflow_cascade_delete_ward_round(self, db):
        """Test ward round data is deleted with workflow."""
        ward_round = WardRoundWorkflowFactory()
        workflow = ward_round.workflow
        ward_round_id = ward_round.id

        workflow.delete()

        assert not WardRoundWorkflow.objects.filter(id=ward_round_id).exists()

    def test_workflow_cascade_delete_admission(self, db):
        """Test admission data is deleted with workflow."""
        admission = AdmissionWorkflowFactory()
        workflow = admission.workflow
        admission_id = admission.id

        workflow.delete()

        assert not AdmissionWorkflow.objects.filter(id=admission_id).exists()

    def test_workflow_cascade_delete_discharge(self, db):
        """Test discharge data is deleted with workflow."""
        discharge = DischargeWorkflowFactory()
        workflow = discharge.workflow
        discharge_id = discharge.id

        workflow.delete()

        assert not DischargeWorkflow.objects.filter(id=discharge_id).exists()

    def test_patient_has_multiple_workflows(self, db):
        """Test patient can have multiple workflows."""
        patient = PatientProfileFactory()
        user = DoctorUserFactory()

        ClinicalWorkflowFactory(user=user, patient=patient)
        ClinicalWorkflowFactory(user=user, patient=patient)
        ClinicalWorkflowFactory(user=user, patient=patient)

        assert patient.workflows.count() == 3

    def test_user_has_multiple_workflows(self, db):
        """Test user can have multiple workflows."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        ClinicalWorkflowFactory(user=user, patient=patient)
        ClinicalWorkflowFactory(user=user, patient=patient)

        assert user.workflows.count() == 2
