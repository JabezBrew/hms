"""
Services for consent and cross-facility access tokens.
"""
import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone

from .models import (
    ConsentGrant,
    ConsentAccessToken,
    ConsentStatus,
    CrossFacilityReferral,
    ReferralStatus,
    ConsentScope,
)


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


def issue_access_token(consent_grant: ConsentGrant, target_facility_code: str, ttl_seconds: int = 3600) -> str:
    """
    Issue a short-lived access token for a consent grant.
    """
    now = timezone.now()
    if consent_grant.status != ConsentStatus.ACTIVE:
        raise ValueError("Consent must be active to issue access tokens.")
    if consent_grant.expires_at and consent_grant.expires_at <= now:
        if consent_grant.status == ConsentStatus.ACTIVE:
            consent_grant.status = ConsentStatus.EXPIRED
            consent_grant.save(update_fields=['status', 'updated_at'])
        raise ValueError("Consent has expired.")

    raw_token = secrets.token_urlsafe(32)
    ConsentAccessToken.objects.create(
        consent_grant=consent_grant,
        token_hash=_hash_token(raw_token),
        target_facility_code=target_facility_code,
        expires_at=timezone.now() + timedelta(seconds=ttl_seconds),
    )
    return raw_token


def create_referral(
    patient_identity,
    source_facility_code: str,
    target_facility_code: str,
    reason_code: str = '',
    created_by_facility_code: str = '',
    created_by_user_id=None,
):
    return CrossFacilityReferral.objects.create(
        patient_identity=patient_identity,
        source_facility_code=source_facility_code,
        target_facility_code=target_facility_code,
        reason_code=reason_code or '',
        created_by_facility_code=created_by_facility_code or '',
        created_by_user_id=created_by_user_id,
    )


def grant_consent(
    patient_identity,
    source_facility_code: str,
    target_facility_code: str,
    scope: str = ConsentScope.FULL_RECORD,
    reason: str = '',
    expires_at=None,
    created_by_facility_code: str = '',
    created_by_user_id=None,
):
    return ConsentGrant.objects.create(
        patient_identity=patient_identity,
        source_facility_code=source_facility_code,
        target_facility_code=target_facility_code,
        scope=scope,
        status=ConsentStatus.ACTIVE,
        reason=reason or '',
        granted_at=timezone.now(),
        expires_at=expires_at,
        created_by_facility_code=created_by_facility_code or '',
        created_by_user_id=created_by_user_id,
    )


def accept_referral(referral: CrossFacilityReferral, consent: ConsentGrant):
    referral.status = ReferralStatus.ACCEPTED
    referral.responded_at = timezone.now()
    referral.save(update_fields=['status', 'responded_at', 'updated_at'])
    return consent


def validate_access_token(
    raw_token: str,
    patient_identity_id,
    source_facility_code: str,
    target_facility_code: str,
):
    """
    Validate a consent access token for cross-facility data access.
    """
    now = timezone.now()
    token_hash = _hash_token(raw_token)
    token = ConsentAccessToken.objects.select_related('consent_grant').filter(
        token_hash=token_hash,
        is_active=True,
        expires_at__gt=now,
        target_facility_code=target_facility_code,
    ).first()

    if not token:
        return None

    consent = token.consent_grant
    if consent.status != ConsentStatus.ACTIVE:
        return None
    if consent.expires_at and consent.expires_at <= now:
        if consent.status == ConsentStatus.ACTIVE:
            consent.status = ConsentStatus.EXPIRED
            consent.save(update_fields=['status', 'updated_at'])
        return None
    if consent.patient_identity_id != patient_identity_id:
        return None
    if consent.source_facility_code != source_facility_code:
        return None
    if consent.target_facility_code != target_facility_code:
        return None

    token.last_used_at = now
    token.save(update_fields=['last_used_at'])
    return consent
