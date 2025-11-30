"""
Workflow engines - Business logic for clinical workflows
"""
from django.db import transaction
from django.utils import timezone
from typing import Dict, Any, Optional, List
import logging

from .models import (
    ClinicalWorkflow, ConsultationWorkflow, ClinicalNoteWorkflow,
    WardRoundWorkflow, AdmissionWorkflow, DischargeWorkflow,
    WorkflowStatus, WorkflowType, ClinicalNoteType
)
from .definitions import WorkflowDefinition, WorkflowStepDefinition
from .registry import get_workflow_definition, WORKFLOW_DEFINITIONS
from apps.users.models import PatientProfile
from apps.wards.models import Admission, Ward, Bed
from apps.wards.proxies import EncounterProxy
from apps.clinical_notes.models import NoteEntry

logger = logging.getLogger(__name__)


class BaseWorkflowEngine:
    """
    Enhanced base class for workflow engines with template support
    Provides common functionality for all workflows with definition-based configuration
    """

    # Subclasses can override this for static definitions
    workflow_definition: Optional[WorkflowDefinition] = None

    @classmethod
    def get_definition(cls, context: Dict = None) -> WorkflowDefinition:
        """
        Get workflow definition - override for dynamic definitions

        Args:
            context: Optional context for dynamic definition lookup

        Returns:
            WorkflowDefinition for this workflow type

        Raises:
            NotImplementedError: If workflow_definition is not set and not overridden
        """
        if cls.workflow_definition:
            return cls.workflow_definition
        raise NotImplementedError(
            f"{cls.__name__} must either set workflow_definition or override get_definition()"
        )

    @classmethod
    def get_step_config(cls, step_number: int, context: Dict = None) -> WorkflowStepDefinition:
        """
        Get configuration for a specific step

        Args:
            step_number: Step number (1-indexed)
            context: Optional context for dynamic step lookup

        Returns:
            WorkflowStepDefinition for the requested step

        Raises:
            ValueError: If step_number is out of range
        """
        definition = cls.get_definition(context)
        step = definition.get_step(step_number)
        if step is None:
            raise ValueError(
                f"Step {step_number} not found in workflow {definition.workflow_type}"
            )
        return step

    @classmethod
    def validate_step(cls, workflow: ClinicalWorkflow, step_data: Dict) -> List[str]:
        """
        Validate step data against definition

        Args:
            workflow: Workflow instance
            step_data: Data to validate for current step

        Returns:
            List of validation error messages (empty if valid)
        """
        errors = []

        try:
            step_config = cls.get_step_config(workflow.current_step)
        except ValueError as e:
            return [str(e)]

        # Validate required fields
        for field in step_config.fields:
            if field.required and not step_data.get(field.name):
                errors.append(f"{field.label} is required")

        # TODO: Add more validation rules based on ValidationRule definitions

        return errors

    @staticmethod
    def save_draft(workflow: ClinicalWorkflow, context_data: Dict[str, Any]) -> ClinicalWorkflow:
        """
        Save workflow draft (auto-save)

        Args:
            workflow: The workflow instance
            context_data: Data to merge into context

        Returns:
            Updated workflow instance
        """
        workflow.context_data.update(context_data)
        workflow.save()
        logger.info(f"Saved draft for workflow {workflow.id}")
        return workflow

    @staticmethod
    def cancel_workflow(workflow: ClinicalWorkflow) -> ClinicalWorkflow:
        """
        Cancel a workflow

        Args:
            workflow: The workflow instance

        Returns:
            Updated workflow instance
        """
        workflow.status = WorkflowStatus.CANCELLED
        workflow.save()
        logger.info(f"Cancelled workflow {workflow.id}")
        return workflow


class ConsultationEngine(BaseWorkflowEngine):
    """
    Business logic for consultation workflow
    Handles consultation-specific workflow operations
    """

    @staticmethod
    @transaction.atomic
    def start(user, patient_id, appointment_id: Optional[str] = None, initial_data: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Initialize a new consultation workflow

        Args:
            user: User starting the workflow
            patient_id: PatientProfile ID (UUID)
            appointment_id: Optional FHIR Appointment ID
            initial_data: Optional initial context data

        Returns:
            Dictionary containing workflow and consultation_data instances
        """
        # Get patient
        try:
            patient = PatientProfile.objects.get(id=patient_id)
        except PatientProfile.DoesNotExist:
            raise ValueError(f"Patient with ID {patient_id} not found")

        # Prepare initial context
        prep_data = ConsultationEngine._load_prep_data(patient)

        # If referral data is provided, add it to prep_data
        if initial_data and initial_data.get('referral_id'):
            prep_data['referral'] = {
                'id': initial_data.get('referral_id'),
                'referral_number': initial_data.get('referral_number'),
                'reason': initial_data.get('referral_reason'),
                'clinical_summary': initial_data.get('referral_clinical_summary'),
                'questions': initial_data.get('referral_questions'),
                'urgency': initial_data.get('referral_urgency'),
                'referring_doctor': initial_data.get('referral_referring_doctor'),
                'referring_department': initial_data.get('referral_referring_department'),
            }
            # Pre-populate chief complaint from referral reason
            prep_data['chief_complaint'] = initial_data.get('referral_reason', '')

        context_data = {
            'appointment_id': appointment_id,
            'prep_data': prep_data,
        }

        if initial_data:
            context_data.update(initial_data)

        # Create workflow
        workflow = ClinicalWorkflow.objects.create(
            workflow_type=WorkflowType.CONSULTATION,
            status=WorkflowStatus.IN_PROGRESS,
            user=user,
            patient=patient,
            current_step=1,
            total_steps=5,
            context_data=context_data,
        )

        # Create consultation-specific data
        consultation_data = ConsultationWorkflow.objects.create(
            workflow=workflow,
            appointment_id=appointment_id,
        )

        logger.info(f"Started consultation workflow {workflow.id} for patient {patient.id}")

        return {
            'workflow': workflow,
            'consultation_data': consultation_data,
        }

    @staticmethod
    def _load_prep_data(patient: PatientProfile) -> Dict[str, Any]:
        """
        Load preparation data for consultation
        Auto-assembled patient context

        Args:
            patient: PatientProfile instance

        Returns:
            Dictionary with patient context data
        """
        # TODO: Implement loading of:
        # - Last visit summary
        # - Recent lab results
        # - Active problems
        # - Current medications
        # - Alerts (overdue screenings, drug interactions, etc.)

        prep_data = {
            'patient_name': patient.user.get_full_name() if patient.user else 'Unknown',
            'patient_id': str(patient.id),
            'fhir_patient_id': patient.fhir_patient_id,
            'medical_record_number': getattr(patient, 'medical_record_number', 'N/A'),
            # Placeholder for additional data
            'last_visit': None,
            'recent_results': [],
            'active_problems': [],
            'current_medications': [],
            'alerts': [],
        }

        return prep_data

    @staticmethod
    @transaction.atomic
    def update_step(
        workflow: ClinicalWorkflow,
        step_data: Dict[str, Any],
        next_step: Optional[int] = None,
        consultation_fields: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Update workflow step and optionally advance

        Args:
            workflow: The workflow instance
            step_data: Data for current step
            next_step: Optional next step number
            consultation_fields: Optional consultation-specific fields to update

        Returns:
            Dictionary with updated workflow and consultation_data
        """
        # Update context data
        workflow.context_data.update(step_data)

        # Mark current step as completed
        if workflow.current_step not in workflow.steps_completed:
            workflow.mark_step_complete(workflow.current_step)

        # Advance to next step if specified
        if next_step and next_step <= workflow.total_steps:
            workflow.advance_to_step(next_step)

        workflow.save()

        # Update consultation-specific fields if provided
        consultation_data = workflow.consultation_data
        if consultation_fields:
            for field, value in consultation_fields.items():
                if hasattr(consultation_data, field):
                    setattr(consultation_data, field, value)
            consultation_data.save()

        logger.info(f"Updated workflow {workflow.id} step to {workflow.current_step}")

        return {
            'workflow': workflow,
            'consultation_data': consultation_data,
        }

    @staticmethod
    @transaction.atomic
    def complete(
        workflow: ClinicalWorkflow,
        final_data: Dict[str, Any],
        encounter_type: str = 'outpatient',
        encounter_status: str = 'finished'
    ) -> Dict[str, Any]:
        """
        Complete consultation workflow and generate artifacts

        Args:
            workflow: The workflow instance
            final_data: Final workflow data
            encounter_type: Type of encounter to create
            encounter_status: Status of encounter

        Returns:
            Dictionary with encounter_id and generated artifacts
        """
        context = workflow.context_data
        consultation_data = workflow.consultation_data

        # Create FHIR Encounter
        try:
            encounter = EncounterProxy.create(
                patient_id=workflow.patient.fhir_patient_id,
                practitioner_id=workflow.user.practitionerprofile.fhir_practitioner_id if hasattr(workflow.user, 'practitionerprofile') else None,
                encounter_type=encounter_type,
                status=encounter_status,
                reason=consultation_data.chief_complaint or context.get('chief_complaint', ''),
                service_type=context.get('service_type'),
                start_time=workflow.created_at,
                appointment_id=consultation_data.appointment_id,
            )

            encounter_id = encounter.get('id')

            logger.info(f"Created FHIR encounter {encounter_id} for workflow {workflow.id}")

        except Exception as e:
            logger.error(f"Failed to create encounter for workflow {workflow.id}: {str(e)}")
            raise

        # Create clinical note
        try:
            note_content = ConsultationEngine._format_consultation_note(consultation_data, context)

            note = NoteEntry.objects.create(
                encounter_id=encounter_id,
                author=workflow.user,
                content=note_content,
                note_type='consultation',
                title=f'Consultation Note - {workflow.patient.user.get_full_name()}',
            )

            logger.info(f"Created clinical note {note.id} for workflow {workflow.id}")

        except Exception as e:
            logger.error(f"Failed to create clinical note for workflow {workflow.id}: {str(e)}")
            note = None

        # Mark workflow complete
        workflow.encounter_id = encounter_id
        workflow.complete_workflow()

        artifacts = [
            {'type': 'encounter', 'id': encounter_id},
        ]

        if note:
            artifacts.append({'type': 'note', 'id': note.id})

        # Auto-complete linked referral if this consultation was started from a referral
        if workflow.source_referral:
            try:
                referral = workflow.source_referral
                referral.status = 'completed'
                referral.completed_at = timezone.now()
                referral.specialist_notes = ConsultationEngine._format_consultation_note(consultation_data, context)
                referral.recommendations = consultation_data.plan or ''
                referral.save()

                artifacts.append({'type': 'referral_completed', 'id': str(referral.id)})
                logger.info(f"Auto-completed referral {referral.referral_number} from consultation workflow {workflow.id}")
            except Exception as e:
                logger.error(f"Failed to auto-complete referral for workflow {workflow.id}: {str(e)}")
                # Don't fail the whole operation if referral update fails

        return {
            'success': True,
            'workflow_id': workflow.id,
            'encounter_id': encounter_id,
            'artifacts': artifacts,
        }

    @staticmethod
    def _format_consultation_note(consultation_data: ConsultationWorkflow, context: Dict) -> str:
        """
        Format consultation data into a clinical note

        Args:
            consultation_data: ConsultationWorkflow instance
            context: Workflow context data

        Returns:
            Formatted note content
        """
        sections = []

        if consultation_data.chief_complaint:
            sections.append(f"CHIEF COMPLAINT:\n{consultation_data.chief_complaint}\n")

        if consultation_data.hpi:
            sections.append(f"HISTORY OF PRESENT ILLNESS:\n{consultation_data.hpi}\n")

        if consultation_data.ros:
            sections.append(f"REVIEW OF SYSTEMS:\n{consultation_data.ros}\n")

        if consultation_data.physical_exam:
            sections.append(f"PHYSICAL EXAMINATION:\n{consultation_data.physical_exam}\n")

        if consultation_data.assessment:
            sections.append(f"ASSESSMENT:\n{consultation_data.assessment}\n")

        if consultation_data.plan:
            sections.append(f"PLAN:\n{consultation_data.plan}\n")

        return "\n".join(sections)


# Add other workflow engines here as needed
class WardRoundEngine(BaseWorkflowEngine):
    """
    Business logic for ward round workflow
    Handles daily patient rounds for inpatient care
    """

    workflow_definition = WORKFLOW_DEFINITIONS[WorkflowType.WARD_ROUND]

    @staticmethod
    @transaction.atomic
    def start(user, patient_id, admission_id, initial_data=None) -> Dict[str, Any]:
        """
        Start a ward round for an admitted patient

        Args:
            user: User starting the workflow
            patient_id: PatientProfile ID (UUID)
            admission_id: Admission ID (UUID)
            initial_data: Optional initial context data

        Returns:
            Dictionary containing workflow and ward_round_data instances
        """
        try:
            patient = PatientProfile.objects.get(id=patient_id)
            admission = Admission.objects.select_related('bed__ward').get(
                id=admission_id,
                patient=patient,
                status='admitted'
            )
        except (PatientProfile.DoesNotExist, Admission.DoesNotExist) as e:
            raise ValueError(str(e))

        definition = WardRoundEngine.get_definition()

        # Prepare context data
        context_data = {
            'admission_id': str(admission_id),
            'ward_name': admission.bed.ward.name if admission.bed else None,
            'bed_number': admission.bed.bed_number if admission.bed else None,
            'admission_date': admission.admission_date.isoformat(),
            'prep_data': WardRoundEngine._load_prep_data(patient, admission),
        }

        if initial_data:
            context_data.update(initial_data)

        # Create workflow
        workflow = ClinicalWorkflow.objects.create(
            workflow_type=WorkflowType.WARD_ROUND,
            status=WorkflowStatus.IN_PROGRESS,
            user=user,
            patient=patient,
            current_step=1,
            total_steps=definition.total_steps,
            context_data=context_data,
        )

        # Create type-specific data model
        ward_round_data = WardRoundWorkflow.objects.create(workflow=workflow)

        logger.info(f"Started ward round workflow {workflow.id} for patient {patient_id}")

        return {
            'workflow': workflow,
            'ward_round_data': ward_round_data,
        }

    @staticmethod
    def _load_prep_data(patient, admission) -> Dict:
        """Load context data for ward round"""
        from apps.nursing.models import VitalSigns
        from datetime import timedelta

        # Get latest vitals (last 24 hours)
        latest_vitals = VitalSigns.objects.filter(
            patient=patient,
            recorded_at__gte=timezone.now() - timedelta(days=1)
        ).order_by('-recorded_at').first()

        # Calculate length of stay
        los_days = (timezone.now().date() - admission.admission_date.date()).days

        return {
            'patient_name': patient.user.get_full_name(),
            'mrn': patient.medical_record_number,
            'admission_days': los_days,
            'admission_reason': admission.admission_notes if hasattr(admission, 'admission_notes') else None,
            'latest_vitals': {
                'temperature': str(latest_vitals.temperature) if latest_vitals and latest_vitals.temperature else None,
                'blood_pressure': latest_vitals.blood_pressure if latest_vitals else None,
                'heart_rate': latest_vitals.heart_rate if latest_vitals else None,
                'respiratory_rate': latest_vitals.respiratory_rate if latest_vitals else None,
                'spo2': latest_vitals.spo2 if latest_vitals else None,
                'recorded_at': latest_vitals.recorded_at.isoformat() if latest_vitals else None,
            } if latest_vitals else {},
        }

    @staticmethod
    @transaction.atomic
    def update_step(workflow, step_number, step_data) -> ClinicalWorkflow:
        """Update ward round step data"""
        ward_round_data = workflow.ward_round_data

        # Update ward round specific fields
        for field, value in step_data.items():
            if hasattr(ward_round_data, field):
                setattr(ward_round_data, field, value)
        ward_round_data.save()

        # Update workflow
        workflow.context_data.update(step_data)
        workflow.mark_step_complete(step_number)
        if step_number < workflow.total_steps:
            workflow.advance_to_step(step_number + 1)
        workflow.save()

        logger.info(f"Updated ward round workflow {workflow.id} step {step_number}")

        return workflow

    @staticmethod
    @transaction.atomic
    def complete(workflow, final_data) -> Dict[str, Any]:
        """Complete ward round and create progress note"""
        ward_round_data = workflow.ward_round_data

        # Update final data
        for field, value in final_data.items():
            if hasattr(ward_round_data, field):
                setattr(ward_round_data, field, value)
        ward_round_data.save()

        # Create progress note
        note_content = f"""Ward Round - {workflow.patient.user.get_full_name()}

Date: {timezone.now().strftime('%Y-%m-%d %H:%M')}
Day {workflow.context_data.get('prep_data', {}).get('admission_days', 'N/A')} of admission

Overnight Events:
{ward_round_data.overnight_events or 'None reported'}

Nursing Concerns:
{ward_round_data.nursing_concerns or 'None'}

Examination Findings:
{ward_round_data.examination_findings}

Assessment:
{ward_round_data.assessment}

Plan:
{ward_round_data.plan_notes}
"""

        note = NoteEntry.objects.create(
            encounter_id=workflow.encounter_id,
            author=workflow.user,
            content=note_content,
            note_type='progress_note',
            title=f'Ward Round - {workflow.patient.user.get_full_name()}',
        )

        workflow.complete_workflow()

        logger.info(f"Completed ward round workflow {workflow.id}")

        return {
            'success': True,
            'workflow_id': str(workflow.id),
            'artifacts': [{'type': 'note', 'id': str(note.id)}],
        }


class AdmissionEngine(BaseWorkflowEngine):
    """
    Business logic for admission workflow
    Handles patient admissions with bed assignment
    """

    workflow_definition = WORKFLOW_DEFINITIONS[WorkflowType.ADMISSION]

    @staticmethod
    @transaction.atomic
    def start(user, patient_id, initial_data=None) -> Dict[str, Any]:
        """
        Start admission workflow

        Args:
            user: User starting the workflow
            patient_id: PatientProfile ID (UUID)
            initial_data: Optional initial context data

        Returns:
            Dictionary containing workflow and admission_data instances
        """
        try:
            patient = PatientProfile.objects.get(id=patient_id)
        except PatientProfile.DoesNotExist:
            raise ValueError(f"Patient with ID {patient_id} not found")

        definition = AdmissionEngine.get_definition()

        # Prepare context data
        context_data = {
            'patient_name': patient.user.get_full_name(),
            'mrn': patient.medical_record_number,
            'prep_data': AdmissionEngine._load_prep_data(patient),
        }

        if initial_data:
            context_data.update(initial_data)

        # Create workflow
        workflow = ClinicalWorkflow.objects.create(
            workflow_type=WorkflowType.ADMISSION,
            status=WorkflowStatus.IN_PROGRESS,
            user=user,
            patient=patient,
            current_step=1,
            total_steps=definition.total_steps,
            context_data=context_data,
        )

        # Create type-specific data model
        admission_data = AdmissionWorkflow.objects.create(workflow=workflow)

        logger.info(f"Started admission workflow {workflow.id} for patient {patient_id}")

        return {
            'workflow': workflow,
            'admission_data': admission_data,
        }

    @staticmethod
    def _load_prep_data(patient) -> Dict:
        """Load context data for admission"""
        return {
            'patient_name': patient.user.get_full_name(),
            'mrn': patient.medical_record_number,
            'dob': patient.user.date_of_birth.isoformat() if hasattr(patient.user, 'date_of_birth') and patient.user.date_of_birth else None,
        }

    @staticmethod
    @transaction.atomic
    def update_step(workflow, step_number, step_data) -> ClinicalWorkflow:
        """Update admission step data"""
        admission_data = workflow.admission_data

        # Update admission specific fields
        for field, value in step_data.items():
            if hasattr(admission_data, field):
                setattr(admission_data, field, value)
        admission_data.save()

        # Update workflow
        workflow.context_data.update(step_data)
        workflow.mark_step_complete(step_number)
        if step_number < workflow.total_steps:
            workflow.advance_to_step(step_number + 1)
        workflow.save()

        logger.info(f"Updated admission workflow {workflow.id} step {step_number}")

        return workflow

    @staticmethod
    @transaction.atomic
    def complete(workflow, final_data) -> Dict[str, Any]:
        """Complete admission and create admission record"""
        admission_data = workflow.admission_data

        # Update final data
        for field, value in final_data.items():
            if hasattr(admission_data, field):
                setattr(admission_data, field, value)
        admission_data.save()

        # Create Admission record
        admission = Admission.objects.create(
            patient=workflow.patient,
            admitting_doctor=workflow.user.practitionerprofile if hasattr(workflow.user, 'practitionerprofile') else None,
            ward_id=admission_data.ward_id,
            bed_id=admission_data.bed_id,
            admission_date=timezone.now(),
            admission_type=admission_data.admission_type,
            admission_notes=admission_data.admission_reason,
            status='admitted',
        )

        # Mark bed as occupied
        if admission_data.bed_id:
            try:
                bed = Bed.objects.get(id=admission_data.bed_id)
                bed.status = 'occupied'
                bed.save()
            except Bed.DoesNotExist:
                logger.warning(f"Bed {admission_data.bed_id} not found")

        # Create FHIR encounter
        encounter = EncounterProxy.create(
            patient_id=str(workflow.patient.fhir_patient_id),
            practitioner_id=str(workflow.user.practitionerprofile.fhir_practitioner_id) if hasattr(workflow.user, 'practitionerprofile') and workflow.user.practitionerprofile.fhir_practitioner_id else None,
            encounter_type='inpatient',
            reason=admission_data.admission_reason,
            start_date=timezone.now(),
        )

        workflow.encounter_id = encounter.get('id') if encounter else None

        # Create admission note
        note = NoteEntry.objects.create(
            encounter_id=workflow.encounter_id,
            author=workflow.user,
            content=admission_data.admission_note,
            note_type='admission',
            title=f'Admission Note - {workflow.patient.user.get_full_name()}',
        )

        workflow.complete_workflow()

        logger.info(f"Completed admission workflow {workflow.id}, created admission {admission.id}")

        return {
            'success': True,
            'workflow_id': str(workflow.id),
            'admission_id': str(admission.id),
            'artifacts': [
                {'type': 'encounter', 'id': workflow.encounter_id},
                {'type': 'admission_record', 'id': str(admission.id)},
                {'type': 'note', 'id': str(note.id)},
            ],
        }


class DischargeEngine(BaseWorkflowEngine):
    """
    Business logic for discharge workflow
    Handles patient discharges with medication reconciliation
    """

    workflow_definition = WORKFLOW_DEFINITIONS[WorkflowType.DISCHARGE]

    @staticmethod
    @transaction.atomic
    def start(user, patient_id, admission_id, initial_data=None) -> Dict[str, Any]:
        """
        Start discharge workflow

        Args:
            user: User starting the workflow
            patient_id: PatientProfile ID (UUID)
            admission_id: Admission ID (UUID)
            initial_data: Optional initial context data

        Returns:
            Dictionary containing workflow and discharge_data instances
        """
        try:
            patient = PatientProfile.objects.get(id=patient_id)
            admission = Admission.objects.select_related('bed__ward').get(
                id=admission_id,
                patient=patient,
                status='admitted'
            )
        except (PatientProfile.DoesNotExist, Admission.DoesNotExist) as e:
            raise ValueError(str(e))

        definition = DischargeEngine.get_definition()

        # Prepare context data
        context_data = {
            'admission_id': str(admission_id),
            'admission_date': admission.admission_date.isoformat(),
            'ward_name': admission.bed.ward.name if admission.bed else None,
            'prep_data': DischargeEngine._load_prep_data(patient, admission),
        }

        if initial_data:
            context_data.update(initial_data)

        # Create workflow
        workflow = ClinicalWorkflow.objects.create(
            workflow_type=WorkflowType.DISCHARGE,
            status=WorkflowStatus.IN_PROGRESS,
            user=user,
            patient=patient,
            current_step=1,
            total_steps=definition.total_steps,
            context_data=context_data,
        )

        # Create type-specific data model
        discharge_data = DischargeWorkflow.objects.create(workflow=workflow)

        logger.info(f"Started discharge workflow {workflow.id} for patient {patient_id}")

        return {
            'workflow': workflow,
            'discharge_data': discharge_data,
        }

    @staticmethod
    def _load_prep_data(patient, admission) -> Dict:
        """Load context data for discharge"""
        los_days = (timezone.now().date() - admission.admission_date.date()).days

        return {
            'patient_name': patient.user.get_full_name(),
            'mrn': patient.medical_record_number,
            'admission_days': los_days,
            'admission_date': admission.admission_date.isoformat(),
        }

    @staticmethod
    @transaction.atomic
    def update_step(workflow, step_number, step_data) -> ClinicalWorkflow:
        """Update discharge step data"""
        discharge_data = workflow.discharge_data

        # Update discharge specific fields
        for field, value in step_data.items():
            if hasattr(discharge_data, field):
                setattr(discharge_data, field, value)
        discharge_data.save()

        # Update workflow
        workflow.context_data.update(step_data)
        workflow.mark_step_complete(step_number)
        if step_number < workflow.total_steps:
            workflow.advance_to_step(step_number + 1)
        workflow.save()

        logger.info(f"Updated discharge workflow {workflow.id} step {step_number}")

        return workflow

    @staticmethod
    @transaction.atomic
    def complete(workflow, final_data) -> Dict[str, Any]:
        """Complete discharge and update admission record"""
        discharge_data = workflow.discharge_data

        # Update final data
        for field, value in final_data.items():
            if hasattr(discharge_data, field):
                setattr(discharge_data, field, value)
        discharge_data.save()

        # Update Admission record
        admission_id = workflow.context_data.get('admission_id')
        if admission_id:
            try:
                admission = Admission.objects.get(id=admission_id)
                admission.discharge_date = discharge_data.discharge_date or timezone.now()
                admission.status = 'discharged'
                admission.discharge_notes = discharge_data.discharge_summary
                admission.save()

                # Mark bed as available
                if admission.bed:
                    admission.bed.status = 'available'
                    admission.bed.save()

                logger.info(f"Updated admission {admission_id} to discharged status")
            except Admission.DoesNotExist:
                logger.warning(f"Admission {admission_id} not found")

        # Create discharge note
        note = NoteEntry.objects.create(
            encounter_id=workflow.encounter_id,
            author=workflow.user,
            content=discharge_data.discharge_summary,
            note_type='discharge',
            title=f'Discharge Summary - {workflow.patient.user.get_full_name()}',
        )

        workflow.complete_workflow()

        logger.info(f"Completed discharge workflow {workflow.id}")

        return {
            'success': True,
            'workflow_id': str(workflow.id),
            'admission_id': admission_id,
            'artifacts': [
                {'type': 'encounter_update', 'id': workflow.encounter_id},
                {'type': 'note', 'id': str(note.id)},
                {'type': 'discharge_record', 'id': admission_id},
            ],
        }


class ClinicalNoteEngine(BaseWorkflowEngine):
    """
    Business logic for clinical note workflow
    Handles creation of clinical notes with encounter generation
    """

    # Note type step configurations
    # Supports all ClinicalNoteType categories from models.py
    NOTE_TYPE_STEPS = {
        'progress': {
            'steps': ['chief_complaint', 'assessment', 'plan'],
            'total_steps': 3,
        },
        'soap': {
            'steps': ['subjective', 'objective', 'assessment', 'plan'],
            'total_steps': 4,
        },
        'procedure': {
            'steps': ['pre_procedure', 'procedure_details', 'post_procedure'],
            'total_steps': 3,
        },
        'phone': {
            'steps': ['caller_info', 'discussion', 'action_items'],
            'total_steps': 3,
        },
        'general': {
            'steps': ['chief_complaint', 'assessment', 'plan'],
            'total_steps': 3,
        },
        'admission': {
            'steps': ['presenting_complaint', 'history', 'examination', 'assessment', 'plan'],
            'total_steps': 5,
        },
        'discharge': {
            'steps': ['summary', 'diagnosis', 'medications', 'follow_up'],
            'total_steps': 4,
        },
        'nursing': {
            'steps': ['assessment', 'interventions', 'evaluation'],
            'total_steps': 3,
        },
        'consultation': {
            'steps': ['reason', 'findings', 'recommendations'],
            'total_steps': 3,
        },
        'custom': {
            'steps': ['content'],
            'total_steps': 1,
        },
    }

    @staticmethod
    @transaction.atomic
    def start(
        user,
        patient_id,
        note_type: str,
        initial_data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Initialize a new clinical note workflow

        Args:
            user: User starting the workflow
            patient_id: PatientProfile ID (UUID)
            note_type: Type of note (progress, soap, procedure, phone)
            initial_data: Optional initial context data

        Returns:
            Dictionary containing workflow and clinical_note_data instances
        """
        # Validate note type
        if note_type not in ClinicalNoteEngine.NOTE_TYPE_STEPS:
            raise ValueError(f"Invalid note type: {note_type}")

        # Get patient
        try:
            patient = PatientProfile.objects.get(id=patient_id)
        except PatientProfile.DoesNotExist:
            raise ValueError(f"Patient with ID {patient_id} not found")

        # Get step configuration
        step_config = ClinicalNoteEngine.NOTE_TYPE_STEPS[note_type]

        # Prepare initial context
        context_data = {
            'note_type': note_type,
            'steps': step_config['steps'],
            'prep_data': ClinicalNoteEngine._load_prep_data(patient),
        }

        if initial_data:
            context_data.update(initial_data)

        # Create workflow
        workflow = ClinicalWorkflow.objects.create(
            workflow_type=WorkflowType.CLINICAL_NOTE,
            status=WorkflowStatus.IN_PROGRESS,
            user=user,
            patient=patient,
            current_step=1,
            total_steps=step_config['total_steps'],
            context_data=context_data,
        )

        # Create clinical note-specific data
        clinical_note_data = ClinicalNoteWorkflow.objects.create(
            workflow=workflow,
            note_type=note_type,
        )

        logger.info(f"Started clinical note workflow {workflow.id} ({note_type}) for patient {patient.id}")

        return {
            'workflow': workflow,
            'clinical_note_data': clinical_note_data,
        }

    @staticmethod
    def _load_prep_data(patient: PatientProfile) -> Dict[str, Any]:
        """
        Load preparation data for clinical note
        """
        prep_data = {
            'patient_name': patient.user.get_full_name() if patient.user else 'Unknown',
            'patient_id': str(patient.id),
            'fhir_patient_id': patient.fhir_patient_id,
            'medical_record_number': getattr(patient, 'medical_record_number', 'N/A'),
        }
        return prep_data

    @staticmethod
    @transaction.atomic
    def update_step(
        workflow: ClinicalWorkflow,
        step_data: Dict[str, Any],
        next_step: Optional[int] = None,
        note_fields: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Update workflow step and optionally advance

        Args:
            workflow: The workflow instance
            step_data: Data for current step
            next_step: Optional next step number
            note_fields: Optional clinical note-specific fields to update

        Returns:
            Dictionary with updated workflow and clinical_note_data
        """
        # Update context data
        workflow.context_data.update(step_data)

        # Mark current step as completed
        if workflow.current_step not in workflow.steps_completed:
            workflow.mark_step_complete(workflow.current_step)

        # Advance to next step if specified
        if next_step and next_step <= workflow.total_steps:
            workflow.advance_to_step(next_step)

        workflow.save()

        # Update clinical note-specific fields if provided
        clinical_note_data = workflow.clinical_note_data
        if note_fields:
            for field, value in note_fields.items():
                if hasattr(clinical_note_data, field):
                    setattr(clinical_note_data, field, value)
            clinical_note_data.save()

        logger.info(f"Updated clinical note workflow {workflow.id} step to {workflow.current_step}")

        return {
            'workflow': workflow,
            'clinical_note_data': clinical_note_data,
        }

    @staticmethod
    @transaction.atomic
    def complete(
        workflow: ClinicalWorkflow,
        final_data: Dict[str, Any],
        encounter_type: str = 'outpatient',
        encounter_status: str = 'finished'
    ) -> Dict[str, Any]:
        """
        Complete clinical note workflow and generate artifacts

        Args:
            workflow: The workflow instance
            final_data: Final workflow data
            encounter_type: Type of encounter to create
            encounter_status: Status of encounter

        Returns:
            Dictionary with encounter_id and generated artifacts
        """
        context = workflow.context_data
        clinical_note_data = workflow.clinical_note_data

        # Update clinical note data with final_data if provided
        if final_data:
            for field, value in final_data.items():
                if hasattr(clinical_note_data, field):
                    setattr(clinical_note_data, field, value)
            clinical_note_data.save()

        # Create FHIR Encounter
        try:
            # Determine reason based on note type
            reason = ClinicalNoteEngine._get_encounter_reason(clinical_note_data, context)

            encounter = EncounterProxy.create(
                patient_id=workflow.patient.fhir_patient_id,
                practitioner_id=workflow.user.practitionerprofile.fhir_practitioner_id if hasattr(workflow.user, 'practitionerprofile') else None,
                encounter_type=encounter_type,
                status=encounter_status,
                reason=reason,
                service_type=context.get('service_type'),
                start_time=workflow.created_at,
            )

            encounter_id = encounter.get('id')
            logger.info(f"Created FHIR encounter {encounter_id} for clinical note workflow {workflow.id}")

        except Exception as e:
            logger.error(f"Failed to create encounter for workflow {workflow.id}: {str(e)}")
            raise

        # Create clinical note entry
        try:
            note_content = ClinicalNoteEngine._format_note_content(clinical_note_data, context)
            note_type_display = clinical_note_data.get_note_type_display()

            note = NoteEntry.objects.create(
                encounter_id=encounter_id,
                author=workflow.user,
                content=note_content,
                note_type=clinical_note_data.note_type,
                title=f'{note_type_display} - {workflow.patient.user.get_full_name()}',
            )

            logger.info(f"Created clinical note {note.id} for workflow {workflow.id}")

        except Exception as e:
            logger.error(f"Failed to create clinical note for workflow {workflow.id}: {str(e)}")
            note = None

        # Mark workflow complete
        workflow.encounter_id = encounter_id
        workflow.complete_workflow()

        artifacts = [
            {'type': 'encounter', 'id': encounter_id},
        ]

        if note:
            artifacts.append({'type': 'note', 'id': note.id})

        return {
            'success': True,
            'workflow_id': workflow.id,
            'encounter_id': encounter_id,
            'artifacts': artifacts,
        }

    @staticmethod
    def _get_encounter_reason(clinical_note_data: ClinicalNoteWorkflow, context: Dict) -> str:
        """
        Get reason for encounter based on note type
        """
        note_type = clinical_note_data.note_type

        if note_type == 'progress':
            return clinical_note_data.chief_complaint or 'Progress Note'
        elif note_type == 'soap':
            return clinical_note_data.chief_complaint or clinical_note_data.subjective or 'SOAP Note'
        elif note_type == 'procedure':
            return clinical_note_data.procedure_name or clinical_note_data.indication or 'Procedure'
        elif note_type == 'phone':
            return clinical_note_data.reason_for_call or 'Phone Note'
        else:
            return 'Clinical Note'

    @staticmethod
    def _format_note_content(clinical_note_data: ClinicalNoteWorkflow, context: Dict) -> str:
        """
        Format clinical note data into a note

        Args:
            clinical_note_data: ClinicalNoteWorkflow instance
            context: Workflow context data

        Returns:
            Formatted note content
        """
        note_type = clinical_note_data.note_type
        sections = []

        if note_type == 'progress':
            if clinical_note_data.chief_complaint:
                sections.append(f"CHIEF COMPLAINT:\n{clinical_note_data.chief_complaint}\n")
            if clinical_note_data.assessment:
                sections.append(f"ASSESSMENT:\n{clinical_note_data.assessment}\n")
            if clinical_note_data.plan:
                sections.append(f"PLAN:\n{clinical_note_data.plan}\n")
            if clinical_note_data.follow_up:
                sections.append(f"FOLLOW-UP:\n{clinical_note_data.follow_up}\n")
            if clinical_note_data.patient_education:
                sections.append(f"PATIENT EDUCATION:\n{clinical_note_data.patient_education}\n")

        elif note_type == 'soap':
            if clinical_note_data.chief_complaint:
                sections.append(f"CHIEF COMPLAINT:\n{clinical_note_data.chief_complaint}\n")
            if clinical_note_data.subjective or clinical_note_data.hpi:
                subjective_text = clinical_note_data.subjective or ''
                if clinical_note_data.hpi:
                    subjective_text += f"\n\nHPI: {clinical_note_data.hpi}"
                if clinical_note_data.ros:
                    subjective_text += f"\n\nROS: {clinical_note_data.ros}"
                sections.append(f"SUBJECTIVE:\n{subjective_text.strip()}\n")
            if clinical_note_data.objective or clinical_note_data.physical_exam:
                objective_text = clinical_note_data.objective or ''
                if clinical_note_data.vitals:
                    vitals = clinical_note_data.vitals
                    vitals_str = f"BP: {vitals.get('bp', 'N/A')}, HR: {vitals.get('hr', 'N/A')}, Temp: {vitals.get('temp', 'N/A')}, SpO2: {vitals.get('spo2', 'N/A')}"
                    objective_text = f"Vitals: {vitals_str}\n\n{objective_text}"
                if clinical_note_data.physical_exam:
                    objective_text += f"\n\nPHYSICAL EXAM:\n{clinical_note_data.physical_exam}"
                sections.append(f"OBJECTIVE:\n{objective_text.strip()}\n")
            if clinical_note_data.assessment:
                sections.append(f"ASSESSMENT:\n{clinical_note_data.assessment}\n")
            if clinical_note_data.plan:
                sections.append(f"PLAN:\n{clinical_note_data.plan}\n")

        elif note_type == 'procedure':
            sections.append(f"PROCEDURE: {clinical_note_data.procedure_name or 'Not specified'}\n")
            if clinical_note_data.indication:
                sections.append(f"INDICATION:\n{clinical_note_data.indication}\n")
            if clinical_note_data.consent:
                sections.append(f"CONSENT: {clinical_note_data.consent}\n")
            if clinical_note_data.pre_assessment:
                sections.append(f"PRE-PROCEDURE ASSESSMENT:\n{clinical_note_data.pre_assessment}\n")
            if clinical_note_data.anesthesia:
                sections.append(f"ANESTHESIA: {clinical_note_data.anesthesia}\n")
            if clinical_note_data.technique:
                sections.append(f"TECHNIQUE:\n{clinical_note_data.technique}\n")
            if clinical_note_data.specimens:
                sections.append(f"SPECIMENS: {clinical_note_data.specimens}\n")
            if clinical_note_data.ebl:
                sections.append(f"EBL: {clinical_note_data.ebl}\n")
            if clinical_note_data.complications:
                sections.append(f"COMPLICATIONS: {clinical_note_data.complications}")
                if clinical_note_data.complication_details:
                    sections[-1] += f"\n{clinical_note_data.complication_details}"
                sections[-1] += "\n"
            if clinical_note_data.patient_condition:
                sections.append(f"POST-PROCEDURE CONDITION:\n{clinical_note_data.patient_condition}\n")
            if clinical_note_data.disposition:
                sections.append(f"DISPOSITION: {clinical_note_data.disposition}\n")
            if clinical_note_data.post_instructions:
                sections.append(f"POST-PROCEDURE INSTRUCTIONS:\n{clinical_note_data.post_instructions}\n")
            if clinical_note_data.follow_up:
                sections.append(f"FOLLOW-UP:\n{clinical_note_data.follow_up}\n")

        elif note_type == 'phone':
            if clinical_note_data.caller_name:
                sections.append(f"CALLER: {clinical_note_data.caller_name}")
                if clinical_note_data.caller_relationship:
                    sections[-1] += f" ({clinical_note_data.caller_relationship})"
                sections[-1] += "\n"
            if clinical_note_data.callback_number:
                sections.append(f"CALLBACK NUMBER: {clinical_note_data.callback_number}\n")
            if clinical_note_data.reason_for_call:
                sections.append(f"REASON FOR CALL:\n{clinical_note_data.reason_for_call}\n")
            if clinical_note_data.symptoms_discussed:
                sections.append(f"SYMPTOMS/CONCERNS DISCUSSED:\n{clinical_note_data.symptoms_discussed}\n")
            if clinical_note_data.advice_given:
                sections.append(f"ADVICE/RECOMMENDATIONS:\n{clinical_note_data.advice_given}\n")
            if clinical_note_data.urgency:
                sections.append(f"CLINICAL URGENCY: {clinical_note_data.urgency}\n")
            if clinical_note_data.actions_taken:
                sections.append(f"ACTIONS TAKEN:\n{clinical_note_data.actions_taken}\n")
            if clinical_note_data.pending_actions:
                sections.append(f"PENDING ACTIONS:\n{clinical_note_data.pending_actions}\n")
            if clinical_note_data.follow_up:
                sections.append(f"FOLLOW-UP PLAN:\n{clinical_note_data.follow_up}\n")
            if clinical_note_data.callback_needed:
                sections.append(f"CALLBACK NEEDED: {clinical_note_data.callback_needed}\n")

        return "\n".join(sections) if sections else "No content documented."
