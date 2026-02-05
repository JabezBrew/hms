import pytest
import pytest
import pyotp
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient

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
