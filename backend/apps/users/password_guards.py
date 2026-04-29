from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import CommandError


INSECURE_PASSWORD_SENTINELS = {
    'admin123',
    'admin123!',
    'admin123changeme',
    'admin123!changeme',
    'change_me',
    'change_me_generate_unique_admin_password',
    'change_me_generate_unique_staging_admin_password',
    'changeme',
    'password',
    'password123',
    'test1234',
}


def reject_insecure_default_password(password: str | None, *, label: str = 'password') -> None:
    normalized = (password or '').strip().lower()
    if normalized in INSECURE_PASSWORD_SENTINELS:
        raise CommandError(
            f'Refusing to use insecure default {label}. Set a unique secret before running this command.'
        )


def validate_command_password(password: str, *, label: str = 'password', user=None) -> None:
    reject_insecure_default_password(password, label=label)
    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        message = '; '.join(exc.messages)
        raise CommandError(f'{label} failed password validation: {message}') from exc
