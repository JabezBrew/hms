"""
Workflow definitions registry

Contains all workflow type definitions for the HMS system.
Each workflow definition specifies the steps, fields, and configuration
for a particular clinical workflow type.
"""
from .definitions import (
    WorkflowDefinition,
    WorkflowStepDefinition,
    FieldDefinition,
    FieldType,
    ValidationRule
)
from .models import WorkflowType


WORKFLOW_DEFINITIONS = {
    WorkflowType.WARD_ROUND: WorkflowDefinition(
        workflow_type=WorkflowType.WARD_ROUND,
        name='Ward Round',
        description='Daily patient review workflow for inpatient care',
        total_steps=4,
        steps=[
            WorkflowStepDefinition(
                step_number=1,
                name='patient_review',
                title='Patient Review',
                description='Review patient status and overnight events',
                fields=[
                    FieldDefinition(
                        name='overnight_events',
                        field_type=FieldType.TEXTAREA,
                        label='Overnight Events',
                        help_text='Significant events since last review',
                        placeholder='Any changes in patient status, new symptoms, incidents...'
                    ),
                    FieldDefinition(
                        name='nursing_concerns',
                        field_type=FieldType.TEXTAREA,
                        label='Nursing Concerns',
                        help_text='Issues flagged by nursing staff',
                        placeholder='Pain management, mobility issues, medication concerns...'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=2,
                name='clinical_assessment',
                title='Clinical Assessment',
                description='Examine patient and review vitals',
                fields=[
                    FieldDefinition(
                        name='examination_findings',
                        field_type=FieldType.TEXTAREA,
                        label='Examination Findings',
                        required=True,
                        help_text='Physical examination findings',
                        placeholder='General appearance, cardiovascular, respiratory, abdomen...'
                    ),
                    FieldDefinition(
                        name='vitals_reviewed',
                        field_type=FieldType.BOOLEAN,
                        label='Vitals Reviewed',
                        required=True,
                        default_value=False,
                        help_text='Confirm vital signs have been reviewed'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=3,
                name='plan',
                title='Treatment Plan',
                description='Update treatment plan and orders',
                fields=[
                    FieldDefinition(
                        name='assessment',
                        field_type=FieldType.TEXTAREA,
                        label='Clinical Assessment',
                        required=True,
                        help_text='Current clinical status and assessment',
                        placeholder='Patient condition, response to treatment, concerns...'
                    ),
                    FieldDefinition(
                        name='plan_notes',
                        field_type=FieldType.TEXTAREA,
                        label='Plan',
                        required=True,
                        help_text='Treatment plan for today',
                        placeholder='Medications, procedures, consultations, discharge planning...'
                    ),
                    FieldDefinition(
                        name='orders_placed',
                        field_type=FieldType.ORDERS_LIST,
                        label='Orders',
                        help_text='New orders to be placed'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=4,
                name='documentation',
                title='Documentation',
                description='Complete ward round documentation',
                fields=[
                    FieldDefinition(
                        name='progress_note',
                        field_type=FieldType.RICHTEXT,
                        label='Progress Note',
                        required=True,
                        help_text='Complete progress note for the ward round',
                        placeholder='Subjective, Objective, Assessment, Plan...'
                    ),
                    FieldDefinition(
                        name='estimated_discharge',
                        field_type=FieldType.DATE,
                        label='Estimated Discharge Date',
                        help_text='Expected discharge date (if applicable)'
                    ),
                    FieldDefinition(
                        name='discharge_planning_needed',
                        field_type=FieldType.BOOLEAN,
                        label='Discharge Planning Needed',
                        default_value=False,
                        help_text='Check if discharge planning should be initiated'
                    ),
                ],
            ),
        ],
        completion_artifacts=['note'],
        encounter_type='inpatient',
    ),

    WorkflowType.ADMISSION: WorkflowDefinition(
        workflow_type=WorkflowType.ADMISSION,
        name='Patient Admission',
        description='Guided workflow for admitting patients to the hospital',
        total_steps=5,
        steps=[
            WorkflowStepDefinition(
                step_number=1,
                name='patient_info',
                title='Patient Information',
                description='Verify patient identity and emergency contacts',
                fields=[
                    FieldDefinition(
                        name='patient_verified',
                        field_type=FieldType.BOOLEAN,
                        label='Patient Identity Verified',
                        required=True,
                        default_value=False,
                        help_text='Confirm patient identity with ID or medical record'
                    ),
                    FieldDefinition(
                        name='emergency_contact_name',
                        field_type=FieldType.TEXT,
                        label='Emergency Contact Name',
                        required=True,
                    ),
                    FieldDefinition(
                        name='emergency_contact_relationship',
                        field_type=FieldType.TEXT,
                        label='Relationship',
                        placeholder='Spouse, Parent, Sibling, etc.'
                    ),
                    FieldDefinition(
                        name='emergency_contact_phone',
                        field_type=FieldType.TEXT,
                        label='Emergency Contact Phone',
                        required=True,
                        placeholder='+1 (555) 123-4567'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=2,
                name='bed_assignment',
                title='Bed Assignment',
                description='Assign ward and bed',
                fields=[
                    FieldDefinition(
                        name='ward_id',
                        field_type=FieldType.WARD_SELECT,
                        label='Ward',
                        required=True,
                        help_text='Select ward based on patient needs'
                    ),
                    FieldDefinition(
                        name='bed_id',
                        field_type=FieldType.BED_SELECT,
                        label='Bed',
                        required=True,
                        help_text='Available beds will be shown based on selected ward'
                    ),
                    FieldDefinition(
                        name='admission_type',
                        field_type=FieldType.SELECT,
                        label='Admission Type',
                        required=True,
                        options=['emergency', 'elective', 'maternity', 'newborn', 'observation'],
                        help_text='Type of admission'
                    ),
                    FieldDefinition(
                        name='admission_source',
                        field_type=FieldType.SELECT,
                        label='Admission Source',
                        options=['emergency_department', 'outpatient', 'transfer', 'direct'],
                        help_text='Where the patient is being admitted from'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=3,
                name='clinical_info',
                title='Clinical Information',
                description='Record admission reason and initial assessment',
                fields=[
                    FieldDefinition(
                        name='admission_reason',
                        field_type=FieldType.TEXTAREA,
                        label='Reason for Admission',
                        required=True,
                        help_text='Primary reason patient is being admitted',
                        placeholder='Patient presenting with...'
                    ),
                    FieldDefinition(
                        name='chief_complaint',
                        field_type=FieldType.TEXTAREA,
                        label='Chief Complaint',
                        required=True,
                        help_text='Patient\'s main complaint in their own words',
                        placeholder='Patient reports...'
                    ),
                    FieldDefinition(
                        name='initial_diagnosis',
                        field_type=FieldType.DIAGNOSIS_SEARCH,
                        label='Working Diagnosis',
                        help_text='Initial diagnosis or differential diagnoses'
                    ),
                    FieldDefinition(
                        name='relevant_history',
                        field_type=FieldType.TEXTAREA,
                        label='Relevant Medical History',
                        help_text='Pertinent medical history for this admission',
                        placeholder='Past medical history, surgical history, medications...'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=4,
                name='orders',
                title='Admission Orders',
                description='Create initial orders and care plan',
                fields=[
                    FieldDefinition(
                        name='diet',
                        field_type=FieldType.SELECT,
                        label='Diet Order',
                        options=['regular', 'npo', 'clear_liquid', 'full_liquid', 'soft', 'diabetic', 'cardiac', 'renal'],
                        default_value='regular',
                        help_text='Initial diet order'
                    ),
                    FieldDefinition(
                        name='activity',
                        field_type=FieldType.SELECT,
                        label='Activity Level',
                        options=['bed_rest', 'bed_rest_bpr', 'up_with_assist', 'ambulatory', 'unrestricted'],
                        default_value='ambulatory',
                        help_text='Activity restrictions'
                    ),
                    FieldDefinition(
                        name='vitals_frequency',
                        field_type=FieldType.SELECT,
                        label='Vitals Frequency',
                        options=['q4h', 'q6h', 'q8h', 'q12h', 'daily', 'routine'],
                        default_value='q6h',
                        help_text='How often vitals should be taken'
                    ),
                    FieldDefinition(
                        name='medications',
                        field_type=FieldType.MEDICATION_LIST,
                        label='Admission Medications',
                        help_text='Initial medication orders'
                    ),
                    FieldDefinition(
                        name='labs',
                        field_type=FieldType.LAB_ORDER_LIST,
                        label='Lab Orders',
                        help_text='Initial laboratory tests to order'
                    ),
                    FieldDefinition(
                        name='nursing_instructions',
                        field_type=FieldType.TEXTAREA,
                        label='Nursing Instructions',
                        help_text='Special instructions for nursing staff',
                        placeholder='Fall precautions, isolation, special monitoring...'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=5,
                name='documentation',
                title='Complete Admission',
                description='Review and finalize admission',
                fields=[
                    FieldDefinition(
                        name='admission_note',
                        field_type=FieldType.RICHTEXT,
                        label='Admission Note',
                        required=True,
                        help_text='Complete admission note',
                        placeholder='History of Present Illness, Review of Systems, Physical Exam, Assessment and Plan...'
                    ),
                    FieldDefinition(
                        name='expected_los',
                        field_type=FieldType.NUMBER,
                        label='Expected Length of Stay (days)',
                        help_text='Estimated number of days patient will remain admitted'
                    ),
                    FieldDefinition(
                        name='attending_physician',
                        field_type=FieldType.TEXT,
                        label='Attending Physician',
                        help_text='Name of attending physician if different from current user'
                    ),
                ],
            ),
        ],
        completion_artifacts=['encounter', 'admission_record', 'note'],
        encounter_type='inpatient',
    ),

    WorkflowType.DISCHARGE: WorkflowDefinition(
        workflow_type=WorkflowType.DISCHARGE,
        name='Patient Discharge',
        description='Structured discharge process with medication reconciliation',
        total_steps=4,
        steps=[
            WorkflowStepDefinition(
                step_number=1,
                name='discharge_planning',
                title='Discharge Planning',
                description='Review discharge readiness and plan',
                fields=[
                    FieldDefinition(
                        name='discharge_criteria_met',
                        field_type=FieldType.CHECKLIST,
                        label='Discharge Criteria',
                        help_text='Confirm all discharge criteria are met',
                        options=[
                            'Clinical condition stable',
                            'Pain controlled',
                            'Tolerating oral intake',
                            'No acute issues',
                            'Follow-up arranged',
                            'Patient/family educated'
                        ]
                    ),
                    FieldDefinition(
                        name='discharge_disposition',
                        field_type=FieldType.SELECT,
                        label='Discharge Disposition',
                        required=True,
                        options=['home', 'home_health', 'rehab', 'snf', 'ltac', 'transfer', 'ama', 'deceased'],
                        help_text='Where patient is being discharged to'
                    ),
                    FieldDefinition(
                        name='discharge_date',
                        field_type=FieldType.DATETIME,
                        label='Discharge Date & Time',
                        required=True,
                        help_text='Planned discharge date and time'
                    ),
                    FieldDefinition(
                        name='transportation',
                        field_type=FieldType.SELECT,
                        label='Transportation',
                        options=['private', 'ambulance', 'wheelchair_van', 'family', 'other'],
                        help_text='How patient will leave the facility'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=2,
                name='medications',
                title='Discharge Medications',
                description='Reconcile and prescribe discharge medications',
                fields=[
                    FieldDefinition(
                        name='medications_reconciled',
                        field_type=FieldType.BOOLEAN,
                        label='Medication Reconciliation Completed',
                        required=True,
                        default_value=False,
                        help_text='Confirm medication reconciliation with home medications'
                    ),
                    FieldDefinition(
                        name='discharge_prescriptions',
                        field_type=FieldType.MEDICATION_LIST,
                        label='Discharge Prescriptions',
                        help_text='Medications patient should continue at home'
                    ),
                    FieldDefinition(
                        name='medication_changes',
                        field_type=FieldType.TEXTAREA,
                        label='Medication Changes',
                        help_text='Document changes to home medications',
                        placeholder='New medications, discontinued medications, dose changes...'
                    ),
                    FieldDefinition(
                        name='medication_education_completed',
                        field_type=FieldType.BOOLEAN,
                        label='Patient Educated on Medications',
                        default_value=False,
                        help_text='Patient understands new medications and changes'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=3,
                name='instructions',
                title='Discharge Instructions',
                description='Provide patient education and follow-up plans',
                fields=[
                    FieldDefinition(
                        name='activity_restrictions',
                        field_type=FieldType.TEXTAREA,
                        label='Activity Restrictions',
                        help_text='Any activity limitations or restrictions',
                        placeholder='No heavy lifting, bed rest, gradual return to activities...'
                    ),
                    FieldDefinition(
                        name='diet_instructions',
                        field_type=FieldType.TEXTAREA,
                        label='Diet Instructions',
                        help_text='Dietary recommendations or restrictions',
                        placeholder='Low sodium, diabetic diet, clear liquids...'
                    ),
                    FieldDefinition(
                        name='wound_care',
                        field_type=FieldType.TEXTAREA,
                        label='Wound Care Instructions',
                        help_text='Wound or incision care (if applicable)',
                        placeholder='Keep clean and dry, change dressing daily...'
                    ),
                    FieldDefinition(
                        name='warning_signs',
                        field_type=FieldType.TEXTAREA,
                        label='Warning Signs',
                        required=True,
                        help_text='Symptoms that should prompt immediate medical attention',
                        placeholder='Fever >101F, increased pain, shortness of breath, bleeding...'
                    ),
                    FieldDefinition(
                        name='follow_up_appointments',
                        field_type=FieldType.TEXTAREA,
                        label='Follow-up Appointments',
                        required=True,
                        help_text='When and where patient should follow up',
                        placeholder='See Dr. Smith in 1 week, wound check in 3 days...'
                    ),
                ],
            ),
            WorkflowStepDefinition(
                step_number=4,
                name='documentation',
                title='Complete Discharge',
                description='Finalize discharge documentation',
                fields=[
                    FieldDefinition(
                        name='discharge_summary',
                        field_type=FieldType.RICHTEXT,
                        label='Discharge Summary',
                        required=True,
                        help_text='Complete discharge summary',
                        placeholder='Hospital course, procedures, findings, discharge condition, medications, follow-up...'
                    ),
                    FieldDefinition(
                        name='patient_education_complete',
                        field_type=FieldType.BOOLEAN,
                        label='Patient Education Completed',
                        required=True,
                        default_value=False,
                        help_text='Patient and family understand discharge instructions'
                    ),
                    FieldDefinition(
                        name='discharge_instructions_given',
                        field_type=FieldType.BOOLEAN,
                        label='Written Instructions Provided',
                        required=True,
                        default_value=False,
                        help_text='Patient received written discharge instructions'
                    ),
                    FieldDefinition(
                        name='prescriptions_sent',
                        field_type=FieldType.BOOLEAN,
                        label='Prescriptions Sent to Pharmacy',
                        default_value=False,
                        help_text='Discharge prescriptions have been sent'
                    ),
                ],
            ),
        ],
        completion_artifacts=['encounter_update', 'note', 'discharge_record'],
        encounter_type='inpatient',
    ),
}


def get_workflow_definition(workflow_type: str) -> WorkflowDefinition:
    """
    Get workflow definition by type

    Args:
        workflow_type: Workflow type from WorkflowType enum

    Returns:
        WorkflowDefinition for the requested type

    Raises:
        ValueError: If workflow type is not found
    """
    if workflow_type not in WORKFLOW_DEFINITIONS:
        raise ValueError(f"Unknown workflow type: {workflow_type}")
    return WORKFLOW_DEFINITIONS[workflow_type]


def get_all_workflow_types():
    """Get list of all registered workflow types"""
    return list(WORKFLOW_DEFINITIONS.keys())
