"""
Session tracking utilities for per-device session management.
"""
from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from typing import Optional
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from apps.core.security import normalize_facility_code
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken

from hms_backend.middleware import get_client_ip
from .models import UserSession

User = get_user_model()


@dataclass(frozen=True)
class RefreshClaims:
    user_id: str
    jti: str
    expires_at: timezone.datetime


def _hash_value(value: Optional[str]) -> str:
    if not value:
        return ''
    salt = getattr(settings, 'SESSION_HASH_SALT', settings.SECRET_KEY)
    salt_bytes = str(salt).encode('utf-8')
    return hmac.new(salt_bytes, value.encode('utf-8'), hashlib.sha256).hexdigest()


def _get_device_label(request) -> str:
    if not request:
        return ''
    header_label = request.headers.get('X-Device-Label') or request.META.get('HTTP_X_DEVICE_LABEL')
    if header_label:
        return str(header_label).strip()[:120]
    try:
        payload_label = request.data.get('device_label')
    except Exception:
        payload_label = None
    if payload_label:
        return str(payload_label).strip()[:120]
    return ''


def _get_user_agent_hash(request) -> str:
    if not request:
        return ''
    user_agent = request.META.get('HTTP_USER_AGENT', '')
    return _hash_value(user_agent)


def _get_ip_hash(request) -> str:
    if not request:
        return ''
    client_ip = get_client_ip(request)
    return _hash_value(client_ip)


def _extract_refresh_claims(refresh_token: str) -> Optional[RefreshClaims]:
    if not refresh_token:
        return None
    try:
        token = RefreshToken(refresh_token)
    except TokenError:
        return None

    try:
        user_id = str(token['user_id'])
        jti = str(token['jti'])
        exp = int(token['exp'])
    except (KeyError, TypeError, ValueError):
        return None

    expires_at = datetime.fromtimestamp(exp, tz=dt_timezone.utc)
    return RefreshClaims(user_id=user_id, jti=jti, expires_at=expires_at)


def _resolve_facility_code(request, facility_code: Optional[str]) -> Optional[str]:
    if request:
        request_code = normalize_facility_code(getattr(request, 'facility_code', None))
        if request_code:
            return request_code
        request_facility = getattr(request, 'facility', None)
        if request_facility and getattr(request_facility, 'code', None):
            return normalize_facility_code(request_facility.code)
    return normalize_facility_code(facility_code)


def record_login_session(request, user, refresh_token: str, facility_code: str | None = None) -> Optional[UserSession]:
    claims = _extract_refresh_claims(refresh_token)
    if not claims:
        return None

    resolved_facility_code = _resolve_facility_code(request, facility_code)

    return UserSession.objects.create(
        user=user,
        refresh_jti=claims.jti,
        device_label=_get_device_label(request),
        ip_hash=_get_ip_hash(request),
        user_agent_hash=_get_user_agent_hash(request),
        facility_code=resolved_facility_code or '',
        last_seen_at=timezone.now(),
        expires_at=claims.expires_at,
    )


def touch_session(request, refresh_token: str) -> Optional[UserSession]:
    claims = _extract_refresh_claims(refresh_token)
    if not claims:
        return None

    session = UserSession.objects.filter(refresh_jti=claims.jti).first()
    if not session or session.revoked_at:
        return session

    session.last_seen_at = timezone.now()
    session.ip_hash = _get_ip_hash(request)
    session.user_agent_hash = _get_user_agent_hash(request)
    session.save(update_fields=['last_seen_at', 'ip_hash', 'user_agent_hash', 'updated_at'])
    return session


def rotate_session(
    request,
    old_refresh_token: str,
    new_refresh_token: str,
    facility_code: str | None = None,
) -> Optional[UserSession]:
    new_claims = _extract_refresh_claims(new_refresh_token)
    if not new_claims:
        return None

    old_claims = _extract_refresh_claims(old_refresh_token)
    session = None
    if old_claims:
        session = UserSession.objects.filter(refresh_jti=old_claims.jti).first()

    if session and session.revoked_at:
        return session

    ip_hash = _get_ip_hash(request)
    user_agent_hash = _get_user_agent_hash(request)
    device_label = _get_device_label(request)
    resolved_facility_code = _resolve_facility_code(request, facility_code)

    if session:
        update_fields = ['refresh_jti', 'expires_at', 'last_seen_at', 'ip_hash', 'user_agent_hash', 'updated_at']
        session.refresh_jti = new_claims.jti
        session.expires_at = new_claims.expires_at
        session.last_seen_at = timezone.now()
        session.ip_hash = ip_hash
        session.user_agent_hash = user_agent_hash
        if device_label:
            session.device_label = device_label
            update_fields.append('device_label')
        if resolved_facility_code:
            session.facility_code = resolved_facility_code
            update_fields.append('facility_code')
        session.save(update_fields=update_fields)
        return session

    user = User.objects.filter(id=new_claims.user_id).first()
    if not user:
        return None

    return UserSession.objects.create(
        user=user,
        refresh_jti=new_claims.jti,
        device_label=device_label,
        ip_hash=ip_hash,
        user_agent_hash=user_agent_hash,
        facility_code=resolved_facility_code or '',
        last_seen_at=timezone.now(),
        expires_at=new_claims.expires_at,
    )


def _blacklist_refresh_jti(refresh_jti: str) -> None:
    if not refresh_jti:
        return
    token = OutstandingToken.objects.filter(jti=refresh_jti).first()
    if token:
        BlacklistedToken.objects.get_or_create(token=token)


def revoke_session(session: UserSession, revoked_by=None) -> UserSession:
    if session.revoked_at:
        return session
    session.revoked_at = timezone.now()
    if revoked_by:
        session.revoked_by = revoked_by
    session.save(update_fields=['revoked_at', 'revoked_by', 'updated_at'])
    _blacklist_refresh_jti(session.refresh_jti)
    return session


def revoke_session_by_refresh_token(refresh_token: str, revoked_by=None) -> Optional[UserSession]:
    claims = _extract_refresh_claims(refresh_token)
    if not claims:
        return None
    session = UserSession.objects.filter(refresh_jti=claims.jti).first()
    if session:
        revoke_session(session, revoked_by=revoked_by)
    return session


def get_refresh_jti_from_request(request) -> str:
    if not request:
        return ''
    refresh_token = request.COOKIES.get(settings.JWT_AUTH_REFRESH_COOKIE)
    claims = _extract_refresh_claims(refresh_token)
    return claims.jti if claims else ''


def revoke_sessions_for_user(user, revoked_by=None, exclude_jti: str | None = None) -> int:
    qs = UserSession.objects.filter(user=user, revoked_at__isnull=True)
    if exclude_jti:
        qs = qs.exclude(refresh_jti=exclude_jti)

    revoked_count = 0
    for session in qs.iterator():
        revoke_session(session, revoked_by=revoked_by)
        revoked_count += 1
    return revoked_count
