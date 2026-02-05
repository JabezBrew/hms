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
from rest_framework_simplejwt.exceptions import TokenError, TokenBackendError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.state import token_backend
from apps.core.security import normalize_facility_code
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken

from hms_backend.middleware import get_client_ip
from .models import UserSession
from .geolocation import get_cached_location_from_ip

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


def _summarize_user_agent(user_agent: str) -> str:
    ua = (user_agent or '').lower()
    if not ua:
        return ''

    browser = 'Browser'
    if 'chrome' in ua and 'edge' not in ua and 'edg' not in ua:
        browser = 'Chrome'
    elif 'firefox' in ua:
        browser = 'Firefox'
    elif 'safari' in ua and 'chrome' not in ua:
        browser = 'Safari'
    elif 'edg' in ua or 'edge' in ua:
        browser = 'Edge'
    elif 'opera' in ua or 'opr' in ua:
        browser = 'Opera'

    os_name = ''
    if 'windows' in ua:
        os_name = 'Windows'
    elif 'mac os x' in ua or 'macintosh' in ua:
        os_name = 'macOS'
    elif 'android' in ua:
        os_name = 'Android'
    elif 'iphone' in ua or 'ipad' in ua:
        os_name = 'iOS'
    elif 'linux' in ua:
        os_name = 'Linux'

    return f"{browser} on {os_name}" if os_name else browser


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
    user_agent = request.META.get('HTTP_USER_AGENT', '')
    return _summarize_user_agent(user_agent)[:120]


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


def _get_ip_address(request) -> Optional[str]:
    if not request:
        return None
    return get_client_ip(request)


def _schedule_geoip_lookup(session_id: Optional[int], ip_address: Optional[str]) -> None:
    if not session_id or not ip_address:
        return
    from .tasks import update_session_geolocation
    update_session_geolocation.delay(session_id, ip_address)


def _extract_refresh_claims(refresh_token: str, allow_blacklisted: bool = False) -> Optional[RefreshClaims]:
    if not refresh_token:
        return None
    payload = None
    if allow_blacklisted:
        try:
            payload = token_backend.decode(refresh_token, verify=True)
        except TokenBackendError:
            return None
    else:
        try:
            token = RefreshToken(refresh_token)
        except TokenError:
            return None
        payload = token.payload

    try:
        if payload.get(api_settings.TOKEN_TYPE_CLAIM) != 'refresh':
            return None
        user_id = str(payload[api_settings.USER_ID_CLAIM])
        jti = str(payload[api_settings.JTI_CLAIM])
        exp = int(payload['exp'])
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
    ip_address = _get_ip_address(request)
    location = get_cached_location_from_ip(ip_address)

    session = UserSession.objects.create(
        user=user,
        refresh_jti=claims.jti,
        device_label=_get_device_label(request),
        ip_address=ip_address,
        location_city=location.city if location else '',
        location_country=location.country if location else '',
        ip_hash=_get_ip_hash(request),
        user_agent_hash=_get_user_agent_hash(request),
        facility_code=resolved_facility_code or '',
        last_seen_at=timezone.now(),
        expires_at=claims.expires_at,
    )
    if location is None and ip_address:
        _schedule_geoip_lookup(session.id, ip_address)
    return session


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

    old_claims = _extract_refresh_claims(old_refresh_token, allow_blacklisted=True)
    session = None
    if old_claims:
        session = UserSession.objects.filter(refresh_jti=old_claims.jti).first()

    if session and session.revoked_at:
        return session

    ip_hash = _get_ip_hash(request)
    user_agent_hash = _get_user_agent_hash(request)
    device_label = _get_device_label(request)
    resolved_facility_code = _resolve_facility_code(request, facility_code)

    # If we couldn't find session by old JTI, try to find by fingerprint
    if not session and request and hasattr(request, 'user') and request.user.is_authenticated:
        # Look for the most recent active session with matching fingerprint
        session = UserSession.objects.filter(
            user=request.user,
            ip_hash=ip_hash,
            user_agent_hash=user_agent_hash,
            revoked_at__isnull=True
        ).order_by('-last_seen_at').first()

    if session:
        new_ip = _get_ip_address(request)
        ip_changed = new_ip != session.ip_address
        location = None
        update_fields = ['refresh_jti', 'expires_at', 'last_seen_at', 'ip_address', 'ip_hash', 'user_agent_hash', 'updated_at']
        session.refresh_jti = new_claims.jti
        session.expires_at = new_claims.expires_at
        session.last_seen_at = timezone.now()
        session.ip_address = new_ip
        if ip_changed or not (session.location_city or session.location_country):
            location = get_cached_location_from_ip(new_ip)
            session.location_city = location.city if location else ''
            session.location_country = location.country if location else ''
            update_fields.extend(['location_city', 'location_country'])
        session.ip_hash = ip_hash
        session.user_agent_hash = user_agent_hash
        if device_label:
            session.device_label = device_label
            update_fields.append('device_label')
        if resolved_facility_code:
            session.facility_code = resolved_facility_code
            update_fields.append('facility_code')
        session.save(update_fields=update_fields)
        if location is None and new_ip and (ip_changed or not (session.location_city or session.location_country)):
            _schedule_geoip_lookup(session.id, new_ip)
        return session

    # No existing session found - create one
    # This handles cases where session was never created or was cleaned up
    if request and hasattr(request, 'user') and request.user.is_authenticated:
        new_ip = _get_ip_address(request)
        location = get_cached_location_from_ip(new_ip)
        session = UserSession.objects.create(
            user=request.user,
            refresh_jti=new_claims.jti,
            device_label=device_label or _get_device_label(request),
            ip_address=new_ip,
            location_city=location.city if location else '',
            location_country=location.country if location else '',
            ip_hash=ip_hash,
            user_agent_hash=user_agent_hash,
            facility_code=resolved_facility_code or '',
            last_seen_at=timezone.now(),
            expires_at=new_claims.expires_at,
        )
        if location is None and new_ip:
            _schedule_geoip_lookup(session.id, new_ip)
        return session

    return None


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


def revoke_session_by_refresh_token(refresh_token: str, revoked_by=None, request=None) -> Optional[UserSession]:
    """
    Revoke a session by its refresh token.
    Falls back to fingerprint matching if JTI lookup fails.
    """
    claims = _extract_refresh_claims(refresh_token)
    if not claims:
        return None

    # Try to find session by JTI first
    session = UserSession.objects.filter(refresh_jti=claims.jti).first()

    # Fallback: find by user + fingerprint if JTI lookup fails
    if not session and request:
        ip_hash = _get_ip_hash(request)
        user_agent_hash = _get_user_agent_hash(request)
        user_id = claims.user_id

        session = UserSession.objects.filter(
            user_id=user_id,
            ip_hash=ip_hash,
            user_agent_hash=user_agent_hash,
            revoked_at__isnull=True
        ).order_by('-last_seen_at').first()

    if session:
        revoke_session(session, revoked_by=revoked_by)
    return session


def get_refresh_jti_from_request(request) -> str:
    if not request:
        return ''
    refresh_token = request.COOKIES.get(settings.JWT_AUTH_REFRESH_COOKIE)
    claims = _extract_refresh_claims(refresh_token)
    return claims.jti if claims else ''


def get_current_session_from_request(request) -> Optional[UserSession]:
    """
    Get the current session from the request's refresh token.
    Falls back to matching by user + fingerprint if JTI lookup fails.
    """
    if not request or not hasattr(request, 'user') or not request.user.is_authenticated:
        return None

    refresh_token = request.COOKIES.get(settings.JWT_AUTH_REFRESH_COOKIE)
    claims = _extract_refresh_claims(refresh_token)

    if claims:
        # Try to find session by JTI first (preferred)
        session = UserSession.objects.filter(
            refresh_jti=claims.jti,
            revoked_at__isnull=True
        ).first()
        if session:
            return session

    # Fallback: find the most recently active session for this user
    # that matches the current request fingerprint
    ip_hash = _get_ip_hash(request)
    user_agent_hash = _get_user_agent_hash(request)

    return UserSession.objects.filter(
        user=request.user,
        ip_hash=ip_hash,
        user_agent_hash=user_agent_hash,
        revoked_at__isnull=True
    ).order_by('-last_seen_at').first()


def revoke_sessions_for_user(user, revoked_by=None, exclude_session_id: int | None = None) -> int:
    """
    Revoke all sessions for a user, optionally excluding a specific session.
    """
    qs = UserSession.objects.filter(user=user, revoked_at__isnull=True)
    if exclude_session_id:
        qs = qs.exclude(id=exclude_session_id)

    revoked_count = 0
    for session in qs.iterator():
        revoke_session(session, revoked_by=revoked_by)
        revoked_count += 1
    return revoked_count
