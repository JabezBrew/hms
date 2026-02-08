import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db.models import Q

User = get_user_model()


class ReferralStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    PENDING = 'pending', 'Pending Acceptance'
    ACCEPTED = 'accepted', 'Accepted'
    SCHEDULED = 'scheduled', 'Appointment Scheduled'
    COMPLETED = 'completed', 'Completed'
    DECLINED = 'declined', 'Declined'
    CANCELLED = 'cancelled', 'Cancelled'


class ReferralUrgency(models.TextChoices):
    ROUTINE = 'routine', 'Routine'
    URGENT = 'urgent', 'Urgent'
    EMERGENCY = 'emergency', 'Emergency'


class Referral(models.Model):
    """
    Patient referral to specialist or department.
    Tracks the complete referral workflow from submission to completion.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    referral_number = models.CharField(
        max_length=20,
        unique=True,
        help_text="Unique referral identifier (auto-generated)"
    )

    # Patient and context
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='referrals'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='referrals',
        help_text="Facility context for this referral"
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='referrals',
        help_text="Encounter during which referral was made"
    )

    # Referring provider
    referring_provider = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.CASCADE,
        related_name='sent_referrals',
        help_text="Provider making the referral"
    )
    referring_department = models.CharField(
        max_length=100,
        blank=True,
        help_text="Department of referring provider"
    )

    # Referral destination
    referred_to_provider = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='received_referrals',
        help_text="Specific specialist (optional)"
    )
    referred_to_department = models.CharField(
        max_length=100,
        help_text="Target department (e.g., 'Cardiology', 'Orthopedics')"
    )
    referred_to_specialty = models.CharField(
        max_length=100,
        help_text="Target specialty"
    )

    # Referral details
    urgency = models.CharField(
        max_length=20,
        choices=ReferralUrgency.choices,
        default=ReferralUrgency.ROUTINE
    )
    status = models.CharField(
        max_length=20,
        choices=ReferralStatus.choices,
        default=ReferralStatus.DRAFT
    )
    reason = models.TextField(
        help_text="Primary reason for referral"
    )
    clinical_summary = models.TextField(
        blank=True,
        help_text="Relevant clinical history and findings"
    )
    questions_for_specialist = models.TextField(
        blank=True,
        help_text="Specific questions or consultation requests"
    )

    # Specialist response
    specialist_notes = models.TextField(
        blank=True,
        help_text="Specialist's notes and findings"
    )
    recommendations = models.TextField(
        blank=True,
        help_text="Specialist's recommendations back to referring provider"
    )

    # Scheduling
    scheduled_appointment_id = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Linked appointment ID (can be FHIR Appointment ID or local ID)"
    )

    # Referral type (determines encounter handling)
    referral_type = models.CharField(
        max_length=20,
        choices=[('inpatient', 'Inpatient'), ('opd', 'Outpatient')],
        default='opd',
        help_text="Type of referral - determines encounter handling"
    )

    # Consultation workflow linkage
    consultation_workflow = models.ForeignKey(
        'workflows.ClinicalWorkflow',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='referrals',
        help_text="Consultation workflow created for this referral"
    )
    consultation_encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='consultation_referrals',
        help_text="Encounter created for specialist consultation (for OPD referrals)"
    )

    # Status tracking timestamps
    submitted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When referral was submitted"
    )
    accepted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When specialist accepted the referral"
    )
    completed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When consultation/referral was completed"
    )
    declined_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When specialist declined the referral"
    )
    decline_reason = models.TextField(
        blank=True,
        help_text="Reason for declining (if applicable)"
    )

    # FHIR sync
    fhir_id = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        unique=True,
        help_text="FHIR ServiceRequest resource ID"
    )
    fhir_synced = models.BooleanField(default=False)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Referral'
        verbose_name_plural = 'Referrals'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['referral_number']),
            models.Index(fields=['referring_provider', 'status']),
            models.Index(fields=['referred_to_provider', 'status']),
            models.Index(fields=['referred_to_department', 'status']),
            models.Index(fields=['urgency', 'status']),
            models.Index(fields=['submitted_at']),
            models.Index(fields=['facility', 'status']),
        ]

    def __str__(self):
        return f"Referral {self.referral_number} - {self.patient.user.get_full_name()} to {self.referred_to_department}"

    def save(self, *args, **kwargs):
        """Generate referral number if not set."""
        if not self.referral_number:
            # Generate referral number: REF-YYYYMMDD-####
            from django.db.models import Max
            today = timezone.now().strftime('%Y%m%d')
            prefix = f"REF-{today}"
            last_referral = Referral.objects.filter(referral_number__startswith=prefix).aggregate(
                Max('referral_number')
            )
            if last_referral['referral_number__max']:
                last_num = int(last_referral['referral_number__max'].split('-')[-1])
                self.referral_number = f"{prefix}-{last_num + 1:04d}"
            else:
                self.referral_number = f"{prefix}-0001"
        super().save(*args, **kwargs)

    @property
    def is_urgent(self):
        """Check if referral is urgent or emergency."""
        return self.urgency in [ReferralUrgency.URGENT, ReferralUrgency.EMERGENCY]

    @property
    def days_since_submission(self):
        """Calculate days since referral was submitted."""
        if self.submitted_at:
            return (timezone.now() - self.submitted_at).days
        return None

    @property
    def requires_action(self):
        """Check if referral requires action (pending or scheduled without completion)."""
        return self.status in [ReferralStatus.PENDING, ReferralStatus.SCHEDULED]


class ReferralNotificationEvent(models.TextChoices):
    SUBMITTED = 'submitted', 'Submitted'
    ACCEPTED = 'accepted', 'Accepted'
    DECLINED = 'declined', 'Declined'
    SCHEDULED = 'scheduled', 'Scheduled'
    COMPLETED = 'completed', 'Completed'


class ReferralNotification(models.Model):
    """
    In-app notification for referral workflow events.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='referral_notifications'
    )
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='referral_notifications_sent'
    )
    referral = models.ForeignKey(
        'referrals.Referral',
        on_delete=models.CASCADE,
        related_name='notifications'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='referral_notifications'
    )
    event = models.CharField(max_length=20, choices=ReferralNotificationEvent.choices)
    status = models.CharField(max_length=20, choices=ReferralStatus.choices)
    urgency = models.CharField(max_length=20, choices=ReferralUrgency.choices)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read', '-created_at']),
            models.Index(fields=['facility', '-created_at']),
            models.Index(fields=['event', '-created_at']),
        ]

    def __str__(self):
        return f"Referral {self.referral.referral_number} - {self.get_event_display()}"


class ReferralSLAPolicy(models.Model):
    """SLA target configuration per facility/department/urgency."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='referral_sla_policies'
    )
    referred_to_department = models.CharField(
        max_length=100,
        blank=True,
        default='',
        help_text='Optional department-specific override. Blank means facility-wide default.'
    )
    urgency = models.CharField(max_length=20, choices=ReferralUrgency.choices)
    target_hours = models.PositiveIntegerField(help_text='Target time to first consult in hours.')
    warning_thresholds = models.JSONField(
        default=list,
        blank=True,
        help_text='Percentage thresholds for alerts, e.g. [50, 75, 90].'
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_referral_sla_policies'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_referral_sla_policies'
    )

    class Meta:
        ordering = ['facility_id', 'referred_to_department', 'urgency']
        constraints = [
            models.UniqueConstraint(
                fields=['facility', 'referred_to_department', 'urgency'],
                name='unique_referral_sla_policy_scope'
            )
        ]
        indexes = [
            models.Index(fields=['facility', 'is_active']),
            models.Index(fields=['facility', 'urgency', 'is_active']),
            models.Index(fields=['facility', 'referred_to_department', 'is_active']),
        ]

    def __str__(self):
        scope = self.referred_to_department or 'Facility Default'
        return f"{self.facility.code} {scope} {self.urgency} {self.target_hours}h"


class ReferralSLAEventType(models.TextChoices):
    THRESHOLD_50 = 'threshold_50', '50% Threshold'
    THRESHOLD_75 = 'threshold_75', '75% Threshold'
    THRESHOLD_90 = 'threshold_90', '90% Threshold'
    BREACH = 'breach', 'SLA Breach'


class ReferralSLAEvent(models.Model):
    """Auditable SLA threshold/breach events for referrals."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    referral = models.ForeignKey(
        Referral,
        on_delete=models.CASCADE,
        related_name='sla_events'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='referral_sla_events'
    )
    event_type = models.CharField(max_length=20, choices=ReferralSLAEventType.choices)
    consumed_percent = models.PositiveSmallIntegerField(default=0)
    target_hours = models.PositiveIntegerField(default=0)
    remaining_hours = models.IntegerField(null=True, blank=True)
    deadline_at = models.DateTimeField(null=True, blank=True)
    triggered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-triggered_at']
        constraints = [
            models.UniqueConstraint(
                fields=['referral', 'event_type'],
                name='unique_referral_sla_event_once'
            )
        ]
        indexes = [
            models.Index(fields=['facility', 'event_type', '-triggered_at']),
            models.Index(fields=['referral', '-triggered_at']),
        ]

    def __str__(self):
        return f"{self.referral.referral_number} {self.event_type}"


class ClinicWaitlistEntryStatus(models.TextChoices):
    WAITING = 'waiting', 'Waiting'
    OFFERED = 'offered', 'Offer Sent'
    PROMOTED = 'promoted', 'Promoted to Booking'
    EXPIRED = 'expired', 'Offer Expired'
    CANCELLED = 'cancelled', 'Cancelled'


class ClinicWaitlistRisk(models.TextChoices):
    RED = 'red', 'Red'
    AMBER = 'amber', 'Amber'
    GREEN = 'green', 'Green'
    NONE = 'none', 'None'


class ClinicWaitlistEntry(models.Model):
    """Clinic session waitlist entry with deterministic triage/ranking attributes."""

    class Source(models.TextChoices):
        BOOKING = 'booking', 'Booking Full'
        REFERRAL = 'referral', 'Referral'
        MANUAL = 'manual', 'Manual Entry'
        WALK_IN = 'walk_in', 'Walk-In'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='clinic_waitlist_entries'
    )
    clinic = models.ForeignKey(
        'organization.Clinic',
        on_delete=models.PROTECT,
        related_name='waitlist_entries'
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='clinic_waitlist_entries'
    )
    referral = models.ForeignKey(
        Referral,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='waitlist_entries'
    )
    preferred_practitioner = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='preferred_waitlist_entries'
    )
    requested_start_time = models.DateTimeField()
    requested_end_time = models.DateTimeField()
    urgency = models.CharField(max_length=20, choices=ReferralUrgency.choices, default=ReferralUrgency.ROUTINE)
    deadline_risk = models.CharField(
        max_length=12,
        choices=ClinicWaitlistRisk.choices,
        default=ClinicWaitlistRisk.NONE
    )
    vulnerability_flag = models.BooleanField(default=False)
    status = models.CharField(
        max_length=20,
        choices=ClinicWaitlistEntryStatus.choices,
        default=ClinicWaitlistEntryStatus.WAITING
    )
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    notes = models.TextField(blank=True)
    wait_started_at = models.DateTimeField(auto_now_add=True)
    offer_sent_at = models.DateTimeField(null=True, blank=True)
    offer_expires_at = models.DateTimeField(null=True, blank=True)
    promoted_appointment = models.ForeignKey(
        'appointments.Appointment',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promoted_waitlist_entries'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_clinic_waitlist_entries'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_clinic_waitlist_entries'
    )

    class Meta:
        ordering = ['wait_started_at']
        constraints = [
            models.CheckConstraint(
                check=Q(requested_start_time__lt=models.F('requested_end_time')),
                name='clinic_waitlist_start_before_end'
            ),
            models.UniqueConstraint(
                fields=['clinic', 'patient'],
                condition=Q(status__in=[ClinicWaitlistEntryStatus.WAITING, ClinicWaitlistEntryStatus.OFFERED]),
                name='unique_active_waitlist_per_clinic_patient'
            )
        ]
        indexes = [
            models.Index(fields=['facility', 'status', 'wait_started_at']),
            models.Index(fields=['clinic', 'status', 'wait_started_at']),
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['referral', 'status']),
            models.Index(fields=['urgency', 'deadline_risk', 'vulnerability_flag']),
        ]

    def __str__(self):
        return f"{self.patient_id} {self.clinic_id} {self.status}"
