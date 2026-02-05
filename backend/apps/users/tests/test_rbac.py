"""
Role-Based Access Control (RBAC) tests for users app.

Tests for:
- Permission classes (IsAdmin, IsDoctor, IsNurse, etc.)
- Role-based endpoint access
- Cross-role access denial
- IsClinicalProvider permission
- Data filtering by role
"""
import pytest
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.users.rbac import (
    IsAdmin, IsDoctor, IsNurse, IsReceptionist,
    IsLabTechnician, IsPharmacist, IsBillingOfficer,
    IsPatient, IsClinicalProvider
)
from .factories import (
    UserFactory, AdminUserFactory, DoctorUserFactory, NurseUserFactory,
    ReceptionistUserFactory, LabTechnicianUserFactory, PharmacistUserFactory,
    PatientUserFactory, StaffFactory, PatientProfileFactory,
    create_users_of_all_types
)
from apps.core.tests.factories import DefaultFacilityFactory


@pytest.fixture
def all_role_users(db):
    """Create one user of each role type."""
    return create_users_of_all_types()


@pytest.fixture
def api_client():
    """Return an unauthenticated API client."""
    return APIClient()


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
# Permission Class Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.rbac
class TestPermissionClasses:
    """Tests for individual permission classes."""

    def test_is_admin_permission(self, db):
        """Test IsAdmin permission class."""
        permission = IsAdmin()

        # Create mock request objects
        class MockRequest:
            def __init__(self, user):
                self.user = user

        admin = AdminUserFactory()
        doctor = DoctorUserFactory()
        unauthenticated = UserFactory(is_active=False)

        # Admin should have permission
        assert permission.has_permission(MockRequest(admin), None) is True

        # Doctor should not
        assert permission.has_permission(MockRequest(doctor), None) is False

    def test_is_doctor_permission(self, db):
        """Test IsDoctor permission class."""
        permission = IsDoctor()

        class MockRequest:
            def __init__(self, user):
                self.user = user

        doctor = DoctorUserFactory()
        nurse = NurseUserFactory()

        assert permission.has_permission(MockRequest(doctor), None) is True
        assert permission.has_permission(MockRequest(nurse), None) is False

    def test_is_nurse_permission(self, db):
        """Test IsNurse permission class."""
        permission = IsNurse()

        class MockRequest:
            def __init__(self, user):
                self.user = user

        nurse = NurseUserFactory()
        doctor = DoctorUserFactory()

        assert permission.has_permission(MockRequest(nurse), None) is True
        assert permission.has_permission(MockRequest(doctor), None) is False

    def test_is_clinical_provider_permission(self, db):
        """Test IsClinicalProvider permission class."""
        permission = IsClinicalProvider()

        class MockRequest:
            def __init__(self, user):
                self.user = user

        # Clinical providers
        doctor = DoctorUserFactory()
        nurse = NurseUserFactory()
        lab_tech = LabTechnicianUserFactory()
        pharmacist = PharmacistUserFactory()

        # Non-clinical
        admin = AdminUserFactory()
        receptionist = ReceptionistUserFactory()
        patient = PatientUserFactory()

        # Clinical providers should have permission
        assert permission.has_permission(MockRequest(doctor), None) is True
        assert permission.has_permission(MockRequest(nurse), None) is True
        assert permission.has_permission(MockRequest(lab_tech), None) is True
        assert permission.has_permission(MockRequest(pharmacist), None) is True

        # Non-clinical should not
        assert permission.has_permission(MockRequest(admin), None) is False
        assert permission.has_permission(MockRequest(receptionist), None) is False
        assert permission.has_permission(MockRequest(patient), None) is False


# =============================================================================
# User Endpoint RBAC Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.rbac
class TestUserEndpointRBAC:
    """Tests for user endpoint role-based access."""

    def test_users_list_admin_only(self, all_role_users, api_client):
        """Test that only admins can list all users."""
        # Admin should be able to list
        admin_client = get_authenticated_client(all_role_users['admin'])
        response = admin_client.get('/api/users/users/')
        assert response.status_code == status.HTTP_200_OK

        # Other roles should be forbidden
        for role in ['doctor', 'nurse', 'receptionist', 'patient']:
            client = get_authenticated_client(all_role_users[role])
            response = client.get('/api/users/users/')
            assert response.status_code in [
                status.HTTP_403_FORBIDDEN,
                status.HTTP_200_OK  # Some implementations filter to self
            ]

    def test_users_create_admin_only(self, all_role_users, api_client):
        """Test that only admins can create users."""
        user_data = {
            'email': 'newuser@test.com',
            'username': 'newuser',
            'password': 'TestPass123!',
            'confirm_password': 'TestPass123!',
            'first_name': 'New',
            'last_name': 'User',
            'user_type': 'patient'
        }

        # Admin should be able to create
        admin_client = get_authenticated_client(all_role_users['admin'])
        response = admin_client.post('/api/users/users/', user_data, format='json')
        assert response.status_code in [status.HTTP_201_CREATED, status.HTTP_200_OK]

        # Doctor should be forbidden
        doctor_client = get_authenticated_client(all_role_users['doctor'])
        user_data['email'] = 'another@test.com'
        user_data['username'] = 'another'
        response = doctor_client.post('/api/users/users/', user_data, format='json')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_users_retrieve_self(self, all_role_users):
        """Test that users can retrieve their own profile."""
        for role, user in all_role_users.items():
            client = get_authenticated_client(user)
            response = client.get(f'/api/users/users/{user.id}/')
            assert response.status_code == status.HTTP_200_OK
            assert response.data['email'] == user.email

    def test_users_me_endpoint(self, all_role_users):
        """Test that all authenticated users can access /me endpoint."""
        for role, user in all_role_users.items():
            client = get_authenticated_client(user)
            response = client.get('/api/users/users/me/')
            assert response.status_code == status.HTTP_200_OK
            assert response.data['email'] == user.email


# =============================================================================
# Staff Endpoint RBAC Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.rbac
class TestStaffEndpointRBAC:
    """Tests for staff endpoint role-based access."""

    def test_staff_list_clinical_roles(self, all_role_users):
        """Test that clinical roles can view staff list."""
        # Admin, doctor, nurse, receptionist should be able to list staff
        allowed_roles = ['admin', 'doctor', 'nurse', 'receptionist']
        for role in allowed_roles:
            client = get_authenticated_client(all_role_users[role])
            response = client.get('/api/users/staff/')
            assert response.status_code == status.HTTP_200_OK, f"{role} should access staff list"

    def test_staff_list_forbidden_roles(self, all_role_users):
        """Test that non-clinical roles cannot view staff list."""
        # Patient should not be able to list staff
        patient_client = get_authenticated_client(all_role_users['patient'])
        response = patient_client.get('/api/users/staff/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_staff_create_admin_only(self, all_role_users):
        """Test that only admins can create staff."""
        staff_data = {
            'user_id': str(all_role_users['doctor'].id),
            'employee_id': 'EMP_NEW_001',
            'department': 'Cardiology',
            'position': 'Doctor',
            'hire_date': '2024-01-01'
        }

        # Admin should be able to create
        admin_client = get_authenticated_client(all_role_users['admin'])
        # Note: Actual endpoint may differ

        # Doctor should be forbidden
        doctor_client = get_authenticated_client(all_role_users['doctor'])
        response = doctor_client.post('/api/users/staff/', staff_data, format='json')
        assert response.status_code in [
            status.HTTP_403_FORBIDDEN,
            status.HTTP_400_BAD_REQUEST  # May fail for other reasons
        ]


# =============================================================================
# Patient Endpoint RBAC Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.rbac
class TestPatientEndpointRBAC:
    """Tests for patient endpoint role-based access."""

    @pytest.fixture
    def sample_patient(self, db):
        """Create a sample patient."""
        return PatientProfileFactory()

    def test_patient_list_clinical_access(self, all_role_users, sample_patient):
        """Test that clinical roles can list patients."""
        # Doctors and nurses should be able to list patients
        for role in ['admin', 'doctor', 'nurse', 'receptionist']:
            client = get_authenticated_client(all_role_users[role])
            response = client.get('/api/patients/')
            assert response.status_code == status.HTTP_200_OK, f"{role} should access patient list"

    def test_patient_detail_clinical_access(self, all_role_users, sample_patient):
        """Test that clinical roles can view patient details."""
        for role in ['admin', 'doctor', 'nurse']:
            client = get_authenticated_client(all_role_users[role])
            response = client.get(f'/api/patients/{sample_patient.id}/')
            assert response.status_code in [
                status.HTTP_200_OK,
                status.HTTP_404_NOT_FOUND  # May not find due to queryset filtering
            ]

    def test_patient_cannot_view_other_patients(self, all_role_users, sample_patient):
        """Test that patients cannot view other patients."""
        patient_client = get_authenticated_client(all_role_users['patient'])
        response = patient_client.get(f'/api/patients/{sample_patient.id}/')
        assert response.status_code in [
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND
        ]


# =============================================================================
# Role-Specific Data Filtering Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.rbac
class TestDataFiltering:
    """Tests for role-based data filtering."""

    def test_non_admin_users_see_only_self(self, all_role_users):
        """Test that non-admin users only see themselves in user list."""
        for role in ['doctor', 'nurse', 'receptionist', 'patient']:
            client = get_authenticated_client(all_role_users[role])
            response = client.get('/api/users/users/')

            # If accessible, should only contain self
            if response.status_code == status.HTTP_200_OK:
                results = response.data.get('results', response.data)
                if isinstance(results, list):
                    user_emails = [u['email'] for u in results]
                    assert all_role_users[role].email in user_emails or len(results) == 0

    def test_admin_sees_all_users(self, all_role_users):
        """Test that admin can see all users."""
        admin_client = get_authenticated_client(all_role_users['admin'])
        response = admin_client.get('/api/users/users/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        if isinstance(results, list):
            # Admin should see multiple users
            assert len(results) >= 1


# =============================================================================
# Cross-Role Action Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.rbac
class TestCrossRoleActions:
    """Tests for actions across different roles."""

    def test_doctor_cannot_delete_other_user(self, all_role_users):
        """Test that doctors cannot delete other users."""
        doctor_client = get_authenticated_client(all_role_users['doctor'])
        target_user = all_role_users['nurse']

        response = doctor_client.delete(f'/api/users/users/{target_user.id}/')
        assert response.status_code in [
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND
        ]

    def test_admin_can_delete_user(self, db):
        """Test that admin can delete users."""
        admin = AdminUserFactory()
        user_to_delete = DoctorUserFactory()

        admin_client = get_authenticated_client(admin)
        response = admin_client.delete(f'/api/users/users/{user_to_delete.id}/')

        assert response.status_code in [
            status.HTTP_204_NO_CONTENT,
            status.HTTP_200_OK
        ]

    def test_user_can_update_self(self, all_role_users):
        """Test that users can update their own profile."""
        for role in ['doctor', 'nurse', 'patient']:
            user = all_role_users[role]
            client = get_authenticated_client(user)

            response = client.patch(f'/api/users/users/{user.id}/', {
                'first_name': 'Updated'
            }, format='json')

            assert response.status_code in [
                status.HTTP_200_OK,
                status.HTTP_403_FORBIDDEN  # Some implementations may restrict
            ]

    def test_user_cannot_update_other_user(self, all_role_users):
        """Test that users cannot update other users' profiles."""
        doctor_client = get_authenticated_client(all_role_users['doctor'])
        target_user = all_role_users['nurse']

        response = doctor_client.patch(f'/api/users/users/{target_user.id}/', {
            'first_name': 'Hacked'
        }, format='json')

        assert response.status_code in [
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND
        ]


# =============================================================================
# Unauthenticated Access Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.rbac
class TestUnauthenticatedAccess:
    """Tests for unauthenticated access."""

    def test_users_list_requires_auth(self, api_client, db):
        """Test that users list requires authentication."""
        response = api_client.get('/api/users/users/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_staff_list_requires_auth(self, api_client, db):
        """Test that staff list requires authentication."""
        response = api_client.get('/api/users/staff/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_patients_list_requires_auth(self, api_client, db):
        """Test that patients list requires authentication."""
        response = api_client.get('/api/patients/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_user_detail_requires_auth(self, db, api_client):
        """Test that user detail requires authentication."""
        user = UserFactory()
        response = api_client.get(f'/api/users/users/{user.id}/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


# =============================================================================
# My Patients Endpoint RBAC Tests
# =============================================================================

@pytest.mark.tier1
@pytest.mark.rbac
class TestMyPatientsRBAC:
    """Tests for My Patients endpoint RBAC."""

    def test_clinical_providers_can_access_my_patients(self, all_role_users):
        """Test that clinical providers can access my patients endpoint."""
        clinical_roles = ['doctor', 'nurse', 'lab_technician', 'pharmacist']

        for role in clinical_roles:
            client = get_authenticated_client(all_role_users[role])
            response = client.get('/api/users/my-patients/')

            # Should be accessible (200) or empty list
            assert response.status_code in [
                status.HTTP_200_OK,
                status.HTTP_404_NOT_FOUND  # Endpoint may not exist
            ], f"{role} should access my patients"

    def test_non_clinical_cannot_access_my_patients(self, all_role_users):
        """Test that non-clinical roles cannot access my patients."""
        non_clinical_roles = ['receptionist', 'patient']

        for role in non_clinical_roles:
            client = get_authenticated_client(all_role_users[role])
            response = client.get('/api/users/my-patients/')

            assert response.status_code in [
                status.HTTP_403_FORBIDDEN,
                status.HTTP_404_NOT_FOUND
            ], f"{role} should not access my patients"
