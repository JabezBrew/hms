"""
MFA utilities for TOTP and recovery code handling.
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import sys

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

try:
    import pyotp
except Exception as exc:  # pragma: no cover - optional during tests
    pyotp = None

try:
    from cryptography.fernet import Fernet
except Exception:  # pragma: no cover - optional during tests
    Fernet = None


def _derive_key(secret: str) -> bytes:
    digest = hashlib.sha256(secret.encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet() -> Fernet:
    if Fernet is None:
        raise RuntimeError("cryptography is required for MFA secret storage.")
    key = getattr(settings, 'MFA_ENCRYPTION_KEY', None)
    if not key:
        if not settings.DEBUG and "pytest" not in sys.modules:
            raise ImproperlyConfigured("MFA_ENCRYPTION_KEY is required outside development/test.")
        key = settings.SECRET_KEY
    return Fernet(_derive_key(key))


def encrypt_secret(secret: str) -> str:
    return _get_fernet().encrypt(secret.encode('utf-8')).decode('utf-8')


def decrypt_secret(token: str) -> str:
    return _get_fernet().decrypt(token.encode('utf-8')).decode('utf-8')


def generate_totp_secret() -> str:
    if pyotp is None:
        raise RuntimeError("pyotp is required for TOTP.")
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str) -> str:
    if pyotp is None:
        raise RuntimeError("pyotp is required for TOTP.")
    issuer = getattr(settings, 'MFA_TOTP_ISSUER', 'HMS')
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def verify_totp_code(secret: str, code: str) -> bool:
    if pyotp is None:
        raise RuntimeError("pyotp is required for TOTP.")
    totp = pyotp.TOTP(secret)
    return bool(totp.verify(code, valid_window=1))


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def generate_recovery_codes(count: int = 10) -> list[str]:
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return [''.join(secrets.choice(alphabet) for _ in range(10)) for _ in range(count)]


def hash_recovery_code(code: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{code}".encode('utf-8')).hexdigest()
