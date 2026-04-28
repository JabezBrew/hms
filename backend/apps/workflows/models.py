import hashlib
import json

from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()


class WorkflowType(models.TextChoices):
    """Workflow type choices"""
    CONSULTATION = 'consultation', 'Consultation'
    WARD_ROUND = 'ward_round', 'Ward Round'
    DISCHARGE = 'discharge', 'Discharge'
    EMERGENCY = 'emergency', 'Emergency Intake'
    CLINICAL_NOTE = 'clinical_note', 'Clinical Note'


class ClinicalNoteType(models.TextChoices):
    """Clinical note type choices - matches NoteTemplate categories"""
    GENERAL = 'general', 'General'
    SOAP = 'soap', 'SOAP Note'
    PROGRESS = 'progress', 'Progress Note'
    PROCEDURE = 'procedure', 'Procedure Note'
    ADMISSION = 'admission', 'Admission Note'
    DISCHARGE = 'discharge', 'Discharge Note'
    NURSING = 'nursing', 'Nursing Note'
    CONSULTATION = 'consultation', 'Consultation Note'
    CUSTOM = 'custom', 'Custom Note'
    PHONE = 'phone', 'Phone Note'


class WorkflowStatus(models.TextChoices):
    """Workflow status choices"""
    DRAFT = 'draft', 'Draft'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'


class ClinicalWorkflow(models.Model):
    """
    Base model for all clinical workflows
    Tracks progress through multi-step processes
    """
    workflow_type = models.CharField(
        max_length=50,
        choices=WorkflowType.choices,
        db_index=True
    )
    status = models.CharField(
        max_length=20,
        choices=WorkflowStatus.choices,
        default=WorkflowStatus.DRAFT,
        db_index=True
    )

    # Context
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='workflows'
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='workflows'
    )
    # Encounter is a FHIR resource, store ID only
    encounter_id = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        help_text='FHIR Encounter resource ID'
    )

    # Source referral (if workflow was started from a referral)
    source_referral = models.ForeignKey(
        'referrals.Referral',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='consultation_workflows',
        help_text='Referral that initiated this consultation workflow'
    )

    # Progress tracking
    current_step = models.IntegerField(default=1)
    total_steps = models.IntegerField(default=5)
    steps_completed = models.JSONField(default=list)  # [1, 2, 3]

    # Data storage
    context_data = models.JSONField(default=dict)  # Workflow-specific data

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    # Auto-save tracking
    last_autosave = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workflows_clinical'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['patient', 'workflow_type']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        patient_name = self.patient.user.get_full_name() if self.patient else "Unknown"
        return f"{self.get_workflow_type_display()} - {patient_name} ({self.status})"

    def is_complete(self):
        """Check if all steps are completed"""
        return len(self.steps_completed) == self.total_steps

    def can_proceed_to_next_step(self):
        """Check if can proceed to next step"""
        return self.current_step < self.total_steps

    def mark_step_complete(self, step_number):
        """Mark a specific step as completed"""
        if step_number not in self.steps_completed:
            self.steps_completed.append(step_number)
            self.save(update_fields=['steps_completed', 'updated_at'])

    def advance_to_step(self, step_number):
        """Advance to a specific step"""
        if step_number <= self.total_steps:
            self.current_step = step_number
            self.save(update_fields=['current_step', 'updated_at'])

    def complete_workflow(self):
        """Mark workflow as completed"""
        self.status = WorkflowStatus.COMPLETED
        self.completed_at = timezone.now()
        self.save(update_fields=['status', 'completed_at', 'updated_at'])


class ConsultationWorkflow(models.Model):
    """
    Specific model for consultation workflow data
    Stores consultation-specific fields that don't fit in generic workflow
    """
    workflow = models.OneToOneField(
        ClinicalWorkflow,
        on_delete=models.CASCADE,
        related_name='consultation_data'
    )

    # Appointment reference (FHIR resource, store ID only)
    appointment_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text='FHIR Appointment resource ID'
    )

    # Consultation-specific fields
    chief_complaint = models.TextField(blank=True)
    hpi = models.TextField(blank=True, verbose_name='History of Present Illness')
    ros = models.TextField(blank=True, verbose_name='Review of Systems')
    physical_exam = models.TextField(blank=True)
    assessment = models.TextField(blank=True)
    plan = models.TextField(blank=True)

    # Template used
    template_used = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'workflows_consultation'

    def __str__(self):
        patient_name = self.workflow.patient.user.get_full_name() if self.workflow.patient else "Unknown"
        return f"Consultation - {patient_name}"


class ClinicalNoteWorkflow(models.Model):
    """
    Specific model for clinical note workflow data
    Stores note-specific fields
    """
    workflow = models.OneToOneField(
        ClinicalWorkflow,
        on_delete=models.CASCADE,
        related_name='clinical_note_data'
    )

    # Note type
    note_type = models.CharField(
        max_length=50,
        choices=ClinicalNoteType.choices,
        default=ClinicalNoteType.PROGRESS
    )

    # Common fields across note types
    chief_complaint = models.TextField(blank=True)
    assessment = models.TextField(blank=True)
    plan = models.TextField(blank=True)

    # SOAP-specific fields
    subjective = models.TextField(blank=True)
    objective = models.TextField(blank=True)
    hpi = models.TextField(blank=True, verbose_name='History of Present Illness')
    ros = models.TextField(blank=True, verbose_name='Review of Systems')
    physical_exam = models.TextField(blank=True)
    vitals = models.JSONField(default=dict, blank=True)

    # Procedure-specific fields
    procedure_name = models.CharField(max_length=255, blank=True)
    indication = models.TextField(blank=True)
    consent = models.CharField(max_length=100, blank=True)
    pre_assessment = models.TextField(blank=True)
    anesthesia = models.CharField(max_length=255, blank=True)
    technique = models.TextField(blank=True)
    specimens = models.TextField(blank=True)
    ebl = models.CharField(max_length=100, blank=True, verbose_name='Estimated Blood Loss')
    complications = models.CharField(max_length=100, blank=True)
    complication_details = models.TextField(blank=True)
    patient_condition = models.TextField(blank=True)
    disposition = models.CharField(max_length=100, blank=True)
    post_instructions = models.TextField(blank=True)

    # Phone note fields
    caller_name = models.CharField(max_length=255, blank=True)
    caller_relationship = models.CharField(max_length=100, blank=True)
    callback_number = models.CharField(max_length=50, blank=True)
    reason_for_call = models.TextField(blank=True)
    symptoms_discussed = models.TextField(blank=True)
    advice_given = models.TextField(blank=True)
    urgency = models.CharField(max_length=50, blank=True)
    actions_taken = models.TextField(blank=True)
    pending_actions = models.TextField(blank=True)
    callback_needed = models.CharField(max_length=50, blank=True)

    # Common follow-up field
    follow_up = models.TextField(blank=True)
    patient_education = models.TextField(blank=True)

    class Meta:
        db_table = 'workflows_clinical_note'

    def __str__(self):
        patient_name = self.workflow.patient.user.get_full_name() if self.workflow.patient else "Unknown"
        return f"{self.get_note_type_display()} - {patient_name}"


class WardRoundWorkflow(models.Model):
    """
    Specific model for ward round workflow data
    Stores data for inpatient daily rounds
    """
    workflow = models.OneToOneField(
        ClinicalWorkflow,
        on_delete=models.CASCADE,
        related_name='ward_round_data'
    )

    # Step 1: Patient Review
    overnight_events = models.TextField(blank=True)
    nursing_concerns = models.TextField(blank=True)

    # Step 2: Clinical Assessment
    examination_findings = models.TextField(blank=True)
    vitals_reviewed = models.BooleanField(default=False)

    # Step 3: Plan
    assessment = models.TextField(blank=True)
    plan_notes = models.TextField(blank=True)
    orders_placed = models.JSONField(default=list, blank=True)

    # Step 4: Documentation
    progress_note = models.TextField(blank=True)
    estimated_discharge = models.DateField(null=True, blank=True)
    discharge_planning_needed = models.BooleanField(default=False)

    class Meta:
        db_table = 'workflows_ward_round'

    def __str__(self):
        patient_name = self.workflow.patient.user.get_full_name() if self.workflow.patient else "Unknown"
        return f"Ward Round - {patient_name}"


class DischargeWorkflow(models.Model):
    """
    Specific model for discharge workflow data
    Stores data for patient discharges
    """
    workflow = models.OneToOneField(
        ClinicalWorkflow,
        on_delete=models.CASCADE,
        related_name='discharge_data'
    )

    # Step 1: Discharge Planning
    discharge_criteria_met = models.JSONField(default=list, blank=True)
    discharge_disposition = models.CharField(max_length=100, blank=True)
    discharge_date = models.DateTimeField(null=True, blank=True)
    transportation = models.CharField(max_length=100, blank=True)

    # Step 2: Medications
    medications_reconciled = models.BooleanField(default=False)
    discharge_prescriptions = models.JSONField(default=list, blank=True)
    medication_changes = models.TextField(blank=True)
    medication_education_completed = models.BooleanField(default=False)

    # Step 3: Instructions
    activity_restrictions = models.TextField(blank=True)
    diet_instructions = models.TextField(blank=True)
    wound_care = models.TextField(blank=True)
    warning_signs = models.TextField(blank=True)
    follow_up_appointments = models.TextField(blank=True)

    # Step 4: Documentation
    discharge_summary = models.TextField(blank=True)
    patient_education_complete = models.BooleanField(default=False)
    discharge_instructions_given = models.BooleanField(default=False)
    prescriptions_sent = models.BooleanField(default=False)

    class Meta:
        db_table = 'workflows_discharge'

    def __str__(self):
        patient_name = self.workflow.patient.user.get_full_name() if self.workflow.patient else "Unknown"
        return f"Discharge - {patient_name}"


class WorkflowTemplate(models.Model):
    """
    Templates for common workflow scenarios
    Provides starting content/structure for workflows
    """
    name = models.CharField(max_length=255)
    workflow_type = models.CharField(
        max_length=50,
        choices=WorkflowType.choices
    )
    description = models.TextField(blank=True)

    # Template content
    template_data = models.JSONField(default=dict)

    # Metadata
    specialty = models.CharField(max_length=100, blank=True)
    is_public = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_workflow_templates'
    )

    # Usage tracking
    usage_count = models.IntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workflows_template'
        ordering = ['-usage_count', 'name']

    def __str__(self):
        return f"{self.name} ({self.get_workflow_type_display()})"

    def increment_usage(self):
        """Increment usage count"""
        self.usage_count += 1
        self.save(update_fields=['usage_count'])


class OnboardingProgressStatus(models.TextChoices):
    """Onboarding progress status choices."""

    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'


class OnboardingFlowDefinition(models.Model):
    """
    Versioned onboarding flow definition.

    `definition` contains the full flow contract consumed by frontend and evaluator.
    """

    flow_key = models.CharField(max_length=120, db_index=True)
    version = models.PositiveIntegerField(default=1)
    active = models.BooleanField(default=True, db_index=True)
    roles = models.JSONField(default=list, blank=True)
    definition = models.JSONField(default=dict)
    etag = models.CharField(max_length=64, editable=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workflows_onboarding_flow_definition'
        ordering = ['flow_key', '-version']
        constraints = [
            models.UniqueConstraint(
                fields=['flow_key', 'version'],
                name='uq_workflows_onboarding_flow_definition_key_version',
            ),
        ]
        indexes = [
            models.Index(fields=['active', 'updated_at']),
        ]

    def __str__(self):
        return f"{self.flow_key}:v{self.version}"

    def save(self, *args, **kwargs):
        payload = {
            'flow_key': self.flow_key,
            'version': self.version,
            'active': self.active,
            'roles': self.roles,
            'definition': self.definition,
        }
        serialized = json.dumps(payload, sort_keys=True, separators=(',', ':'))
        self.etag = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
        super().save(*args, **kwargs)


class OnboardingProgress(models.Model):
    """Per-user onboarding progress for a specific flow version."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='onboarding_progress',
    )
    flow_definition = models.ForeignKey(
        OnboardingFlowDefinition,
        on_delete=models.CASCADE,
        related_name='progress_records',
    )
    flow_key = models.CharField(max_length=120, db_index=True)
    flow_version = models.PositiveIntegerField()

    status = models.CharField(
        max_length=20,
        choices=OnboardingProgressStatus.choices,
        default=OnboardingProgressStatus.IN_PROGRESS,
        db_index=True,
    )
    current_step_index = models.PositiveIntegerField(default=0)
    completed_steps_mask = models.BigIntegerField(default=0)
    skipped_steps_mask = models.BigIntegerField(default=0)
    state_json = models.JSONField(default=dict, blank=True)
    step_runtime_json = models.JSONField(default=dict, blank=True)

    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workflows_onboarding_progress'
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'flow_key', 'flow_version'],
                name='uq_workflows_onboarding_progress_user_flow',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'status', 'updated_at']),
            models.Index(fields=['user', 'flow_key']),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.flow_key}:v{self.flow_version}"

    def save(self, *args, **kwargs):
        if self.flow_definition_id:
            self.flow_key = self.flow_definition.flow_key
            self.flow_version = self.flow_definition.version
        super().save(*args, **kwargs)


class OnboardingEventReceipt(models.Model):
    """Idempotency receipts for ingested onboarding events."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='onboarding_event_receipts',
    )
    event_id = models.CharField(max_length=64)
    event_name = models.CharField(max_length=120, db_index=True)
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'workflows_onboarding_event_receipt'
        ordering = ['-received_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'event_id'],
                name='uq_workflows_onboarding_event_receipt_user_event',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'received_at']),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.event_id}"
