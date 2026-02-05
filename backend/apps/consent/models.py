import uuid

from django.db import models


class ConsentStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    ACTIVE = 'active', 'Active'
    REVOKED = 'revoked', 'Revoked'
    EXPIRED = 'expired', 'Expired'


class ConsentScope(models.TextChoices):
    FULL_RECORD = 'full_record', 'Full Record'


class ReferralStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    ACCEPTED = 'accepted', 'Accepted'
    DECLINED = 'declined', 'Declined'
    CANCELLED = 'cancelled', 'Cancelled'


class ConsentGrant(models.Model):
    """
    Control-plane consent grant for cross-facility access.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_identity = models.ForeignKey(
        'mpi.PatientIdentity',
        on_delete=models.CASCADE,
        related_name='consent_grants'
    )
    source_facility_code = models.CharField(max_length=20)
    target_facility_code = models.CharField(max_length=20)
    scope = models.CharField(max_length=50, choices=ConsentScope.choices)
    status = models.CharField(max_length=20, choices=ConsentStatus.choices, default=ConsentStatus.PENDING)
    reason = models.CharField(max_length=200, blank=True)

    granted_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    created_by_facility_code = models.CharField(max_length=20, blank=True)
    created_by_user_id = models.UUIDField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['patient_identity', 'status']),
            models.Index(fields=['source_facility_code', 'target_facility_code']),
            models.Index(fields=['expires_at']),
        ]
        ordering = ['-created_at']
        verbose_name = 'Consent Grant'
        verbose_name_plural = 'Consent Grants'

    def __str__(self):
        return f"{self.patient_identity_id} {self.source_facility_code}->{self.target_facility_code}"


class CrossFacilityReferral(models.Model):
    """
    Control-plane referral request between facilities (non-PHI metadata only).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_identity = models.ForeignKey(
        'mpi.PatientIdentity',
        on_delete=models.CASCADE,
        related_name='referrals'
    )
    source_facility_code = models.CharField(max_length=20)
    target_facility_code = models.CharField(max_length=20)
    status = models.CharField(max_length=20, choices=ReferralStatus.choices, default=ReferralStatus.PENDING)
    reason_code = models.CharField(max_length=100, blank=True)

    created_by_facility_code = models.CharField(max_length=20, blank=True)
    created_by_user_id = models.UUIDField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    decline_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['patient_identity', 'status']),
            models.Index(fields=['source_facility_code', 'target_facility_code']),
        ]
        ordering = ['-created_at']
        verbose_name = 'Cross-Facility Referral'
        verbose_name_plural = 'Cross-Facility Referrals'

    def __str__(self):
        return f"{self.patient_identity_id} {self.source_facility_code}->{self.target_facility_code}"


class ConsentAccessToken(models.Model):
    """
    Short-lived access token for a consent grant.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    consent_grant = models.ForeignKey(
        ConsentGrant,
        on_delete=models.CASCADE,
        related_name='access_tokens'
    )
    token_hash = models.CharField(max_length=64, db_index=True)
    target_facility_code = models.CharField(max_length=20)
    expires_at = models.DateTimeField()
    last_used_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['target_facility_code', 'expires_at']),
        ]
        ordering = ['-created_at']
        verbose_name = 'Consent Access Token'
        verbose_name_plural = 'Consent Access Tokens'

    def __str__(self):
        return f"{self.consent_grant_id}:{self.target_facility_code}"
