"""
Tests for organization models.
"""
import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.organization.models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    UnitLeadership,
)


@pytest.fixture
def seed_organization_data(db):
    """Seed the organization configuration data."""
    call_command('seed_organization')


@pytest.fixture
def unit_types(seed_organization_data):
    """Get all seeded unit types."""
    return {ut.code: ut for ut in UnitTypeConfig.objects.all()}


@pytest.fixture
def facility_type(unit_types):
    """Get the facility unit type."""
    return unit_types['facility']


@pytest.fixture
def department_type(unit_types):
    """Get the department unit type."""
    return unit_types['department']


@pytest.fixture
def team_type(unit_types):
    """Get the team unit type."""
    return unit_types['team']


@pytest.mark.django_db
class TestUnitTypeConfig:
    """Tests for UnitTypeConfig model."""

    def test_seed_creates_unit_types(self, seed_organization_data):
        """Test that seed command creates expected unit types."""
        assert UnitTypeConfig.objects.count() >= 6

        facility = UnitTypeConfig.objects.get(code='facility')
        assert facility.can_be_root is True
        assert facility.can_have_budget is True

        department = UnitTypeConfig.objects.get(code='department')
        assert department.can_admit_patients is True
        assert department.can_consult is True

    def test_facility_can_be_root(self, facility_type):
        """Test that facility type can be root."""
        assert facility_type.can_be_root is True

    def test_department_cannot_be_root(self, department_type):
        """Test that department type cannot be root."""
        assert department_type.can_be_root is False


@pytest.mark.django_db
class TestLeadershipRoleConfig:
    """Tests for LeadershipRoleConfig model."""

    def test_seed_creates_leadership_roles(self, seed_organization_data):
        """Test that seed command creates expected leadership roles."""
        assert LeadershipRoleConfig.objects.count() >= 5

        head = LeadershipRoleConfig.objects.get(code='head')
        assert head.is_primary_leader is True
        assert head.can_approve is True
        assert head.can_manage_staff is True


@pytest.mark.django_db
class TestStaffAssignmentTypeConfig:
    """Tests for StaffAssignmentTypeConfig model."""

    def test_seed_creates_assignment_types(self, seed_organization_data):
        """Test that seed command creates expected assignment types."""
        assert StaffAssignmentTypeConfig.objects.count() >= 4

        rotational = StaffAssignmentTypeConfig.objects.get(code='rotational')
        assert rotational.supports_date_ranges is True
        assert rotational.allows_multiple_primary is True


@pytest.mark.django_db
class TestClinicalUnit:
    """Tests for ClinicalUnit model."""

    def test_create_facility(self, facility_type):
        """Test creating a root facility unit."""
        facility = ClinicalUnit.objects.create(
            code='MAIN',
            name='Main Hospital',
            unit_type=facility_type
        )

        assert facility.parent is None
        assert facility.full_path == 'Main Hospital'

    def test_create_department_under_facility(self, facility_type, department_type):
        """Test creating a department under a facility."""
        facility = ClinicalUnit.objects.create(
            code='MAIN',
            name='Main Hospital',
            unit_type=facility_type
        )

        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery Department',
            unit_type=department_type,
            parent=facility
        )

        assert department.parent == facility
        # Path cache is updated via signals after save
        department.refresh_from_db()
        assert 'Main Hospital' in department.full_path
        assert 'Surgery Department' in department.full_path

    def test_create_team_under_department(self, facility_type, department_type, team_type):
        """Test creating a team under a department."""
        facility = ClinicalUnit.objects.create(
            code='MAIN',
            name='Main Hospital',
            unit_type=facility_type
        )

        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=department_type,
            parent=facility
        )

        team = ClinicalUnit.objects.create(
            code='TEAM-A',
            name='Surgery Team A',
            unit_type=team_type,
            parent=department
        )

        team.refresh_from_db()
        assert 'Main Hospital' in team.full_path
        assert 'Surgery' in team.full_path
        assert 'Surgery Team A' in team.full_path

    def test_root_unit_is_facility(self, facility_type, department_type, team_type):
        """Test that root_unit points to the facility for nested units."""
        facility = ClinicalUnit.objects.create(
            code='MAIN',
            name='Main Hospital',
            unit_type=facility_type
        )

        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=department_type,
            parent=facility
        )
        department.refresh_from_db()

        team = ClinicalUnit.objects.create(
            code='TEAM-A',
            name='Surgery Team A',
            unit_type=team_type,
            parent=department
        )
        team.refresh_from_db()

        assert team.root_unit_id == facility.id
        assert department.root_unit_id == facility.id

    def test_unique_code_within_parent(self, facility_type, department_type):
        """Test that codes must be unique within a parent."""
        facility = ClinicalUnit.objects.create(
            code='MAIN',
            name='Main Hospital',
            unit_type=facility_type
        )

        ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=department_type,
            parent=facility
        )

        # Same code under same parent should fail
        from django.db import IntegrityError
        with pytest.raises(IntegrityError):
            ClinicalUnit.objects.create(
                code='SURG',
                name='Surgery 2',
                unit_type=department_type,
                parent=facility
            )


@pytest.mark.django_db
class TestUnitLeadership:
    """Tests for UnitLeadership model."""

    def test_create_leadership_assignment(self, seed_organization_data, django_user_model, facility_type):
        """Test creating a leadership assignment."""
        user = django_user_model.objects.create_user(
            username='leader',
            email='leader@test.com',
            password='testpass123',
            first_name='Test',
            last_name='Leader'
        )

        facility = ClinicalUnit.objects.create(
            code='MAIN',
            name='Main Hospital',
            unit_type=facility_type
        )

        head_role = LeadershipRoleConfig.objects.get(code='head')

        leadership = UnitLeadership.objects.create(
            unit=facility,
            role=head_role,
            user=user,
            effective_from=timezone.now().date()
        )

        assert leadership.is_currently_effective is True

    def test_expired_leadership_not_effective(self, seed_organization_data, django_user_model, facility_type):
        """Test that expired leadership is not currently effective."""
        from datetime import timedelta

        user = django_user_model.objects.create_user(
            username='oldleader',
            email='oldleader@test.com',
            password='testpass123'
        )

        facility = ClinicalUnit.objects.create(
            code='MAIN',
            name='Main Hospital',
            unit_type=facility_type
        )

        head_role = LeadershipRoleConfig.objects.get(code='head')

        # Create expired leadership
        yesterday = timezone.now().date() - timedelta(days=1)
        two_days_ago = timezone.now().date() - timedelta(days=2)

        leadership = UnitLeadership.objects.create(
            unit=facility,
            role=head_role,
            user=user,
            effective_from=two_days_ago,
            effective_until=yesterday
        )

        assert leadership.is_currently_effective is False

    def test_future_leadership_not_effective(self, seed_organization_data, django_user_model, facility_type):
        """Test that future leadership is not currently effective."""
        from datetime import timedelta

        user = django_user_model.objects.create_user(
            username='futureleader',
            email='futureleader@test.com',
            password='testpass123'
        )

        facility = ClinicalUnit.objects.create(
            code='MAIN',
            name='Main Hospital',
            unit_type=facility_type
        )

        head_role = LeadershipRoleConfig.objects.get(code='head')

        # Create future leadership
        tomorrow = timezone.now().date() + timedelta(days=1)

        leadership = UnitLeadership.objects.create(
            unit=facility,
            role=head_role,
            user=user,
            effective_from=tomorrow
        )

        assert leadership.is_currently_effective is False
