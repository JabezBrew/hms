import json

import pytest
import pyotp
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient

from apps.users import mfa_views
from apps.users.models import User


@pytest.mark.django_db
def test_admin_login_requires_mfa():
    user = User.objects.create_user(
        username='admin',
        email='admin@example.com',
        password='StrongPass123!',
        user_type='admin',
    )

    client = APIClient()
    response = client.post('/api/auth/login/', {
        'email': user.email,
        'password': 'StrongPass123!',
    }, format='json')

    assert response.status_code == status.HTTP_200_OK
    assert response.data.get('mfa_required') is True
    assert response.data.get('mfa_session')


@pytest.mark.django_db
def test_mfa_login_payload_includes_password_change_requirement():
    user = User.objects.create_user(
        username='admin-change',
        email='admin-change@example.com',
        password='StrongPass123!',
        user_type='admin',
        must_change_password=True,
    )

    client = APIClient()
    response = client.post('/api/auth/login/', {
        'email': user.email,
        'password': 'StrongPass123!',
    }, format='json')

    assert response.status_code == status.HTTP_200_OK
    assert response.data.get('mfa_required') is True
    assert response.data.get('password_change_required') is True
    assert response.data.get('user', {}).get('must_change_password') is True


@pytest.mark.django_db
@override_settings(MFA_REQUIRED_FOR_ADMIN=False, MFA_REQUIRED_FOR_ALL=True)
def test_all_users_login_requires_mfa():
    user = User.objects.create_user(
        username='doctor',
        email='doctor@example.com',
        password='StrongPass123!',
        user_type='doctor',
    )

    client = APIClient()
    response = client.post('/api/auth/login/', {
        'email': user.email,
        'password': 'StrongPass123!',
    }, format='json')

    assert response.status_code == status.HTTP_200_OK
    assert response.data.get('mfa_required') is True
    assert response.data.get('mfa_session')


@pytest.mark.django_db
def test_totp_enrollment_flow():
    user = User.objects.create_user(
        username='admin2',
        email='admin2@example.com',
        password='StrongPass123!',
        user_type='admin',
    )

    client = APIClient()
    login_resp = client.post('/api/auth/login/', {
        'email': user.email,
        'password': 'StrongPass123!',
    }, format='json')
    session_token = login_resp.data['mfa_session']

    start_resp = client.post('/api/auth/mfa/totp/start/', {
        'mfa_session': session_token,
    }, format='json')
    assert start_resp.status_code == status.HTTP_200_OK
    secret = start_resp.data['secret']
    code = pyotp.TOTP(secret).now()

    confirm_resp = client.post('/api/auth/mfa/totp/confirm/', {
        'mfa_session': session_token,
        'code': code,
    }, format='json')
    assert confirm_resp.status_code == status.HTTP_200_OK


def _create_admin_with_mfa_session():
    user = User.objects.create_user(
        username='admin-webauthn',
        email='admin-webauthn@example.com',
        password='StrongPass123!',
        user_type='admin',
    )
    client = APIClient()
    login_resp = client.post('/api/auth/login/', {
        'email': user.email,
        'password': 'StrongPass123!',
    }, format='json')
    return client, login_resp.data['mfa_session']


@pytest.mark.django_db
@override_settings(
    WEBAUTHN_RP_ID='localhost',
    WEBAUTHN_ALLOWED_ORIGINS=['https://hms-frontend-staging.up.railway.app'],
    CORS_ALLOWED_ORIGINS=['https://hms-frontend-staging.up.railway.app'],
)
def test_webauthn_registration_uses_request_origin_rp_id_when_configured_rp_id_is_incompatible(monkeypatch):
    client, session_token = _create_admin_with_mfa_session()
    captured = {}

    monkeypatch.setattr(mfa_views, '_ensure_webauthn_available', lambda: None)

    def fake_generate_registration_options(**kwargs):
        captured['rp_id'] = kwargs['rp_id']
        return {
            'challenge': 'test-challenge',
            'rp': {
                'id': kwargs['rp_id'],
                'name': kwargs['rp_name'],
            },
            'user': {
                'id': 'dGVzdA',
                'name': kwargs['user_name'],
                'displayName': kwargs['user_display_name'],
            },
            'excludeCredentials': [],
        }

    monkeypatch.setattr(mfa_views, 'generate_registration_options', fake_generate_registration_options)
    monkeypatch.setattr(mfa_views, 'options_to_json', lambda options: json.dumps(options))

    response = client.post(
        '/api/auth/mfa/webauthn/registration/options/',
        {'mfa_session': session_token},
        format='json',
        HTTP_ORIGIN='https://hms-frontend-staging.up.railway.app',
    )

    assert response.status_code == status.HTTP_200_OK
    assert captured['rp_id'] == 'hms-frontend-staging.up.railway.app'
    assert response.data['rp']['id'] == 'hms-frontend-staging.up.railway.app'


@pytest.mark.django_db
@override_settings(
    WEBAUTHN_RP_ID='localhost',
    WEBAUTHN_ALLOWED_ORIGINS=['https://hms-frontend-staging.up.railway.app'],
    CORS_ALLOWED_ORIGINS=['https://hms-frontend-staging.up.railway.app'],
)
def test_webauthn_registration_rejects_untrusted_origin(monkeypatch):
    client, session_token = _create_admin_with_mfa_session()
    monkeypatch.setattr(mfa_views, '_ensure_webauthn_available', lambda: None)

    response = client.post(
        '/api/auth/mfa/webauthn/registration/options/',
        {'mfa_session': session_token},
        format='json',
        HTTP_ORIGIN='https://evil.example.com',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.data['detail'] == 'WebAuthn origin is not allowed.'


@pytest.mark.django_db
@override_settings(
    WEBAUTHN_RP_ID='thehms.systems',
    WEBAUTHN_ALLOWED_ORIGINS=['https://thehms.systems'],
    WEBAUTHN_ALLOWED_ORIGIN_REGEXES=[
        r'^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.thehms\.systems$',
    ],
    CORS_ALLOWED_ORIGINS=['https://thehms.systems'],
    CORS_ALLOWED_ORIGIN_REGEXES=[
        r'^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.thehms\.systems$',
    ],
)
def test_webauthn_registration_allows_tenant_subdomain_when_regex_matches(monkeypatch):
    client, session_token = _create_admin_with_mfa_session()
    captured = {}

    monkeypatch.setattr(mfa_views, '_ensure_webauthn_available', lambda: None)

    def fake_generate_registration_options(**kwargs):
        captured['rp_id'] = kwargs['rp_id']
        return {
            'challenge': 'test-challenge',
            'rp': {
                'id': kwargs['rp_id'],
                'name': kwargs['rp_name'],
            },
            'user': {
                'id': 'dGVzdA',
                'name': kwargs['user_name'],
                'displayName': kwargs['user_display_name'],
            },
            'excludeCredentials': [],
        }

    monkeypatch.setattr(mfa_views, 'generate_registration_options', fake_generate_registration_options)
    monkeypatch.setattr(mfa_views, 'options_to_json', lambda options: json.dumps(options))

    response = client.post(
        '/api/auth/mfa/webauthn/registration/options/',
        {'mfa_session': session_token},
        format='json',
        HTTP_ORIGIN='https://agakhan.thehms.systems',
    )

    assert response.status_code == status.HTTP_200_OK
    assert captured['rp_id'] == 'thehms.systems'
    assert response.data['rp']['id'] == 'thehms.systems'


@pytest.mark.django_db
@override_settings(
    WEBAUTHN_RP_ID='thehms.systems',
    WEBAUTHN_ALLOWED_ORIGINS=['https://thehms.systems'],
    WEBAUTHN_ALLOWED_ORIGIN_REGEXES=[
        r'^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.thehms\.systems$',
    ],
    CORS_ALLOWED_ORIGINS=['https://thehms.systems'],
    CORS_ALLOWED_ORIGIN_REGEXES=[
        r'^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.thehms\.systems$',
    ],
)
def test_webauthn_registration_rejects_origin_outside_tenant_regex(monkeypatch):
    client, session_token = _create_admin_with_mfa_session()
    monkeypatch.setattr(mfa_views, '_ensure_webauthn_available', lambda: None)

    response = client.post(
        '/api/auth/mfa/webauthn/registration/options/',
        {'mfa_session': session_token},
        format='json',
        HTTP_ORIGIN='https://agakhan.thehms.systems.evil.com',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.data['detail'] == 'WebAuthn origin is not allowed.'


@override_settings(
    CORS_ALLOWED_ORIGINS=['https://hms-frontend-staging.up.railway.app'],
    CORS_ALLOW_HEADERS=[
        'accept',
        'accept-encoding',
        'authorization',
        'content-type',
        'dnt',
        'origin',
        'user-agent',
        'x-csrftoken',
        'x-device-label',
        'x-facility-code',
        'x-mfa-session',
        'x-requested-with',
    ],
)
def test_mfa_status_preflight_allows_mfa_session_header():
    client = APIClient()
    response = client.options(
        '/api/auth/mfa/status/',
        HTTP_ORIGIN='https://hms-frontend-staging.up.railway.app',
        HTTP_ACCESS_CONTROL_REQUEST_METHOD='GET',
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS='x-mfa-session',
    )

    assert response.status_code == status.HTTP_200_OK
    allowed_headers = response.get('Access-Control-Allow-Headers', '')
    assert 'x-mfa-session' in allowed_headers.lower()


@override_settings(
    CORS_ALLOWED_ORIGINS=['https://hms-frontend-staging.up.railway.app'],
    CORS_ALLOW_HEADERS=[
        'accept',
        'accept-encoding',
        'authorization',
        'content-type',
        'dnt',
        'origin',
        'user-agent',
        'x-csrftoken',
        'x-device-label',
        'x-facility-code',
        'x-mfa-session',
        'x-requested-with',
    ],
)
def test_login_preflight_allows_device_label_header():
    client = APIClient()
    response = client.options(
        '/api/auth/login/',
        HTTP_ORIGIN='https://hms-frontend-staging.up.railway.app',
        HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS='x-device-label,x-facility-code,content-type',
    )

    assert response.status_code == status.HTTP_200_OK
    allowed_headers = response.get('Access-Control-Allow-Headers', '').lower()
    assert 'x-device-label' in allowed_headers
    assert 'x-facility-code' in allowed_headers


@override_settings(
    CORS_ALLOWED_ORIGINS=['https://thehms.systems'],
    CORS_ALLOWED_ORIGIN_REGEXES=[
        r'^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.thehms\.systems$',
    ],
    CORS_ALLOW_HEADERS=[
        'accept',
        'accept-encoding',
        'authorization',
        'content-type',
        'dnt',
        'origin',
        'user-agent',
        'x-csrftoken',
        'x-device-label',
        'x-facility-code',
        'x-mfa-session',
        'x-requested-with',
    ],
)
def test_login_preflight_allows_tenant_origin_matching_regex():
    client = APIClient()
    response = client.options(
        '/api/auth/login/',
        HTTP_ORIGIN='https://agakhan.thehms.systems',
        HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS='x-device-label,x-facility-code,content-type',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.get('Access-Control-Allow-Origin') == 'https://agakhan.thehms.systems'
