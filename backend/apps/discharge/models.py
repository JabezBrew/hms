import uuid

from django.conf import settings
from django.db import models


class DischargeCase(models.Model):
    class Status(models.TextChoices):
        AWAITING_CLEARANCE = 'awaiting_clearance', 'Awaiting Clearance'
        READY_FOR_FINALIZATION = 'ready_for_finalization', 'Ready for Finalization'
        FINALIZED = 'finalized', 'Finalized'
        CANCELLED = 'cancelled', 'Cancelled'
        REOPENED = 'reopened', 'Reopened'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='discharge_cases',
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='discharge_cases',
    )
    admission = models.OneToOneField(
        'wards.Admission',
        on_delete=models.CASCADE,
        related_name='discharge_case',
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='discharge_cases',
    )
    workflow = models.ForeignKey(
        'workflows.ClinicalWorkflow',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='discharge_cases',
    )
    discharge_note = models.ForeignKey(
        'clinical_notes.NoteEntry',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='discharge_cases',
    )
    nursing_task = models.OneToOneField(
        'nursing.NursingTask',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='discharge_case',
    )

    medical_ready_at = models.DateTimeField()
    billing_cutoff_at = models.DateTimeField()
    finalized_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.AWAITING_CLEARANCE,
    )
    discharge_disposition = models.CharField(max_length=100, blank=True)

    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='submitted_discharge_cases',
    )
    submitted_at = models.DateTimeField(auto_now_add=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cancelled_discharge_cases',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True)
    reopened_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reopened_discharge_cases',
    )
    reopened_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-medical_ready_at']),
            models.Index(fields=['patient', '-medical_ready_at']),
            models.Index(fields=['admission']),
        ]

    def __str__(self):
        return f"DischargeCase {self.id} ({self.get_status_display()})"

    @property
    def is_open(self):
        return self.status not in {self.Status.FINALIZED, self.Status.CANCELLED}


class DischargeTask(models.Model):
    class TaskType(models.TextChoices):
        BILLING_CLEARANCE = 'billing_clearance', 'Billing Clearance'
        NURSING_FINALIZATION = 'nursing_finalization', 'Nursing Finalization'
        PHARMACY_FOLLOWUP = 'pharmacy_followup', 'Pharmacy Follow-up'
        LAB_FOLLOWUP = 'lab_followup', 'Lab Follow-up'
        IMAGING = 'imaging', 'Imaging'
        SOCIAL_WORK = 'social_work', 'Social Work'
        TRANSPORT = 'transport', 'Transport'
        DOCUMENTS = 'documents', 'Documents'
        OTHER = 'other', 'Other'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        COMPLETED = 'completed', 'Completed'
        NOT_REQUIRED = 'not_required', 'Not Required'
        ACKNOWLEDGED_UNRESOLVED = 'acknowledged_unresolved', 'Acknowledged Unresolved'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey(
        DischargeCase,
        on_delete=models.CASCADE,
        related_name='tasks',
    )
    task_type = models.CharField(max_length=40, choices=TaskType.choices)
    assigned_role = models.CharField(max_length=30, blank=True)
    blocking = models.BooleanField(default=False)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.PENDING,
    )
    notes = models.TextField(blank=True)
    snapshot = models.JSONField(default=dict, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_discharge_tasks',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='acknowledged_discharge_tasks',
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_discharge_tasks',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['blocking', 'created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['case', 'task_type'],
                name='discharge_case_task_type_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['case', 'blocking', 'status']),
            models.Index(fields=['assigned_role', 'status']),
            models.Index(fields=['task_type', 'status']),
        ]

    def __str__(self):
        return f"{self.get_task_type_display()} ({self.get_status_display()})"
