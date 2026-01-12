"""
Global pytest fixtures for HMS backend testing.

This module provides comprehensive fixtures for:
- User fixtures for all 7 roles (admin, doctor, nurse, receptionist, lab_technician, pharmacist, patient)
- JWT token fixtures for authenticated API requests
- Patient profile fixtures
- Ward, bed, and admission fixtures
- Mock FHIR client fixtures
- Mock Celery task fixtures
"""
import os
import sys
import uuid
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch
from pathlib import Path

import django
import pytest

# Add backend directory to Python path
BACKEND_DIR = Path(__file__).parent.resolve()
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Configure Django settings BEFORE importing Django/DRF modules
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
os.environ.setdefault('DEFAULT_FACILITY_CODE', 'TEST')
os.environ.setdefault('CONTROL_PLANE_DB_ALIAS', 'default')
django.setup()

# Import Django/DRF modules after setup
from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

# Import models after Django setup
from django.contrib.auth import get_user_model
from apps.users.models import PatientProfile, Staff, PractitionerProfile, UserPatientList
from apps.wards.models import Ward, Bed

User = get_user_model()


# =============================================================================
# Database Access Fixtures
# =============================================================================

@pytest.fixture(autouse=True)
def enable_db_access_for_all_tests(db):
    """Automatically enable database access for all tests."""
    pass


# =============================================================================
# Facility Fixtures
# =============================================================================

@pytest.fixture(autouse=True)
def default_facility(db):
    """Ensure a default facility exists for facility-scoped requests."""
    from django.core.cache import cache
    from apps.core.cache_utils import facility_cache_key
    from apps.core.tests.factories import DefaultFacilityFactory

    cache.clear()
    facility = DefaultFacilityFactory()
    cache.set(facility_cache_key(f'facility_{facility.code}'), facility, 300)
    cache.set(facility_cache_key('active_facilities'), [facility], 300)
    return facility


# =============================================================================
# API Client Fixtures
# =============================================================================

@pytest.fixture
def api_client():
    """Return an unauthenticated API client."""
    return APIClient()


@pytest.fixture
def authenticated_client(api_client, user, default_facility):
    """Return an API client authenticated with a generic user."""
    token = AccessToken.for_user(user)
    facility = getattr(user, 'primary_facility', None) or default_facility
    api_client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return api_client


# =============================================================================
# Base User Factory Fixture
# =============================================================================

@pytest.fixture
def user_factory(db):
    """Factory fixture for creating users with specific roles."""
    def create_user(
        email=None,
        password='testpass123',
        user_type='patient',
        first_name='Test',
        last_name='User',
        is_active=True,
        is_staff=False,
        is_superuser=False,
        **kwargs
    ):
        if email is None:
            email = f'{user_type}_{uuid.uuid4().hex[:8]}@test.com'

        user = User.objects.create_user(
            username=email,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
            user_type=user_type,
            is_active=is_active,
            is_staff=is_staff,
            is_superuser=is_superuser,
            **kwargs
        )
        return user

    return create_user


# =============================================================================
# User Fixtures by Role
# =============================================================================

@pytest.fixture
def user(user_factory):
    """Create a generic patient user."""
    return user_factory(user_type='patient')


@pytest.fixture
def admin_user(user_factory):
    """Create an admin user."""
    return user_factory(
        email='admin@test.com',
        user_type='admin',
        first_name='Admin',
        last_name='User',
        is_staff=True,
        is_superuser=True
    )


@pytest.fixture
def doctor_user(user_factory):
    """Create a doctor user."""
    return user_factory(
        email='doctor@test.com',
        user_type='doctor',
        first_name='John',
        last_name='Doctor'
    )


@pytest.fixture
def nurse_user(user_factory):
    """Create a nurse user."""
    return user_factory(
        email='nurse@test.com',
        user_type='nurse',
        first_name='Jane',
        last_name='Nurse'
    )


@pytest.fixture
def receptionist_user(user_factory):
    """Create a receptionist user."""
    return user_factory(
        email='receptionist@test.com',
        user_type='receptionist',
        first_name='Mary',
        last_name='Receptionist'
    )


@pytest.fixture
def lab_technician_user(user_factory):
    """Create a lab technician user."""
    return user_factory(
        email='lab_tech@test.com',
        user_type='lab_technician',
        first_name='Lab',
        last_name='Technician'
    )


@pytest.fixture
def pharmacist_user(user_factory):
    """Create a pharmacist user."""
    return user_factory(
        email='pharmacist@test.com',
        user_type='pharmacist',
        first_name='Phil',
        last_name='Pharmacist'
    )


@pytest.fixture
def patient_user(user_factory):
    """Create a patient user."""
    return user_factory(
        email='patient@test.com',
        user_type='patient',
        first_name='Pat',
        last_name='Patient'
    )


# =============================================================================
# Authenticated API Client Fixtures by Role
# =============================================================================

def _make_authenticated_client(api_client_fixture, user_fixture):
    """Helper to create authenticated client."""
    def fixture(api_client, user, default_facility):
        token = AccessToken.for_user(user)
        facility = getattr(user, 'primary_facility', None) or default_facility
        api_client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_FACILITY_CODE=facility.code
        )
        return api_client
    return fixture


@pytest.fixture
def admin_client(api_client, admin_user, default_facility):
    """Return an API client authenticated as admin."""
    token = AccessToken.for_user(admin_user)
    facility = getattr(admin_user, 'primary_facility', None) or default_facility
    api_client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return api_client


@pytest.fixture
def doctor_client(api_client, doctor_user, default_facility):
    """Return an API client authenticated as doctor."""
    token = AccessToken.for_user(doctor_user)
    facility = getattr(doctor_user, 'primary_facility', None) or default_facility
    api_client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return api_client


@pytest.fixture
def nurse_client(api_client, nurse_user, default_facility):
    """Return an API client authenticated as nurse."""
    token = AccessToken.for_user(nurse_user)
    facility = getattr(nurse_user, 'primary_facility', None) or default_facility
    api_client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return api_client


@pytest.fixture
def receptionist_client(api_client, receptionist_user, default_facility):
    """Return an API client authenticated as receptionist."""
    token = AccessToken.for_user(receptionist_user)
    facility = getattr(receptionist_user, 'primary_facility', None) or default_facility
    api_client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return api_client


@pytest.fixture
def lab_technician_client(api_client, lab_technician_user, default_facility):
    """Return an API client authenticated as lab technician."""
    token = AccessToken.for_user(lab_technician_user)
    facility = getattr(lab_technician_user, 'primary_facility', None) or default_facility
    api_client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return api_client


@pytest.fixture
def pharmacist_client(api_client, pharmacist_user, default_facility):
    """Return an API client authenticated as pharmacist."""
    token = AccessToken.for_user(pharmacist_user)
    facility = getattr(pharmacist_user, 'primary_facility', None) or default_facility
    api_client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return api_client


@pytest.fixture
def patient_client(api_client, patient_user, default_facility):
    """Return an API client authenticated as patient."""
    token = AccessToken.for_user(patient_user)
    facility = getattr(patient_user, 'primary_facility', None) or default_facility
    api_client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return api_client


# =============================================================================
# JWT Token Fixtures
# =============================================================================

@pytest.fixture
def access_token(user):
    """Generate an access token for the generic user."""
    return str(AccessToken.for_user(user))


@pytest.fixture
def refresh_token(user):
    """Generate a refresh token for the generic user."""
    return str(RefreshToken.for_user(user))


@pytest.fixture
def token_pair(user):
    """Generate both access and refresh tokens for the generic user."""
    refresh = RefreshToken.for_user(user)
    return {
        'access': str(refresh.access_token),
        'refresh': str(refresh)
    }


@pytest.fixture
def expired_token(user):
    """Generate an expired access token."""
    token = AccessToken.for_user(user)
    # Set expiration to the past
    token.set_exp(lifetime=-timedelta(hours=1))
    return str(token)


# =============================================================================
# Staff and Practitioner Fixtures
# =============================================================================

@pytest.fixture
def staff_factory(db, admin_user):
    """Factory fixture for creating staff profiles."""
    counter = [0]

    def create_staff(user, department='General', position='Staff', hire_date=None):
        counter[0] += 1
        if hire_date is None:
            hire_date = date.today() - timedelta(days=365)

        return Staff.objects.create(
            user=user,
            employee_id=f'EMP{counter[0]:04d}',
            department=department,
            position=position,
            hire_date=hire_date,
            created_by=admin_user,
            updated_by=admin_user
        )

    return create_staff


@pytest.fixture
def practitioner_factory(db, staff_factory, admin_user):
    """Factory fixture for creating practitioner profiles."""
    counter = [0]

    def create_practitioner(user, specialization='General Medicine', qualification='MD'):
        counter[0] += 1
        staff = staff_factory(
            user=user,
            department='Medical',
            position='Practitioner'
        )

        return PractitionerProfile.objects.create(
            staff=staff,
            license_number=f'LIC{counter[0]:06d}',
            specialization=specialization,
            qualification=qualification,
            created_by=admin_user,
            updated_by=admin_user
        )

    return create_practitioner


@pytest.fixture
def doctor_practitioner(practitioner_factory, doctor_user):
    """Create a doctor user with practitioner profile."""
    return practitioner_factory(
        user=doctor_user,
        specialization='Internal Medicine',
        qualification='MD, MBBS'
    )


@pytest.fixture
def nurse_practitioner(practitioner_factory, nurse_user):
    """Create a nurse user with practitioner profile."""
    return practitioner_factory(
        user=nurse_user,
        specialization='Nursing',
        qualification='RN, BSN'
    )


# =============================================================================
# Patient Fixtures
# =============================================================================

@pytest.fixture
def patient_profile_factory(db, user_factory, admin_user):
    """Factory fixture for creating patient profiles."""
    counter = [0]
    from apps.core.tests.factories import FacilityFactory

    def create_patient_profile(
        user=None,
        medical_record_number=None,
        blood_group='O+',
        allergies=None,
        emergency_contact_name='Emergency Contact',
        emergency_contact_phone='+1234567890',
        **kwargs
    ):
        counter[0] += 1

        if user is None:
            user = user_factory(
                user_type='patient',
                first_name=f'Patient{counter[0]}',
                last_name='Test'
            )

        if medical_record_number is None:
            medical_record_number = f'MRN{counter[0]:06d}'

        facility = kwargs.pop('facility', None)
        if not facility:
            facility = getattr(user, 'primary_facility', None)
        if not facility:
            facility = FacilityFactory()

        return PatientProfile.objects.create(
            user=user,
            facility=facility,
            medical_record_number=medical_record_number,
            blood_group=blood_group,
            allergies=allergies,
            emergency_contact_name=emergency_contact_name,
            emergency_contact_phone=emergency_contact_phone,
            created_by=admin_user,
            updated_by=admin_user,
            **kwargs
        )

    return create_patient_profile


@pytest.fixture
def patient_profile(patient_profile_factory):
    """Create a single patient profile."""
    return patient_profile_factory(
        blood_group='A+',
        allergies='Penicillin, Sulfa',
        emergency_contact_name='John Smith',
        emergency_contact_phone='+1987654321'
    )


@pytest.fixture
def multiple_patients(patient_profile_factory):
    """Create multiple patient profiles for list testing."""
    patients = []
    for i in range(5):
        patients.append(patient_profile_factory(
            blood_group=['A+', 'B+', 'O+', 'AB+', 'A-'][i],
            allergies=None if i % 2 == 0 else 'Test allergy'
        ))
    return patients


# =============================================================================
# Ward and Bed Fixtures
# =============================================================================

@pytest.fixture
def ward_factory(db, admin_user):
    """Factory fixture for creating wards."""
    counter = [0]

    def create_ward(
        name=None,
        ward_type='general',
        total_beds=20,
        base_rate_per_night=100.00,
        is_active=True,
        **kwargs
    ):
        counter[0] += 1
        if name is None:
            name = f'Test Ward {counter[0]}'

        return Ward.objects.create(
            name=name,
            ward_type=ward_type,
            total_beds=total_beds,
            base_rate_per_night=Decimal(str(base_rate_per_night)),
            is_active=is_active,
            created_by=admin_user,
            updated_by=admin_user,
            **kwargs
        )

    return create_ward


@pytest.fixture
def bed_factory(db, ward_factory):
    """Factory fixture for creating beds."""
    counter = [0]

    def create_bed(
        ward=None,
        bed_number=None,
        bed_type='standard',
        status='available',
        **kwargs
    ):
        counter[0] += 1
        if ward is None:
            ward = ward_factory()
        if bed_number is None:
            bed_number = f'BED-{counter[0]:03d}'

        return Bed.objects.create(
            ward=ward,
            bed_number=bed_number,
            bed_type=bed_type,
            status=status,
            **kwargs
        )

    return create_bed


@pytest.fixture
def ward(ward_factory):
    """Create a general ward."""
    return ward_factory(
        name='General Ward A',
        ward_type='general',
        total_beds=20
    )


@pytest.fixture
def icu_ward(ward_factory):
    """Create an ICU ward."""
    return ward_factory(
        name='ICU',
        ward_type='icu',
        total_beds=10,
        base_rate_per_night=500.00
    )


@pytest.fixture
def ward_with_beds(ward_factory, bed_factory):
    """Create a ward with multiple beds."""
    ward = ward_factory(name='Ward with Beds', total_beds=5)
    beds = []
    for i in range(5):
        status = 'available' if i < 3 else 'occupied'
        beds.append(bed_factory(
            ward=ward,
            bed_number=f'W1-{i+1:02d}',
            status=status
        ))
    return ward, beds


# =============================================================================
# Mock FHIR Client Fixtures
# =============================================================================

@pytest.fixture
def mock_fhir_client():
    """Mock FHIR client for testing without external API calls."""
    with patch('apps.fhir_client.client.FHIRClient') as mock_client:
        mock_instance = MagicMock()

        # Mock common FHIR operations
        mock_instance.create_resource.return_value = {
            'resourceType': 'Patient',
            'id': f'fhir-{uuid.uuid4().hex[:12]}',
            'meta': {'versionId': '1'}
        }

        mock_instance.read_resource.return_value = {
            'resourceType': 'Patient',
            'id': 'fhir-patient-123',
            'name': [{'given': ['Test'], 'family': 'Patient'}]
        }

        mock_instance.update_resource.return_value = {
            'resourceType': 'Patient',
            'id': 'fhir-patient-123',
            'meta': {'versionId': '2'}
        }

        mock_instance.delete_resource.return_value = True

        mock_instance.search.return_value = {
            'resourceType': 'Bundle',
            'type': 'searchset',
            'total': 0,
            'entry': []
        }

        mock_client.return_value = mock_instance
        yield mock_instance


@pytest.fixture
def mock_fhir_patient_create(mock_fhir_client):
    """Mock FHIR client specifically configured for patient creation."""
    mock_fhir_client.create_resource.return_value = {
        'resourceType': 'Patient',
        'id': f'fhir-patient-{uuid.uuid4().hex[:8]}',
        'meta': {'versionId': '1'},
        'identifier': [
            {'system': 'urn:hms:mrn', 'value': 'MRN000001'}
        ]
    }
    return mock_fhir_client


# =============================================================================
# Mock Celery Task Fixtures
# =============================================================================

@pytest.fixture
def mock_celery():
    """Mock Celery tasks to run synchronously for testing."""
    with patch('celery.current_app') as mock_app:
        mock_app.conf.task_always_eager = True
        yield mock_app


@pytest.fixture
def mock_send_email():
    """Mock email sending for testing."""
    with patch('django.core.mail.send_mail') as mock_mail:
        mock_mail.return_value = 1  # Number of emails sent
        yield mock_mail


# =============================================================================
# Time-related Fixtures
# =============================================================================

@pytest.fixture
def frozen_time():
    """Fixture for freezing time in tests.

    Usage:
        def test_something(frozen_time):
            with frozen_time('2024-01-15 10:00:00'):
                # Time is frozen to 2024-01-15 10:00:00
                pass
    """
    from freezegun import freeze_time
    return freeze_time


@pytest.fixture
def now():
    """Return current timezone-aware datetime."""
    return timezone.now()


@pytest.fixture
def yesterday():
    """Return yesterday's timezone-aware datetime."""
    return timezone.now() - timedelta(days=1)


@pytest.fixture
def tomorrow():
    """Return tomorrow's timezone-aware datetime."""
    return timezone.now() + timedelta(days=1)


# =============================================================================
# Response Mock Fixtures
# =============================================================================

@pytest.fixture
def mock_external_api():
    """Mock external HTTP requests using responses library.

    Usage:
        def test_external_api(mock_external_api):
            mock_external_api.add(
                responses.GET,
                'https://api.example.com/data',
                json={'key': 'value'},
                status=200
            )
            # Make request to external API
    """
    import responses

    with responses.RequestsMock() as rsps:
        yield rsps


# =============================================================================
# Test Data Cleanup Fixtures
# =============================================================================

@pytest.fixture(autouse=True)
def reset_sequences(db):
    """Reset database sequences after each test for consistent IDs."""
    yield
    # Cleanup happens automatically with Django's test database rollback


# =============================================================================
# Utility Fixtures
# =============================================================================

@pytest.fixture
def assert_audit_fields():
    """Helper fixture to assert audit fields are correctly set."""
    def check_audit_fields(obj, created_by=None, updated_by=None):
        assert obj.created_at is not None
        assert obj.updated_at is not None
        if created_by:
            assert obj.created_by == created_by
        if updated_by:
            assert obj.updated_by == updated_by
    return check_audit_fields


@pytest.fixture
def assert_api_error():
    """Helper fixture to assert API error responses."""
    def check_error(response, expected_status, error_contains=None):
        assert response.status_code == expected_status
        if error_contains:
            response_text = str(response.data)
            assert error_contains.lower() in response_text.lower()
    return check_error


@pytest.fixture
def assert_requires_auth(api_client):
    """Helper fixture to assert endpoint requires authentication."""
    def check_auth_required(url, method='GET', data=None):
        methods = {
            'GET': api_client.get,
            'POST': api_client.post,
            'PUT': api_client.put,
            'PATCH': api_client.patch,
            'DELETE': api_client.delete
        }
        response = methods[method](url, data=data, format='json')
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    return check_auth_required
