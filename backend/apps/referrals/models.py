import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone

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
