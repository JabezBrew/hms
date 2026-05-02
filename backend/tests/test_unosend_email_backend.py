import base64

import pytest
from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.test import override_settings

from hms_backend.email_backends import (
    ResendEmailBackend,
    ResendEmailError,
    UnosendEmailBackend,
    UnosendEmailError,
)


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


@override_settings(
    DEFAULT_FROM_EMAIL='noreply@example.test',
    UNOSEND_API_KEY='un_test_key',
    UNOSEND_API_BASE_URL='https://api.unosend.test',
    UNOSEND_REQUEST_TIMEOUT_SECONDS=7,
)
def test_unosend_backend_sends_django_message_payload(monkeypatch):
    requests = []

    def fake_post(url, json, headers, timeout):
        requests.append({
            'url': url,
            'json': json,
            'headers': headers,
            'timeout': timeout,
        })
        return FakeResponse(200)

    monkeypatch.setattr('hms_backend.email_backends.requests.post', fake_post)

    message = EmailMultiAlternatives(
        subject='Account setup',
        body='Plain setup instructions',
        from_email='HMS <noreply@example.test>',
        to=['patient@example.test'],
        cc=['clinician@example.test'],
        bcc=['audit@example.test'],
        reply_to=['support@example.test'],
        headers={'X-HMS-Message': 'account-setup'},
    )
    message.attach_alternative('<p>HTML setup instructions</p>', 'text/html')

    backend = UnosendEmailBackend()

    assert backend.send_messages([message]) == 1
    assert requests == [{
        'url': 'https://api.unosend.test/emails',
        'json': {
            'from': 'HMS <noreply@example.test>',
            'to': ['patient@example.test'],
            'subject': 'Account setup',
            'html': '<p>HTML setup instructions</p>',
            'text': 'Plain setup instructions',
            'cc': ['clinician@example.test'],
            'bcc': ['audit@example.test'],
            'reply_to': 'support@example.test',
            'headers': {'X-HMS-Message': 'account-setup'},
        },
        'headers': {
            'Authorization': 'Bearer un_test_key',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        'timeout': 7,
    }]


@override_settings(
    DEFAULT_FROM_EMAIL='noreply@example.test',
    UNOSEND_API_KEY='un_test_key',
    UNOSEND_API_BASE_URL='https://api.unosend.test',
)
def test_unosend_backend_base64_encodes_attachments(monkeypatch):
    requests = []

    def fake_post(url, json, headers, timeout):
        requests.append(json)
        return FakeResponse(200)

    monkeypatch.setattr('hms_backend.email_backends.requests.post', fake_post)

    message = EmailMessage(
        subject='Export ready',
        body='Attached.',
        from_email=None,
        to=['patient@example.test'],
    )
    message.attach('export.csv', 'name,value\none,1\n', 'text/csv')

    assert UnosendEmailBackend().send_messages([message]) == 1

    attachment = requests[0]['attachments'][0]
    assert attachment == {
        'filename': 'export.csv',
        'content': base64.b64encode(b'name,value\none,1\n').decode('ascii'),
        'content_type': 'text/csv',
    }
    assert requests[0]['from'] == 'noreply@example.test'


@override_settings(
    DEFAULT_FROM_EMAIL='noreply@example.test',
    UNOSEND_API_KEY='un_test_key',
    UNOSEND_API_BASE_URL='https://api.unosend.test',
)
def test_unosend_backend_raises_on_rejected_request(monkeypatch):
    def fake_post(url, json, headers, timeout):
        return FakeResponse(422)

    monkeypatch.setattr('hms_backend.email_backends.requests.post', fake_post)

    message = EmailMessage(
        subject='Rejected',
        body='Body',
        from_email=None,
        to=['patient@example.test'],
    )

    with pytest.raises(UnosendEmailError, match='HTTP 422'):
        UnosendEmailBackend().send_messages([message])


@override_settings(
    DEFAULT_FROM_EMAIL='noreply@example.test',
    UNOSEND_API_KEY='un_test_key',
    UNOSEND_API_BASE_URL='https://api.unosend.test',
)
def test_unosend_backend_honors_fail_silently(monkeypatch):
    def fake_post(url, json, headers, timeout):
        return FakeResponse(401)

    monkeypatch.setattr('hms_backend.email_backends.requests.post', fake_post)

    message = EmailMessage(
        subject='Rejected',
        body='Body',
        from_email=None,
        to=['patient@example.test'],
    )

    assert UnosendEmailBackend(fail_silently=True).send_messages([message]) == 0


@override_settings(
    DEFAULT_FROM_EMAIL='noreply@example.test',
    RESEND_API_KEY='re_test_key',
    RESEND_API_BASE_URL='https://api.resend.test',
    RESEND_REQUEST_TIMEOUT_SECONDS=5,
)
def test_resend_backend_sends_django_message_payload(monkeypatch):
    requests = []

    def fake_post(url, json, headers, timeout):
        requests.append({
            'url': url,
            'json': json,
            'headers': headers,
            'timeout': timeout,
        })
        return FakeResponse(200)

    monkeypatch.setattr('hms_backend.email_backends.requests.post', fake_post)

    message = EmailMultiAlternatives(
        subject='Account setup',
        body='Plain setup instructions',
        from_email='HMS <noreply@example.test>',
        to=['patient@example.test'],
        cc=['clinician@example.test'],
        bcc=['audit@example.test'],
        reply_to=['support@example.test'],
        headers={'X-HMS-Message': 'account-setup'},
    )
    message.attach_alternative('<p>HTML setup instructions</p>', 'text/html')

    assert ResendEmailBackend().send_messages([message]) == 1
    assert requests == [{
        'url': 'https://api.resend.test/emails',
        'json': {
            'from': 'HMS <noreply@example.test>',
            'to': ['patient@example.test'],
            'subject': 'Account setup',
            'html': '<p>HTML setup instructions</p>',
            'text': 'Plain setup instructions',
            'cc': ['clinician@example.test'],
            'bcc': ['audit@example.test'],
            'headers': {'X-HMS-Message': 'account-setup'},
            'reply_to': 'support@example.test',
        },
        'headers': {
            'Authorization': 'Bearer re_test_key',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        'timeout': 5,
    }]


@override_settings(
    DEFAULT_FROM_EMAIL='noreply@example.test',
    RESEND_API_KEY='re_test_key',
    RESEND_API_BASE_URL='https://api.resend.test',
)
def test_resend_backend_base64_encodes_attachments(monkeypatch):
    requests = []

    def fake_post(url, json, headers, timeout):
        requests.append(json)
        return FakeResponse(200)

    monkeypatch.setattr('hms_backend.email_backends.requests.post', fake_post)

    message = EmailMessage(
        subject='Export ready',
        body='Attached.',
        from_email=None,
        to=['patient@example.test'],
    )
    message.attach('export.csv', 'name,value\none,1\n', 'text/csv')

    assert ResendEmailBackend().send_messages([message]) == 1

    attachment = requests[0]['attachments'][0]
    assert attachment == {
        'filename': 'export.csv',
        'content': base64.b64encode(b'name,value\none,1\n').decode('ascii'),
    }
    assert requests[0]['from'] == 'noreply@example.test'


@override_settings(
    DEFAULT_FROM_EMAIL='noreply@example.test',
    RESEND_API_KEY='re_test_key',
    RESEND_API_BASE_URL='https://api.resend.test',
)
def test_resend_backend_raises_on_rejected_request(monkeypatch):
    def fake_post(url, json, headers, timeout):
        return FakeResponse(403)

    monkeypatch.setattr('hms_backend.email_backends.requests.post', fake_post)

    message = EmailMessage(
        subject='Rejected',
        body='Body',
        from_email=None,
        to=['patient@example.test'],
    )

    with pytest.raises(ResendEmailError, match='HTTP 403'):
        ResendEmailBackend().send_messages([message])
