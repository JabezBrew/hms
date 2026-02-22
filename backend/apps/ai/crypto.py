import base64
import hashlib

from django.conf import settings

try:
    from cryptography.fernet import Fernet
except Exception:  # pragma: no cover - dependency safety
    Fernet = None


def _derive_fernet_key(secret: str) -> bytes:
    digest = hashlib.sha256(secret.encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest)


def _normalize_secret_to_fernet_key(secret: str) -> bytes:
    if not secret:
        return _derive_fernet_key(settings.SECRET_KEY)

    encoded = secret.encode('utf-8')
    if len(encoded) == 44:
        try:
            Fernet(encoded)
            return encoded
        except Exception:
            pass

    return _derive_fernet_key(secret)


def get_ai_fernet() -> 'Fernet':
    if Fernet is None:
        raise RuntimeError('cryptography is required for AI payload encryption.')

    preferred = getattr(settings, 'AI_MESSAGE_ENCRYPTION_KEY', '')
    fallback = getattr(settings, 'RECORD_EXPORT_FERNET_KEY', '')
    key = _normalize_secret_to_fernet_key(preferred or fallback or settings.SECRET_KEY)
    return Fernet(key)


def encrypt_ai_text(raw_text: str) -> str:
    if raw_text is None:
        return ''
    return get_ai_fernet().encrypt(raw_text.encode('utf-8')).decode('utf-8')


def decrypt_ai_text(token: str) -> str:
    if not token:
        return ''
    return get_ai_fernet().decrypt(token.encode('utf-8')).decode('utf-8')
