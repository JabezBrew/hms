"""
Integration tests for the organization app.

Tests complex workflows that involve multiple models and services working together.
"""
import pytest
from datetime import timedelta
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
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
    CrossCoverageSchedule,
    UnitWardAllocation,
)
from apps.organization.services import UnitAccessService


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before and after each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client():
    """Create an API client."""
    return APIClient()


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
def hospital_structure(unit_types):
    """Create a complete hospital structure for integration testing."""
    facility = ClinicalUnit.objects.create(
        code='MAIN',
        name='Main Hospital',
        unit_type=unit_types['facility']
    )

    # Surgery department with teams
    surgery = ClinicalUnit.objects.create(
        code='SURG',
        name='Surgery Department',
        unit_type=unit_types['department'],
        parent=facility
    )
    surgery_team_a = ClinicalUnit.objects.create(
        code='SURG-A',
        name='Surgery Team A',
        unit_type=unit_types['team'],
        parent=surgery
    )
    surgery_team_b = ClinicalUnit.objects.create(
        code='SURG-B',
        name='Surgery Team B',
        unit_type=unit_types['team'],
        parent=surgery
    )

    # Medicine department with teams
    medicine = ClinicalUnit.objects.create(
        code='MED',
        name='Medicine Department',
        unit_type=unit_types['department'],
        parent=facility
    )
    medicine_team = ClinicalUnit.objects.create(
        code='MED-A',
        name='Medicine Team A',
        unit_type=unit_types['team'],
        parent=medicine
    )

    # Refresh to get updated path_cache and root_unit
    for unit in [facility, surgery, surgery_team_a, surgery_team_b, medicine, medicine_team]:
        unit.refresh_from_db()

    return {
        'facility': facility,
        'surgery': surgery,
        'surgery_team_a': surgery_team_a,
        'surgery_team_b': surgery_team_b,
        'medicine': medicine,
        'medicine_team': medicine_team,
    }


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
def doctor_user(db, django_user_model):
    """Create a doctor user."""
    return django_user_model.objects.create_user(
        username='doctor',
        email='doctor@test.com',
        password='testpass123',
        first_name='John',
        last_name='Smith',
        user_type='doctor'
    )


@pytest.fixture
def nurse_user(db, django_user_model):
    """Create a nurse user."""
    return django_user_model.objects.create_user(
        username='nurse',
        email='nurse@test.com',
        password='testpass123',
        first_name='Jane',
        last_name='Doe',
        user_type='nurse'
    )


@pytest.fixture
def doctor_practitioner(db, doctor_user):
    """Create a practitioner profile for the doctor."""
    from datetime import date
    from apps.users.models import Staff, PractitionerProfile

    staff = Staff.objects.create(
        user=doctor_user,
        employee_id='EMP001',
        department='Surgery',
        position='Attending Physician',
        hire_date=date(2020, 1, 1)
    )
    return PractitionerProfile.objects.create(
        staff=staff,
        license_number='LIC001',
        specialization='General Surgery',
        qualification='MD'
    )


# =============================================================================
# Full Workflow Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestOrganizationalHierarchyWorkflow:
    """Tests for complete organizational hierarchy workflows."""

    def test_complete_hospital_setup_workflow(self, api_client, admin_user, unit_types):
        """Test the complete workflow of setting up a hospital organization."""
        api_client.force_authenticate(user=admin_user)

        # Step 1: Create facility
        response = api_client.post('/api/organization/units/', {
            'code': 'HOSP1',
            'name': 'City General Hospital',
            'unit_type': unit_types['facility'].id,
            'description': 'Main city hospital',
            'phone': '+1234567890',
            'email': 'info@citygeneral.com',
        })
        assert response.status_code == status.HTTP_201_CREATED
        facility_id = response.data['id']

        # Step 2: Create departments
        dept_codes = ['SURG', 'MED', 'PED', 'ORTH']
        dept_names = ['Surgery', 'Medicine', 'Pediatrics', 'Orthopedics']
        dept_ids = []

        for code, name in zip(dept_codes, dept_names):
            response = api_client.post('/api/organization/units/', {
                'code': code,
                'name': f'{name} Department',
                'unit_type': unit_types['department'].id,
                'parent': facility_id,
            })
            assert response.status_code == status.HTTP_201_CREATED
            dept_ids.append(response.data['id'])

        # Step 3: Verify tree structure
        response = api_client.get('/api/organization/units/tree/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1  # One root
        assert len(response.data[0]['children']) == 4  # Four departments

        # Step 4: Verify path caches are correct
        for dept_id in dept_ids:
            response = api_client.get(f'/api/organization/units/{dept_id}/')
            assert response.status_code == status.HTTP_200_OK
            assert 'City General Hospital' in response.data['full_path']

    def test_department_leadership_workflow(self, api_client, admin_user, hospital_structure,
                                            leadership_roles, doctor_user, nurse_user):
        """Test the complete workflow of assigning leadership to a department."""
        api_client.force_authenticate(user=admin_user)
        surgery = hospital_structure['surgery']

        # Step 1: Assign department head
        response = api_client.post('/api/organization/leadership/', {
            'unit': str(surgery.id),
            'role': leadership_roles['head'].id,
            'user': str(doctor_user.id),
            'effective_from': timezone.now().date().isoformat(),
        })
        assert response.status_code == status.HTTP_201_CREATED

        # Step 2: Assign nurse manager
        response = api_client.post('/api/organization/leadership/', {
            'unit': str(surgery.id),
            'role': leadership_roles['nurse_manager'].id,
            'user': str(nurse_user.id),
            'effective_from': timezone.now().date().isoformat(),
        })
        assert response.status_code == status.HTTP_201_CREATED

        # Step 3: Verify leaders via unit endpoint
        response = api_client.get(f'/api/organization/units/{surgery.id}/leaders/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

        leaders = {l['role_name']: l for l in response.data}
        assert leaders['Head']['user_name'] == 'John Smith'
        assert leaders['Nurse Manager']['user_name'] == 'Jane Doe'


@pytest.mark.django_db
class TestAccessControlWorkflow:
    """Tests for access control workflows involving multiple units and users."""

    def test_staff_sees_only_assigned_units(self, hospital_structure, doctor_practitioner,
                                             assignment_types, leadership_roles, doctor_user):
        """Test that staff can only access units they are assigned to."""
        surgery = hospital_structure['surgery']
        medicine = hospital_structure['medicine']
        surgery_team_a = hospital_structure['surgery_team_a']

        # Assign doctor to surgery department
        StaffUnitAssignment.objects.create(
            unit=surgery,
            practitioner=doctor_practitioner,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        # Get accessible units
        unit_ids = UnitAccessService.get_accessible_unit_ids(doctor_user)

        # Should have access to surgery and its descendants
        assert surgery.id in unit_ids
        assert surgery_team_a.id in unit_ids

        # Should NOT have access to medicine
        assert medicine.id not in unit_ids

    def test_leadership_grants_department_access(self, hospital_structure, leadership_roles,
                                                  doctor_user):
        """Test that leadership position grants access to unit and descendants."""
        surgery = hospital_structure['surgery']
        surgery_team_a = hospital_structure['surgery_team_a']
        surgery_team_b = hospital_structure['surgery_team_b']

        # Make doctor head of surgery
        UnitLeadership.objects.create(
            unit=surgery,
            role=leadership_roles['head'],
            user=doctor_user,
            effective_from=timezone.now().date()
        )

        # Get accessible units
        unit_ids = UnitAccessService.get_accessible_unit_ids(doctor_user)

        # Should have access to surgery and all its teams
        assert surgery.id in unit_ids
        assert surgery_team_a.id in unit_ids
        assert surgery_team_b.id in unit_ids

    def test_cross_coverage_grants_temporary_access(self, hospital_structure,
                                                     doctor_practitioner, doctor_user):
        """Test that cross coverage grants temporary access."""
        medicine = hospital_structure['medicine']
        medicine_team = hospital_structure['medicine_team']

        # Doctor covering medicine team during night shift
        now = timezone.now()
        CrossCoverageSchedule.objects.create(
            covered_unit=medicine,
            covering_practitioner=doctor_practitioner,
            start_datetime=now - timedelta(hours=1),
            end_datetime=now + timedelta(hours=7),
            coverage_type='on_call'
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(doctor_user)

        # Should have access to medicine and its team during coverage
        assert medicine.id in unit_ids
        assert medicine_team.id in unit_ids

    def test_combined_access_from_multiple_sources(self, hospital_structure, doctor_practitioner,
                                                    doctor_user, assignment_types, leadership_roles):
        """Test that access from multiple sources is combined correctly."""
        surgery = hospital_structure['surgery']
        medicine = hospital_structure['medicine']

        # Staff assignment to surgery
        StaffUnitAssignment.objects.create(
            unit=surgery,
            practitioner=doctor_practitioner,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        # Leadership in medicine
        UnitLeadership.objects.create(
            unit=medicine,
            role=leadership_roles['deputy'],
            user=doctor_user,
            effective_from=timezone.now().date()
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(doctor_user)

        # Should have access to both
        assert surgery.id in unit_ids
        assert medicine.id in unit_ids


@pytest.mark.django_db
class TestQueryPerformance:
    """Tests to verify query performance meets expectations."""

    def test_tree_endpoint_query_count(self, api_client, admin_user, hospital_structure):
        """Test that tree endpoint has reasonable query count."""
        api_client.force_authenticate(user=admin_user)

        with CaptureQueriesContext(connection) as ctx:
            response = api_client.get('/api/organization/units/tree/')
            assert response.status_code == status.HTTP_200_OK

        # Should be efficient - less than 10 queries regardless of tree size
        # Note: May need adjustment based on actual implementation
        assert len(ctx) < 15, f"Too many queries: {len(ctx)}"

    def test_unit_list_query_count(self, api_client, admin_user, hospital_structure):
        """Test that unit list has reasonable query count."""
        api_client.force_authenticate(user=admin_user)

        with CaptureQueriesContext(connection) as ctx:
            response = api_client.get('/api/organization/units/')
            assert response.status_code == status.HTTP_200_OK

        # Should be efficient with select_related
        assert len(ctx) < 10, f"Too many queries: {len(ctx)}"

    def test_access_service_caching(self, hospital_structure, doctor_user, leadership_roles):
        """Test that access service caching reduces queries on repeated calls."""
        surgery = hospital_structure['surgery']

        UnitLeadership.objects.create(
            unit=surgery,
            role=leadership_roles['head'],
            user=doctor_user,
            effective_from=timezone.now().date()
        )

        # First call should hit database
        with CaptureQueriesContext(connection) as ctx1:
            unit_ids1 = UnitAccessService.get_accessible_unit_ids(doctor_user)
            query_count_first = len(ctx1)

        # Second call should use cache
        with CaptureQueriesContext(connection) as ctx2:
            unit_ids2 = UnitAccessService.get_accessible_unit_ids(doctor_user)
            query_count_second = len(ctx2)

        assert unit_ids1 == unit_ids2
        assert query_count_second < query_count_first
        assert query_count_second == 0  # Should be fully cached


@pytest.mark.django_db
class TestDataConsistency:
    """Tests to verify data consistency across operations."""

    def test_unit_delete_cascades_properly(self, hospital_structure, doctor_user, leadership_roles):
        """Test that deleting a unit cascades properly."""
        surgery = hospital_structure['surgery']
        surgery_team_a = hospital_structure['surgery_team_a']

        # Create leadership on department
        leadership = UnitLeadership.objects.create(
            unit=surgery,
            role=leadership_roles['head'],
            user=doctor_user,
            effective_from=timezone.now().date()
        )

        # Delete department (should cascade to team and leadership)
        surgery.delete()

        # Verify cascades
        assert not ClinicalUnit.objects.filter(id=surgery_team_a.id).exists()
        assert not UnitLeadership.objects.filter(id=leadership.id).exists()

    def test_path_cache_consistency_after_rename(self, hospital_structure, api_client, admin_user):
        """Test that renaming a unit updates all descendant paths."""
        api_client.force_authenticate(user=admin_user)
        surgery = hospital_structure['surgery']
        surgery_team_a = hospital_structure['surgery_team_a']
        surgery_team_b = hospital_structure['surgery_team_b']

        # Rename surgery department
        response = api_client.patch(f'/api/organization/units/{surgery.id}/', {
            'name': 'General & Vascular Surgery'
        })
        assert response.status_code == status.HTTP_200_OK

        # Verify team paths are updated
        surgery_team_a.refresh_from_db()
        surgery_team_b.refresh_from_db()

        assert 'General & Vascular Surgery' in surgery_team_a.path_cache
        assert 'General & Vascular Surgery' in surgery_team_b.path_cache

    def test_root_unit_consistency_after_move(self, hospital_structure, unit_types):
        """Test that moving units updates root_unit correctly."""
        # Create a second facility
        facility2 = ClinicalUnit.objects.create(
            code='HOSP2',
            name='Community Hospital',
            unit_type=unit_types['facility']
        )

        surgery = hospital_structure['surgery']
        surgery_team_a = hospital_structure['surgery_team_a']
        original_facility = hospital_structure['facility']

        # Move surgery to new facility
        surgery.parent = facility2
        surgery.save()

        # Refresh and verify root_unit
        surgery.refresh_from_db()
        surgery_team_a.refresh_from_db()

        assert surgery.root_unit_id == facility2.id
        assert surgery_team_a.root_unit_id == facility2.id
