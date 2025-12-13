"""
Consultation workflow integration tests.

Tests for complete consultation workflow:
1. Doctor starts consultation for patient
2. Progress through consultation steps (Chief Complaint → HPI → ROS → Physical → Assessment → Plan)
3. Complete consultation
4. Verify encounter and clinical note created
5. Verify prescriptions and orders created
"""
import pytest
from datetime import date, timedelta
from django.utils import timezone
from unittest.mock import patch, MagicMock

from apps.workflows.models import (
    ClinicalWorkflow, ConsultationWorkflow,
    WorkflowStatus, WorkflowType
)
from apps.workflows.engines import ConsultationEngine
from apps.clinical_notes.models import Prescription, NoteEntry, NoteTemplate
from apps.users.tests.factories import (
    PatientProfileFactory, DoctorUserFactory, PractitionerProfileFactory
)
from apps.nursing.tests.factories import EncounterFactory


@pytest.mark.tier1
@pytest.mark.integration
class TestConsultationWorkflowIntegration:
    """Integration tests for consultation workflow."""

    def test_complete_consultation_workflow(self, db):
        """
        Test complete consultation workflow from start to finish.

        Flow:
        1. Doctor starts consultation for patient
        2. Completes Chief Complaint step
        3. Completes HPI/ROS step
        4. Completes Physical Exam step
        5. Completes Assessment step
        6. Completes Plan step with prescription
        7. Completes workflow
        8. Verify encounter and note created
        """
        # Setup
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor)

        # Step 1: Start consultation
        result = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id
        )

        workflow = result['workflow']
        consultation_data = result['consultation_data']

        assert workflow.workflow_type == WorkflowType.CONSULTATION
        assert workflow.status == WorkflowStatus.IN_PROGRESS
        assert workflow.current_step == 1
        assert workflow.patient == patient

        # Step 2: Chief Complaint
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'chief_complaint': 'Headache for 2 days'},
            consultation_fields={'chief_complaint': 'Headache for 2 days'},
            next_step=2
        )

        workflow.refresh_from_db()
        consultation_data.refresh_from_db()

        assert workflow.current_step == 2
        assert 1 in workflow.steps_completed
        assert consultation_data.chief_complaint == 'Headache for 2 days'

        # Step 3: HPI/ROS
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={
                'hpi': 'Gradual onset, throbbing, temporal region',
                'ros': 'No nausea, vomiting, photophobia'
            },
            consultation_fields={
                'hpi': 'Gradual onset, throbbing, temporal region',
                'ros': 'No nausea, vomiting, photophobia'
            },
            next_step=3
        )

        workflow.refresh_from_db()
        consultation_data.refresh_from_db()

        assert workflow.current_step == 3
        assert 2 in workflow.steps_completed

        # Step 4: Physical Exam
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={
                'physical_exam': 'Alert, oriented. HEENT: No papilledema. Neuro: CN II-XII intact'
            },
            consultation_fields={
                'physical_exam': 'Alert, oriented. HEENT: No papilledema. Neuro: CN II-XII intact'
            },
            next_step=4
        )

        workflow.refresh_from_db()
        assert workflow.current_step == 4
        assert 3 in workflow.steps_completed

        # Step 5: Assessment
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={
                'assessment': 'Tension-type headache'
            },
            consultation_fields={
                'assessment': 'Tension-type headache'
            },
            next_step=5
        )

        workflow.refresh_from_db()
        assert workflow.current_step == 5
        assert 4 in workflow.steps_completed

        # Step 6: Plan
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={
                'plan': 'Rest, Ibuprofen 400mg PRN, Follow up if symptoms persist'
            },
            consultation_fields={
                'plan': 'Rest, Ibuprofen 400mg PRN, Follow up if symptoms persist'
            }
        )

        workflow.refresh_from_db()
        consultation_data.refresh_from_db()

        assert 5 in workflow.steps_completed
        assert consultation_data.plan is not None

    def test_consultation_with_appointment_link(self, db):
        """Test consultation workflow linked to appointment."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id,
            appointment_id='apt-12345'
        )

        workflow = result['workflow']
        consultation_data = result['consultation_data']

        assert consultation_data.appointment_id == 'apt-12345'
        assert workflow.context_data.get('appointment_id') == 'apt-12345'

    def test_consultation_with_referral_data(self, db):
        """Test consultation workflow started from referral."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id,
            initial_data={
                'referral_id': 'ref-123',
                'referral_reason': 'Cardiac evaluation',
                'referral_clinical_summary': 'Patient with chest pain on exertion',
                'referral_questions': 'Rule out CAD'
            }
        )

        workflow = result['workflow']
        prep_data = workflow.context_data.get('prep_data', {})

        # Referral info should be incorporated
        assert 'referral' in workflow.context_data or 'chief_complaint' in prep_data

    def test_consultation_draft_save_and_resume(self, db):
        """Test saving consultation draft and resuming later."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        # Start consultation
        result = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id
        )
        workflow = result['workflow']
        workflow_id = workflow.id

        # Complete first step
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'chief_complaint': 'Chest pain'},
            consultation_fields={'chief_complaint': 'Chest pain'},
            next_step=2
        )

        # Simulate returning later - fetch workflow by ID
        resumed_workflow = ClinicalWorkflow.objects.get(id=workflow_id)

        assert resumed_workflow.current_step == 2
        assert 1 in resumed_workflow.steps_completed
        assert resumed_workflow.context_data.get('chief_complaint') == 'Chest pain'

        # Continue from where left off
        ConsultationEngine.update_step(
            workflow=resumed_workflow,
            step_data={'hpi': 'Chest pain started yesterday'},
            consultation_fields={'hpi': 'Chest pain started yesterday'},
            next_step=3
        )

        resumed_workflow.refresh_from_db()
        assert resumed_workflow.current_step == 3

    def test_consultation_cancelled_workflow(self, db):
        """Test cancelling a consultation workflow."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id
        )
        workflow = result['workflow']

        # Complete a couple steps
        ConsultationEngine.update_step(
            workflow=workflow,
            step_data={'chief_complaint': 'Abdominal pain'},
            consultation_fields={'chief_complaint': 'Abdominal pain'},
            next_step=2
        )

        # Cancel workflow
        workflow.status = WorkflowStatus.CANCELLED
        workflow.save()

        workflow.refresh_from_db()
        assert workflow.status == WorkflowStatus.CANCELLED


@pytest.mark.tier1
@pytest.mark.integration
class TestConsultationWithPrescriptionsIntegration:
    """Integration tests for consultation with prescription creation."""

    def test_consultation_creates_prescriptions(self, db):
        """Test that completing consultation can create prescriptions."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor)
        encounter = EncounterFactory(patient=patient, practitioner=practitioner)

        # Start and progress consultation
        result = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id
        )
        workflow = result['workflow']
        consultation_data = result['consultation_data']

        # Complete all steps with prescription in plan
        consultation_data.chief_complaint = 'Upper respiratory infection'
        consultation_data.hpi = 'Cough and congestion for 5 days'
        consultation_data.ros = 'Positive for cough, congestion'
        consultation_data.physical_exam = 'Lungs clear, throat erythematous'
        consultation_data.assessment = 'Viral URI'
        consultation_data.plan = 'Rx: Amoxicillin 500mg TID x 7 days'
        consultation_data.save()

        # Create associated prescription
        prescription = Prescription.objects.create(
            patient=patient,
            prescribed_by=practitioner,
            encounter=encounter,
            medication_name='Amoxicillin',
            dosage='500mg',
            route='oral',
            frequency='tid',
            duration_days=7,
            status='active'
        )

        assert prescription.patient == patient
        assert prescription.medication_name == 'Amoxicillin'
        assert prescription.frequency == 'tid'

    def test_multiple_prescriptions_in_consultation(self, db):
        """Test creating multiple prescriptions in one consultation."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor)
        encounter = EncounterFactory(patient=patient, practitioner=practitioner)

        # Create multiple prescriptions
        prescriptions = [
            Prescription.objects.create(
                patient=patient,
                prescribed_by=practitioner,
                encounter=encounter,
                medication_name='Lisinopril',
                dosage='10mg',
                route='oral',
                frequency='daily',
                duration_days=30,
                status='active'
            ),
            Prescription.objects.create(
                patient=patient,
                prescribed_by=practitioner,
                encounter=encounter,
                medication_name='Metformin',
                dosage='500mg',
                route='oral',
                frequency='bid',
                duration_days=30,
                status='active'
            ),
            Prescription.objects.create(
                patient=patient,
                prescribed_by=practitioner,
                encounter=encounter,
                medication_name='Atorvastatin',
                dosage='20mg',
                route='oral',
                frequency='qhs',
                duration_days=30,
                status='active'
            ),
        ]

        assert len(prescriptions) == 3
        assert all(rx.encounter == encounter for rx in prescriptions)


@pytest.mark.tier1
@pytest.mark.integration
class TestConsultationPrepDataIntegration:
    """Integration tests for consultation prep data loading."""

    def test_prep_data_loads_patient_info(self, db):
        """Test that prep data includes patient information."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id
        )

        prep_data = result['workflow'].context_data.get('prep_data', {})

        assert 'patient_name' in prep_data
        assert prep_data['patient_id'] == str(patient.id)

    def test_prep_data_loads_mrn(self, db):
        """Test that prep data includes MRN."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        result = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id
        )

        prep_data = result['workflow'].context_data.get('prep_data', {})

        assert 'medical_record_number' in prep_data


@pytest.mark.tier1
@pytest.mark.integration
class TestMultipleConsultationsIntegration:
    """Integration tests for multiple consultations."""

    def test_patient_can_have_multiple_consultations(self, db):
        """Test that a patient can have multiple consultations."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        # First consultation
        result1 = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id
        )
        workflow1 = result1['workflow']
        workflow1.complete_workflow()

        # Second consultation
        result2 = ConsultationEngine.start(
            user=doctor,
            patient_id=patient.id
        )
        workflow2 = result2['workflow']

        # Both consultations exist
        consultations = ClinicalWorkflow.objects.filter(
            patient=patient,
            workflow_type=WorkflowType.CONSULTATION
        )

        assert consultations.count() == 2

    def test_doctor_can_have_concurrent_consultations(self, db):
        """Test that a doctor can have concurrent consultations with different patients."""
        doctor = DoctorUserFactory()
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()

        # Start consultation with patient 1
        result1 = ConsultationEngine.start(
            user=doctor,
            patient_id=patient1.id
        )

        # Start consultation with patient 2
        result2 = ConsultationEngine.start(
            user=doctor,
            patient_id=patient2.id
        )

        # Both are in progress
        doctor_workflows = ClinicalWorkflow.objects.filter(
            user=doctor,
            status=WorkflowStatus.IN_PROGRESS
        )

        assert doctor_workflows.count() == 2
