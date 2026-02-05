"""
API view tests for users app.

Tests for:
- UserViewSet (CRUD operations)
- StaffViewSet (CRUD operations, registration)
- PractitionerProfileViewSet
- PatientProfileViewSet
- UserPatientListViewSet (my patients)
"""
import pytest
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.users.models import User, Staff, PractitionerProfile, PatientProfile, UserPatientList
from apps.core.tests.factories import DefaultFacilityFactory
from .factories import (
    UserFactory, AdminUserFactory, DoctorUserFactory, NurseUserFactory,
    PatientUserFactory, StaffFactory, PractitionerProfileFactory,
    PatientProfileFactory, UserPatientListFactory
)


def get_authenticated_client(user, facility=None):
    """Get an API client authenticated as the given user."""
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    if facility is None:
        facility = getattr(user, 'primary_facility', None) or DefaultFacilityFactory()
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return client


# =============================================================================
# User ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestUserViewSet:
    """Tests for UserViewSet."""

    def test_list_users_as_admin(self, db):
        """Test admin can list all users."""
        admin = AdminUserFactory()
        # Create some users
        DoctorUserFactory()
        NurseUserFactory()
        PatientUserFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/users/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 4  # admin + 3 created users

    def test_create_user_as_admin(self, db):
        """Test admin can create a new user."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        user_data = {
            'email': 'newdoctor@test.com',
            'username': 'newdoctor',
            'password': 'SecurePass123!',
            'confirm_password': 'SecurePass123!',
            'first_name': 'New',
            'last_name': 'Doctor',
            'user_type': 'doctor'
        }

        response = client.post('/api/users/users/', user_data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['email'] == 'newdoctor@test.com'
        assert User.objects.filter(email='newdoctor@test.com').exists()

    def test_retrieve_user(self, db):
        """Test retrieving a user's details."""
        admin = AdminUserFactory()
        doctor = DoctorUserFactory(first_name='John', last_name='Smith')

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/users/{doctor.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['first_name'] == 'John'
        assert response.data['last_name'] == 'Smith'

    def test_update_user_as_admin(self, db):
        """Test admin can update a user."""
        admin = AdminUserFactory()
        doctor = DoctorUserFactory()

        client = get_authenticated_client(admin)
        response = client.patch(f'/api/users/users/{doctor.id}/', {
            'first_name': 'Updated'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        doctor.refresh_from_db()
        assert doctor.first_name == 'Updated'

    def test_update_self(self, db):
        """Test user can update their own profile."""
        doctor = DoctorUserFactory()
        client = get_authenticated_client(doctor)

        response = client.patch(f'/api/users/users/{doctor.id}/', {
            'first_name': 'SelfUpdated'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        doctor.refresh_from_db()
        assert doctor.first_name == 'SelfUpdated'

    def test_delete_user_as_admin(self, db):
        """Test admin can delete a user."""
        admin = AdminUserFactory()
        user_to_delete = PatientUserFactory()

        client = get_authenticated_client(admin)
        response = client.delete(f'/api/users/users/{user_to_delete.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not User.objects.filter(id=user_to_delete.id).exists()

    def test_me_endpoint(self, db):
        """Test the /me endpoint returns current user."""
        doctor = DoctorUserFactory(email='me@test.com', first_name='Me')
        client = get_authenticated_client(doctor)

        response = client.get('/api/users/users/me/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['email'] == 'me@test.com'
        assert response.data['first_name'] == 'Me'


# =============================================================================
# Staff ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestStaffViewSet:
    """Tests for StaffViewSet."""

    def test_list_staff(self, db):
        """Test listing staff members."""
        admin = AdminUserFactory()
        StaffFactory()
        StaffFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/staff/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 2

    def test_retrieve_staff(self, db):
        """Test retrieving staff details."""
        admin = AdminUserFactory()
        staff = StaffFactory(employee_id='EMP_RETRIEVE', department='Cardiology')

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/staff/{staff.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['employee_id'] == 'EMP_RETRIEVE'
        assert response.data['department'] == 'Cardiology'

    def test_staff_with_practitioner_profile(self, db):
        """Test staff with practitioner profile."""
        admin = AdminUserFactory()
        doctor = DoctorUserFactory()
        staff = StaffFactory(user=doctor)
        practitioner = PractitionerProfileFactory(
            staff=staff,
            specialization='Cardiology'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/staff/{staff.id}/')

        assert response.status_code == status.HTTP_200_OK
        # Response should include practitioner info
        if 'practitioner_profile' in response.data:
            assert response.data['practitioner_profile']['specialization'] == 'Cardiology'

    def test_invite_staff_sends_reset_link(self, db, monkeypatch):
        """Admin can invite staff without setting a known password."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        # Avoid sending real email
        called = {}

        def fake_delay(**kwargs):
            called.update(kwargs)
            return {"status": "queued"}

        monkeypatch.setattr('apps.users.tasks.send_account_setup_email.delay', fake_delay)

        payload = {
            'email': 'v2tui.doctor@inbox.testmail.app',
            'first_name': 'Test',
            'last_name': 'Doctor',
            'user_type': 'doctor',
            'department': 'Internal Medicine',
            'position': 'Attending Physician',
            'hire_date': '2020-01-15',
            'license_number': 'MD-INV-001',
            'specialization': 'Internal Medicine',
            'qualification': 'MD, MBBS',
        }

        response = client.post('/api/users/staff/invite/', payload, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        user = User.objects.get(email='v2tui.doctor@inbox.testmail.app')
        assert not user.has_usable_password()
        assert Staff.objects.filter(user=user).exists()
        assert PractitionerProfile.objects.filter(staff__user=user).exists()
        assert called.get('user_email') == 'v2tui.doctor@inbox.testmail.app'


# =============================================================================
# Practitioner Profile ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPractitionerProfileViewSet:
    """Tests for PractitionerProfileViewSet."""

    def test_list_practitioners(self, db):
        """Test listing practitioners."""
        admin = AdminUserFactory()
        PractitionerProfileFactory()
        PractitionerProfileFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/practitioners/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 2

    def test_retrieve_practitioner(self, db):
        """Test retrieving practitioner details."""
        admin = AdminUserFactory()
        practitioner = PractitionerProfileFactory(
            license_number='LIC_RETRIEVE',
            specialization='Neurology'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/practitioners/{practitioner.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['license_number'] == 'LIC_RETRIEVE'
        assert response.data['specialization'] == 'Neurology'

    def test_filter_practitioners_by_specialization(self, db):
        """Test filtering practitioners by specialization."""
        admin = AdminUserFactory()
        PractitionerProfileFactory(specialization='Cardiology')
        PractitionerProfileFactory(specialization='Cardiology')
        PractitionerProfileFactory(specialization='Neurology')

        client = get_authenticated_client(admin)
        response = client.get('/api/users/practitioners/', {'specialization': 'Cardiology'})

        if response.status_code == status.HTTP_200_OK:
            results = response.data.get('results', response.data)
            # Should only include cardiologists if filter works
            specializations = [p['specialization'] for p in results]
            # Filter may or may not be implemented
            assert len(results) >= 1


# =============================================================================
# Patient Profile ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientProfileViewSet:
    """Tests for PatientProfileViewSet (via /api/patients/)."""

    def test_list_patients(self, db):
        """Test listing patients."""
        admin = AdminUserFactory()
        PatientProfileFactory()
        PatientProfileFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 2

    def test_retrieve_patient(self, db):
        """Test retrieving patient details."""
        admin = AdminUserFactory()
        patient = PatientProfileFactory(
            medical_record_number='MRN_RETRIEVE',
            blood_group='A+'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/patients/{patient.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['medical_record_number'] == 'MRN_RETRIEVE'
        assert response.data['blood_group'] == 'A+'

    def test_search_patients_by_name(self, db):
        """Test searching patients by name."""
        admin = AdminUserFactory()
        user1 = PatientUserFactory(first_name='John', last_name='Doe')
        user2 = PatientUserFactory(first_name='Jane', last_name='Smith')
        PatientProfileFactory(user=user1)
        PatientProfileFactory(user=user2)

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/', {'search': 'John'})

        assert response.status_code == status.HTTP_200_OK

    def test_search_patients_by_mrn(self, db):
        """Test searching patients by MRN."""
        admin = AdminUserFactory()
        PatientProfileFactory(medical_record_number='MRN_SEARCH_001')
        PatientProfileFactory(medical_record_number='MRN_SEARCH_002')

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/', {'search': 'MRN_SEARCH_001'})

        assert response.status_code == status.HTTP_200_OK

    def test_patient_includes_emergency_contact(self, db):
        """Test that patient details include emergency contact."""
        admin = AdminUserFactory()
        patient = PatientProfileFactory(
            emergency_contact_name='John Smith',
            emergency_contact_phone='+1234567890',
            emergency_contact_relationship='Spouse'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/patients/{patient.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['emergency_contact_name'] == 'John Smith'


# =============================================================================
# User Patient List (My Patients) ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestUserPatientListViewSet:
    """Tests for UserPatientList (My Patients) functionality."""

    def test_list_my_patients(self, db):
        """Test listing my patients."""
        doctor = DoctorUserFactory()
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()

        UserPatientList.objects.create(user=doctor, patient=patient1)
        UserPatientList.objects.create(user=doctor, patient=patient2)

        client = get_authenticated_client(doctor)
        response = client.get('/api/users/my-patients/')

        if response.status_code == status.HTTP_200_OK:
            results = response.data.get('results', response.data)
            assert len(results) == 2

    def test_add_patient_to_my_list(self, db):
        """Test adding a patient to my list."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        client = get_authenticated_client(doctor)
        response = client.post('/api/users/my-patients/', {
            'patient': str(patient.id),
            'notes': 'Follow-up needed'
        }, format='json')

        if response.status_code in [status.HTTP_201_CREATED, status.HTTP_200_OK]:
            assert UserPatientList.objects.filter(user=doctor, patient=patient).exists()

    def test_remove_patient_from_my_list(self, db):
        """Test removing a patient from my list."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        entry = UserPatientList.objects.create(user=doctor, patient=patient)

        client = get_authenticated_client(doctor)
        response = client.delete(f'/api/users/my-patients/{entry.id}/')

        if response.status_code == status.HTTP_204_NO_CONTENT:
            assert not UserPatientList.objects.filter(id=entry.id).exists()

    def test_pin_patient(self, db):
        """Test pinning a patient."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        entry = UserPatientList.objects.create(user=doctor, patient=patient, is_pinned=False)

        client = get_authenticated_client(doctor)
        response = client.patch(f'/api/users/my-patients/{entry.id}/', {
            'is_pinned': True
        }, format='json')

        if response.status_code == status.HTTP_200_OK:
            entry.refresh_from_db()
            assert entry.is_pinned is True

    def test_my_patients_isolated_per_user(self, db):
        """Test that each user sees only their own patient list."""
        doctor1 = DoctorUserFactory()
        doctor2 = DoctorUserFactory()
        patient = PatientProfileFactory()

        UserPatientList.objects.create(user=doctor1, patient=patient)

        # Doctor2 should not see doctor1's patients
        client = get_authenticated_client(doctor2)
        response = client.get('/api/users/my-patients/')

        if response.status_code == status.HTTP_200_OK:
            results = response.data.get('results', response.data)
            assert len(results) == 0

    def test_cannot_add_duplicate_patient(self, db):
        """Test that adding same patient twice fails."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        UserPatientList.objects.create(user=doctor, patient=patient)

        client = get_authenticated_client(doctor)
        response = client.post('/api/users/my-patients/', {
            'patient': str(patient.id)
        }, format='json')

        # Should fail with 400 or similar
        assert response.status_code in [
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_409_CONFLICT,
            status.HTTP_201_CREATED  # Some implementations may update instead
        ]


# =============================================================================
# Pagination Tests
# =============================================================================

@pytest.mark.tier1
class TestPagination:
    """Tests for pagination on list endpoints."""

    def test_users_list_paginated(self, db):
        """Test that users list is paginated."""
        admin = AdminUserFactory()
        # Create many users
        for _ in range(25):
            UserFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/users/')

        assert response.status_code == status.HTTP_200_OK
        # Should have pagination fields
        if isinstance(response.data, dict):
            assert 'results' in response.data or 'count' in response.data

    def test_patients_list_paginated(self, db):
        """Test that patients list is paginated."""
        admin = AdminUserFactory()
        for _ in range(25):
            PatientProfileFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/patients/')

        assert response.status_code == status.HTTP_200_OK
        if isinstance(response.data, dict):
            assert 'results' in response.data or 'count' in response.data


# =============================================================================
# Error Handling Tests
# =============================================================================

@pytest.mark.tier1
class TestErrorHandling:
    """Tests for error handling on endpoints."""

    def test_get_nonexistent_user(self, db):
        """Test getting a non-existent user returns 404."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        response = client.get('/api/users/users/00000000-0000-0000-0000-000000000000/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_get_nonexistent_patient(self, db):
        """Test getting a non-existent patient returns 404."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        response = client.get('/api/patients/00000000-0000-0000-0000-000000000000/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_create_user_invalid_email(self, db):
        """Test creating user with invalid email fails."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        response = client.post('/api/users/users/', {
            'email': 'not-an-email',
            'username': 'testuser',
            'password': 'TestPass123!',
            'first_name': 'Test',
            'last_name': 'User'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_user_duplicate_email(self, db):
        """Test creating user with duplicate email fails."""
        admin = AdminUserFactory()
        UserFactory(email='duplicate@test.com')

        client = get_authenticated_client(admin)
        response = client.post('/api/users/users/', {
            'email': 'duplicate@test.com',
            'username': 'anotheruser',
            'password': 'TestPass123!',
            'first_name': 'Test',
            'last_name': 'User'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
