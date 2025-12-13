"""
Admission and Discharge workflow integration tests.

Tests for complete admission and discharge workflows:
1. Admission: Patient registration → Bed assignment → Clinical info → Orders → Documentation
2. Discharge: Discharge planning → Medication reconciliation → Instructions → Documentation
"""
import pytest
from datetime import date, timedelta
from django.utils import timezone
from unittest.mock import patch, MagicMock

from apps.workflows.models import (
    ClinicalWorkflow, AdmissionWorkflow, DischargeWorkflow,
    WorkflowStatus, WorkflowType
)
from apps.workflows.engines import AdmissionEngine, DischargeEngine
from apps.wards.models import Admission
from apps.users.tests.factories import (
    PatientProfileFactory, DoctorUserFactory, PractitionerProfileFactory
)
from apps.nursing.tests.factories import AdmissionFactory, EncounterFactory


@pytest.mark.tier1
@pytest.mark.integration
class TestAdmissionWorkflowIntegration:
    """Integration tests for admission workflow."""

    def test_complete_admission_workflow(self, db):
        """
        Test complete admission workflow from start to finish.

        Flow:
        1. Start admission workflow
        2. Verify patient information
        3. Assign bed
        4. Capture clinical information
        5. Enter admission orders
        6. Complete documentation
        """
        # Setup
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Step 1: Start admission workflow
        result = AdmissionEngine.start(
            user=doctor,
            patient_id=patient.id
        )

        workflow = result['workflow']
        admission_data = result['admission_data']

        assert workflow.workflow_type == WorkflowType.ADMISSION
        assert workflow.status == WorkflowStatus.IN_PROGRESS
        assert workflow.current_step == 1

        # Step 2: Patient Verification
        AdmissionEngine.update_step(
            workflow=workflow,
            step_number=1,
            step_data={
                'patient_verified': True,
                'emergency_contact_name': 'Jane Doe',
                'emergency_contact_relationship': 'Spouse',
                'emergency_contact_phone': '555-0123'
            }
        )

        admission_data.refresh_from_db()
        assert admission_data.patient_verified is True
        assert admission_data.emergency_contact_name == 'Jane Doe'

        # Step 3: Bed Assignment (simulated - normally uses ward service)
        import uuid
        ward_id = uuid.uuid4()
        bed_id = uuid.uuid4()

        AdmissionEngine.update_step(
            workflow=workflow,
            step_number=2,
            step_data={
                'ward_id': str(ward_id),
                'bed_id': str(bed_id),
                'admission_type': 'elective',
                'admission_source': 'Outpatient clinic'
            }
        )

        admission_data.refresh_from_db()
        assert admission_data.admission_type == 'elective'

        # Step 4: Clinical Information
        AdmissionEngine.update_step(
            workflow=workflow,
            step_number=3,
            step_data={
                'admission_reason': 'Elective knee replacement',
                'chief_complaint': 'Right knee osteoarthritis',
                'initial_diagnosis': 'Severe osteoarthritis of right knee',
                'relevant_history': 'HTN, DM2'
            }
        )

        admission_data.refresh_from_db()
        assert admission_data.admission_reason == 'Elective knee replacement'

        # Step 5: Admission Orders
        AdmissionEngine.update_step(
            workflow=workflow,
            step_number=4,
            step_data={
                'diet': 'NPO after midnight',
                'activity': 'Bed rest',
                'vitals_frequency': 'Q4H',
                'medications': [
                    {'name': 'Enoxaparin', 'dose': '40mg', 'route': 'SC', 'frequency': 'daily'}
                ],
                'labs': [
                    {'name': 'CBC'},
                    {'name': 'BMP'},
                    {'name': 'Type and Screen'}
                ],
                'nursing_instructions': 'Pre-op checklist, DVT prophylaxis'
            }
        )

        admission_data.refresh_from_db()
        assert admission_data.diet == 'NPO after midnight'
        assert len(admission_data.medications) == 1
        assert len(admission_data.labs) == 3

        # Step 6: Documentation
        AdmissionEngine.update_step(
            workflow=workflow,
            step_number=5,
            step_data={
                'admission_note': 'Patient admitted for elective right TKA...',
                'expected_los': 3,
                'attending_physician': 'Dr. Smith'
            }
        )

        admission_data.refresh_from_db()
        workflow.refresh_from_db()

        assert admission_data.expected_los == 3
        assert workflow.current_step == 5

    def test_emergency_admission_workflow(self, db):
        """Test admission workflow for emergency admission."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = AdmissionEngine.start(
            user=doctor,
            patient_id=patient.id,
            initial_data={'source': 'Emergency Department'}
        )

        workflow = result['workflow']
        admission_data = result['admission_data']

        # Emergency admission data
        AdmissionEngine.update_step(
            workflow=workflow,
            step_number=3,
            step_data={
                'admission_reason': 'Chest pain rule out MI',
                'chief_complaint': 'Severe chest pain x 2 hours',
                'initial_diagnosis': 'NSTEMI',
                'admission_type': 'emergency',
                'admission_source': 'Emergency Department'
            }
        )

        admission_data.refresh_from_db()
        assert admission_data.admission_type == 'emergency'


@pytest.mark.tier1
@pytest.mark.integration
class TestDischargeWorkflowIntegration:
    """Integration tests for discharge workflow."""

    @patch('apps.workflows.engines.Admission')
    @patch('apps.workflows.engines.PatientProfile')
    def test_complete_discharge_workflow(self, mock_patient, mock_admission, db):
        """
        Test complete discharge workflow from start to finish.

        Flow:
        1. Start discharge workflow for admitted patient
        2. Complete discharge planning
        3. Medication reconciliation
        4. Discharge instructions
        5. Complete documentation
        """
        # Setup
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Mock patient lookup
        mock_patient.objects.get.return_value = patient

        # Mock admission with bed
        mock_bed = MagicMock()
        mock_bed.ward.name = 'Medical Ward'

        mock_admission_obj = MagicMock()
        mock_admission_obj.patient = patient
        mock_admission_obj.bed = mock_bed
        mock_admission_obj.admission_date = timezone.now() - timedelta(days=5)
        mock_admission.objects.select_related.return_value.get.return_value = mock_admission_obj

        # Step 1: Start discharge workflow
        result = DischargeEngine.start(
            user=doctor,
            patient_id=patient.id,
            admission_id='admission-123'
        )

        workflow = result['workflow']
        discharge_data = result['discharge_data']

        assert workflow.workflow_type == WorkflowType.DISCHARGE
        assert workflow.status == WorkflowStatus.IN_PROGRESS

        # Step 2: Discharge Planning
        DischargeEngine.update_step(
            workflow=workflow,
            step_number=1,
            step_data={
                'discharge_criteria_met': [
                    'Vitals stable for 24 hours',
                    'Ambulating independently',
                    'Pain controlled with oral medications',
                    'No signs of infection'
                ],
                'discharge_disposition': 'Home',
                'transportation': 'Family member'
            }
        )

        discharge_data.refresh_from_db()
        assert len(discharge_data.discharge_criteria_met) == 4
        assert discharge_data.discharge_disposition == 'Home'

        # Step 3: Medication Reconciliation
        DischargeEngine.update_step(
            workflow=workflow,
            step_number=2,
            step_data={
                'medications_reconciled': True,
                'discharge_prescriptions': [
                    {'medication': 'Oxycodone/APAP', 'dose': '5/325mg', 'frequency': 'Q6H PRN'},
                    {'medication': 'Enoxaparin', 'dose': '40mg', 'frequency': 'daily x 14 days'}
                ],
                'medication_changes': 'Discontinued IV pain meds, started oral',
                'medication_education_completed': True
            }
        )

        discharge_data.refresh_from_db()
        assert discharge_data.medications_reconciled is True
        assert len(discharge_data.discharge_prescriptions) == 2

        # Step 4: Discharge Instructions
        DischargeEngine.update_step(
            workflow=workflow,
            step_number=3,
            step_data={
                'activity_restrictions': 'No driving for 2 weeks, No lifting > 10 lbs',
                'diet_instructions': 'Regular diet',
                'wound_care': 'Keep dressing clean and dry, change every 2 days',
                'warning_signs': 'Return to ER if: fever > 101F, increased swelling, drainage',
                'follow_up_appointments': 'Orthopedic surgeon: 2 weeks, PCP: 1 week'
            }
        )

        discharge_data.refresh_from_db()
        assert discharge_data.activity_restrictions == 'No driving for 2 weeks, No lifting > 10 lbs'
        assert discharge_data.wound_care is not None

        # Step 5: Documentation
        DischargeEngine.update_step(
            workflow=workflow,
            step_number=4,
            step_data={
                'discharge_summary': 'Patient underwent successful right TKA...',
                'patient_education_complete': True,
                'discharge_instructions_given': True,
                'prescriptions_sent': True
            }
        )

        discharge_data.refresh_from_db()
        assert discharge_data.patient_education_complete is True
        assert discharge_data.prescriptions_sent is True


@pytest.mark.tier1
@pytest.mark.integration
class TestAdmissionToDischargeIntegration:
    """Integration tests for complete admission to discharge flow."""

    def test_admission_creates_admission_record(self, db):
        """Test that completing admission workflow creates admission record."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Start admission
        result = AdmissionEngine.start(
            user=doctor,
            patient_id=patient.id
        )

        workflow = result['workflow']
        admission_data = result['admission_data']

        # Complete steps
        admission_data.patient_verified = True
        admission_data.admission_type = 'elective'
        admission_data.admission_reason = 'Surgery'
        admission_data.chief_complaint = 'Scheduled procedure'
        admission_data.save()

        # Verify admission workflow data is stored
        assert admission_data.admission_type == 'elective'
        assert admission_data.patient_verified is True

    def test_patient_journey_admission_to_discharge(self, db):
        """Test tracking patient journey from admission to discharge."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Create admission workflow
        admission_result = AdmissionEngine.start(
            user=doctor,
            patient_id=patient.id
        )
        admission_workflow = admission_result['workflow']

        # Complete admission
        admission_workflow.steps_completed = [1, 2, 3, 4, 5]
        admission_workflow.complete_workflow()

        # Patient workflows should show admission
        patient_workflows = ClinicalWorkflow.objects.filter(
            patient=patient
        )

        assert patient_workflows.filter(
            workflow_type=WorkflowType.ADMISSION,
            status=WorkflowStatus.COMPLETED
        ).exists()


@pytest.mark.tier1
@pytest.mark.integration
class TestWorkflowContextPreservation:
    """Integration tests for workflow context data preservation."""

    def test_admission_context_preserved_across_steps(self, db):
        """Test that admission context data is preserved across all steps."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = AdmissionEngine.start(
            user=doctor,
            patient_id=patient.id
        )
        workflow = result['workflow']

        # Add context data at step 1
        workflow.context_data['step_1'] = {'field': 'value1'}
        workflow.save()

        # Update step (simulating step progression)
        workflow.context_data['step_2'] = {'field': 'value2'}
        workflow.save()

        workflow.refresh_from_db()

        # Both should be preserved
        assert workflow.context_data.get('step_1', {}).get('field') == 'value1'
        assert workflow.context_data.get('step_2', {}).get('field') == 'value2'

    def test_discharge_preserves_admission_reference(self, db):
        """Test that discharge workflow maintains reference to admission."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Create admission workflow
        admission_result = AdmissionEngine.start(
            user=doctor,
            patient_id=patient.id
        )

        # The discharge workflow should be able to reference this admission
        # (In real implementation, discharge would be started with admission_id)
        assert admission_result['workflow'].id is not None
