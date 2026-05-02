from django.core import mail
from django.test import override_settings

from apps.users.tasks import (
    send_account_setup_email,
    send_admin_force_reset_email,
    send_password_reset_email,
)


EMAIL_SETTINGS = {
    'EMAIL_BACKEND': 'django.core.mail.backends.locmem.EmailBackend',
    'DEFAULT_FROM_EMAIL': 'noreply@emailing.thehms.systems',
    'EMAIL_SENDER_DOMAIN': 'emailing.thehms.systems',
    'EMAIL_WELCOME_LOCAL_PART': 'welcome',
    'EMAIL_SECURITY_LOCAL_PART': 'security',
    'WELCOME_FROM_EMAIL': '',
    'SECURITY_FROM_EMAIL': '',
}


@override_settings(**EMAIL_SETTINGS)
def test_account_setup_email_uses_welcome_sender(db):
    mail.outbox = []

    result = send_account_setup_email.run(
        'user-id',
        'setup-token',
        'user@example.test',
        'Kwame Mensah',
    )

    assert result == {"status": "success"}
    assert len(mail.outbox) == 1
    assert mail.outbox[0].from_email == 'welcome@emailing.thehms.systems'


@override_settings(**EMAIL_SETTINGS)
def test_password_reset_email_uses_security_sender(db):
    mail.outbox = []

    result = send_password_reset_email.run(
        'user-id',
        'reset-token',
        'user@example.test',
        'Kwame Mensah',
    )

    assert result == {"status": "success"}
    assert len(mail.outbox) == 1
    assert mail.outbox[0].from_email == 'security@emailing.thehms.systems'


@override_settings(**EMAIL_SETTINGS)
def test_admin_force_reset_email_uses_security_sender(db):
    mail.outbox = []

    result = send_admin_force_reset_email.run(
        'user-id',
        'temporary-password',
        'user@example.test',
        'Kwame Mensah',
        'Admin User',
    )

    assert result == {"status": "success"}
    assert len(mail.outbox) == 1
    assert mail.outbox[0].from_email == 'security@emailing.thehms.systems'


@override_settings(
    **{
        **EMAIL_SETTINGS,
        'WELCOME_FROM_EMAIL': 'hello@emailing.thehms.systems',
        'SECURITY_FROM_EMAIL': 'accounts@emailing.thehms.systems',
    }
)
def test_exact_sender_overrides_take_precedence(db):
    mail.outbox = []

    send_account_setup_email.run(
        'user-id',
        'setup-token',
        'user@example.test',
        'Kwame Mensah',
    )
    send_password_reset_email.run(
        'user-id',
        'reset-token',
        'user@example.test',
        'Kwame Mensah',
    )

    assert [message.from_email for message in mail.outbox] == [
        'hello@emailing.thehms.systems',
        'accounts@emailing.thehms.systems',
    ]
