"""
Tests for ward staff assignment models and API.

Tests cover:
- StaffRole model (configurable roles for facilities)
- WardStaffAssignment model (assignment of practitioners to wards)
- Ward staff API endpoint
"""
import pytest
from django.db import IntegrityError
from rest_framework.test import APIClient
from rest_framework import status

from apps.wards.models import StaffRole, WardStaffAssignment
from .factories import WardFactory
from apps.users.tests.factories import (
    UserFactory, PractitionerProfileFactory, NurseUserFactory, AdminUserFactory
)


def get_or_create_role(name, code, category='nursing', description=''):
    role, _ = StaffRole.objects.get_or_create(
        code=code,
        defaults={
            'name': name,
            'category': category,
            'description': description,
        }
    )
    return role


def configure_facility_header(client, user):
    facility = getattr(user, 'primary_facility', None)
    if facility:
        client.credentials(HTTP_X_FACILITY_CODE=facility.code)


# ============================================================================
# StaffRole Model Tests
# ============================================================================

@pytest.mark.tier1
class TestStaffRoleModel:
    """Tests for the StaffRole model."""

    def test_create_staff_role(self, db):
        """Test basic staff role creation."""
        role = StaffRole.objects.create(
            name='Test Staff Nurse',
            code='test_staff_nurse',
            category='nursing',
            description='General nursing staff'
        )
        assert role.name == 'Test Staff Nurse'
        assert role.code == 'test_staff_nurse'
        assert role.category == 'nursing'
        assert role.is_active is True

    def test_staff_role_categories(self, db):
        """Test all role category choices."""
        categories = ['nursing', 'medical', 'allied']
        for category in categories:
            role = StaffRole.objects.create(
                name=f'Test Role {category}',
                code=f'test_{category}',
                category=category
            )
            assert role.category == category

    def test_staff_role_str_representation(self, db):
        """Test staff role string representation."""
        role = StaffRole.objects.create(
            name='Charge Nurse Test',
            code='charge_nurse_test',
            category='nursing'
        )
        assert str(role) == 'Charge Nurse Test'

    def test_unique_role_name(self, db):
        """Test that role names are unique."""
        StaffRole.objects.create(name='Unique Role', code='unique_role')
        with pytest.raises(IntegrityError):
            StaffRole.objects.create(name='Unique Role', code='unique_role_2')

    def test_unique_role_code(self, db):
        """Test that role codes are unique."""
        StaffRole.objects.create(name='Unique Code Role', code='unique_code_role')
        with pytest.raises(IntegrityError):
            StaffRole.objects.create(name='Unique Code Role 2', code='unique_code_role')

    def test_inactive_role_filtering(self, db):
        """Test filtering active/inactive roles."""
        active_role = StaffRole.objects.create(
            name='Active Role',
            code='active',
            is_active=True
        )
        inactive_role = StaffRole.objects.create(
            name='Inactive Role',
            code='inactive',
            is_active=False
        )

        active_roles = StaffRole.objects.filter(is_active=True)
        assert active_role in active_roles
        assert inactive_role not in active_roles


# ============================================================================
# WardStaffAssignment Model Tests
# ============================================================================

@pytest.mark.tier1
class TestWardStaffAssignmentModel:
    """Tests for the WardStaffAssignment model."""

    @pytest.fixture
    def staff_role(self, db):
        """Create a default staff role for tests."""
        return get_or_create_role(
            name='Staff Nurse',
            code='staff_nurse',
            category='nursing'
        )

    @pytest.fixture
    def ward(self, db):
        """Create a ward for tests."""
        return WardFactory()

    @pytest.fixture
    def practitioner(self, db):
        """Create a practitioner for tests."""
        return PractitionerProfileFactory()

    def test_create_assignment(self, db, ward, practitioner, staff_role):
        """Test basic ward staff assignment creation."""
        assignment = WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=staff_role,
            is_active=True
        )
        assert assignment.ward == ward
        assert assignment.practitioner == practitioner
        assert assignment.role == staff_role
        assert assignment.is_active is True
        assert assignment.is_primary is False

    def test_assignment_str_representation(self, db, ward, practitioner, staff_role):
        """Test assignment string representation."""
        assignment = WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=staff_role
        )
        # Should include practitioner name, ward name, and role
        str_repr = str(assignment)
        assert ward.name in str_repr

    def test_unique_ward_practitioner_constraint(self, db, ward, practitioner, staff_role):
        """Test that practitioner can only have one assignment per ward."""
        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=staff_role
        )
        with pytest.raises(IntegrityError):
            WardStaffAssignment.objects.create(
                ward=ward,
                practitioner=practitioner,
                role=staff_role
            )

    def test_practitioner_multiple_wards(self, db, practitioner, staff_role):
        """Test that practitioner can be assigned to multiple wards."""
        ward1 = WardFactory(name='Ward A')
        ward2 = WardFactory(name='Ward B')

        assignment1 = WardStaffAssignment.objects.create(
            ward=ward1,
            practitioner=practitioner,
            role=staff_role
        )
        assignment2 = WardStaffAssignment.objects.create(
            ward=ward2,
            practitioner=practitioner,
            role=staff_role
        )

        # Both assignments should exist
        assert WardStaffAssignment.objects.filter(practitioner=practitioner).count() == 2

    def test_ward_multiple_staff(self, db, ward, staff_role):
        """Test that ward can have multiple staff assigned."""
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner1,
            role=staff_role
        )
        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner2,
            role=staff_role
        )

        assert WardStaffAssignment.objects.filter(ward=ward).count() == 2

    def test_filter_by_active(self, db, ward, staff_role):
        """Test filtering assignments by is_active."""
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner1,
            role=staff_role,
            is_active=True
        )
        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner2,
            role=staff_role,
            is_active=False
        )

        active = WardStaffAssignment.objects.filter(ward=ward, is_active=True)
        assert active.count() == 1

    def test_filter_by_role_category(self, db, ward):
        """Test filtering assignments by role category."""
        nursing_role = StaffRole.objects.create(
            name='Staff Nurse Test',
            code='staff_nurse_test',
            category='nursing'
        )
        medical_role = StaffRole.objects.create(
            name='Attending Physician Test',
            code='attending_physician_test',
            category='medical'
        )

        nurse = PractitionerProfileFactory()
        doctor = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=nurse,
            role=nursing_role
        )
        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=doctor,
            role=medical_role
        )

        nursing_staff = WardStaffAssignment.objects.filter(
            ward=ward,
            role__category='nursing'
        )
        assert nursing_staff.count() == 1

    def test_primary_ward_flag(self, db, practitioner, staff_role):
        """Test marking a ward as primary for a practitioner."""
        ward1 = WardFactory(name='Primary Ward')
        ward2 = WardFactory(name='Secondary Ward')

        assignment1 = WardStaffAssignment.objects.create(
            ward=ward1,
            practitioner=practitioner,
            role=staff_role,
            is_primary=True
        )
        assignment2 = WardStaffAssignment.objects.create(
            ward=ward2,
            practitioner=practitioner,
            role=staff_role,
            is_primary=False
        )

        primary = WardStaffAssignment.objects.filter(
            practitioner=practitioner,
            is_primary=True
        )
        assert primary.count() == 1
        assert primary.first().ward == ward1


# ============================================================================
# Ward Staff API Tests
# ============================================================================

@pytest.mark.tier1
class TestWardStaffAPI:
    """Tests for the ward staff API endpoint."""

    @pytest.fixture
    def api_client(self, db):
        """Create authenticated API client."""
        user = UserFactory(user_type='admin')
        client = APIClient()
        client.force_authenticate(user=user)
        configure_facility_header(client, user)
        return client

    @pytest.fixture
    def nursing_role(self, db):
        """Create nursing role."""
        return get_or_create_role(
            name='Staff Nurse',
            code='staff_nurse',
            category='nursing'
        )

    @pytest.fixture
    def medical_role(self, db):
        """Create medical role."""
        return get_or_create_role(
            name='Attending Physician',
            code='attending_physician',
            category='medical'
        )

    def test_get_ward_staff(self, api_client, nursing_role):
        """Test getting all staff assigned to a ward."""
        ward = WardFactory()
        practitioner = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=nursing_role,
            is_active=True
        )

        response = api_client.get(f'/api/wards/wards/{ward.id}/staff/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1

    def test_get_ward_staff_filter_by_category(self, api_client, nursing_role, medical_role):
        """Test filtering ward staff by role category."""
        ward = WardFactory()
        nurse = PractitionerProfileFactory()
        doctor = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=nurse,
            role=nursing_role,
            is_active=True
        )
        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=doctor,
            role=medical_role,
            is_active=True
        )

        # Filter by nursing
        response = api_client.get(f'/api/wards/wards/{ward.id}/staff/?category=nursing')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1

    def test_get_ward_staff_excludes_inactive(self, api_client, nursing_role):
        """Test that inactive assignments are excluded."""
        ward = WardFactory()
        active_nurse = PractitionerProfileFactory()
        inactive_nurse = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=active_nurse,
            role=nursing_role,
            is_active=True
        )
        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=inactive_nurse,
            role=nursing_role,
            is_active=False
        )

        response = api_client.get(f'/api/wards/wards/{ward.id}/staff/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1

    def test_get_ward_staff_response_format(self, api_client, nursing_role):
        """Test that response includes required fields for dropdowns."""
        ward = WardFactory()
        practitioner = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=nursing_role,
            is_active=True
        )

        response = api_client.get(f'/api/wards/wards/{ward.id}/staff/')
        assert response.status_code == status.HTTP_200_OK

        staff_data = response.data[0]
        # Should have id, full_name, and role_name for dropdown use
        assert 'id' in staff_data
        assert 'full_name' in staff_data
        assert 'role_name' in staff_data

    def test_get_ward_staff_empty_ward(self, api_client):
        """Test getting staff from ward with no assignments."""
        ward = WardFactory()

        response = api_client.get(f'/api/wards/wards/{ward.id}/staff/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 0

    def test_get_ward_staff_invalid_ward(self, api_client):
        """Test getting staff from non-existent ward."""
        import uuid
        fake_id = uuid.uuid4()

        response = api_client.get(f'/api/wards/wards/{fake_id}/staff/')
        assert response.status_code == status.HTTP_404_NOT_FOUND


# ============================================================================
# Staff Assignment CRUD API Tests
# ============================================================================

@pytest.mark.tier1
class TestWardStaffAssignmentCRUD:
    """Tests for the staff assignment CRUD endpoints."""

    @pytest.fixture
    def admin_client(self, db):
        """Create authenticated admin API client."""
        user = AdminUserFactory()
        client = APIClient()
        client.force_authenticate(user=user)
        configure_facility_header(client, user)
        return client

    @pytest.fixture
    def nursing_role(self, db):
        """Create nursing role."""
        return get_or_create_role(
            name='Staff Nurse',
            code='staff_nurse',
            category='nursing'
        )

    @pytest.fixture
    def ward(self, db):
        """Create a ward for tests."""
        return WardFactory()

    @pytest.fixture
    def practitioner(self, db):
        """Create a practitioner for tests."""
        return PractitionerProfileFactory()

    def test_create_assignment(self, admin_client, ward, practitioner, nursing_role):
        """Test creating a new staff assignment."""
        response = admin_client.post('/api/wards/staff-assignments/', {
            'ward': str(ward.id),
            'practitioner': str(practitioner.id),
            'role': str(nursing_role.id),
            'is_active': True,
            'is_primary': False
        })
        assert response.status_code == status.HTTP_201_CREATED
        assert WardStaffAssignment.objects.filter(
            ward=ward,
            practitioner=practitioner
        ).exists()

    def test_create_duplicate_assignment_fails(self, admin_client, ward, practitioner, nursing_role):
        """Test that creating duplicate assignment fails."""
        # Create first assignment
        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=nursing_role
        )

        # Try to create duplicate
        response = admin_client.post('/api/wards/staff-assignments/', {
            'ward': str(ward.id),
            'practitioner': str(practitioner.id),
            'role': str(nursing_role.id),
        })
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_list_assignments(self, admin_client, ward, nursing_role):
        """Test listing all assignments."""
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner1,
            role=nursing_role
        )
        WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner2,
            role=nursing_role
        )

        response = admin_client.get('/api/wards/staff-assignments/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 2

    def test_list_assignments_filter_by_ward(self, admin_client, nursing_role):
        """Test filtering assignments by ward."""
        ward1 = WardFactory(name='Ward A')
        ward2 = WardFactory(name='Ward B')
        practitioner = PractitionerProfileFactory()

        WardStaffAssignment.objects.create(
            ward=ward1,
            practitioner=practitioner,
            role=nursing_role
        )
        WardStaffAssignment.objects.create(
            ward=ward2,
            practitioner=PractitionerProfileFactory(),
            role=nursing_role
        )

        response = admin_client.get(f'/api/wards/staff-assignments/?ward={ward1.id}')
        assert response.status_code == status.HTTP_200_OK
        # Handle both paginated and non-paginated responses
        data = response.data.get('results', response.data) if isinstance(response.data, dict) else response.data
        assert len(data) == 1

    def test_get_assignment_detail(self, admin_client, ward, practitioner, nursing_role):
        """Test getting a single assignment."""
        assignment = WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=nursing_role
        )

        response = admin_client.get(f'/api/wards/staff-assignments/{assignment.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == str(assignment.id)
        assert 'practitioner_name' in response.data
        assert 'role_name' in response.data

    def test_update_assignment(self, admin_client, ward, practitioner, nursing_role):
        """Test updating an assignment."""
        assignment = WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=nursing_role,
            is_primary=False
        )

        response = admin_client.patch(f'/api/wards/staff-assignments/{assignment.id}/', {
            'is_primary': True
        })
        assert response.status_code == status.HTTP_200_OK

        assignment.refresh_from_db()
        assert assignment.is_primary is True

    def test_delete_assignment(self, admin_client, ward, practitioner, nursing_role):
        """Test deleting an assignment."""
        assignment = WardStaffAssignment.objects.create(
            ward=ward,
            practitioner=practitioner,
            role=nursing_role
        )
        assignment_id = assignment.id

        response = admin_client.delete(f'/api/wards/staff-assignments/{assignment_id}/')
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not WardStaffAssignment.objects.filter(id=assignment_id).exists()

    def test_by_practitioner_action(self, admin_client, nursing_role):
        """Test getting assignments by practitioner."""
        practitioner = PractitionerProfileFactory()
        ward1 = WardFactory(name='Ward A')
        ward2 = WardFactory(name='Ward B')

        WardStaffAssignment.objects.create(
            ward=ward1,
            practitioner=practitioner,
            role=nursing_role
        )
        WardStaffAssignment.objects.create(
            ward=ward2,
            practitioner=practitioner,
            role=nursing_role
        )

        response = admin_client.get(
            f'/api/wards/staff-assignments/by_practitioner/?practitioner_id={practitioner.id}'
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2


# ============================================================================
# Staff Role API Tests
# ============================================================================

@pytest.mark.tier1
class TestStaffRoleAPI:
    """Tests for the staff role API endpoints."""

    @pytest.fixture
    def admin_client(self, db):
        """Create authenticated admin API client."""
        user = AdminUserFactory()
        client = APIClient()
        client.force_authenticate(user=user)
        configure_facility_header(client, user)
        return client

    def _get_results(self, response):
        """Helper to get results from paginated or non-paginated response."""
        if isinstance(response.data, dict) and 'results' in response.data:
            return response.data['results']
        return response.data

    def test_list_roles(self, admin_client, db):
        """Test listing all active roles."""
        StaffRole.objects.create(name='Active Role', code='active', is_active=True)
        StaffRole.objects.create(name='Inactive Role', code='inactive', is_active=False)

        response = admin_client.get('/api/wards/staff-roles/')
        assert response.status_code == status.HTTP_200_OK
        # Should only return active roles by default
        data = self._get_results(response)
        role_names = [r['name'] for r in data]
        assert 'Active Role' in role_names
        assert 'Inactive Role' not in role_names

    def test_list_roles_with_inactive(self, admin_client, db):
        """Test listing all roles including inactive."""
        StaffRole.objects.create(name='Active Role', code='active', is_active=True)
        StaffRole.objects.create(name='Inactive Role', code='inactive', is_active=False)

        response = admin_client.get('/api/wards/staff-roles/?show_inactive=true')
        assert response.status_code == status.HTTP_200_OK
        data = self._get_results(response)
        role_names = [r['name'] for r in data]
        assert 'Active Role' in role_names
        assert 'Inactive Role' in role_names

    def test_filter_roles_by_category(self, admin_client, db):
        """Test filtering roles by category."""
        StaffRole.objects.create(name='Nurse', code='nurse', category='nursing')
        StaffRole.objects.create(name='Doctor', code='doctor', category='medical')

        response = admin_client.get('/api/wards/staff-roles/?category=nursing')
        assert response.status_code == status.HTTP_200_OK
        data = self._get_results(response)
        categories = [r['category'] for r in data]
        assert all(c == 'nursing' for c in categories)

    def test_get_role_detail(self, admin_client, db):
        """Test getting a single role."""
        role = get_or_create_role(
            name='Staff Nurse',
            code='staff_nurse',
            category='nursing',
            description='General nursing staff'
        )

        response = admin_client.get(f'/api/wards/staff-roles/{role.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Staff Nurse'
        assert response.data['code'] == 'staff_nurse'
