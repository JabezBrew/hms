"""
Workflow lifecycle tests for workflows app.

Tests for:
- Workflow status transitions
- Step progression
- Draft save and resume
- Workflow completion
- Artifact generation
"""
import pytest
from datetime import timedelta
from django.utils import timezone

from apps.workflows.models import (
    ClinicalWorkflow, ConsultationWorkflow,
    WorkflowStatus, WorkflowType
)
from apps.users.models import UserPatientList
from apps.users.tests.factories import PatientProfileFactory, DoctorUserFactory
from .factories import (
    ClinicalWorkflowFactory, InProgressWorkflowFactory, CompletedWorkflowFactory,
    ConsultationWorkflowFactory, WardRoundWorkflowFactory,
    DischargeWorkflowFactory,
    create_consultation_workflow, create_ward_round_workflow
)


# =============================================================================
# Workflow Status Transition Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowStatusTransitions:
    """Tests for workflow status transitions."""

    def test_draft_to_in_progress(self, db):
        """Test workflow can transition from draft to in_progress."""
        workflow = ClinicalWorkflowFactory(status=WorkflowStatus.DRAFT)

        workflow.status = WorkflowStatus.IN_PROGRESS
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.status == WorkflowStatus.IN_PROGRESS

    def test_in_progress_to_completed(self, db):
        """Test workflow can transition to completed."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS,
            steps_completed=[1, 2, 3, 4, 5],
            total_steps=5
        )

        workflow.complete_workflow()

        assert workflow.status == WorkflowStatus.COMPLETED
        assert workflow.completed_at is not None

    def test_in_progress_to_cancelled(self, db):
        """Test workflow can be cancelled."""
        workflow = ClinicalWorkflowFactory(status=WorkflowStatus.IN_PROGRESS)

        workflow.status = WorkflowStatus.CANCELLED
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.status == WorkflowStatus.CANCELLED

    def test_draft_to_cancelled(self, db):
        """Test draft workflow can be cancelled."""
        workflow = ClinicalWorkflowFactory(status=WorkflowStatus.DRAFT)

        workflow.status = WorkflowStatus.CANCELLED
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.status == WorkflowStatus.CANCELLED

    def test_completed_at_set_on_completion(self, db):
        """Test completed_at timestamp is set on completion."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS,
            completed_at=None
        )

        assert workflow.completed_at is None

        workflow.complete_workflow()

        assert workflow.completed_at is not None
        assert workflow.completed_at <= timezone.now()


# =============================================================================
# Step Progression Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowStepProgression:
    """Tests for workflow step progression."""

    def test_initial_step_is_one(self, db):
        """Test workflow starts at step 1."""
        workflow = ClinicalWorkflowFactory()

        assert workflow.current_step == 1

    def test_advance_step_sequentially(self, db):
        """Test advancing steps sequentially."""
        workflow = ClinicalWorkflowFactory(
            current_step=1,
            total_steps=5,
            steps_completed=[]
        )

        workflow.mark_step_complete(1)
        workflow.advance_to_step(2)

        assert workflow.current_step == 2
        assert 1 in workflow.steps_completed

    def test_advance_multiple_steps(self, db):
        """Test advancing multiple steps."""
        workflow = ClinicalWorkflowFactory(
            current_step=1,
            total_steps=5
        )

        workflow.mark_step_complete(1)
        workflow.mark_step_complete(2)
        workflow.advance_to_step(3)

        assert workflow.current_step == 3
        assert 1 in workflow.steps_completed
        assert 2 in workflow.steps_completed

    def test_skip_to_step(self, db):
        """Test skipping to a later step."""
        workflow = ClinicalWorkflowFactory(
            current_step=1,
            total_steps=5
        )

        # Skip to step 4 (some workflows allow non-sequential progression)
        workflow.advance_to_step(4)

        assert workflow.current_step == 4

    def test_cannot_advance_past_total_steps(self, db):
        """Test cannot advance beyond total steps."""
        workflow = ClinicalWorkflowFactory(
            current_step=5,
            total_steps=5
        )

        original_step = workflow.current_step
        workflow.advance_to_step(6)

        assert workflow.current_step == original_step

    def test_go_back_to_previous_step(self, db):
        """Test going back to a previous step."""
        workflow = ClinicalWorkflowFactory(
            current_step=3,
            total_steps=5,
            steps_completed=[1, 2]
        )

        workflow.advance_to_step(2)

        assert workflow.current_step == 2

    def test_steps_completed_tracks_all(self, db):
        """Test steps_completed tracks all completed steps."""
        workflow = ClinicalWorkflowFactory(steps_completed=[])

        workflow.mark_step_complete(1)
        workflow.mark_step_complete(2)
        workflow.mark_step_complete(3)

        assert len(workflow.steps_completed) == 3
        assert 1 in workflow.steps_completed
        assert 2 in workflow.steps_completed
        assert 3 in workflow.steps_completed


# =============================================================================
# Draft Save and Resume Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowDraftSaveResume:
    """Tests for workflow draft saving and resuming."""

    def test_save_draft_updates_context(self, db):
        """Test saving draft updates context data."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS,
            context_data={}
        )

        workflow.context_data['chief_complaint'] = 'Headache'
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.context_data['chief_complaint'] == 'Headache'

    def test_save_draft_preserves_existing_data(self, db):
        """Test saving draft preserves existing data."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS,
            context_data={'existing_field': 'existing_value'}
        )

        workflow.context_data['new_field'] = 'new_value'
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.context_data['existing_field'] == 'existing_value'
        assert workflow.context_data['new_field'] == 'new_value'

    def test_save_draft_requires_current_patient_access(
        self,
        settings,
        doctor_client,
        doctor_user,
        patient_profile_factory,
        default_facility,
    ):
        """A clinician cannot keep mutating an owned workflow after losing patient access."""
        settings.TEAM_ACCESS_STRICT = True
        accessible_patient = patient_profile_factory(facility=default_facility)
        inaccessible_patient = patient_profile_factory(facility=default_facility)
        UserPatientList.objects.create(user=doctor_user, patient=accessible_patient)
        workflow = ClinicalWorkflowFactory(
            user=doctor_user,
            patient=inaccessible_patient,
            workflow_type=WorkflowType.CONSULTATION,
            status=WorkflowStatus.IN_PROGRESS,
        )

        response = doctor_client.post(
            f'/api/workflows/{workflow.id}/save-draft/',
            {'context_data': {'chief_complaint': 'Headache'}},
            format='json',
        )

        assert response.status_code == 404

    def test_resume_workflow_from_draft(self, db):
        """Test resuming workflow from saved draft."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Create and save a draft
        workflow = ClinicalWorkflowFactory(
            user=user,
            patient=patient,
            status=WorkflowStatus.IN_PROGRESS,
            current_step=3,
            steps_completed=[1, 2],
            context_data={'step_1': 'data1', 'step_2': 'data2'}
        )
        workflow_id = workflow.id

        # Simulate resuming the workflow
        resumed = ClinicalWorkflow.objects.get(id=workflow_id)

        assert resumed.current_step == 3
        assert resumed.steps_completed == [1, 2]
        assert resumed.context_data['step_1'] == 'data1'

    def test_autosave_updates_timestamp(self, db):
        """Test autosave updates last_autosave timestamp."""
        workflow = ClinicalWorkflowFactory()
        original_autosave = workflow.last_autosave

        # Make a change and save
        workflow.context_data['new_data'] = 'value'
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.last_autosave >= original_autosave

    def test_find_incomplete_workflows_for_patient(self, db):
        """Test finding incomplete workflows for a patient."""
        patient = PatientProfileFactory()
        user = DoctorUserFactory()

        # Create various workflow states
        ClinicalWorkflowFactory(
            user=user, patient=patient, status=WorkflowStatus.IN_PROGRESS
        )
        ClinicalWorkflowFactory(
            user=user, patient=patient, status=WorkflowStatus.DRAFT
        )
        ClinicalWorkflowFactory(
            user=user, patient=patient, status=WorkflowStatus.COMPLETED
        )

        incomplete = ClinicalWorkflow.objects.filter(
            patient=patient,
            status__in=[WorkflowStatus.DRAFT, WorkflowStatus.IN_PROGRESS]
        )

        assert incomplete.count() == 2


# =============================================================================
# Workflow Completion Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowCompletion:
    """Tests for workflow completion."""

    def test_workflow_marked_complete(self, db):
        """Test workflow is marked complete correctly."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS,
            steps_completed=[1, 2, 3, 4, 5],
            total_steps=5
        )

        workflow.complete_workflow()

        assert workflow.status == WorkflowStatus.COMPLETED

    def test_completion_sets_timestamp(self, db):
        """Test completion sets completed_at timestamp."""
        workflow = ClinicalWorkflowFactory(
            status=WorkflowStatus.IN_PROGRESS
        )

        before_completion = timezone.now()
        workflow.complete_workflow()

        assert workflow.completed_at is not None
        assert workflow.completed_at >= before_completion

    def test_is_complete_check(self, db):
        """Test is_complete method works correctly."""
        workflow = ClinicalWorkflowFactory(
            total_steps=5,
            steps_completed=[1, 2, 3]
        )

        assert workflow.is_complete() is False

        workflow.steps_completed = [1, 2, 3, 4, 5]
        workflow.save()

        assert workflow.is_complete() is True


# =============================================================================
# Consultation Workflow Lifecycle Tests
# =============================================================================

@pytest.mark.tier1
class TestConsultationWorkflowLifecycle:
    """Tests for consultation workflow lifecycle."""

    def test_consultation_workflow_creation(self, db):
        """Test creating a consultation workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        workflow, consultation_data = create_consultation_workflow(user, patient)

        assert workflow.workflow_type == WorkflowType.CONSULTATION
        assert workflow.patient == patient
        assert consultation_data is not None

    def test_consultation_step_progression(self, db):
        """Test consultation workflow step progression."""
        consultation = ConsultationWorkflowFactory()
        workflow = consultation.workflow

        # Step 1: Chief Complaint
        workflow.context_data['chief_complaint'] = 'Headache'
        workflow.mark_step_complete(1)
        workflow.advance_to_step(2)

        # Step 2: HPI/ROS
        workflow.context_data['hpi'] = 'Headache for 2 days'
        consultation.hpi = 'Headache for 2 days'
        workflow.mark_step_complete(2)
        workflow.advance_to_step(3)
        consultation.save()

        assert workflow.current_step == 3
        assert 1 in workflow.steps_completed
        assert 2 in workflow.steps_completed

    def test_consultation_data_storage(self, db):
        """Test consultation-specific data is stored."""
        consultation = ConsultationWorkflowFactory(
            chief_complaint='Chest pain',
            hpi='Sharp chest pain for 1 hour',
            ros='All other systems negative',
            physical_exam='Heart sounds normal',
            assessment='Chest wall pain',
            plan='NSAIDs, follow up if worse'
        )

        consultation.refresh_from_db()

        assert consultation.chief_complaint == 'Chest pain'
        assert consultation.assessment == 'Chest wall pain'


# =============================================================================
# Ward Round Workflow Lifecycle Tests
# =============================================================================

@pytest.mark.tier1
class TestWardRoundWorkflowLifecycle:
    """Tests for ward round workflow lifecycle."""

    def test_ward_round_workflow_creation(self, db):
        """Test creating a ward round workflow."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        workflow, ward_round_data = create_ward_round_workflow(
            user, patient, admission_id='test-admission-123'
        )

        assert workflow.workflow_type == WorkflowType.WARD_ROUND
        assert workflow.context_data['admission_id'] == 'test-admission-123'

    def test_ward_round_step_progression(self, db):
        """Test ward round workflow step progression."""
        ward_round = WardRoundWorkflowFactory()
        workflow = ward_round.workflow

        # Step 1: Patient Review
        ward_round.overnight_events = 'Patient slept well'
        ward_round.nursing_concerns = 'None'
        workflow.mark_step_complete(1)
        workflow.advance_to_step(2)
        ward_round.save()

        # Step 2: Clinical Assessment
        ward_round.vitals_reviewed = True
        ward_round.examination_findings = 'Stable'
        workflow.mark_step_complete(2)
        workflow.advance_to_step(3)
        ward_round.save()

        assert workflow.current_step == 3
        assert ward_round.vitals_reviewed is True

    def test_ward_round_orders_tracking(self, db):
        """Test ward round orders are tracked."""
        ward_round = WardRoundWorkflowFactory()

        ward_round.orders_placed = [
            {'type': 'lab', 'name': 'CBC', 'urgency': 'routine'},
            {'type': 'medication', 'name': 'Aspirin 81mg', 'frequency': 'daily'}
        ]
        ward_round.save()

        ward_round.refresh_from_db()
        assert len(ward_round.orders_placed) == 2


# =============================================================================
# Discharge Workflow Lifecycle Tests
# =============================================================================

@pytest.mark.tier1
class TestDischargeWorkflowLifecycle:
    """Tests for discharge workflow lifecycle."""

    def test_discharge_workflow_step_progression(self, db):
        """Test discharge workflow step progression."""
        discharge = DischargeWorkflowFactory()
        workflow = discharge.workflow

        # Step 1: Discharge Planning
        discharge.discharge_criteria_met = ['Vitals stable', 'Ambulating']
        discharge.discharge_disposition = 'Home'
        workflow.mark_step_complete(1)
        workflow.advance_to_step(2)
        discharge.save()

        # Step 2: Medications
        discharge.medications_reconciled = True
        discharge.medication_education_completed = True
        workflow.mark_step_complete(2)
        workflow.advance_to_step(3)
        discharge.save()

        assert workflow.current_step == 3
        assert discharge.medications_reconciled is True

    def test_discharge_instructions_storage(self, db):
        """Test discharge instructions are stored."""
        discharge = DischargeWorkflowFactory(
            activity_restrictions='No driving for 2 weeks',
            diet_instructions='Resume regular diet',
            wound_care='Change dressing daily',
            warning_signs='Return if fever > 101F',
            follow_up_appointments='Surgery clinic in 2 weeks'
        )

        assert discharge.activity_restrictions == 'No driving for 2 weeks'
        assert discharge.warning_signs == 'Return if fever > 101F'

    def test_discharge_education_checklist(self, db):
        """Test discharge education checklist completion."""
        discharge = DischargeWorkflowFactory(
            medication_education_completed=True,
            patient_education_complete=True,
            discharge_instructions_given=True,
            prescriptions_sent=True
        )

        assert discharge.medication_education_completed is True
        assert discharge.patient_education_complete is True
        assert discharge.discharge_instructions_given is True
        assert discharge.prescriptions_sent is True


# =============================================================================
# Workflow Filtering Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowFiltering:
    """Tests for workflow filtering and queries."""

    def test_filter_by_status(self, db):
        """Test filtering workflows by status."""
        user = DoctorUserFactory()

        ClinicalWorkflowFactory(user=user, status=WorkflowStatus.DRAFT)
        ClinicalWorkflowFactory(user=user, status=WorkflowStatus.IN_PROGRESS)
        ClinicalWorkflowFactory(user=user, status=WorkflowStatus.IN_PROGRESS)
        ClinicalWorkflowFactory(user=user, status=WorkflowStatus.COMPLETED)

        in_progress = ClinicalWorkflow.objects.filter(
            user=user,
            status=WorkflowStatus.IN_PROGRESS
        )

        assert in_progress.count() == 2

    def test_filter_by_workflow_type(self, db):
        """Test filtering workflows by type."""
        patient = PatientProfileFactory()

        ClinicalWorkflowFactory(
            patient=patient, workflow_type=WorkflowType.CONSULTATION
        )
        ClinicalWorkflowFactory(
            patient=patient, workflow_type=WorkflowType.CONSULTATION
        )
        ClinicalWorkflowFactory(
            patient=patient, workflow_type=WorkflowType.WARD_ROUND
        )

        consultations = ClinicalWorkflow.objects.filter(
            patient=patient,
            workflow_type=WorkflowType.CONSULTATION
        )

        assert consultations.count() == 2

    def test_filter_by_user_and_patient(self, db):
        """Test filtering by user and patient combination."""
        user1 = DoctorUserFactory()
        user2 = DoctorUserFactory()
        patient = PatientProfileFactory()

        ClinicalWorkflowFactory(user=user1, patient=patient)
        ClinicalWorkflowFactory(user=user1, patient=patient)
        ClinicalWorkflowFactory(user=user2, patient=patient)

        user1_workflows = ClinicalWorkflow.objects.filter(
            user=user1,
            patient=patient
        )

        assert user1_workflows.count() == 2

    def test_filter_active_workflows(self, db):
        """Test filtering for active (non-completed, non-cancelled) workflows."""
        patient = PatientProfileFactory()
        user = DoctorUserFactory()

        ClinicalWorkflowFactory(
            user=user, patient=patient, status=WorkflowStatus.DRAFT
        )
        ClinicalWorkflowFactory(
            user=user, patient=patient, status=WorkflowStatus.IN_PROGRESS
        )
        ClinicalWorkflowFactory(
            user=user, patient=patient, status=WorkflowStatus.COMPLETED
        )
        ClinicalWorkflowFactory(
            user=user, patient=patient, status=WorkflowStatus.CANCELLED
        )

        active = ClinicalWorkflow.objects.filter(
            patient=patient,
            status__in=[WorkflowStatus.DRAFT, WorkflowStatus.IN_PROGRESS]
        )

        assert active.count() == 2

    def test_filter_by_date_range(self, db):
        """Test filtering workflows by date range."""
        user = DoctorUserFactory()

        # Workflows from today will be within range
        workflow1 = ClinicalWorkflowFactory(user=user)
        workflow2 = ClinicalWorkflowFactory(user=user)

        yesterday = timezone.now() - timedelta(days=1)
        tomorrow = timezone.now() + timedelta(days=1)

        workflows = ClinicalWorkflow.objects.filter(
            user=user,
            created_at__gte=yesterday,
            created_at__lte=tomorrow
        )

        assert workflows.count() >= 2


# =============================================================================
# Workflow Audit Tests
# =============================================================================

@pytest.mark.tier1
class TestWorkflowAudit:
    """Tests for workflow audit fields."""

    def test_created_at_auto_set(self, db):
        """Test created_at is automatically set."""
        workflow = ClinicalWorkflowFactory()

        assert workflow.created_at is not None

    def test_updated_at_auto_updated(self, db):
        """Test updated_at is updated on save."""
        workflow = ClinicalWorkflowFactory()
        original_updated = workflow.updated_at

        workflow.context_data['test'] = 'data'
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.updated_at >= original_updated

    def test_user_is_tracked(self, db):
        """Test user who created workflow is tracked."""
        user = DoctorUserFactory()
        workflow = ClinicalWorkflowFactory(user=user)

        assert workflow.user == user
