import base64
import hashlib
import sys

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

try:
    from cryptography.fernet import Fernet
except Exception:  # pragma: no cover - fallback when dependency missing
    Fernet = None


def _derive_fernet_key(secret: str) -> bytes:
    digest = hashlib.sha256(secret.encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest)


def get_fernet():
    if Fernet is None:
        raise RuntimeError("cryptography is required for record export encryption.")

    key = getattr(settings, 'RECORD_EXPORT_FERNET_KEY', None)
    if not key:
        if not settings.DEBUG and "pytest" not in sys.modules:
            raise ImproperlyConfigured("RECORD_EXPORT_FERNET_KEY is required outside development/test.")
        key = _derive_fernet_key(settings.SECRET_KEY).decode('utf-8')
    return Fernet(key)


def encrypt_payload(payload_bytes: bytes) -> str:
    fernet = get_fernet()
    return fernet.encrypt(payload_bytes).decode('utf-8')


def decrypt_payload(token: str) -> bytes:
    fernet = get_fernet()
    return fernet.decrypt(token.encode('utf-8'))
