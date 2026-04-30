import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class WardBoardTask(models.Model):
    class Category(models.TextChoices):
        ADMISSION = 'admission', 'Admission'
        ASSESSMENT = 'assessment', 'Assessment'
        DISCHARGE = 'discharge', 'Discharge'
        DOCUMENTATION = 'documentation', 'Documentation'
        LAB = 'lab', 'Lab'
        MEDICATION = 'medication', 'Medication'
        MOBILITY = 'mobility', 'Mobility'
        REVIEW = 'review', 'Review'
        SAFETY = 'safety', 'Safety'
        VITALS = 'vitals', 'Vitals'
        OTHER = 'other', 'Other'

    class Priority(models.TextChoices):
        ROUTINE = 'routine', 'Routine'
        IMPORTANT = 'important', 'Important'
        URGENT = 'urgent', 'Urgent'
        STAT = 'stat', 'STAT'

    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        IN_PROGRESS = 'in_progress', 'In Progress'
        ESCALATED = 'escalated', 'Escalated'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    class SourceType(models.TextChoices):
        MANUAL = 'manual', 'Manual'
        ADMISSION_TASK = 'admission_task', 'Admission Task'
        DISCHARGE_TASK = 'discharge_task', 'Discharge Task'
        LAB_ORDER = 'lab_order', 'Lab Order'
        NURSING_ALERT = 'nursing_alert', 'Nursing Alert'
        NURSING_TASK = 'nursing_task', 'Nursing Task'
        SYSTEM = 'system', 'System'

    TERMINAL_STATUSES = {Status.COMPLETED, Status.CANCELLED}

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='ward_board_tasks',
        help_text='Facility context for this ward-board task.',
    )
    ward = models.ForeignKey(
        'wards.Ward',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='ward_board_tasks',
    )
    admission = models.ForeignKey(
        'wards.Admission',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='ward_board_tasks',
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='ward_board_tasks',
    )
    category = models.CharField(
        max_length=32,
        choices=Category.choices,
        default=Category.OTHER,
    )
    priority = models.CharField(
        max_length=16,
        choices=Priority.choices,
        default=Priority.ROUTINE,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )
    owner_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='owned_ward_board_tasks',
    )
    owner_role = models.CharField(max_length=30, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    action_text = models.TextField()
    contingency_text = models.TextField(blank=True)
    source_type = models.CharField(
        max_length=32,
        choices=SourceType.choices,
        default=SourceType.MANUAL,
    )
    source_id = models.CharField(max_length=64, blank=True)
    cancellation_reason = models.TextField(blank=True)
    escalated_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_ward_board_tasks',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_ward_board_tasks',
    )
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_ward_board_tasks',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cancelled_ward_board_tasks',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_at', '-priority', '-created_at']
        constraints = [
            models.CheckConstraint(
                check=(
                    Q(owner_user__isnull=False, owner_role='') |
                    (Q(owner_user__isnull=True) & ~Q(owner_role=''))
                ),
                name='wb_task_owner_xor_chk',
            ),
            models.UniqueConstraint(
                fields=['facility', 'source_type', 'source_id'],
                condition=~Q(source_id=''),
                name='wb_task_source_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['facility', 'status', 'due_at'], name='wb_task_fac_status_due_idx'),
            models.Index(fields=['facility', 'priority', 'due_at'], name='wb_task_fac_priority_due_idx'),
            models.Index(fields=['patient', 'status'], name='wb_task_patient_status_idx'),
            models.Index(fields=['admission', 'status'], name='wb_task_adm_status_idx'),
            models.Index(fields=['ward', 'status', 'due_at'], name='wb_task_ward_status_due_idx'),
            models.Index(fields=['owner_role', 'status', 'due_at'], name='wb_task_owner_role_idx'),
            models.Index(fields=['source_type', 'source_id'], name='wb_task_source_idx'),
        ]

    def __str__(self):
        return f'{self.get_category_display()} task for {self.patient_id}'

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    @property
    def is_overdue(self):
        return bool(
            self.due_at
            and self.status not in self.TERMINAL_STATUSES
            and self.due_at < timezone.now()
        )


class WardBoardTaskEvent(models.Model):
    class EventType(models.TextChoices):
        CREATE = 'create', 'Create'
        UPDATE = 'update', 'Update'
        ACKNOWLEDGE = 'acknowledge', 'Acknowledge'
        ASSIGN = 'assign', 'Assign'
        COMPLETE = 'complete', 'Complete'
        CANCEL = 'cancel', 'Cancel'
        ESCALATE = 'escalate', 'Escalate'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(
        WardBoardTask,
        on_delete=models.CASCADE,
        related_name='events',
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='ward_board_task_events',
    )
    event_type = models.CharField(max_length=24, choices=EventType.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ward_board_task_events',
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['task', 'created_at'], name='wb_event_task_created_idx'),
            models.Index(fields=['facility', 'created_at'], name='wb_event_fac_created_idx'),
            models.Index(fields=['actor', 'created_at'], name='wb_event_actor_created_idx'),
        ]

    def __str__(self):
        return f'{self.event_type} for {self.task_id}'


class WardBoardAcknowledgement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(
        WardBoardTask,
        on_delete=models.CASCADE,
        related_name='acknowledgements',
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='ward_board_acknowledgements',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='ward_board_acknowledgements',
    )
    acknowledged_at = models.DateTimeField(default=timezone.now)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ['-acknowledged_at']
        constraints = [
            models.UniqueConstraint(
                fields=['task', 'user'],
                name='wb_ack_task_user_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['task', 'acknowledged_at'], name='wb_ack_task_at_idx'),
            models.Index(fields=['user', 'acknowledged_at'], name='wb_ack_user_at_idx'),
            models.Index(fields=['facility', 'acknowledged_at'], name='wb_ack_fac_at_idx'),
        ]

    def __str__(self):
        return f'{self.user_id} acknowledged {self.task_id}'

