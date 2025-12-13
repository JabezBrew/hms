"""
Workflow test factories.

Factory classes for creating workflow test data.
"""
import factory
from datetime import date, timedelta
from django.utils import timezone

from apps.workflows.models import (
    ClinicalWorkflow, ConsultationWorkflow, ClinicalNoteWorkflow,
    WardRoundWorkflow, AdmissionWorkflow, DischargeWorkflow,
    WorkflowTemplate, WorkflowType, WorkflowStatus, ClinicalNoteType
)
from apps.users.tests.factories import (
    UserFactory, PatientProfileFactory, DoctorUserFactory
)


class ClinicalWorkflowFactory(factory.django.DjangoModelFactory):
    """Factory for ClinicalWorkflow model."""

    class Meta:
        model = ClinicalWorkflow

    workflow_type = WorkflowType.CONSULTATION
    status = WorkflowStatus.DRAFT
    user = factory.SubFactory(DoctorUserFactory)
    patient = factory.SubFactory(PatientProfileFactory)
    encounter_id = None
    current_step = 1
    total_steps = 5
    steps_completed = factory.LazyFunction(list)
    context_data = factory.LazyFunction(dict)


class InProgressWorkflowFactory(ClinicalWorkflowFactory):
    """Factory for in-progress workflows."""

    status = WorkflowStatus.IN_PROGRESS
    current_step = 2
    steps_completed = [1]


class CompletedWorkflowFactory(ClinicalWorkflowFactory):
    """Factory for completed workflows."""

    status = WorkflowStatus.COMPLETED
    current_step = 5
    steps_completed = [1, 2, 3, 4, 5]
    completed_at = factory.LazyFunction(timezone.now)


class CancelledWorkflowFactory(ClinicalWorkflowFactory):
    """Factory for cancelled workflows."""

    status = WorkflowStatus.CANCELLED


class ConsultationWorkflowFactory(factory.django.DjangoModelFactory):
    """Factory for ConsultationWorkflow model."""

    class Meta:
        model = ConsultationWorkflow

    workflow = factory.SubFactory(
        ClinicalWorkflowFactory,
        workflow_type=WorkflowType.CONSULTATION,
        total_steps=5
    )
    appointment_id = factory.Sequence(lambda n: f'appointment-{n}')
    chief_complaint = factory.Faker('sentence')
    hpi = factory.Faker('paragraph')
    ros = factory.Faker('paragraph')
    physical_exam = factory.Faker('paragraph')
    assessment = factory.Faker('paragraph')
    plan = factory.Faker('paragraph')
    template_used = ''


class CompletedConsultationWorkflowFactory(ConsultationWorkflowFactory):
    """Factory for completed consultation workflows."""

    workflow = factory.SubFactory(
        CompletedWorkflowFactory,
        workflow_type=WorkflowType.CONSULTATION,
        total_steps=5
    )


class ClinicalNoteWorkflowFactory(factory.django.DjangoModelFactory):
    """Factory for ClinicalNoteWorkflow model."""

    class Meta:
        model = ClinicalNoteWorkflow

    workflow = factory.SubFactory(
        ClinicalWorkflowFactory,
        workflow_type=WorkflowType.CLINICAL_NOTE,
        total_steps=3
    )
    note_type = ClinicalNoteType.PROGRESS
    chief_complaint = factory.Faker('sentence')
    assessment = factory.Faker('paragraph')
    plan = factory.Faker('paragraph')


class SOAPNoteWorkflowFactory(ClinicalNoteWorkflowFactory):
    """Factory for SOAP note workflows."""

    workflow = factory.SubFactory(
        ClinicalWorkflowFactory,
        workflow_type=WorkflowType.CLINICAL_NOTE,
        total_steps=4
    )
    note_type = ClinicalNoteType.SOAP
    subjective = factory.Faker('paragraph')
    objective = factory.Faker('paragraph')
    hpi = factory.Faker('paragraph')
    ros = factory.Faker('paragraph')
    physical_exam = factory.Faker('paragraph')
    vitals = factory.LazyFunction(lambda: {
        'bp': '120/80',
        'hr': 72,
        'temp': 37.0,
        'spo2': 98
    })


class ProcedureNoteWorkflowFactory(ClinicalNoteWorkflowFactory):
    """Factory for procedure note workflows."""

    note_type = ClinicalNoteType.PROCEDURE
    procedure_name = factory.Faker('sentence', nb_words=3)
    indication = factory.Faker('sentence')
    consent = 'Obtained'
    pre_assessment = factory.Faker('paragraph')
    anesthesia = 'Local'
    technique = factory.Faker('paragraph')
    specimens = 'None'
    ebl = 'Minimal'
    complications = 'None'
    patient_condition = 'Stable'
    disposition = 'Home'


class PhoneNoteWorkflowFactory(ClinicalNoteWorkflowFactory):
    """Factory for phone note workflows."""

    note_type = ClinicalNoteType.PHONE
    caller_name = factory.Faker('name')
    caller_relationship = 'Self'
    callback_number = factory.Faker('numerify', text='###-###-####')
    reason_for_call = factory.Faker('sentence')
    symptoms_discussed = factory.Faker('paragraph')
    advice_given = factory.Faker('paragraph')
    urgency = 'Routine'
    callback_needed = 'No'


class WardRoundWorkflowFactory(factory.django.DjangoModelFactory):
    """Factory for WardRoundWorkflow model."""

    class Meta:
        model = WardRoundWorkflow

    workflow = factory.SubFactory(
        ClinicalWorkflowFactory,
        workflow_type=WorkflowType.WARD_ROUND,
        total_steps=4
    )
    overnight_events = factory.Faker('paragraph')
    nursing_concerns = factory.Faker('sentence')
    examination_findings = factory.Faker('paragraph')
    vitals_reviewed = True
    assessment = factory.Faker('paragraph')
    plan_notes = factory.Faker('paragraph')
    orders_placed = factory.LazyFunction(list)
    progress_note = factory.Faker('paragraph')
    estimated_discharge = factory.LazyFunction(
        lambda: date.today() + timedelta(days=3)
    )
    discharge_planning_needed = False


class AdmissionWorkflowFactory(factory.django.DjangoModelFactory):
    """Factory for AdmissionWorkflow model."""

    class Meta:
        model = AdmissionWorkflow

    workflow = factory.SubFactory(
        ClinicalWorkflowFactory,
        workflow_type=WorkflowType.ADMISSION,
        total_steps=5
    )
    patient_verified = True
    emergency_contact_name = factory.Faker('name')
    emergency_contact_relationship = 'Spouse'
    emergency_contact_phone = factory.Faker('numerify', text='###-###-####')
    ward_id = None
    bed_id = None
    admission_type = 'elective'
    admission_source = 'Outpatient clinic'
    admission_reason = factory.Faker('sentence')
    chief_complaint = factory.Faker('sentence')
    initial_diagnosis = factory.Faker('sentence')
    relevant_history = factory.Faker('paragraph')
    diet = 'Regular'
    activity = 'Bed rest'
    vitals_frequency = 'Q4H'
    medications = factory.LazyFunction(list)
    labs = factory.LazyFunction(list)
    nursing_instructions = factory.Faker('paragraph')
    admission_note = factory.Faker('paragraph')
    expected_los = 3
    attending_physician = factory.Faker('name')


class DischargeWorkflowFactory(factory.django.DjangoModelFactory):
    """Factory for DischargeWorkflow model."""

    class Meta:
        model = DischargeWorkflow

    workflow = factory.SubFactory(
        ClinicalWorkflowFactory,
        workflow_type=WorkflowType.DISCHARGE,
        total_steps=4
    )
    discharge_criteria_met = factory.LazyFunction(
        lambda: ['Vitals stable', 'Ambulating', 'Pain controlled']
    )
    discharge_disposition = 'Home'
    discharge_date = factory.LazyFunction(timezone.now)
    transportation = 'Private car'
    medications_reconciled = True
    discharge_prescriptions = factory.LazyFunction(list)
    medication_changes = factory.Faker('sentence')
    medication_education_completed = True
    activity_restrictions = factory.Faker('sentence')
    diet_instructions = 'Regular diet'
    wound_care = 'Keep dressing dry for 48 hours'
    warning_signs = factory.Faker('sentence')
    follow_up_appointments = factory.Faker('sentence')
    discharge_summary = factory.Faker('paragraph')
    patient_education_complete = True
    discharge_instructions_given = True
    prescriptions_sent = True


class WorkflowTemplateFactory(factory.django.DjangoModelFactory):
    """Factory for WorkflowTemplate model."""

    class Meta:
        model = WorkflowTemplate

    name = factory.Sequence(lambda n: f'Template {n}')
    workflow_type = WorkflowType.CONSULTATION
    description = factory.Faker('sentence')
    template_data = factory.LazyFunction(lambda: {
        'default_values': {},
        'sections': []
    })
    specialty = 'General'
    is_public = True
    created_by = factory.SubFactory(DoctorUserFactory)
    usage_count = 0


class ConsultationTemplateFactory(WorkflowTemplateFactory):
    """Factory for consultation workflow templates."""

    workflow_type = WorkflowType.CONSULTATION
    name = factory.Sequence(lambda n: f'Consultation Template {n}')
    template_data = factory.LazyFunction(lambda: {
        'default_values': {
            'ros_template': 'General: No fever, chills, or weight loss',
        },
        'sections': [
            {'name': 'Chief Complaint', 'required': True},
            {'name': 'HPI', 'required': True},
            {'name': 'ROS', 'required': False},
            {'name': 'Physical Exam', 'required': True},
            {'name': 'Assessment & Plan', 'required': True},
        ]
    })


class AdmissionTemplateFactory(WorkflowTemplateFactory):
    """Factory for admission workflow templates."""

    workflow_type = WorkflowType.ADMISSION
    name = factory.Sequence(lambda n: f'Admission Template {n}')


class DischargeTemplateFactory(WorkflowTemplateFactory):
    """Factory for discharge workflow templates."""

    workflow_type = WorkflowType.DISCHARGE
    name = factory.Sequence(lambda n: f'Discharge Template {n}')


# Helper functions for creating workflow test scenarios
def create_consultation_workflow(user, patient, status=WorkflowStatus.IN_PROGRESS, **kwargs):
    """
    Create a complete consultation workflow with associated consultation data.

    Args:
        user: User performing the consultation
        patient: Patient being seen
        status: Workflow status
        **kwargs: Additional workflow attributes

    Returns:
        Tuple of (ClinicalWorkflow, ConsultationWorkflow)
    """
    workflow = ClinicalWorkflowFactory(
        user=user,
        patient=patient,
        workflow_type=WorkflowType.CONSULTATION,
        status=status,
        **kwargs
    )
    consultation_data = ConsultationWorkflow.objects.create(
        workflow=workflow
    )
    return workflow, consultation_data


def create_ward_round_workflow(user, patient, admission_id=None, **kwargs):
    """
    Create a ward round workflow for an admitted patient.

    Args:
        user: User performing the ward round
        patient: Patient being seen
        admission_id: ID of the admission
        **kwargs: Additional workflow attributes

    Returns:
        Tuple of (ClinicalWorkflow, WardRoundWorkflow)
    """
    context_data = kwargs.pop('context_data', {})
    if admission_id:
        context_data['admission_id'] = str(admission_id)

    workflow = ClinicalWorkflowFactory(
        user=user,
        patient=patient,
        workflow_type=WorkflowType.WARD_ROUND,
        total_steps=4,
        context_data=context_data,
        **kwargs
    )
    ward_round_data = WardRoundWorkflow.objects.create(workflow=workflow)
    return workflow, ward_round_data


def create_admission_workflow(user, patient, **kwargs):
    """
    Create an admission workflow.

    Args:
        user: User performing the admission
        patient: Patient being admitted
        **kwargs: Additional workflow attributes

    Returns:
        Tuple of (ClinicalWorkflow, AdmissionWorkflow)
    """
    workflow = ClinicalWorkflowFactory(
        user=user,
        patient=patient,
        workflow_type=WorkflowType.ADMISSION,
        total_steps=5,
        **kwargs
    )
    admission_data = AdmissionWorkflow.objects.create(workflow=workflow)
    return workflow, admission_data


def create_discharge_workflow(user, patient, admission_id=None, **kwargs):
    """
    Create a discharge workflow.

    Args:
        user: User performing the discharge
        patient: Patient being discharged
        admission_id: ID of the admission
        **kwargs: Additional workflow attributes

    Returns:
        Tuple of (ClinicalWorkflow, DischargeWorkflow)
    """
    context_data = kwargs.pop('context_data', {})
    if admission_id:
        context_data['admission_id'] = str(admission_id)

    workflow = ClinicalWorkflowFactory(
        user=user,
        patient=patient,
        workflow_type=WorkflowType.DISCHARGE,
        total_steps=4,
        context_data=context_data,
        **kwargs
    )
    discharge_data = DischargeWorkflow.objects.create(workflow=workflow)
    return workflow, discharge_data
