"""Discharge workflow integration tests."""
import pytest
from datetime import date, timedelta
from django.utils import timezone
from unittest.mock import patch, MagicMock

from apps.workflows.models import DischargeWorkflow, WorkflowStatus, WorkflowType
from apps.workflows.engines import DischargeEngine
from apps.users.tests.factories import (
    PatientProfileFactory, DoctorUserFactory
)


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
                'discharge_date': timezone.now().isoformat(),
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
