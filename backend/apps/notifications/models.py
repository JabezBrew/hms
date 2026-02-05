import uuid

from django.conf import settings
from django.db import models


class InboxItem(models.Model):
    """
    Denormalized inbox entry for O(1) inbox pagination.
    """

    class SourceType(models.TextChoices):
        REFERRAL = 'referral', 'Referral'
        NURSING_ALERT = 'nursing_alert', 'Nursing Alert'
        NURSING_TASK = 'nursing_task', 'Nursing Task'
        DRUG_SAFETY = 'drug_safety', 'Drug Safety'
        LAB_RESULT = 'lab_result', 'Lab Result'

    class PriorityLevel(models.TextChoices):
        ROUTINE = 'routine', 'Routine'
        NORMAL = 'normal', 'Normal'
        URGENT = 'urgent', 'Urgent'
        EMERGENCY = 'emergency', 'Emergency'

    class ItemStatus(models.TextChoices):
        UNREAD = 'unread', 'Unread'
        READ = 'read', 'Read'
        ACKNOWLEDGED = 'acknowledged', 'Acknowledged'
        DONE = 'done', 'Done'
        DISMISSED = 'dismissed', 'Dismissed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='inbox_items'
    )
    recipient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='inbox_items'
    )
    recipient_role = models.CharField(max_length=30, blank=True)

    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inbox_items'
    )

    source_type = models.CharField(max_length=30, choices=SourceType.choices)
    source_id = models.UUIDField()
    title = models.CharField(max_length=200)
    summary = models.CharField(max_length=500, blank=True)
    action_url = models.CharField(max_length=255, blank=True)

    priority = models.CharField(max_length=20, choices=PriorityLevel.choices, default=PriorityLevel.NORMAL)
    status = models.CharField(max_length=20, choices=ItemStatus.choices, default=ItemStatus.UNREAD)
    is_action_required = models.BooleanField(default=False)
    is_read = models.BooleanField(default=False)

    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    dedupe_key = models.CharField(max_length=200, blank=True, db_index=True)

    class Meta:
        ordering = ['-occurred_at']
        indexes = [
            models.Index(fields=['recipient_user', 'status', '-occurred_at']),
            models.Index(fields=['recipient_role', 'facility', 'status', '-occurred_at']),
            models.Index(fields=['facility', 'status', '-occurred_at']),
            models.Index(fields=['patient', '-occurred_at']),
            models.Index(fields=['source_type', 'source_id']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['recipient_user', 'recipient_role', 'source_type', 'source_id'],
                name='notifications_inbox_item_user_source_unique'
            ),
            models.UniqueConstraint(
                fields=['recipient_role', 'source_type', 'source_id', 'dedupe_key'],
                name='notifications_inbox_item_role_source_unique'
            )
        ]

    def __str__(self):
        return f"{self.get_source_type_display()} - {self.title}"
