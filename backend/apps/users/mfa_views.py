"""
MFA enrollment and verification endpoints.
"""
from __future__ import annotations

import base64
import json
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from hms_backend.throttling import MFARecoveryThrottle

from apps.audit.models import AuditAction
from apps.audit.services import AuditService
from hms_backend.auth_utils import build_auth_response
from hms_backend.tenancy import set_current_facility_code

from .mfa import (
    decrypt_secret,
    encrypt_secret,
    generate_recovery_codes,
    generate_totp_secret,
    hash_recovery_code,
    hash_token,
    totp_provisioning_uri,
    verify_totp_code,
)
from .mfa_service import create_mfa_session, get_mfa_enrollment_status, get_or_create_mfa_profile
from .models import MFASession, WebAuthnCredential

try:
    from webauthn import (
        generate_registration_options,
        generate_authentication_options,
        verify_registration_response,
        verify_authentication_response,
    )
    from webauthn.helpers import (
        options_to_json,
        parse_registration_credential_json,
        parse_authentication_credential_json,
    )
    from webauthn.helpers.structs import (
        AttestationConveyancePreference,
        AuthenticatorSelectionCriteria,
        PublicKeyCredentialDescriptor,
        PublicKeyCredentialType,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    )
except Exception:  # pragma: no cover - optional when dependency missing
    generate_registration_options = None
    generate_authentication_options = None
    verify_registration_response = None
    verify_authentication_response = None
    options_to_json = None
    parse_registration_credential_json = None
    parse_authentication_credential_json = None
    AttestationConveyancePreference = None
    AuthenticatorSelectionCriteria = None
    PublicKeyCredentialDescriptor = None
    PublicKeyCredentialType = None
    ResidentKeyRequirement = None
    UserVerificationRequirement = None


def _base64url_to_bytes(value: str) -> bytes:
    padding = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _bytes_to_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode('utf-8').rstrip('=')


def _get_mfa_session(request) -> MFASession:
    raw_token = request.headers.get('X-MFA-Session') or request.data.get('mfa_session')
    if not raw_token:
        return None
    token_hash = hash_token(str(raw_token))
    session = MFASession.objects.select_related('user').filter(token_hash=token_hash).first()
    if not session:
        return None
    if session.expires_at <= timezone.now():
        return None
    if session.facility_code:
        set_current_facility_code(session.facility_code)
    return session


def _get_user_and_session(request):
    if request.user and request.user.is_authenticated:
        return request.user, None
    session = _get_mfa_session(request)
    if session:
        return session.user, session
    return None, None


def _ensure_webauthn_available():
    if generate_registration_options is None or verify_registration_response is None:
        raise RuntimeError("webauthn is required for WebAuthn support.")


def _allowed_origins():
    return getattr(settings, 'WEBAUTHN_ALLOWED_ORIGINS', [])


def _verify_with_origins(verify_func, expected_challenge, expected_rp_id, **kwargs):
    last_error = None
    for origin in _allowed_origins():
        try:
            return verify_func(
                expected_challenge=expected_challenge,
                expected_origin=origin,
                expected_rp_id=expected_rp_id,
                **kwargs
            )
        except Exception as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise RuntimeError("No allowed WebAuthn origins configured.")


def _parse_registration_credential(credential):
    if parse_registration_credential_json and isinstance(credential, dict):
        return parse_registration_credential_json(json.dumps(credential))
    return credential


def _parse_authentication_credential(credential):
    if parse_authentication_credential_json and isinstance(credential, dict):
        return parse_authentication_credential_json(json.dumps(credential))
    return credential


def _complete_session(request, session: MFASession):
    session.completed_at = timezone.now()
    session.save(update_fields=['completed_at', 'updated_at'])

    response = build_auth_response(request, session.user, facility_code=session.facility_code)
    try:
        AuditService.log_authentication(request, action=AuditAction.LOGIN, user=session.user)
    except Exception:
        pass

    access_context = response.data.get('access_context') or {}
    if access_context.get('is_offsite'):
        try:
            AuditService.log_authentication(
                request,
                action=AuditAction.OFFSITE_ACCESS,
                user=session.user
            )
        except Exception:
            pass
    return response


class MFAStatusView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        user, session = _get_user_and_session(request)
        if not user:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)

        status_payload = get_mfa_enrollment_status(user)
        if session:
            status_payload['enrollment_required'] = bool(session.enrollment_required)
        else:
            status_payload['enrollment_required'] = not (
                status_payload['totp_enrolled'] or status_payload['webauthn_enrolled']
            )
        return Response(status_payload)


class MFATOTPStartView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        user, session = _get_user_and_session(request)
        if not user:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_mfa_profile(user)
        secret = generate_totp_secret()
        profile.totp_secret_encrypted = encrypt_secret(secret)
        profile.totp_confirmed_at = None
        profile.save(update_fields=['totp_secret_encrypted', 'totp_confirmed_at', 'updated_at'])

        return Response({
            'secret': secret,
            'otpauth_url': totp_provisioning_uri(secret, user.email),
        })


class MFATOTPConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        session = _get_mfa_session(request)
        user = session.user if session else request.user if request.user.is_authenticated else None
        if not user:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)

        code = request.data.get('code')
        if not code:
            return Response({'detail': 'Code is required.'}, status=status.HTTP_400_BAD_REQUEST)

        profile = get_or_create_mfa_profile(user)
        if not profile.totp_secret_encrypted:
            return Response({'detail': 'TOTP setup not started.'}, status=status.HTTP_409_CONFLICT)

        secret = decrypt_secret(profile.totp_secret_encrypted)
        if not verify_totp_code(secret, str(code)):
            return Response({'detail': 'Invalid code.'}, status=status.HTTP_400_BAD_REQUEST)

        profile.totp_confirmed_at = timezone.now()
        profile.totp_last_used_at = timezone.now()
        profile.save(update_fields=['totp_confirmed_at', 'totp_last_used_at', 'updated_at'])

        if session:
            session.totp_verified = True
            session.webauthn_verified = True  # TOTP alone is sufficient
            session.save(update_fields=['totp_verified', 'webauthn_verified', 'updated_at'])
            return _complete_session(request, session)

        return Response({'detail': 'TOTP confirmed.'})


class MFARecoveryGenerateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        profile = get_or_create_mfa_profile(user)

        raw_codes = generate_recovery_codes()
        hashed = [hash_recovery_code(code, str(user.id)) for code in raw_codes]
        profile.recovery_codes = hashed
        profile.recovery_codes_generated_at = timezone.now()
        profile.save(update_fields=['recovery_codes', 'recovery_codes_generated_at', 'updated_at'])

        return Response({'codes': raw_codes})


class MFARecoveryVerifyView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [MFARecoveryThrottle]

    def post(self, request):
        session = _get_mfa_session(request)
        if not session:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)

        code = request.data.get('code')
        if not code:
            return Response({'detail': 'Code is required.'}, status=status.HTTP_400_BAD_REQUEST)

        profile = get_or_create_mfa_profile(session.user)
        hashed = hash_recovery_code(str(code), str(session.user.id))
        if hashed not in (profile.recovery_codes or []):
            return Response({'detail': 'Invalid recovery code.'}, status=status.HTTP_400_BAD_REQUEST)

        profile.recovery_codes = [c for c in profile.recovery_codes if c != hashed]
        profile.save(update_fields=['recovery_codes', 'updated_at'])

        session.totp_verified = True
        session.webauthn_verified = True
        session.save(update_fields=['totp_verified', 'webauthn_verified', 'updated_at'])
        return _complete_session(request, session)


class MFAWebAuthnRegistrationOptionsView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            _ensure_webauthn_available()
        except RuntimeError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        user, session = _get_user_and_session(request)
        session_token = None
        if not user:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not session:
            session, session_token = create_mfa_session(
                user=user,
                facility_code=request.headers.get('X-Facility-Code', ''),
                enrollment_required=False,
                purpose='enrollment',
            )

        rp_id = settings.WEBAUTHN_RP_ID
        rp_name = settings.WEBAUTHN_RP_NAME
        timeout_ms = settings.WEBAUTHN_TIMEOUT_MS

        exclude = []
        for cred in WebAuthnCredential.objects.filter(user=user, is_active=True):
            exclude.append(PublicKeyCredentialDescriptor(
                id=_base64url_to_bytes(cred.credential_id),
                type=PublicKeyCredentialType.PUBLIC_KEY,
            ))

        options = generate_registration_options(
            rp_id=rp_id,
            rp_name=rp_name,
            user_id=str(user.id).encode('utf-8'),
            user_name=user.email,
            user_display_name=user.get_full_name() or user.email,
            timeout=timeout_ms,
            exclude_credentials=exclude,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            attestation=AttestationConveyancePreference.NONE,
        )
        options_dict = json.loads(options_to_json(options))
        session.webauthn_challenge = options_dict.get('challenge', '')
        session.webauthn_challenge_type = 'registration'
        session.webauthn_challenge_expires_at = timezone.now() + timedelta(minutes=5)
        session.save(update_fields=['webauthn_challenge', 'webauthn_challenge_type', 'webauthn_challenge_expires_at', 'updated_at'])

        if session_token:
            options_dict['mfa_session'] = session_token
        return Response(options_dict)


class MFAWebAuthnRegistrationVerifyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            _ensure_webauthn_available()
        except RuntimeError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        session = _get_mfa_session(request)
        if not session:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)

        if session.webauthn_challenge_type != 'registration':
            return Response({'detail': 'No active WebAuthn registration.'}, status=status.HTTP_409_CONFLICT)
        if session.webauthn_challenge_expires_at and session.webauthn_challenge_expires_at <= timezone.now():
            return Response({'detail': 'WebAuthn challenge expired.'}, status=status.HTTP_400_BAD_REQUEST)

        credential = request.data.get('credential')
        if not credential:
            return Response({'detail': 'Credential payload required.'}, status=status.HTTP_400_BAD_REQUEST)
        credential = _parse_registration_credential(credential)

        transports = []
        if isinstance(credential, dict):
            transports = credential.get('response', {}).get('transports') or []

        try:
            verification = _verify_with_origins(
                verify_registration_response,
                expected_challenge=_base64url_to_bytes(session.webauthn_challenge),
                expected_rp_id=settings.WEBAUTHN_RP_ID,
                credential=credential,
                require_user_verification=True,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        credential_id = _bytes_to_base64url(verification.credential_id)
        public_key = _bytes_to_base64url(verification.credential_public_key)
        WebAuthnCredential.objects.create(
            user=session.user,
            credential_id=credential_id,
            public_key=public_key,
            sign_count=verification.sign_count,
            transports=transports or [],
            is_resident_key=True,
            is_active=True,
        )

        session.webauthn_verified = True
        session.totp_verified = True  # WebAuthn alone is sufficient
        session.webauthn_challenge = ''
        session.webauthn_challenge_type = ''
        session.webauthn_challenge_expires_at = None
        session.save(update_fields=[
            'webauthn_verified',
            'totp_verified',
            'webauthn_challenge',
            'webauthn_challenge_type',
            'webauthn_challenge_expires_at',
            'updated_at',
        ])
        return _complete_session(request, session)


class MFAWebAuthnAuthenticationOptionsView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            _ensure_webauthn_available()
        except RuntimeError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        session = _get_mfa_session(request)
        if not session:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)
        if session.enrollment_required:
            return Response({'detail': 'MFA enrollment required.'}, status=status.HTTP_409_CONFLICT)

        credentials = WebAuthnCredential.objects.filter(user=session.user, is_active=True)
        if not credentials.exists():
            return Response({'detail': 'No WebAuthn credentials enrolled.'}, status=status.HTTP_409_CONFLICT)
        allow = [
            PublicKeyCredentialDescriptor(
                id=_base64url_to_bytes(cred.credential_id),
                type=PublicKeyCredentialType.PUBLIC_KEY,
            )
            for cred in credentials
        ]
        options = generate_authentication_options(
            rp_id=settings.WEBAUTHN_RP_ID,
            timeout=settings.WEBAUTHN_TIMEOUT_MS,
            allow_credentials=allow,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        options_dict = json.loads(options_to_json(options))
        session.webauthn_challenge = options_dict.get('challenge', '')
        session.webauthn_challenge_type = 'authentication'
        session.webauthn_challenge_expires_at = timezone.now() + timedelta(minutes=5)
        session.save(update_fields=['webauthn_challenge', 'webauthn_challenge_type', 'webauthn_challenge_expires_at', 'updated_at'])
        return Response(options_dict)


class MFAWebAuthnAuthenticationVerifyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            _ensure_webauthn_available()
        except RuntimeError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        session = _get_mfa_session(request)
        if not session:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)
        if session.enrollment_required:
            return Response({'detail': 'MFA enrollment required.'}, status=status.HTTP_409_CONFLICT)

        if session.webauthn_challenge_type != 'authentication':
            return Response({'detail': 'No active WebAuthn authentication.'}, status=status.HTTP_409_CONFLICT)
        if session.webauthn_challenge_expires_at and session.webauthn_challenge_expires_at <= timezone.now():
            return Response({'detail': 'WebAuthn challenge expired.'}, status=status.HTTP_400_BAD_REQUEST)

        credential = request.data.get('credential')
        if not credential:
            return Response({'detail': 'Credential payload required.'}, status=status.HTTP_400_BAD_REQUEST)
        credential = _parse_authentication_credential(credential)

        if isinstance(credential, dict):
            credential_id = credential.get('id')
        else:
            credential_id = getattr(credential, 'id', None)
        if not credential_id:
            return Response({'detail': 'Credential ID required.'}, status=status.HTTP_400_BAD_REQUEST)

        stored = WebAuthnCredential.objects.filter(
            user=session.user,
            credential_id=credential_id,
            is_active=True,
        ).first()
        if not stored:
            return Response({'detail': 'Credential not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            verification = _verify_with_origins(
                verify_authentication_response,
                expected_challenge=_base64url_to_bytes(session.webauthn_challenge),
                expected_rp_id=settings.WEBAUTHN_RP_ID,
                credential=credential,
                credential_public_key=_base64url_to_bytes(stored.public_key),
                credential_current_sign_count=stored.sign_count,
                require_user_verification=True,
            )
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        stored.sign_count = verification.new_sign_count
        stored.last_used_at = timezone.now()
        stored.save(update_fields=['sign_count', 'last_used_at'])

        session.webauthn_verified = True
        session.totp_verified = True  # WebAuthn alone is sufficient
        session.webauthn_challenge = ''
        session.webauthn_challenge_type = ''
        session.webauthn_challenge_expires_at = None
        session.save(update_fields=[
            'webauthn_verified',
            'totp_verified',
            'webauthn_challenge',
            'webauthn_challenge_type',
            'webauthn_challenge_expires_at',
            'updated_at',
        ])
        return _complete_session(request, session)


class MFATOTPVerifyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        session = _get_mfa_session(request)
        if not session:
            return Response({'detail': 'MFA session required.'}, status=status.HTTP_401_UNAUTHORIZED)
        if session.enrollment_required:
            return Response({'detail': 'MFA enrollment required.'}, status=status.HTTP_409_CONFLICT)

        code = request.data.get('code')
        if not code:
            return Response({'detail': 'Code is required.'}, status=status.HTTP_400_BAD_REQUEST)

        profile = get_or_create_mfa_profile(session.user)
        if not profile.totp_confirmed_at or not profile.totp_secret_encrypted:
            return Response({'detail': 'TOTP not enrolled.'}, status=status.HTTP_409_CONFLICT)

        secret = decrypt_secret(profile.totp_secret_encrypted)
        if not verify_totp_code(secret, str(code)):
            return Response({'detail': 'Invalid code.'}, status=status.HTTP_400_BAD_REQUEST)

        profile.totp_last_used_at = timezone.now()
        profile.save(update_fields=['totp_last_used_at', 'updated_at'])

        session.totp_verified = True
        session.webauthn_verified = True  # TOTP alone is sufficient
        session.save(update_fields=['totp_verified', 'webauthn_verified', 'updated_at'])
        return _complete_session(request, session)
