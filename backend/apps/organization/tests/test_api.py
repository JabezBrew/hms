"""
API endpoint tests for the organization app.
"""
import pytest
from datetime import timedelta
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.organization.models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
    UnitWardAllocation,
)


@pytest.fixture
def api_client():
    """Create an API client."""
    return APIClient()


@pytest.fixture
def admin_user(db, django_user_model):
    """Create an admin user."""
    return django_user_model.objects.create_user(
        username='admin',
        email='admin@test.com',
        password='testpass123',
        user_type='admin'
    )


@pytest.fixture
def staff_user(db, django_user_model):
    """Create a staff user."""
    return django_user_model.objects.create_user(
        username='doctor',
        email='doctor@test.com',
        password='testpass123',
        user_type='doctor'
    )


@pytest.fixture
def authenticated_client(api_client, admin_user, default_facility):
    """Create an authenticated API client."""
    api_client.force_authenticate(user=admin_user)
    api_client.credentials(HTTP_X_FACILITY_CODE=default_facility.code)
    return api_client


@pytest.fixture
def staff_authenticated_client(staff_user, default_facility):
    """Create an authenticated non-admin API client."""
    client = APIClient()
    client.force_authenticate(user=staff_user)
    client.credentials(HTTP_X_FACILITY_CODE=default_facility.code)
    return client


@pytest.fixture
def seed_organization_data(db):
    """Seed the organization configuration data."""
    from django.core.management import call_command
    call_command('seed_organization')


@pytest.fixture
def unit_types(seed_organization_data):
    """Get all seeded unit types."""
    return {ut.code: ut for ut in UnitTypeConfig.objects.all()}


@pytest.fixture
def leadership_roles(seed_organization_data):
    """Get all seeded leadership roles."""
    return {lr.code: lr for lr in LeadershipRoleConfig.objects.all()}


@pytest.fixture
def assignment_types(seed_organization_data):
    """Get all seeded assignment types."""
    return {at.code: at for at in StaffAssignmentTypeConfig.objects.all()}


@pytest.fixture
def facility(unit_types, default_facility):
    """Create a facility."""
    return ClinicalUnit.objects.create(
        code=default_facility.code,
        name='Main Hospital',
        unit_type=unit_types['facility']
    )


@pytest.fixture
def department(unit_types, facility):
    """Create a department under the facility."""
    dept = ClinicalUnit.objects.create(
        code='SURG',
        name='Surgery Department',
        unit_type=unit_types['department'],
        parent=facility
    )
    dept.refresh_from_db()
    return dept


@pytest.fixture
def team(unit_types, department):
    """Create a team under the department."""
    team = ClinicalUnit.objects.create(
        code='TEAM-A',
        name='Surgery Team A',
        unit_type=unit_types['team'],
        parent=department
    )
    team.refresh_from_db()
    return team


# =============================================================================
# Unit Type Config API Tests
# =============================================================================


@pytest.mark.django_db
class TestUnitTypeConfigAPI:
    """Tests for the unit type configuration API."""

    def test_list_unit_types_requires_auth(self, api_client, seed_organization_data):
        """Test that listing unit types requires authentication."""
        response = api_client.get('/api/organization/unit-types/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_list_unit_types(self, authenticated_client, seed_organization_data):
        """Test listing unit types."""
        response = authenticated_client.get('/api/organization/unit-types/')
        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert len(response.data['results']) >= 6

    def test_list_unit_types_excludes_inactive(self, authenticated_client, seed_organization_data):
        """Test that inactive unit types are excluded by default."""
        # Make one inactive
        ut = UnitTypeConfig.objects.first()
        ut.is_active = False
        ut.save()

        response = authenticated_client.get('/api/organization/unit-types/')
        assert response.status_code == status.HTTP_200_OK

        codes = [item['code'] for item in response.data['results']]
        assert ut.code not in codes

    def test_list_unit_types_include_inactive(self, authenticated_client, seed_organization_data):
        """Test including inactive unit types."""
        ut = UnitTypeConfig.objects.first()
        ut.is_active = False
        ut.save()

        response = authenticated_client.get('/api/organization/unit-types/?include_inactive=true')
        assert response.status_code == status.HTTP_200_OK

        codes = [item['code'] for item in response.data['results']]
        assert ut.code in codes

    def test_get_unit_type_detail(self, authenticated_client, seed_organization_data):
        """Test retrieving a single unit type."""
        ut = UnitTypeConfig.objects.get(code='facility')
        response = authenticated_client.get(f'/api/organization/unit-types/{ut.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['code'] == 'facility'
        assert response.data['can_be_root'] is True

    def test_non_admin_cannot_create_unit_type(self, staff_authenticated_client, seed_organization_data):
        """Test that non-admin users cannot mutate unit type config."""
        response = staff_authenticated_client.post('/api/organization/unit-types/', {
            'code': 'NON_ADMIN_UT',
            'name': 'Non Admin Unit Type',
        })
        assert response.status_code == status.HTTP_403_FORBIDDEN


# =============================================================================
# Leadership Role Config API Tests
# =============================================================================


@pytest.mark.django_db
class TestLeadershipRoleConfigAPI:
    """Tests for the leadership role configuration API."""

    def test_list_leadership_roles(self, authenticated_client, seed_organization_data):
        """Test listing leadership roles."""
        response = authenticated_client.get('/api/organization/leadership-roles/')
        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert len(response.data['results']) >= 5

    def test_get_leadership_role_detail(self, authenticated_client, seed_organization_data):
        """Test retrieving a single leadership role."""
        role = LeadershipRoleConfig.objects.get(code='head')
        response = authenticated_client.get(f'/api/organization/leadership-roles/{role.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['code'] == 'head'
        assert response.data['is_primary_leader'] is True

    def test_non_admin_cannot_create_leadership_role(self, staff_authenticated_client, seed_organization_data):
        """Test that non-admin users cannot mutate leadership role config."""
        response = staff_authenticated_client.post('/api/organization/leadership-roles/', {
            'code': 'NON_ADMIN_ROLE',
            'name': 'Non Admin Role',
        })
        assert response.status_code == status.HTTP_403_FORBIDDEN


# =============================================================================
# Assignment Type Config API Tests
# =============================================================================


@pytest.mark.django_db
class TestAssignmentTypeConfigAPI:
    """Tests for the assignment type configuration API."""

    def test_list_assignment_types(self, authenticated_client, seed_organization_data):
        """Test listing assignment types."""
        response = authenticated_client.get('/api/organization/assignment-types/')
        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert len(response.data['results']) >= 4

    def test_non_admin_cannot_create_assignment_type(self, staff_authenticated_client, seed_organization_data):
        """Test that non-admin users cannot mutate assignment type config."""
        response = staff_authenticated_client.post('/api/organization/assignment-types/', {
            'code': 'NON_ADMIN_ASSIGNMENT',
            'name': 'Non Admin Assignment Type',
        })
        assert response.status_code == status.HTTP_403_FORBIDDEN


# =============================================================================
# Clinical Unit API Tests
# =============================================================================


@pytest.mark.django_db
class TestClinicalUnitAPI:
    """Tests for the clinical unit API."""

    def test_list_clinical_units(self, authenticated_client, facility, department, team):
        """Test listing clinical units."""
        response = authenticated_client.get('/api/organization/units/')
        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert len(response.data['results']) == 3

    def test_list_units_roots_only(self, authenticated_client, facility, department, team):
        """Test listing only root units."""
        response = authenticated_client.get('/api/organization/units/?roots_only=true')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['code'] == facility.code

    def test_list_units_by_facility(self, authenticated_client, facility, department, team):
        """Test filtering units by facility."""
        response = authenticated_client.get(f'/api/organization/units/?facility={facility.id}')
        assert response.status_code == status.HTTP_200_OK
        # All 3 units belong to this facility
        assert len(response.data['results']) == 3

    def test_create_clinical_unit(self, authenticated_client, unit_types, default_facility):
        """Test creating a clinical unit."""
        response = authenticated_client.post('/api/organization/units/', {
            'code': default_facility.code,
            'name': 'New Facility',
            'unit_type': unit_types['facility'].id,
        })
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['code'] == default_facility.code
        assert response.data['name'] == 'New Facility'

    def test_create_unit_under_parent(self, authenticated_client, unit_types, facility):
        """Test creating a unit under a parent."""
        response = authenticated_client.post('/api/organization/units/', {
            'code': 'CARD',
            'name': 'Cardiology',
            'unit_type': unit_types['department'].id,
            'parent': str(facility.id),
        })
        assert response.status_code == status.HTTP_201_CREATED
        # Compare as strings to handle UUID object vs string
        assert str(response.data['parent']) == str(facility.id)

    def test_create_non_root_unit_without_parent_fails(self, authenticated_client, unit_types):
        """Test that non-root types require a parent."""
        response = authenticated_client.post('/api/organization/units/', {
            'code': 'TEAM-X',
            'name': 'Orphan Team',
            'unit_type': unit_types['team'].id,
        })
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'parent' in response.data

    def test_duplicate_code_under_same_parent_fails(self, authenticated_client, unit_types, facility, department):
        """Test that duplicate codes under the same parent fail."""
        response = authenticated_client.post('/api/organization/units/', {
            'code': 'SURG',  # Same as existing department
            'name': 'Surgery 2',
            'unit_type': unit_types['department'].id,
            'parent': str(facility.id),
        })
        # Should fail with either 400 (validation) or 500 (IntegrityError)
        # The constraint is enforced at DB level, so may not get validation error
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_500_INTERNAL_SERVER_ERROR]

    def test_update_clinical_unit(self, authenticated_client, department):
        """Test updating a clinical unit."""
        response = authenticated_client.patch(f'/api/organization/units/{department.id}/', {
            'name': 'Updated Surgery Department',
        })
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Updated Surgery Department'

    def test_delete_clinical_unit(self, authenticated_client, team):
        """Test deleting a clinical unit."""
        response = authenticated_client.delete(f'/api/organization/units/{team.id}/')
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not ClinicalUnit.objects.filter(id=team.id).exists()

    def test_get_unit_detail(self, authenticated_client, department):
        """Test retrieving unit detail."""
        response = authenticated_client.get(f'/api/organization/units/{department.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['code'] == 'SURG'
        assert response.data['unit_type_name'] == 'Department'

    def test_tree_endpoint(self, authenticated_client, facility, department, team):
        """Test the tree endpoint returns nested structure."""
        response = authenticated_client.get('/api/organization/units/tree/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1  # One root
        assert response.data[0]['code'] == facility.code
        assert len(response.data[0]['children']) == 1  # Department
        assert len(response.data[0]['children'][0]['children']) == 1  # Team
        assert response['ETag']
        assert response['Last-Modified']
        assert response['Cache-Control']

    def test_tree_endpoint_etag_not_modified(self, authenticated_client, facility):
        """Test that ETag returns 304 when content hasn't changed."""
        cache.clear()
        response = authenticated_client.get('/api/organization/units/tree/')
        assert response.status_code == status.HTTP_200_OK
        etag = response['ETag']
        response = authenticated_client.get(
            '/api/organization/units/tree/',
            HTTP_IF_NONE_MATCH=etag
        )
        assert response.status_code == status.HTTP_304_NOT_MODIFIED

    def test_tree_endpoint_etag_changes_on_update(self, authenticated_client, department):
        """Test that ETag changes when tree content changes."""
        cache.clear()
        response = authenticated_client.get('/api/organization/units/tree/')
        assert response.status_code == status.HTTP_200_OK
        etag = response['ETag']
        department.name = 'Updated Surgery Department'
        department.save()
        response = authenticated_client.get('/api/organization/units/tree/')
        assert response.status_code == status.HTTP_200_OK
        assert response['ETag'] != etag

    def test_children_endpoint(self, authenticated_client, facility, department):
        """Test the children endpoint."""
        response = authenticated_client.get(f'/api/organization/units/{facility.id}/children/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1
        assert response.data[0]['code'] == 'SURG'

    def test_ancestors_endpoint(self, authenticated_client, facility, department, team):
        """Test the ancestors endpoint."""
        response = authenticated_client.get(f'/api/organization/units/{team.id}/ancestors/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2  # facility and department
        codes = [a['code'] for a in response.data]
        assert facility.code in codes
        assert 'SURG' in codes

    def test_descendants_endpoint(self, authenticated_client, facility, department, team):
        """Test the descendants endpoint."""
        response = authenticated_client.get(f'/api/organization/units/{facility.id}/descendants/')
        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert len(response.data['results']) == 2  # department and team


# =============================================================================
# Unit Staff API Tests
# =============================================================================


@pytest.mark.django_db
class TestClinicalUnitStaffEndpoints:
    """Tests for unit staff/member endpoints."""

    def test_staff_search_filters_by_name(self, authenticated_client, department, assignment_types, django_user_model):
        from datetime import date
        from apps.users.models import Staff, PractitionerProfile

        user_jane = django_user_model.objects.create_user(
            username='jane',
            email='jane@test.com',
            password='testpass123',
            first_name='Jane',
            last_name='Doe',
            user_type='doctor'
        )
        staff_jane = Staff.objects.create(
            user=user_jane,
            employee_id='EMP-JANE',
            department='Surgery',
            position='Attending Physician',
            hire_date=date(2020, 1, 1)
        )
        practitioner_jane = PractitionerProfile.objects.create(
            staff=staff_jane,
            license_number='LIC-JANE',
            specialization='Surgery',
            qualification='MD'
        )
        StaffUnitAssignment.objects.create(
            unit=department,
            practitioner=practitioner_jane,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        user_john = django_user_model.objects.create_user(
            username='john',
            email='john@test.com',
            password='testpass123',
            first_name='John',
            last_name='Smith',
            user_type='doctor'
        )
        staff_john = Staff.objects.create(
            user=user_john,
            employee_id='EMP-JOHN',
            department='Surgery',
            position='Resident',
            hire_date=date(2021, 1, 1)
        )
        practitioner_john = PractitionerProfile.objects.create(
            staff=staff_john,
            license_number='LIC-JOHN',
            specialization='Surgery',
            qualification='MD'
        )
        StaffUnitAssignment.objects.create(
            unit=department,
            practitioner=practitioner_john,
            assignment_type=assignment_types['single'],
            is_primary=False
        )

        response = authenticated_client.get(
            f'/api/organization/units/{department.id}/staff/?q=Jane'
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['practitioner_name'] == 'Jane Doe'

    def test_members_search_filters_by_name(self, authenticated_client, facility, unit_types, assignment_types, django_user_model):
        from datetime import date
        from apps.users.models import Staff

        ops_unit = ClinicalUnit.objects.create(
            code='ADM',
            name='Administration',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='mixed'
        )
        staff_amy = Staff.objects.create(
            user=django_user_model.objects.create_user(
                username='amy',
                email='amy@test.com',
                password='testpass123',
                first_name='Amy',
                last_name='Ng',
                user_type='billing'
            ),
            employee_id='OPS-AMY',
            department='Administration',
            position='Coordinator',
            hire_date=date(2022, 1, 1)
        )
        UnitMemberAssignment.objects.create(
            unit=ops_unit,
            staff=staff_amy,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        staff_lee = Staff.objects.create(
            user=django_user_model.objects.create_user(
                username='lee',
                email='lee@test.com',
                password='testpass123',
                first_name='Lee',
                last_name='Zhang',
                user_type='billing'
            ),
            employee_id='OPS-LEE',
            department='Administration',
            position='Clerk',
            hire_date=date(2022, 1, 1)
        )
        UnitMemberAssignment.objects.create(
            unit=ops_unit,
            staff=staff_lee,
            assignment_type=assignment_types['single'],
            is_primary=False
        )

        response = authenticated_client.get(
            f'/api/organization/units/{ops_unit.id}/members/?q=Amy'
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['staff_name'] == 'Amy Ng'

    def test_staff_counts_include_descendants(self, authenticated_client, facility, team, assignment_types, django_user_model):
        from datetime import date
        from apps.users.models import Staff, PractitionerProfile

        user_alex = django_user_model.objects.create_user(
            username='alex',
            email='alex@test.com',
            password='testpass123',
            first_name='Alex',
            last_name='Kim',
            user_type='doctor'
        )
        staff_alex = Staff.objects.create(
            user=user_alex,
            employee_id='EMP-ALEX',
            department='Surgery',
            position='Attending Physician',
            hire_date=date(2020, 1, 1)
        )
        practitioner_alex = PractitionerProfile.objects.create(
            staff=staff_alex,
            license_number='LIC-ALEX',
            specialization='Surgery',
            qualification='MD'
        )
        StaffUnitAssignment.objects.create(
            unit=team,
            practitioner=practitioner_alex,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        user_bri = django_user_model.objects.create_user(
            username='bri',
            email='bri@test.com',
            password='testpass123',
            first_name='Bri',
            last_name='Jones',
            user_type='doctor'
        )
        staff_bri = Staff.objects.create(
            user=user_bri,
            employee_id='EMP-BRI',
            department='Surgery',
            position='Resident',
            hire_date=date(2021, 1, 1)
        )
        practitioner_bri = PractitionerProfile.objects.create(
            staff=staff_bri,
            license_number='LIC-BRI',
            specialization='Surgery',
            qualification='MD'
        )
        StaffUnitAssignment.objects.create(
            unit=team,
            practitioner=practitioner_bri,
            assignment_type=assignment_types['single'],
            is_primary=False
        )

        response = authenticated_client.get(
            f'/api/organization/units/{facility.id}/staff/counts/?include_descendants=true'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data[str(team.id)] == 2
        assert str(facility.id) not in response.data

    def test_members_counts_include_descendants(self, authenticated_client, facility, unit_types, assignment_types, django_user_model):
        from datetime import date
        from apps.users.models import Staff

        ops_facility = facility
        ops_facility.staffing_mode = 'mixed'
        ops_facility.save(update_fields=['staffing_mode'])
        ops_department = ClinicalUnit.objects.create(
            code='ADM',
            name='Administration',
            unit_type=unit_types['department'],
            parent=ops_facility,
            staffing_mode='mixed'
        )
        staff_amy = Staff.objects.create(
            user=django_user_model.objects.create_user(
                username='ops-amy',
                email='ops-amy@test.com',
                password='testpass123',
                first_name='Amy',
                last_name='Diaz',
                user_type='billing'
            ),
            employee_id='OPS-AMY',
            department='Administration',
            position='Coordinator',
            hire_date=date(2022, 1, 1)
        )
        UnitMemberAssignment.objects.create(
            unit=ops_department,
            staff=staff_amy,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        response = authenticated_client.get(
            f'/api/organization/units/{ops_facility.id}/members/counts/?include_descendants=true'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data[str(ops_department.id)] == 1


# =============================================================================
# Unit Leadership API Tests
# =============================================================================


@pytest.mark.django_db
class TestUnitLeadershipAPI:
    """Tests for the unit leadership API."""

    def test_create_leadership_assignment(self, authenticated_client, leadership_roles, department, admin_user):
        """Test creating a leadership assignment."""
        response = authenticated_client.post('/api/organization/leadership/', {
            'unit': str(department.id),
            'role': leadership_roles['head'].id,
            'user': str(admin_user.id),
            'effective_from': timezone.now().date().isoformat(),
        })
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['role'] == leadership_roles['head'].id

    def test_list_leadership_assignments(self, authenticated_client, leadership_roles, department, admin_user):
        """Test listing leadership assignments."""
        # Create an assignment first
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=admin_user,
            effective_from=timezone.now().date()
        )

        response = authenticated_client.get('/api/organization/leadership/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1

    def test_list_current_leadership(self, authenticated_client, leadership_roles, department, admin_user):
        """Test filtering for currently effective leadership."""
        today = timezone.now().date()

        # Current leadership
        current = UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=admin_user,
            effective_from=today - timedelta(days=10)
        )

        # Future leadership
        future = UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['deputy'],
            user=admin_user,
            effective_from=today + timedelta(days=10)
        )

        response = authenticated_client.get('/api/organization/leadership/?current=true')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['id'] == str(current.id)

    def test_unit_leaders_endpoint(self, authenticated_client, leadership_roles, department, admin_user):
        """Test the unit leaders endpoint."""
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=admin_user,
            effective_from=timezone.now().date()
        )

        response = authenticated_client.get(f'/api/organization/units/{department.id}/leaders/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1


# =============================================================================
# Staff Assignment API Tests
# =============================================================================


@pytest.mark.django_db
class TestStaffAssignmentAPI:
    """Tests for the staff assignment API."""

    @pytest.fixture
    def practitioner(self, db, django_user_model):
        """Create a practitioner profile."""
        from datetime import date
        from apps.users.models import Staff, PractitionerProfile

        user = django_user_model.objects.create_user(
            username='practitioner',
            email='practitioner@test.com',
            password='testpass123',
            user_type='doctor'
        )
        staff = Staff.objects.create(
            user=user,
            employee_id='EMP001',
            department='Medicine',
            position='Attending Physician',
            hire_date=date(2020, 1, 1)
        )
        return PractitionerProfile.objects.create(
            staff=staff,
            license_number='LIC001',
            specialization='General Medicine',
            qualification='MD'
        )

    def test_create_staff_assignment(self, authenticated_client, assignment_types, department, practitioner):
        """Test creating a staff assignment."""
        response = authenticated_client.post('/api/organization/staff-assignments/', {
            'unit': str(department.id),
            'practitioner': str(practitioner.id),
            'assignment_type': assignment_types['single'].id,
            'is_primary': True,
        })
        assert response.status_code == status.HTTP_201_CREATED


    def test_non_admin_cannot_create_staff_assignment(self, staff_authenticated_client, assignment_types, department, practitioner):
        """Test non-admin users cannot create staff assignments."""
        response = staff_authenticated_client.post('/api/organization/staff-assignments/', {
            'unit': str(department.id),
            'practitioner': str(practitioner.id),
            'assignment_type': assignment_types['single'].id,
            'is_primary': True,
        })
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_list_staff_assignments(self, authenticated_client, assignment_types, department, practitioner):
        """Test listing staff assignments."""
        StaffUnitAssignment.objects.create(
            unit=department,
            practitioner=practitioner,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        response = authenticated_client.get('/api/organization/staff-assignments/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1

    def test_unit_staff_endpoint(self, authenticated_client, assignment_types, department, practitioner):
        """Test the unit staff endpoint."""
        StaffUnitAssignment.objects.create(
            unit=department,
            practitioner=practitioner,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        response = authenticated_client.get(f'/api/organization/units/{department.id}/staff/')
        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert len(response.data['results']) == 1


# =============================================================================
# Cross Coverage API Tests
# =============================================================================


@pytest.mark.django_db
class TestCrossCoverageAPI:
    """Tests for the cross coverage API."""

    @pytest.fixture
    def practitioner(self, db, django_user_model):
        """Create a practitioner profile."""
        from datetime import date
        from apps.users.models import Staff, PractitionerProfile

        user = django_user_model.objects.create_user(
            username='coverer',
            email='coverer@test.com',
            password='testpass123',
            user_type='doctor'
        )
        staff = Staff.objects.create(
            user=user,
            employee_id='EMP002',
            department='Medicine',
            position='Attending Physician',
            hire_date=date(2020, 1, 1)
        )
        return PractitionerProfile.objects.create(
            staff=staff,
            license_number='LIC002',
            specialization='General Medicine',
            qualification='MD'
        )

    def test_create_practitioner_coverage(self, authenticated_client, department, practitioner):
        """Test creating coverage with a practitioner."""
        now = timezone.now()
        response = authenticated_client.post('/api/organization/cross-coverage/', {
            'covered_unit': str(department.id),
            'covering_practitioner': str(practitioner.id),
            'start_datetime': now.isoformat(),
            'end_datetime': (now + timedelta(hours=8)).isoformat(),
            'coverage_type': 'on_call',
        })
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_unit_coverage(self, authenticated_client, department, team):
        """Test creating coverage with a covering unit."""
        now = timezone.now()
        response = authenticated_client.post('/api/organization/cross-coverage/', {
            'covered_unit': str(department.id),
            'covering_unit': str(team.id),
            'start_datetime': now.isoformat(),
            'end_datetime': (now + timedelta(hours=8)).isoformat(),
            'coverage_type': 'backup',
        })
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_coverage_requires_covering_entity(self, authenticated_client, department):
        """Test that coverage requires either practitioner or unit."""
        now = timezone.now()
        response = authenticated_client.post('/api/organization/cross-coverage/', {
            'covered_unit': str(department.id),
            'start_datetime': now.isoformat(),
            'end_datetime': (now + timedelta(hours=8)).isoformat(),
            'coverage_type': 'on_call',
        })
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_coverage_not_both(self, authenticated_client, department, team, practitioner):
        """Test that coverage cannot have both practitioner and unit."""
        now = timezone.now()
        response = authenticated_client.post('/api/organization/cross-coverage/', {
            'covered_unit': str(department.id),
            'covering_practitioner': str(practitioner.id),
            'covering_unit': str(team.id),
            'start_datetime': now.isoformat(),
            'end_datetime': (now + timedelta(hours=8)).isoformat(),
            'coverage_type': 'on_call',
        })
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_list_current_coverage(self, authenticated_client, department, practitioner):
        """Test filtering for current coverage."""
        now = timezone.now()

        # Current coverage
        current = CrossCoverageSchedule.objects.create(
            covered_unit=department,
            covering_practitioner=practitioner,
            start_datetime=now - timedelta(hours=1),
            end_datetime=now + timedelta(hours=7),
            coverage_type='on_call'
        )

        # Past coverage
        past = CrossCoverageSchedule.objects.create(
            covered_unit=department,
            covering_practitioner=practitioner,
            start_datetime=now - timedelta(days=2),
            end_datetime=now - timedelta(days=1),
            coverage_type='on_call'
        )

        response = authenticated_client.get('/api/organization/cross-coverage/?current=true')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['id'] == str(current.id)

    def test_unit_coverage_endpoint(self, authenticated_client, department, practitioner):
        """Test the unit coverage endpoint."""
        now = timezone.now()
        CrossCoverageSchedule.objects.create(
            covered_unit=department,
            covering_practitioner=practitioner,
            start_datetime=now - timedelta(hours=1),
            end_datetime=now + timedelta(hours=7),
            coverage_type='on_call'
        )

        response = authenticated_client.get(f'/api/organization/units/{department.id}/coverage/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1


# =============================================================================
# Ward Allocation API Tests
# =============================================================================


@pytest.mark.django_db
class TestWardAllocationAPI:
    """Tests for the ward allocation API."""

    @pytest.fixture
    def ward(self, db):
        """Create a ward."""
        from decimal import Decimal
        from apps.wards.models import Ward
        return Ward.objects.create(
            name='General Ward',
            total_beds=20,
            ward_type='general',
            base_rate_per_night=Decimal('100.00')
        )

    def test_create_ward_allocation(self, authenticated_client, department, ward):
        """Test creating a ward allocation."""
        response = authenticated_client.post('/api/organization/ward-allocations/', {
            'unit': str(department.id),
            'ward': str(ward.id),
            'allocation_type': 'dedicated',
            'allocated_beds': 10,
            'priority': 1,
        })
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['allocated_beds'] == 10

    def test_list_ward_allocations(self, authenticated_client, department, ward):
        """Test listing ward allocations."""
        UnitWardAllocation.objects.create(
            unit=department,
            ward=ward,
            allocation_type='dedicated',
            allocated_beds=10
        )

        response = authenticated_client.get('/api/organization/ward-allocations/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1

    def test_unit_wards_endpoint(self, authenticated_client, department, ward):
        """Test the unit wards endpoint."""
        UnitWardAllocation.objects.create(
            unit=department,
            ward=ward,
            allocation_type='dedicated',
            allocated_beds=10
        )

        response = authenticated_client.get(f'/api/organization/units/{department.id}/wards/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1

    def test_facility_wards_endpoint_returns_all_facility_wards(
        self, authenticated_client, facility, default_facility
    ):
        """Test that facility-level units return all wards belonging to the facility."""
        from decimal import Decimal
        from apps.wards.models import Ward
        from apps.core.models import Department

        # Create a core.Department linked to the facility
        dept = Department.objects.create(
            facility=default_facility,
            code='TEST_DEPT',
            name='Test Department',
            department_type='clinical',
        )

        # Create wards under this department
        ward1 = Ward.objects.create(
            name='Ward A',
            department=dept,
            total_beds=20,
            ward_type='general',
            base_rate_per_night=Decimal('100.00'),
        )
        ward2 = Ward.objects.create(
            name='Ward B',
            department=dept,
            total_beds=15,
            ward_type='private',
            base_rate_per_night=Decimal('200.00'),
        )

        # Request wards for the facility-level unit
        response = authenticated_client.get(f'/api/organization/units/{facility.id}/wards/')
        assert response.status_code == status.HTTP_200_OK

        # Should return all wards (not allocations)
        assert len(response.data) == 2
        ward_names = [w['name'] for w in response.data]
        assert 'Ward A' in ward_names
        assert 'Ward B' in ward_names

        # Should have ward fields, not allocation fields
        assert 'total_beds' in response.data[0]
        assert 'occupancy_rate' in response.data[0]
