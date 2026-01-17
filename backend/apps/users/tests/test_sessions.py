"""
Tests for user session tracking.
"""
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
