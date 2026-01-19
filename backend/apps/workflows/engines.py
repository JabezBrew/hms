"""
Workflow engines - Business logic for clinical workflows
"""
from django.db import transaction
from django.utils import timezone
from typing import Dict, Any, Optional, List
import logging
from apps.organization.services import UnitHierarchyService

def _extract_string_value(value, preferred_keys=None) -> str:
    """
    Extract a string value from a field that may be a string or dict.
    Used to safely get string values for FHIR resources.

    Args:
        value: The field value (string or dict)
        preferred_keys: List of keys to try if value is a dict

    Returns:
        A string representation of the value
    """
    if not value:
        return ''

    if isinstance(value, str):
        return value

    if isinstance(value, dict):
        # Try preferred keys first
        if preferred_keys:
            for key in preferred_keys:
                if key in value and value[key]:
                    return str(value[key])

        # Fall back to first non-empty string value
        for v in value.values():
            if v and isinstance(v, str):
                return v

        # Last resort: join all string values
        parts = [str(v) for v in value.values() if v]
        return '; '.join(parts) if parts else ''

    return str(value)


from .models import (
    ClinicalWorkflow, ConsultationWorkflow, ClinicalNoteWorkflow,
    WardRoundWorkflow, AdmissionWorkflow, DischargeWorkflow,
    WorkflowStatus, WorkflowType, ClinicalNoteType
)
from .definitions import WorkflowDefinition, WorkflowStepDefinition
from .registry import get_workflow_definition, WORKFLOW_DEFINITIONS
from apps.users.models import PatientProfile
from apps.wards.models import Admission, Ward, Bed
from apps.encounters.proxies import EncounterProxy
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
        from apps.clinical_notes.models import NoteTemplate
        from apps.users.models import PractitionerProfile
        from apps.encounters.services import get_or_create_active_encounter

        context = workflow.context_data
        consultation_data = workflow.consultation_data

        # Get practitioner profile
        practitioner = None
        if hasattr(workflow.user, 'practitionerprofile'):
            practitioner = workflow.user.practitionerprofile
        elif hasattr(workflow.user, 'staff') and workflow.user.staff:
            practitioner = getattr(workflow.user.staff, 'practitioner_profile', None)

        if not practitioner:
            try:
                practitioner = PractitionerProfile.objects.get(staff__user=workflow.user)
            except PractitionerProfile.DoesNotExist:
                logger.warning(f"No practitioner profile found for user {workflow.user.id}")
                practitioner = None

        # Get reason for encounter
        reason = _extract_string_value(
            consultation_data.chief_complaint or context.get('chief_complaint', ''),
            ['chief_complaint']
        )

        # Get or create Django Encounter (local model)
        encounter, encounter_created = get_or_create_active_encounter(
            patient=workflow.patient,
            practitioner=practitioner,
            encounter_type=encounter_type,
            reason=reason
        )

        logger.info(f"{'Created' if encounter_created else 'Found existing'} encounter {encounter.id} for workflow {workflow.id}")

        # Create clinical note if we have a practitioner
        note = None
        if practitioner:
            try:
                # Get or create a consultation template
                template = NoteTemplate.objects.filter(
                    category='consultation',
                    is_active=True
                ).first()

                if not template:
                    # Create a default consultation template if none exists
                    template = NoteTemplate.objects.create(
                        title='Consultation Note',
                        category='consultation',
                        visibility='public',
                        is_active=True,
                        structure={
                            'sections': [
                                {'name': 'Chief Complaint', 'type': 'text'},
                                {'name': 'History of Present Illness', 'type': 'text'},
                                {'name': 'Review of Systems', 'type': 'text'},
                                {'name': 'Physical Examination', 'type': 'text'},
                                {'name': 'Assessment', 'type': 'text'},
                                {'name': 'Plan', 'type': 'text'},
                            ]
                        }
                    )
                    logger.info(f"Created default consultation template {template.id}")

                # Build note data from consultation fields
                note_data = {
                    'Chief Complaint': _extract_string_value(consultation_data.chief_complaint, ['chief_complaint']),
                    'History of Present Illness': _extract_string_value(consultation_data.hpi, ['hpi']),
                    'Review of Systems': _extract_string_value(consultation_data.ros, ['ros']),
                    'Physical Examination': _extract_string_value(consultation_data.physical_exam, ['physical_exam']),
                    'Assessment': _extract_string_value(consultation_data.assessment, ['assessment']),
                    'Plan': _extract_string_value(consultation_data.plan, ['plan']),
                }

                note = NoteEntry.objects.create(
                    template=template,
                    patient=workflow.patient,
                    encounter=encounter,
                    practitioner=practitioner,
                    data=note_data,
                )

                logger.info(f"Created clinical note {note.id} for workflow {workflow.id}")

            except Exception as e:
                logger.error(f"Failed to create clinical note for workflow {workflow.id}: {str(e)}")
                # Don't fail the workflow if note creation fails

        # Mark workflow complete
        workflow.encounter_id = str(encounter.id)
        workflow.complete_workflow()

        artifacts = [
            {'type': 'encounter', 'id': str(encounter.id)},
        ]

        if note:
            artifacts.append({'type': 'note', 'id': str(note.id)})

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
        """Complete ward round, create progress note, and process orders"""
        from apps.clinical_notes.models import NoteTemplate, Prescription
        from apps.users.models import PractitionerProfile
        from apps.encounters.services import get_or_create_active_encounter
        from apps.laboratory.models import (
            LabOrder, LabOrderTest, LabTestCatalog,
            LabOrderPriority, LabOrderStatus
        )

        ward_round_data = workflow.ward_round_data

        # Extract orders_placed before setting attributes
        orders_placed = final_data.get('orders_placed', {}) if isinstance(final_data, dict) else {}

        # Update final data
        for field, value in final_data.items():
            if field == 'orders_placed':
                continue
            if hasattr(ward_round_data, field):
                setattr(ward_round_data, field, value)
        ward_round_data.save()

        # Get practitioner profile
        practitioner = None
        if hasattr(workflow.user, 'practitionerprofile'):
            practitioner = workflow.user.practitionerprofile
        elif hasattr(workflow.user, 'staff') and workflow.user.staff:
            practitioner = getattr(workflow.user.staff, 'practitioner_profile', None)

        if not practitioner:
            try:
                practitioner = PractitionerProfile.objects.get(staff__user=workflow.user)
            except PractitionerProfile.DoesNotExist:
                logger.warning(f"No practitioner profile found for user {workflow.user.id}")
                practitioner = None

        # Get or create encounter for the ward round
        encounter, _ = get_or_create_active_encounter(
            patient=workflow.patient,
            practitioner=practitioner,
            encounter_type='inpatient',
            reason='Ward Round'
        )

        # Create progress note with proper model fields
        note = None
        if practitioner:
            try:
                # Get or create a progress note template
                template = NoteTemplate.objects.filter(
                    category='progress',
                    is_active=True
                ).first()

                if not template:
                    template = NoteTemplate.objects.create(
                        title='Progress Note',
                        category='progress',
                        visibility='public',
                        is_active=True,
                        structure={
                            'sections': [
                                {'name': 'Overnight Events', 'type': 'text'},
                                {'name': 'Nursing Concerns', 'type': 'text'},
                                {'name': 'Examination Findings', 'type': 'text'},
                                {'name': 'Assessment', 'type': 'text'},
                                {'name': 'Plan', 'type': 'text'},
                            ]
                        }
                    )
                    logger.info(f"Created default progress note template {template.id}")

                # Build note data
                note_data = {
                    'Overnight Events': ward_round_data.overnight_events or 'None reported',
                    'Nursing Concerns': ward_round_data.nursing_concerns or 'None',
                    'Examination Findings': ward_round_data.examination_findings or '',
                    'Assessment': ward_round_data.assessment or '',
                    'Plan': ward_round_data.plan_notes or '',
                    '_metadata': {
                        'admission_days': workflow.context_data.get('prep_data', {}).get('admission_days', 'N/A'),
                        'date': timezone.now().strftime('%Y-%m-%d %H:%M'),
                    }
                }

                note = NoteEntry.objects.create(
                    template=template,
                    patient=workflow.patient,
                    encounter=encounter,
                    practitioner=practitioner,
                    data=note_data,
                )

                logger.info(f"Created ward round note {note.id} for workflow {workflow.id}")

            except Exception as e:
                logger.error(f"Failed to create ward round note for workflow {workflow.id}: {str(e)}")

        workflow.encounter_id = str(encounter.id)
        workflow.complete_workflow()

        logger.info(f"Completed ward round workflow {workflow.id}")

        artifacts = [{'type': 'encounter', 'id': str(encounter.id)}]
        if note:
            artifacts.append({'type': 'note', 'id': str(note.id)})

        # Process orders if any
        orders_created = []

        # Process medication orders (prescriptions)
        medications = orders_placed.get('medications', [])
        facility = encounter.facility if encounter and encounter.facility_id else workflow.patient.facility
        for med_order in medications:
            if not practitioner:
                logger.warning(
                    f"Skipping prescription for ward round {workflow.id}: missing practitioner"
                )
                continue
            try:
                prescription = Prescription.objects.create(
                    patient=workflow.patient,
                    facility=facility,
                    encounter=encounter,
                    prescribed_by=practitioner,
                    medication_name=med_order.get('medication_name', ''),
                    dosage=med_order.get('dosage', ''),
                    route=med_order.get('route', 'oral'),
                    frequency=med_order.get('frequency', ''),
                    instructions=med_order.get('instructions', ''),
                    status='active',
                )
                orders_created.append({'type': 'prescription', 'id': str(prescription.id)})
                logger.info(f"Created prescription {prescription.id} from ward round {workflow.id}")
            except Exception as e:
                logger.error(f"Failed to create prescription from ward round {workflow.id}: {str(e)}")

        # Process lab orders
        labs = orders_placed.get('labs', [])
        if labs:
            if not practitioner:
                logger.warning(
                    f"Skipping lab orders for ward round {workflow.id}: missing practitioner"
                )
            else:
                try:
                    # Resolve valid tests before creating lab order
                    resolved_tests = []
                    has_stat = False
                    for lab in labs:
                        test_code = lab.get('test_code', '')
                        test_name = lab.get('test_name', test_code)
                        urgency = lab.get('urgency', 'routine')

                        catalog_test = LabTestCatalog.objects.filter(code=test_code, facility=facility).first()
                        if not catalog_test:
                            logger.warning(
                                f"Skipping lab test '{test_code}' for ward round {workflow.id}: not found in catalog"
                            )
                            continue

                        resolved_tests.append({
                            'test': catalog_test,
                            'notes': test_name if test_name and test_name != catalog_test.name else '',
                        })
                        if urgency == 'stat':
                            has_stat = True

                    if not resolved_tests:
                        logger.warning(
                            f"No valid lab tests found for ward round {workflow.id}; lab order skipped"
                        )
                    else:
                        lab_order = LabOrder.objects.create(
                            patient=workflow.patient,
                            facility=facility,
                            encounter=encounter,
                            ordering_provider=practitioner,
                            clinical_notes=f"Ward round order - Day {workflow.context_data.get('prep_data', {}).get('admission_days', 'N/A')}",
                            priority=LabOrderPriority.STAT if has_stat else LabOrderPriority.ROUTINE,
                            status=LabOrderStatus.ORDERED,
                        )
                        for resolved in resolved_tests:
                            LabOrderTest.objects.create(
                                order=lab_order,
                                facility=facility,
                                test=resolved['test'],
                                status=LabOrderStatus.ORDERED,
                                notes=resolved['notes'],
                            )
                        orders_created.append({'type': 'lab_order', 'id': str(lab_order.id)})
                        logger.info(
                            f"Created lab order {lab_order.id} with {len(resolved_tests)} tests from ward round {workflow.id}"
                        )
                except Exception as e:
                    logger.error(f"Failed to create lab orders from ward round {workflow.id}: {str(e)}")

        # Nursing orders are stored in the note but not as separate entities for now
        nursing_orders = orders_placed.get('nursing', [])
        if nursing_orders:
            logger.info(f"Ward round {workflow.id} includes {len(nursing_orders)} nursing orders (documented in note)")

        return {
            'success': True,
            'workflow_id': str(workflow.id),
            'encounter_id': str(encounter.id),
            'note_id': str(note.id) if note else None,
            'artifacts': artifacts,
            'orders_created': orders_created,
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
        from apps.clinical_notes.models import NoteTemplate
        from apps.users.models import PractitionerProfile
        from apps.encounters.models import Encounter

        admission_data = workflow.admission_data

        # Update final data
        for field, value in final_data.items():
            if hasattr(admission_data, field):
                setattr(admission_data, field, value)
        admission_data.save()

        # Get practitioner profile
        practitioner = None
        if hasattr(workflow.user, 'practitionerprofile'):
            practitioner = workflow.user.practitionerprofile
        elif hasattr(workflow.user, 'staff') and workflow.user.staff:
            practitioner = getattr(workflow.user.staff, 'practitioner_profile', None)

        if not practitioner:
            try:
                practitioner = PractitionerProfile.objects.get(staff__user=workflow.user)
            except PractitionerProfile.DoesNotExist:
                logger.warning(f"No practitioner profile found for user {workflow.user.id}")
                practitioner = None

        # Try to get admitting practitioner from duty roster based on ward
        admitting_practitioner = practitioner
        primary_team = None
        if admission_data.ward_id:
            try:
                from apps.organization.services import DutyRosterService
                from apps.organization.models import UnitWardAllocation

                ward = Bed.objects.get(id=admission_data.bed_id).ward if admission_data.bed_id else None
                if ward:
                    unit_allocation = UnitWardAllocation.objects.filter(
                        ward=ward, is_active=True
                    ).select_related('unit').first()

                    if unit_allocation:
                        roster_practitioner = DutyRosterService.get_admitting_practitioner(
                            unit=unit_allocation.unit
                        )
                        if roster_practitioner:
                            admitting_practitioner = roster_practitioner
                            logger.info(f"Assigned admission to on-duty practitioner {roster_practitioner}")
                        primary_team = unit_allocation.unit
            except Exception as e:
                logger.warning(f"Could not get duty roster practitioner: {e}")

        # Create Admission record
        admission = Admission.objects.create(
            patient=workflow.patient,
            admitting_doctor=admitting_practitioner,
            primary_team=primary_team,
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

        # Create local Django Encounter for the admission
        reason = _extract_string_value(
            admission_data.admission_reason,
            ['admission_reason', 'reason', 'chief_complaint']
        )

        department_unit = None
        if admission.bed and admission.bed.ward and admission.bed.ward.department:
            department_unit = UnitHierarchyService.get_department_unit_for_core_department(
                admission.bed.ward.department,
                facility=workflow.patient.facility
            )

        encounter = Encounter.objects.create(
            patient=workflow.patient,
            facility=workflow.patient.facility,
            practitioner=admitting_practitioner,
            department=department_unit,
            encounter_type='inpatient',
            status='in-progress',
            start_time=timezone.now(),
            reason=reason,
            admission=admission,
        )
        from apps.organization.services import TeamAssignmentService
        TeamAssignmentService.assign_initial_team(
            encounter=encounter,
            team=primary_team,
            use_duty_roster=True,
            context='inpatient'
        )
        if admission.bed:
            TeamAssignmentService.reassign_team_on_bed_assignment(
                encounter=encounter,
                bed=admission.bed
            )

        workflow.encounter_id = str(encounter.id)

        # Create admission note with proper model fields
        note = None
        if practitioner:
            try:
                # Get or create an admission template
                template = NoteTemplate.objects.filter(
                    category='admission',
                    is_active=True
                ).first()

                if not template:
                    template = NoteTemplate.objects.create(
                        title='Admission Note',
                        category='admission',
                        visibility='public',
                        is_active=True,
                        structure={
                            'sections': [
                                {'name': 'Admission Reason', 'type': 'text'},
                                {'name': 'History of Present Illness', 'type': 'text'},
                                {'name': 'Past Medical History', 'type': 'text'},
                                {'name': 'Physical Examination', 'type': 'text'},
                                {'name': 'Assessment and Plan', 'type': 'text'},
                            ]
                        }
                    )
                    logger.info(f"Created default admission template {template.id}")

                # Build note data
                note_data = {
                    'Admission Reason': reason,
                    'Admission Note': admission_data.admission_note or '',
                    '_metadata': {
                        'ward': str(admission_data.ward_id) if admission_data.ward_id else None,
                        'bed': str(admission_data.bed_id) if admission_data.bed_id else None,
                        'admission_type': admission_data.admission_type,
                    }
                }

                note = NoteEntry.objects.create(
                    template=template,
                    patient=workflow.patient,
                    encounter=encounter,
                    practitioner=practitioner,
                    data=note_data,
                )

                logger.info(f"Created admission note {note.id} for workflow {workflow.id}")

            except Exception as e:
                logger.error(f"Failed to create admission note for workflow {workflow.id}: {str(e)}")

        workflow.complete_workflow()

        logger.info(f"Completed admission workflow {workflow.id}, created admission {admission.id}")

        artifacts = [
            {'type': 'encounter', 'id': str(encounter.id)},
            {'type': 'admission_record', 'id': str(admission.id)},
        ]
        if note:
            artifacts.append({'type': 'note', 'id': str(note.id)})

        return {
            'success': True,
            'workflow_id': str(workflow.id),
            'admission_id': str(admission.id),
            'encounter_id': str(encounter.id),
            'artifacts': artifacts,
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
        from apps.clinical_notes.models import NoteTemplate
        from apps.users.models import PractitionerProfile
        from apps.encounters.services import get_or_create_active_encounter

        discharge_data = workflow.discharge_data

        # Update final data
        for field, value in final_data.items():
            if hasattr(discharge_data, field):
                setattr(discharge_data, field, value)
        discharge_data.save()

        # Get practitioner profile
        practitioner = None
        if hasattr(workflow.user, 'practitionerprofile'):
            practitioner = workflow.user.practitionerprofile
        elif hasattr(workflow.user, 'staff') and workflow.user.staff:
            practitioner = getattr(workflow.user.staff, 'practitioner_profile', None)

        if not practitioner:
            try:
                practitioner = PractitionerProfile.objects.get(staff__user=workflow.user)
            except PractitionerProfile.DoesNotExist:
                logger.warning(f"No practitioner profile found for user {workflow.user.id}")
                practitioner = None

        # Update Admission record
        admission_id = workflow.context_data.get('admission_id')
        admission = None
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

        # Get or create encounter
        encounter, _ = get_or_create_active_encounter(
            patient=workflow.patient,
            practitioner=practitioner,
            encounter_type='inpatient',
            reason='Discharge'
        )

        # Update encounter status to finished
        encounter.status = 'finished'
        encounter.end_time = timezone.now()
        encounter.discharge_disposition = discharge_data.discharge_disposition if hasattr(discharge_data, 'discharge_disposition') else None
        encounter.save()

        # Create discharge note with proper model fields
        note = None
        if practitioner:
            try:
                # Get or create a discharge template
                template = NoteTemplate.objects.filter(
                    category='discharge',
                    is_active=True
                ).first()

                if not template:
                    template = NoteTemplate.objects.create(
                        title='Discharge Summary',
                        category='discharge',
                        visibility='public',
                        is_active=True,
                        structure={
                            'sections': [
                                {'name': 'Hospital Course', 'type': 'text'},
                                {'name': 'Discharge Diagnosis', 'type': 'text'},
                                {'name': 'Discharge Medications', 'type': 'text'},
                                {'name': 'Follow-up Instructions', 'type': 'text'},
                            ]
                        }
                    )
                    logger.info(f"Created default discharge template {template.id}")

                # Build note data
                note_data = {
                    'Discharge Summary': discharge_data.discharge_summary or '',
                    'Follow-up Instructions': discharge_data.follow_up_instructions or '' if hasattr(discharge_data, 'follow_up_instructions') else '',
                    '_metadata': {
                        'discharge_date': (discharge_data.discharge_date or timezone.now()).isoformat() if discharge_data.discharge_date else timezone.now().isoformat(),
                        'admission_id': str(admission_id) if admission_id else None,
                    }
                }

                note = NoteEntry.objects.create(
                    template=template,
                    patient=workflow.patient,
                    encounter=encounter,
                    practitioner=practitioner,
                    data=note_data,
                )

                logger.info(f"Created discharge note {note.id} for workflow {workflow.id}")

            except Exception as e:
                logger.error(f"Failed to create discharge note for workflow {workflow.id}: {str(e)}")

        workflow.encounter_id = str(encounter.id)
        workflow.complete_workflow()

        logger.info(f"Completed discharge workflow {workflow.id}")

        artifacts = [
            {'type': 'encounter_update', 'id': str(encounter.id)},
            {'type': 'discharge_record', 'id': admission_id},
        ]
        if note:
            artifacts.append({'type': 'note', 'id': str(note.id)})

        return {
            'success': True,
            'workflow_id': str(workflow.id),
            'admission_id': admission_id,
            'encounter_id': str(encounter.id),
            'artifacts': artifacts,
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
        encounter_status: str = 'finished',
        template_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Complete clinical note workflow and generate artifacts

        Args:
            workflow: The workflow instance
            final_data: Final workflow data
            encounter_type: Type of encounter to create
            encounter_status: Status of encounter
            template_id: UUID of the template to use for the note

        Returns:
            Dictionary with encounter_id and generated artifacts
        """
        from apps.clinical_notes.models import NoteTemplate
        from apps.users.models import PractitionerProfile
        from apps.encounters.services import get_or_create_active_encounter

        context = workflow.context_data
        clinical_note_data = workflow.clinical_note_data

        # Update clinical note data with final_data if provided
        if final_data:
            for field, value in final_data.items():
                if hasattr(clinical_note_data, field):
                    setattr(clinical_note_data, field, value)
            clinical_note_data.save()

        # Get template_id from parameter or context
        if not template_id:
            template_id = context.get('template_id')

        # Get template
        template = None
        if template_id:
            template = NoteTemplate.objects.filter(id=template_id).first()

        if not template:
            logger.error(f"No template found for workflow {workflow.id}, template_id={template_id}")
            raise ValueError("Template is required to create a clinical note")

        # Get practitioner profile
        practitioner = None
        if hasattr(workflow.user, 'practitionerprofile'):
            practitioner = workflow.user.practitionerprofile
        elif hasattr(workflow.user, 'staff') and workflow.user.staff:
            practitioner = getattr(workflow.user.staff, 'practitioner_profile', None)

        if not practitioner:
            # Try to get or create practitioner profile
            try:
                practitioner = PractitionerProfile.objects.get(staff__user=workflow.user)
            except PractitionerProfile.DoesNotExist:
                logger.error(f"No practitioner profile found for user {workflow.user.id}")
                raise ValueError("User must have a practitioner profile to create clinical notes")

        # Get or create Django Encounter (local model, not just FHIR ID)
        reason = ClinicalNoteEngine._get_encounter_reason(clinical_note_data, context)
        encounter, encounter_created = get_or_create_active_encounter(
            patient=workflow.patient,
            practitioner=practitioner,
            encounter_type=encounter_type,
            reason=reason
        )

        logger.info(f"{'Created' if encounter_created else 'Found existing'} encounter {encounter.id} for clinical note workflow {workflow.id}")

        # Build note data from final_data (which contains the actual form data)
        # The final_data is structured by step IDs from the template
        note_data = final_data if final_data else {}

        # Create clinical note entry with correct model fields
        try:
            note = NoteEntry.objects.create(
                template=template,
                patient=workflow.patient,
                encounter=encounter,
                practitioner=practitioner,
                data=note_data,
            )

            logger.info(f"Created clinical note {note.id} for workflow {workflow.id}")

        except Exception as e:
            logger.error(f"Failed to create clinical note for workflow {workflow.id}: {str(e)}")
            raise  # Re-raise instead of silently continuing

        # Mark workflow complete
        workflow.encounter_id = str(encounter.id)
        workflow.complete_workflow()

        artifacts = [
            {'type': 'encounter', 'id': str(encounter.id)},
            {'type': 'note', 'id': str(note.id)},
        ]

        return {
            'success': True,
            'workflow_id': str(workflow.id),
            'encounter_id': str(encounter.id),
            'note_id': str(note.id),
            'artifacts': artifacts,
        }

    @staticmethod
    def _get_encounter_reason(clinical_note_data: ClinicalNoteWorkflow, context: Dict) -> str:
        """
        Get reason for encounter based on note type.
        Handles both string and dict field values.
        """
        note_type = clinical_note_data.note_type

        if note_type == 'progress':
            reason = _extract_string_value(
                clinical_note_data.chief_complaint,
                ['chief_complaint']
            )
            return reason or 'Progress Note'
        elif note_type == 'soap':
            reason = _extract_string_value(
                clinical_note_data.chief_complaint,
                ['chief_complaint']
            ) or _extract_string_value(
                clinical_note_data.subjective,
                ['chief_complaint', 'history_of_present_illness', 'hpi']
            )
            return reason or 'SOAP Note'
        elif note_type == 'procedure':
            reason = _extract_string_value(
                clinical_note_data.procedure_name
            ) or _extract_string_value(
                clinical_note_data.indication
            )
            return reason or 'Procedure'
        elif note_type == 'phone':
            reason = _extract_string_value(
                clinical_note_data.reason_for_call,
                ['reason_for_call', 'reason']
            )
            return reason or 'Phone Note'
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
