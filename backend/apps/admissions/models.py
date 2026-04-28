import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.wards.models import Admission


class AdmissionCase(models.Model):
    class Status(models.TextChoices):
        AWAITING_CLEARANCE = 'awaiting_clearance', 'Awaiting Clearance'
        READY_FOR_ACTIVATION = 'ready_for_activation', 'Ready for Activation'
        INTAKE_IN_PROGRESS = 'intake_in_progress', 'Intake In Progress'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    class Urgency(models.TextChoices):
        ROUTINE = 'routine', 'Routine'
        URGENT = 'urgent', 'Urgent'
        EMERGENT = 'emergent', 'Emergent'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='admission_cases',
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='admission_cases',
    )
    source_encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='source_admission_cases',
    )
    admission = models.OneToOneField(
        'wards.Admission',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='admission_case',
    )
    requested_ward = models.ForeignKey(
        'wards.Ward',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='admission_cases',
    )
    requested_bed = models.ForeignKey(
        'wards.Bed',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='requested_admission_cases',
    )
    admitting_practitioner = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='admission_cases',
    )
    primary_team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='admission_cases',
    )
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.AWAITING_CLEARANCE,
    )
    admission_source = models.CharField(max_length=50, blank=True)
    urgency = models.CharField(
        max_length=20,
        choices=Urgency.choices,
        default=Urgency.ROUTINE,
    )
    requested_admission_type = models.CharField(
        max_length=20,
        choices=Admission.ADMISSION_TYPE_CHOICES,
        default='elective',
    )
    requested_for_at = models.DateTimeField(null=True, blank=True)
    ready_for_activation_at = models.DateTimeField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='requested_admission_cases',
    )
    expected_length_of_stay = models.PositiveSmallIntegerField(null=True, blank=True)
    draft_payload = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-requested_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-requested_at']),
            models.Index(fields=['patient', '-requested_at']),
            models.Index(fields=['requested_bed', 'status']),
        ]

    def __str__(self):
        return f"AdmissionCase {self.id} ({self.get_status_display()})"

    @property
    def is_open(self):
        return self.status not in {self.Status.COMPLETED, self.Status.CANCELLED}


class AdmissionTask(models.Model):
    class Phase(models.TextChoices):
        PRE_ACTIVATION = 'pre_activation', 'Pre-Activation'
        POST_ACTIVATION = 'post_activation', 'Post-Activation'

    class TaskType(models.TextChoices):
        MEDICAL_ADMISSION_ORDER = 'medical_admission_order', 'Medical Admission Order'
        PLACEMENT = 'placement', 'Placement'
        REGISTRATION_COMPLETION = 'registration_completion', 'Registration Completion'
        FINANCIAL_CLEARANCE = 'financial_clearance', 'Financial Clearance'
        NURSING_INTAKE = 'nursing_intake', 'Nursing Intake'
        ADMISSION_DOCUMENTATION = 'admission_documentation', 'Admission Documentation'
        PHARMACY_MED_REC = 'pharmacy_med_rec', 'Pharmacy Medication Reconciliation'
        BASELINE_LAB_FOLLOWUP = 'baseline_lab_followup', 'Baseline Lab Follow-up'
        INFECTION_CONTROL = 'infection_control', 'Infection Control'
        DIETARY = 'dietary', 'Dietary'
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
        AdmissionCase,
        on_delete=models.CASCADE,
        related_name='tasks',
    )
    task_type = models.CharField(max_length=40, choices=TaskType.choices)
    phase = models.CharField(max_length=24, choices=Phase.choices)
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
        related_name='completed_admission_tasks',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='acknowledged_admission_tasks',
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_admission_tasks',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['phase', '-blocking', 'created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['case', 'task_type'],
                name='admission_case_task_type_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['case', 'phase', 'blocking', 'status']),
            models.Index(fields=['assigned_role', 'status']),
            models.Index(fields=['task_type', 'status']),
        ]

    def __str__(self):
        return f"{self.get_task_type_display()} ({self.get_status_display()})"


class BedReservation(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        RELEASED = 'released', 'Released'
        CONSUMED = 'consumed', 'Consumed'
        CANCELLED = 'cancelled', 'Cancelled'
        EXPIRED = 'expired', 'Expired'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey(
        AdmissionCase,
        on_delete=models.CASCADE,
        related_name='bed_reservations',
    )
    bed = models.ForeignKey(
        'wards.Bed',
        on_delete=models.CASCADE,
        related_name='admission_reservations',
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    reserved_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_bed_reservations',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_bed_reservations',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-reserved_at']
        constraints = [
            models.UniqueConstraint(
                fields=['bed'],
                condition=Q(status='active'),
                name='admission_active_bed_reservation_unique',
            ),
            models.UniqueConstraint(
                fields=['case'],
                condition=Q(status='active'),
                name='admission_active_case_reservation_unique',
            ),
        ]
        indexes = [
            models.Index(fields=['case', 'status']),
            models.Index(fields=['bed', 'status']),
        ]

    def __str__(self):
        return f"{self.bed} ({self.get_status_display()})"

