"""
MFA session helpers and enrollment status checks.
"""
from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Tuple

from django.conf import settings
from django.utils import timezone

from .models import UserMFAProfile, WebAuthnCredential, MFASession
from .mfa import hash_token
from hms_backend.tenancy import facility_context


def is_mfa_required(user) -> bool:
    require_all = bool(getattr(settings, 'MFA_REQUIRED_FOR_ALL', False))
    if require_all:
        return True
    return bool(getattr(settings, 'MFA_REQUIRED_FOR_ADMIN', True)) and user.user_type == 'admin'


def get_or_create_mfa_profile(user) -> UserMFAProfile:
    profile, _ = UserMFAProfile.objects.get_or_create(user=user)
    return profile


def get_mfa_enrollment_status(user) -> dict:
    profile = get_or_create_mfa_profile(user)
    has_totp = bool(profile.totp_confirmed_at)
    has_webauthn = WebAuthnCredential.objects.filter(user=user, is_active=True).exists()
    recovery_remaining = len(profile.recovery_codes or [])
    return {
        'totp_enrolled': has_totp,
        'webauthn_enrolled': has_webauthn,
        'recovery_codes_remaining': recovery_remaining,
    }


def create_mfa_session(
    user,
    facility_code: str,
    enrollment_required: bool,
    purpose: str = 'login',
    ttl_minutes: int | None = None,
) -> Tuple[MFASession, str]:
    if ttl_minutes is None:
        if purpose == 'enrollment':
            ttl_minutes = getattr(settings, 'MFA_ENROLLMENT_TTL_MINUTES', 30)
        else:
            ttl_minutes = getattr(settings, 'MFA_SESSION_TTL_MINUTES', 5)

    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_token(raw_token)

    with facility_context(facility_code):
        session = MFASession.objects.create(
            user=user,
            token_hash=token_hash,
            purpose=purpose,
            facility_code=facility_code or '',
            enrollment_required=enrollment_required,
            expires_at=timezone.now() + timedelta(minutes=ttl_minutes),
        )
    return session, raw_token
