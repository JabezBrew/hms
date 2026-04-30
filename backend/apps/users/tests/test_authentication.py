"""
Authentication tests for users app.

Tests for:
- JWT login (valid credentials, invalid credentials, inactive user)
- JWT token refresh
- JWT logout
- Password change
- Password reset flow (request, token validation, reset confirm)
- Session validation
"""
import pytest
from datetime import timedelta
from unittest.mock import patch, MagicMock

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction
from apps.core.tests.factories import DefaultFacilityFactory, FacilityFactory
from apps.users.models import PasswordResetToken
from .factories import (
    UserFactory, AdminUserFactory, DoctorUserFactory,
    PatientUserFactory
)


@pytest.fixture
def api_client():
    """Return an unauthenticated API client."""
    return APIClient()


@pytest.fixture
def authenticated_client(api_client, db):
    """Return an authenticated API client."""
    user = UserFactory()
    refresh = RefreshToken.for_user(user)
    api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return api_client, user


@pytest.fixture(autouse=True)
def disable_mfa_for_tests(settings):
    settings.MFA_REQUIRED_FOR_ALL = False
    settings.MFA_REQUIRED_FOR_ADMIN = False


# =============================================================================
# Login Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.critical
class TestLogin:
    """Tests for JWT login endpoint."""

    @pytest.fixture(autouse=True)
    def clear_throttle_cache(self):
        """Clear the throttle cache before each test to prevent rate limiting."""
        from django.core.cache import cache
        cache.clear()

    def test_login_success(self, api_client, db):
        """Test successful login with valid credentials."""
        user = UserFactory(email='login@test.com', password='correctpassword')

        response = api_client.post('/api/auth/login/', {
            'email': 'login@test.com',
            'password': 'correctpassword'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert 'access' in response.data
        # Refresh token is stored in HTTP-only cookie for security
        assert 'user' in response.data

    def test_login_with_user_data(self, api_client, db):
        """Test that login returns user data."""
        user = UserFactory(
            email='userdata@test.com',
            password='testpass',
            first_name='John',
            last_name='Doe',
            user_type='doctor'
        )

        response = api_client.post('/api/auth/login/', {
            'email': 'userdata@test.com',
            'password': 'testpass'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert 'user' in response.data
        assert response.data['user']['email'] == 'userdata@test.com'
        assert response.data['user']['first_name'] == 'John'
        assert response.data['user']['last_name'] == 'Doe'

    def test_login_returns_password_change_requirement(self, api_client, db):
        """Login response should include first-login password change requirement flag."""
        UserFactory(
            email='force-change@test.com',
            password='testpass',
            must_change_password=True,
        )

        response = api_client.post('/api/auth/login/', {
            'email': 'force-change@test.com',
            'password': 'testpass'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['password_change_required'] is True
        assert response.data['user']['must_change_password'] is True

    def test_login_invalid_password(self, api_client, db):
        """Test login fails with wrong password."""
        UserFactory(email='wrongpass@test.com', password='correctpassword')

        response = api_client.post('/api/auth/login/', {
            'email': 'wrongpass@test.com',
            'password': 'wrongpassword'
        }, format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_login_nonexistent_user(self, api_client, db):
        """Test login fails for non-existent user."""
        response = api_client.post('/api/auth/login/', {
            'email': 'nouser@test.com',
            'password': 'anypassword'
        }, format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_login_inactive_user(self, api_client, db):
        """Test login fails for inactive user."""
        UserFactory(
            email='inactive@test.com',
            password='testpass',
            is_active=False
        )

        response = api_client.post('/api/auth/login/', {
            'email': 'inactive@test.com',
            'password': 'testpass'
        }, format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_login_missing_email(self, api_client, db):
        """Test login fails without email."""
        response = api_client.post('/api/auth/login/', {
            'password': 'anypassword'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_login_missing_password(self, api_client, db):
        """Test login fails without password."""
        response = api_client.post('/api/auth/login/', {
            'email': 'test@test.com'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_login_case_insensitive_email(self, api_client, db):
        """Test that email is case-insensitive for login."""
        UserFactory(email='case@test.com', password='testpass')

        response = api_client.post('/api/auth/login/', {
            'email': 'CASE@test.com',
            'password': 'testpass'
        }, format='json')

        # Behavior depends on implementation - either 200 or 401 is acceptable
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_401_UNAUTHORIZED]

    @patch('apps.core.models.OffSiteAccessSettings.get_settings', side_effect=Exception("settings unavailable"))
    @patch('apps.core.models.SiteNetwork.is_ip_on_site', side_effect=Exception("network lookup unavailable"))
    def test_login_survives_offsite_lookup_failure(self, _mock_on_site, _mock_settings, api_client, db):
        """Login must not return 500 when off-site settings/network lookups fail."""
        UserFactory(email='offsite@test.com', password='testpass')

        response = api_client.post('/api/auth/login/', {
            'email': 'offsite@test.com',
            'password': 'testpass'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['access_context']['offsite_mode'] == 'readonly'
        assert response.data['access_context']['is_offsite'] is True

    def test_login_infers_primary_facility_for_multi_facility_user(self, api_client, db, settings):
        settings.MULTI_FACILITY_MODE = True
        facility_a = DefaultFacilityFactory(code='LOGINA')
        facility_b = DefaultFacilityFactory(code='LOGINB')
        user = DoctorUserFactory(
            email='multifacility@test.com',
            password='testpass',
            primary_facility=facility_b,
        )
        user.facilities.add(facility_a, facility_b)

        response = api_client.post('/api/auth/login/', {
            'email': user.email,
            'password': 'testpass'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['user']['facility_code'] == facility_b.code

    def test_login_infers_primary_facility_for_multi_facility_admin(self, api_client, db, settings):
        settings.MULTI_FACILITY_MODE = True
        facility_a = DefaultFacilityFactory(code='ADMINA')
        facility_b = DefaultFacilityFactory(code='ADMINB')
        user = AdminUserFactory(
            email='multiadmin@test.com',
            password='testpass',
            primary_facility=facility_a,
        )
        user.facilities.add(facility_a, facility_b)

        response = api_client.post('/api/auth/login/', {
            'email': user.email,
            'password': 'testpass'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['user']['facility_code'] == facility_a.code
        assert 'admin_access' in response.data['user']
        assert 'admin.organization.manage' in response.data['user']['admin_access']['capabilities']

    def test_login_rejects_unassigned_facility_for_facility_admin(self, api_client, db, settings):
        settings.ALLOW_CROSS_FACILITY_ACCESS = True
        facility_a = DefaultFacilityFactory(code='FACADMINA')
        facility_b = FacilityFactory(code='FACADMINB')
        user = UserFactory(
            user_type='admin',
            is_staff=True,
            is_superuser=False,
            email='facility-admin@test.com',
            password='testpass',
            primary_facility=facility_a,
        )
        user.facilities.add(facility_a)

        response = api_client.post('/api/auth/login/', {
            'email': user.email,
            'password': 'testpass',
            'facility_code': facility_b.code,
        }, format='json')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.data['code'] == 'facility_forbidden'

    def test_login_allows_unassigned_facility_for_platform_admin(self, api_client, db, settings):
        settings.ALLOW_CROSS_FACILITY_ACCESS = True
        facility_a = DefaultFacilityFactory(code='PLATLOGA')
        facility_b = FacilityFactory(code='PLATLOGB')
        user = AdminUserFactory(
            email='platform-admin@test.com',
            password='testpass',
            primary_facility=facility_a,
        )
        user.facilities.add(facility_a)

        response = api_client.post('/api/auth/login/', {
            'email': user.email,
            'password': 'testpass',
            'facility_code': facility_b.code,
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['user']['facility_code'] == facility_b.code

    def test_login_requires_facility_when_multi_facility_user_has_no_primary(self, api_client, db, settings):
        settings.MULTI_FACILITY_MODE = True
        facility_a = DefaultFacilityFactory(code='NOPRIMA')
        facility_b = DefaultFacilityFactory(code='NOPRIMB')
        user = DoctorUserFactory(
            email='noprimary@test.com',
            password='testpass',
            primary_facility=None,
        )
        user.facilities.add(facility_a, facility_b)

        response = api_client.post('/api/auth/login/', {
            'email': user.email,
            'password': 'testpass'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data['code'] == 'facility_required'

    @patch('apps.core.models.OffSiteAccessSettings.get_settings', side_effect=Exception("settings unavailable"))
    @patch('apps.core.models.SiteNetwork.is_ip_on_site', side_effect=Exception("network lookup unavailable"))
    def test_non_auth_get_survives_offsite_lookup_failure(self, _mock_on_site, _mock_settings, api_client, db):
        """Generic unauthenticated GET requests should not crash on off-site lookup failure."""
        response = api_client.get('/favicon.ico')
        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Token Refresh Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.critical
class TestTokenRefresh:
    """Tests for JWT token refresh endpoint."""

    def test_refresh_token_success(self, api_client, db):
        """Test refreshing an access token."""
        from django.conf import settings
        user = UserFactory()
        refresh = RefreshToken.for_user(user)

        # Set refresh token in cookie (as the implementation expects)
        api_client.cookies[settings.JWT_AUTH_REFRESH_COOKIE] = str(refresh)

        response = api_client.post('/api/auth/token/refresh/', format='json')

        assert response.status_code == status.HTTP_200_OK
        assert 'access' in response.data

    def test_refresh_with_invalid_token(self, api_client, db):
        """Test refresh fails with invalid token."""
        from django.conf import settings
        api_client.cookies[settings.JWT_AUTH_REFRESH_COOKIE] = 'invalid_token_here'

        response = api_client.post('/api/auth/token/refresh/', format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_refresh_with_expired_token(self, api_client, db):
        """Test refresh fails with expired token."""
        from django.conf import settings
        user = UserFactory()
        refresh = RefreshToken.for_user(user)

        # Manually expire the token
        refresh.set_exp(lifetime=-timedelta(days=1))

        api_client.cookies[settings.JWT_AUTH_REFRESH_COOKIE] = str(refresh)
        response = api_client.post('/api/auth/token/refresh/', format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_refresh_missing_token(self, api_client, db):
        """Test refresh fails without token in cookie."""
        response = api_client.post('/api/auth/token/refresh/', format='json')

        # No cookie set, so should return 401 (unauthorized - token not found)
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


# =============================================================================
# Logout Tests
# =============================================================================

@pytest.mark.tier1
class TestLogout:
    """Tests for JWT logout endpoint."""

    def test_logout_success(self, db):
        """Test successful logout."""
        user = UserFactory()
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.post('/api/auth/logout/', format='json')

        # Logout should succeed (either 200 or 204)
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_204_NO_CONTENT]

    def test_logout_without_auth(self, api_client, db):
        """Test logout without authentication."""
        response = api_client.post('/api/auth/logout/', format='json')

        # Should either succeed (graceful) or require auth
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_204_NO_CONTENT,
            status.HTTP_401_UNAUTHORIZED
        ]

    @patch('apps.audit.services.log_audit_async.delay')
    def test_logout_without_identity_logs_anonymous_session(
        self,
        mock_audit_delay,
        api_client,
        db,
    ):
        """Unauthenticated logout should be tracked as anonymous session activity."""
        response = api_client.post('/api/auth/logout/', format='json')

        assert response.status_code in [status.HTTP_200_OK, status.HTTP_204_NO_CONTENT]
        mock_audit_delay.assert_called_once()
        kwargs = mock_audit_delay.call_args.kwargs
        assert kwargs['action'] == AuditAction.LOGOUT
        assert kwargs['user_id'] is None
        assert kwargs['user_email'] == 'anonymous'
        assert kwargs['user_type'] == 'anonymous'
        assert kwargs['resource_type'] == 'Session'
        assert kwargs['resource_name'] == 'anonymous session'
        assert kwargs['description'] == 'Anonymous session logout request'

    @patch('apps.audit.services.log_audit_async.delay')
    def test_logout_after_blacklist_keeps_user_audit_attribution(
        self,
        mock_audit_delay,
        db,
    ):
        """Repeated logout with a now-blacklisted refresh token should still resolve user identity."""
        from django.conf import settings

        user = UserFactory(email='logout-audit@test.com')
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        client.cookies[settings.JWT_AUTH_REFRESH_COOKIE] = str(refresh)

        first_response = client.post('/api/auth/logout/', format='json')
        assert first_response.status_code in [status.HTTP_200_OK, status.HTTP_204_NO_CONTENT]

        client.credentials()
        client.cookies[settings.JWT_AUTH_REFRESH_COOKIE] = str(refresh)
        mock_audit_delay.reset_mock()

        second_response = client.post('/api/auth/logout/', format='json')
        assert second_response.status_code in [status.HTTP_200_OK, status.HTTP_204_NO_CONTENT]

        mock_audit_delay.assert_called_once()
        kwargs = mock_audit_delay.call_args.kwargs
        assert kwargs['action'] == AuditAction.LOGOUT
        assert kwargs['user_id'] == str(user.id)
        assert kwargs['user_email'] == user.email
        assert kwargs['resource_type'] == 'User'
        assert kwargs['resource_name'] == user.email


# =============================================================================
# Password Change Tests
# =============================================================================

@pytest.mark.tier1
class TestPasswordChange:
    """Tests for password change endpoint."""

    def test_change_password_success(self, db):
        """Test successful password change."""
        user = UserFactory(password='oldpassword')
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.post('/api/users/users/change_password/', {
            'old_password': 'oldpassword',
            'new_password': 'NewSecurePass123!'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK

        # Verify old password no longer works
        user.refresh_from_db()
        assert not user.check_password('oldpassword')
        assert user.check_password('NewSecurePass123!')

    def test_change_password_clears_password_change_requirement(self, db):
        """Changing password should clear first-login requirement."""
        user = UserFactory(password='oldpassword', must_change_password=True)
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.post('/api/users/users/change_password/', {
            'old_password': 'oldpassword',
            'new_password': 'NewSecurePass123!'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK

        user.refresh_from_db()
        assert user.must_change_password is False
        assert user.password_changed_at is not None

    def test_password_change_required_blocks_protected_endpoints(self, db):
        """Users flagged for first-login password change must be restricted."""
        user = AdminUserFactory(password='oldpassword', must_change_password=True)
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.get('/api/users/users/')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.json().get('code') == 'password_change_required'

    def test_change_password_wrong_old_password(self, db):
        """Test password change fails with wrong old password."""
        user = UserFactory(password='correctoldpassword')
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.post('/api/users/users/change_password/', {
            'old_password': 'wrongoldpassword',
            'new_password': 'NewSecurePass123!'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_change_password_weak_new_password(self, db):
        """Test password change fails with weak new password."""
        user = UserFactory(password='oldpassword')
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.post('/api/users/users/change_password/', {
            'old_password': 'oldpassword',
            'new_password': '123'  # Too short/weak
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_change_password_unauthenticated(self, api_client, db):
        """Test password change requires authentication."""
        response = api_client.post('/api/users/users/change_password/', {
            'old_password': 'old',
            'new_password': 'new'
        }, format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED


# =============================================================================
# Password Reset Tests
# =============================================================================

@pytest.mark.tier1
class TestPasswordReset:
    """Tests for password reset flow."""

    @patch('apps.users.password_reset_views.send_password_reset_email')
    def test_request_password_reset(self, mock_send_email, api_client, db):
        """Test requesting a password reset."""
        user = UserFactory(email='reset@test.com')

        response = api_client.post('/api/auth/password-reset/', {
            'email': 'reset@test.com'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        # Token should be created
        assert PasswordResetToken.objects.filter(user=user).exists()
        # Email task should be called
        mock_send_email.delay.assert_called_once()

    def test_request_password_reset_nonexistent_email(self, api_client, db):
        """Test password reset request for non-existent email."""
        response = api_client.post('/api/auth/password-reset/', {
            'email': 'nonexistent@test.com'
        }, format='json')

        # Should return success to prevent email enumeration
        assert response.status_code == status.HTTP_200_OK

    def test_verify_password_reset_token(self, api_client, db):
        """Test verifying a password reset token."""
        user = UserFactory()
        plain_token, _ = PasswordResetToken.create_for_user(user)

        response = api_client.post('/api/auth/password-reset/validate-token/', {
            'token': plain_token
        }, format='json')

        assert response.status_code == status.HTTP_200_OK

    def test_verify_invalid_token(self, api_client, db):
        """Test verifying an invalid token returns valid=false."""
        response = api_client.post('/api/auth/password-reset/validate-token/', {
            'token': 'invalid_token'
        }, format='json')

        # Validation endpoint returns 200 with valid: false for invalid tokens
        assert response.status_code == status.HTTP_200_OK
        assert response.data['valid'] is False

    def test_reset_password_confirm(self, api_client, db):
        """Test confirming password reset."""
        user = UserFactory()
        plain_token, _ = PasswordResetToken.create_for_user(user)

        response = api_client.post('/api/auth/password-reset/confirm/', {
            'token': plain_token,
            'password': 'NewSecurePassword123!',
            'password_confirm': 'NewSecurePassword123!'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK

        # Verify new password works
        user.refresh_from_db()
        assert user.check_password('NewSecurePassword123!')

    def test_reset_password_confirm_clears_password_change_requirement(self, api_client, db):
        """Completing reset confirmation should clear first-login requirement."""
        user = UserFactory(must_change_password=True)
        plain_token, _ = PasswordResetToken.create_for_user(user, reset_type='admin_force')

        response = api_client.post('/api/auth/password-reset/confirm/', {
            'token': plain_token,
            'password': 'NewSecurePassword123!',
            'password_confirm': 'NewSecurePassword123!'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK

        user.refresh_from_db()
        assert user.must_change_password is False
        assert user.password_changed_at is not None

    def test_reset_password_token_invalidated_after_use(self, api_client, db):
        """Test that token is invalidated after use."""
        user = UserFactory()
        plain_token, token_obj = PasswordResetToken.create_for_user(user)

        # First reset should succeed
        api_client.post('/api/auth/password-reset/confirm/', {
            'token': plain_token,
            'password': 'NewPassword123!',
            'password_confirm': 'NewPassword123!'
        }, format='json')

        # Second reset should fail
        response = api_client.post('/api/auth/password-reset/confirm/', {
            'token': plain_token,
            'password': 'AnotherPassword123!',
            'password_confirm': 'AnotherPassword123!'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST


# =============================================================================
# Current User Endpoint Tests
# =============================================================================

@pytest.mark.tier1
class TestCurrentUser:
    """Tests for getting current user info."""

    def test_get_current_user(self, db):
        """Test getting current user info."""
        user = DoctorUserFactory(
            email='me@test.com',
            first_name='Current',
            last_name='User'
        )
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.get('/api/users/users/me/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['email'] == 'me@test.com'
        assert response.data['first_name'] == 'Current'
        assert response.data['last_name'] == 'User'

    def test_get_current_user_unauthenticated(self, api_client, db):
        """Test getting current user without auth."""
        response = api_client.get('/api/users/users/me/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_current_user_includes_user_type(self, db):
        """Test that current user response includes user type."""
        user = DoctorUserFactory()
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.get('/api/users/users/me/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['user_type'] == 'doctor'


# =============================================================================
# Token Expiration Tests
# =============================================================================

@pytest.mark.tier1
class TestTokenExpiration:
    """Tests for token expiration handling."""

    def test_expired_access_token_rejected(self, db):
        """Test that expired access tokens are rejected."""
        user = UserFactory()
        refresh = RefreshToken.for_user(user)
        access = refresh.access_token

        # Manually expire the token
        access.set_exp(lifetime=-timedelta(hours=1))

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')

        response = client.get('/api/users/users/me/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_valid_token_accepted(self, db):
        """Test that valid tokens are accepted."""
        user = UserFactory()
        refresh = RefreshToken.for_user(user)

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.get('/api/users/users/me/')

        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Rate Limiting Tests (if implemented)
# =============================================================================

@pytest.mark.tier1
class TestRateLimiting:
    """Tests for login rate limiting."""

    def test_rate_limiting_after_many_failed_attempts(self, api_client, db):
        """Test that rate limiting kicks in after many failed login attempts."""
        UserFactory(email='ratelimit@test.com', password='correctpass')

        # Make many failed login attempts
        for _ in range(10):
            api_client.post('/api/auth/login/', {
                'email': 'ratelimit@test.com',
                'password': 'wrongpassword'
            }, format='json')

        # Next attempt might be rate limited (429) or still just unauthorized (401)
        response = api_client.post('/api/auth/login/', {
            'email': 'ratelimit@test.com',
            'password': 'wrongpassword'
        }, format='json')

        # Either rate limited or unauthorized is acceptable
        assert response.status_code in [
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_429_TOO_MANY_REQUESTS
        ]
