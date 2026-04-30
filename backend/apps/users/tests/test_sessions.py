"""
Tests for user session tracking.
"""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.users.models import UserSession
from .factories import UserFactory, AdminUserFactory


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture(autouse=True)
def disable_mfa_for_tests(settings):
    settings.MFA_REQUIRED_FOR_ALL = False
    settings.MFA_REQUIRED_FOR_ADMIN = False


def authenticate_client(user, client=None):
    if client is None:
        client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


@pytest.mark.tier1
class TestUserSessions:
    def test_login_creates_session(self, api_client, db):
        user = UserFactory(email='session@test.com', password='testpass123')

        response = api_client.post(
            '/api/auth/login/',
            {'email': 'session@test.com', 'password': 'testpass123'},
            format='json',
            HTTP_X_DEVICE_LABEL='Nurse Station iPad',
            HTTP_USER_AGENT='pytest-agent',
        )

        assert response.status_code == status.HTTP_200_OK
        session = UserSession.objects.get(user=user)
        assert session.device_label == 'Nurse Station iPad'
        assert len(session.ip_hash) == 64
        assert len(session.user_agent_hash) == 64
        assert session.expires_at > timezone.now()

    def test_list_sessions_returns_current(self, api_client, db):
        user = UserFactory(email='list@test.com', password='testpass123')

        login_response = api_client.post(
            '/api/auth/login/',
            {'email': 'list@test.com', 'password': 'testpass123'},
            format='json',
        )
        assert login_response.status_code == status.HTTP_200_OK

        access_token = login_response.data['access']
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

        response = api_client.get('/api/users/sessions/')
        assert response.status_code == status.HTTP_200_OK

        results = response.data.get('results', response.data)
        assert len(results) == 1
        assert results[0]['is_current'] is True

    def test_logout_revokes_session(self, api_client, db):
        user = UserFactory(email='logout@test.com', password='testpass123')

        login_response = api_client.post(
            '/api/auth/login/',
            {'email': 'logout@test.com', 'password': 'testpass123'},
            format='json',
        )
        assert login_response.status_code == status.HTTP_200_OK

        access_token = login_response.data['access']
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

        logout_response = api_client.post('/api/auth/logout/', format='json')
        assert logout_response.status_code in [status.HTTP_200_OK, status.HTTP_204_NO_CONTENT]

        session = UserSession.objects.get(user=user)
        assert session.revoked_at is not None

    def test_admin_revoke_all_sessions_for_user(self, db):
        user = UserFactory(email='revoke@test.com', password='testpass123')
        admin = AdminUserFactory(email='admin@test.com')

        client = APIClient()
        login_response = client.post(
            '/api/auth/login/',
            {'email': 'revoke@test.com', 'password': 'testpass123'},
            format='json',
        )
        assert login_response.status_code == status.HTTP_200_OK
        assert UserSession.objects.filter(user=user, revoked_at__isnull=True).count() == 1

        admin_client = authenticate_client(admin)
        response = admin_client.post(
            '/api/users/sessions/revoke_all/',
            {'user_id': str(user.id)},
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        assert UserSession.objects.filter(user=user, revoked_at__isnull=True).count() == 0

    def test_refresh_rotates_session_in_place(self, api_client, db):
        from django.conf import settings
        user = UserFactory(email='refresh@test.com', password='testpass123')

        login_response = api_client.post(
            '/api/auth/login/',
            {'email': 'refresh@test.com', 'password': 'testpass123'},
            format='json',
        )
        assert login_response.status_code == status.HTTP_200_OK

        session = UserSession.objects.get(user=user)
        old_session_id = session.id
        old_jti = session.refresh_jti

        refresh_cookie = login_response.cookies.get(settings.JWT_AUTH_REFRESH_COOKIE)
        if refresh_cookie:
            api_client.cookies[settings.JWT_AUTH_REFRESH_COOKIE] = refresh_cookie.value

        refresh_response = api_client.post('/api/auth/token/refresh/', format='json')
        assert refresh_response.status_code == status.HTTP_200_OK

        assert UserSession.objects.filter(user=user).count() == 1
        session.refresh_from_db()
        assert session.id == old_session_id
        assert session.refresh_jti != old_jti

    def test_login_with_invalid_forwarded_ip_still_creates_session(self, api_client, db, settings):
        settings.TRUST_PROXY_HEADERS = True
        settings.TRUSTED_PROXY_HOPS = 1
        user = UserFactory(email='invalid-ip@test.com', password='testpass123')

        response = api_client.post(
            '/api/auth/login/',
            {'email': 'invalid-ip@test.com', 'password': 'testpass123'},
            format='json',
            HTTP_X_FORWARDED_FOR='not-an-ip, 10.0.0.10',
            REMOTE_ADDR='127.0.0.1',
        )

        assert response.status_code == status.HTTP_200_OK
        session = UserSession.objects.get(user=user)
        assert session.ip_address == '127.0.0.1'

    def test_list_sessions_excludes_idle_sessions(self, api_client, db, settings):
        settings.USER_SESSION_IDLE_TIMEOUT_MINUTES = 30
        user = UserFactory(email='idle@test.com', password='testpass123')

        login_response = api_client.post(
            '/api/auth/login/',
            {'email': 'idle@test.com', 'password': 'testpass123'},
            format='json',
        )
        assert login_response.status_code == status.HTTP_200_OK

        stale_session = UserSession.objects.get(user=user)
        stale_session.last_seen_at = timezone.now() - timedelta(minutes=45)
        stale_session.expires_at = timezone.now() + timedelta(days=1)
        stale_session.save(update_fields=['last_seen_at', 'expires_at', 'updated_at'])

        access_token = login_response.data['access']
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')
        response = api_client.get('/api/users/sessions/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert results == []
