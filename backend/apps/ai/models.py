import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.ai.constants import FEATURE_CHOICES, MODEL_ROLE_CHOICES


class AISession(models.Model):
    STATUS_QUEUED = 'queued'
    STATUS_RUNNING = 'running'
    STATUS_COMPLETED = 'completed'
    STATUS_FAILED = 'failed'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = [
        (STATUS_QUEUED, 'Queued'),
        (STATUS_RUNNING, 'Running'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='ai_sessions',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='ai_sessions',
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ai_sessions',
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ai_sessions',
    )

    feature = models.CharField(max_length=40, choices=FEATURE_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_QUEUED)

    request_context_hash = models.CharField(max_length=64, db_index=True)
    request_metadata = models.JSONField(default=dict, blank=True)

    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'feature', '-created_at'], name='ai_ses_fac_feat_created'),
            models.Index(fields=['facility', 'status', '-created_at'], name='ai_ses_fac_status_created'),
            models.Index(fields=['user', '-created_at'], name='ai_session_user_created_idx'),
        ]

    def __str__(self):
        return f"AISession({self.id}, {self.feature}, {self.status})"


class AIMessage(models.Model):
    ROLE_SYSTEM = 'system'
    ROLE_USER = 'user'
    ROLE_ASSISTANT = 'assistant'
    ROLE_TOOL = 'tool'

    ROLE_CHOICES = [
        (ROLE_SYSTEM, 'System'),
        (ROLE_USER, 'User'),
        (ROLE_ASSISTANT, 'Assistant'),
        (ROLE_TOOL, 'Tool'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(AISession, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)

    # Store encrypted source text and a redacted projection for safe diagnostics.
    content_encrypted = models.TextField(blank=True)
    content_redacted = models.TextField(blank=True)

    model_role = models.CharField(max_length=40, blank=True, choices=[(r, r) for r in MODEL_ROLE_CHOICES])
    model_name = models.CharField(max_length=120, blank=True)
    provider = models.CharField(max_length=80, blank=True)

    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    estimated_cost_usd = models.DecimalField(max_digits=12, decimal_places=6, default=Decimal('0'))

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['session', 'created_at'], name='ai_msg_session_created_idx'),
            models.Index(fields=['provider', 'model_name'], name='ai_msg_provider_model_idx'),
        ]

    def __str__(self):
        return f"AIMessage({self.id}, {self.role})"


class AIArtifact(models.Model):
    TYPE_SUMMARY = 'summary'
    TYPE_ANSWER = 'answer'
    TYPE_NOTE_DRAFT = 'note_draft'
    TYPE_NOTE_LINT = 'note_lint'
    TYPE_LAB_INTERPRET = 'lab_interpretation'
    TYPE_OMNI_PARSE = 'omni_parse'
    TYPE_OMNI_PREVIEW = 'omni_preview'
    TYPE_SCRIBE_SECTION_DRAFT = 'scribe_section_draft'
    TYPE_OTHER = 'other'

    ARTIFACT_CHOICES = [
        (TYPE_SUMMARY, 'Summary'),
        (TYPE_ANSWER, 'Answer'),
        (TYPE_NOTE_DRAFT, 'Note Draft'),
        (TYPE_NOTE_LINT, 'Note Lint'),
        (TYPE_LAB_INTERPRET, 'Lab Interpretation'),
        (TYPE_OMNI_PARSE, 'Omni Parse'),
        (TYPE_OMNI_PREVIEW, 'Omni Execute Preview'),
        (TYPE_SCRIBE_SECTION_DRAFT, 'Scribe Section Draft'),
        (TYPE_OTHER, 'Other'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(AISession, on_delete=models.CASCADE, related_name='artifacts')
    artifact_type = models.CharField(max_length=40, choices=ARTIFACT_CHOICES)

    payload_json = models.JSONField(default=dict)
    schema_version = models.CharField(max_length=20, default='1.0')
    confidence_score = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)

    requires_human_review = models.BooleanField(default=True)
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='accepted_ai_artifacts',
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    rejected_reason = models.TextField(blank=True)

    note_entry_id = models.UUIDField(null=True, blank=True)
    lab_result_id = models.UUIDField(null=True, blank=True)
    timeline_event_id = models.UUIDField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['session', 'artifact_type'], name='ai_art_session_type_idx'),
            models.Index(fields=['requires_human_review', '-created_at'], name='ai_art_review_created_idx'),
        ]
        constraints = [
            models.CheckConstraint(
                check=(Q(confidence_score__isnull=True) | (Q(confidence_score__gte=0) & Q(confidence_score__lte=1))),
                name='ai_artifact_confidence_range',
            ),
        ]

    def __str__(self):
        return f"AIArtifact({self.id}, {self.artifact_type})"


class AIFeedback(models.Model):
    THUMB_UP = 'up'
    THUMB_DOWN = 'down'

    THUMB_CHOICES = [
        (THUMB_UP, 'Up'),
        (THUMB_DOWN, 'Down'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    artifact = models.ForeignKey(AIArtifact, on_delete=models.CASCADE, related_name='feedback_entries')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    thumb = models.CharField(max_length=10, choices=THUMB_CHOICES)
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['artifact', 'created_at'], name='ai_feedback_art_created_idx'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['artifact', 'user'], name='ai_feedback_unique_artifact_user'),
        ]

    def __str__(self):
        return f"AIFeedback({self.id}, {self.thumb})"
