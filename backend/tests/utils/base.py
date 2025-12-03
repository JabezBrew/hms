"""
Base test classes for HMS backend testing.

Provides common setup and teardown logic for test cases.
"""
import pytest
from django.test import TestCase
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import AccessToken

from django.contrib.auth import get_user_model

User = get_user_model()


class BaseTestCase(TestCase):
    """
    Base test case with common setup for model and service tests.

    Features:
    - Automatic user creation for tests
    - Common assertion helpers
    - Audit field verification
    """

    @classmethod
    def setUpTestData(cls):
        """Set up data for the whole TestCase."""
        cls.admin_user = User.objects.create_superuser(
            username='admin@test.com',
            email='admin@test.com',
            password='adminpass123',
            first_name='Admin',
            last_name='User',
            user_type='admin'
        )

    def create_user(self, user_type='patient', **kwargs):
        """Helper to create users for testing."""
        email = kwargs.pop('email', f'{user_type}@test.com')
        defaults = {
            'username': email,
            'email': email,
            'password': 'testpass123',
            'first_name': 'Test',
            'last_name': 'User',
            'user_type': user_type,
        }
        defaults.update(kwargs)

        user = User.objects.create_user(**defaults)
        return user

    def assertAuditFieldsSet(self, obj, created_by=None, updated_by=None):
        """Assert that audit fields are properly set."""
        self.assertIsNotNone(obj.created_at)
        self.assertIsNotNone(obj.updated_at)
        if created_by:
            self.assertEqual(obj.created_by, created_by)
        if updated_by:
            self.assertEqual(obj.updated_by, updated_by)

    def assertTimestampRecent(self, timestamp, seconds=60):
        """Assert that a timestamp is within the last N seconds."""
        from django.utils import timezone
        from datetime import timedelta

        now = timezone.now()
        delta = now - timestamp
        self.assertLess(
            delta,
            timedelta(seconds=seconds),
            f"Timestamp {timestamp} is not recent (delta: {delta})"
        )


class BaseAPITestCase(APITestCase):
    """
    Base API test case with authentication helpers.

    Features:
    - Pre-configured API client
    - Authentication helpers for all user roles
    - Response assertion helpers
    """

    @classmethod
    def setUpTestData(cls):
        """Set up data for the whole TestCase."""
        cls.admin_user = User.objects.create_superuser(
            username='admin@test.com',
            email='admin@test.com',
            password='adminpass123',
            first_name='Admin',
            last_name='User',
            user_type='admin'
        )

        cls.doctor_user = User.objects.create_user(
            username='doctor@test.com',
            email='doctor@test.com',
            password='testpass123',
            first_name='John',
            last_name='Doctor',
            user_type='doctor'
        )

        cls.nurse_user = User.objects.create_user(
            username='nurse@test.com',
            email='nurse@test.com',
            password='testpass123',
            first_name='Jane',
            last_name='Nurse',
            user_type='nurse'
        )

        cls.patient_user = User.objects.create_user(
            username='patient@test.com',
            email='patient@test.com',
            password='testpass123',
            first_name='Pat',
            last_name='Patient',
            user_type='patient'
        )

    def setUp(self):
        """Set up for each test."""
        self.client = APIClient()

    def authenticate_as(self, user):
        """Authenticate API client as a specific user."""
        token = AccessToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def authenticate_as_admin(self):
        """Authenticate as admin user."""
        self.authenticate_as(self.admin_user)

    def authenticate_as_doctor(self):
        """Authenticate as doctor user."""
        self.authenticate_as(self.doctor_user)

    def authenticate_as_nurse(self):
        """Authenticate as nurse user."""
        self.authenticate_as(self.nurse_user)

    def authenticate_as_patient(self):
        """Authenticate as patient user."""
        self.authenticate_as(self.patient_user)

    def logout(self):
        """Clear authentication credentials."""
        self.client.credentials()

    def assertSuccessResponse(self, response, expected_status=200):
        """Assert successful response with optional status code check."""
        self.assertIn(
            response.status_code,
            [200, 201, 204] if expected_status == 200 else [expected_status],
            f"Expected success status, got {response.status_code}: {response.data if hasattr(response, 'data') else ''}"
        )

    def assertErrorResponse(self, response, expected_status, error_contains=None):
        """Assert error response with optional message check."""
        self.assertEqual(
            response.status_code,
            expected_status,
            f"Expected {expected_status}, got {response.status_code}: {response.data if hasattr(response, 'data') else ''}"
        )
        if error_contains:
            response_text = str(response.data)
            self.assertIn(
                error_contains.lower(),
                response_text.lower(),
                f"Expected '{error_contains}' in response: {response_text}"
            )

    def assertUnauthorized(self, response):
        """Assert 401 Unauthorized response."""
        self.assertEqual(response.status_code, 401)

    def assertForbidden(self, response):
        """Assert 403 Forbidden response."""
        self.assertEqual(response.status_code, 403)

    def assertNotFound(self, response):
        """Assert 404 Not Found response."""
        self.assertEqual(response.status_code, 404)

    def assertValidationError(self, response, field=None):
        """Assert 400 Bad Request with optional field check."""
        self.assertEqual(response.status_code, 400)
        if field:
            self.assertIn(field, response.data)

    def assertPaginated(self, response, expected_count=None):
        """Assert response is properly paginated."""
        self.assertEqual(response.status_code, 200)
        self.assertIn('results', response.data)
        self.assertIn('count', response.data)
        if expected_count is not None:
            self.assertEqual(response.data['count'], expected_count)
