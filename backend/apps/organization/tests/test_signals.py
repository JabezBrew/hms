"""
Signal tests for the organization app.
"""
import pytest
from datetime import timedelta
from django.core.cache import cache
from django.utils import timezone

from apps.organization.models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
)
from apps.organization.services import UnitAccessService
from apps.core.cache_utils import facility_cache_key


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before and after each test."""
    cache.clear()
    yield
    cache.clear()


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
def facility(unit_types):
    """Create a facility."""
    return ClinicalUnit.objects.create(
        code='MAIN',
        name='Main Hospital',
        unit_type=unit_types['facility']
    )


@pytest.fixture
def user(db, django_user_model):
    """Create a user."""
    return django_user_model.objects.create_user(
        username='testuser',
        email='testuser@test.com',
        password='testpass123'
    )


@pytest.fixture
def practitioner(db, user):
    """Create a practitioner profile."""
    from datetime import date
    from apps.users.models import Staff, PractitionerProfile

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


@pytest.fixture
def ops_staff(db, django_user_model):
    """Create a non-clinical staff profile."""
    from datetime import date
    from apps.users.models import Staff

    ops_user = django_user_model.objects.create_user(
        username='opsuser',
        email='opsuser@test.com',
        password='testpass123',
        user_type='billing'
    )
    return Staff.objects.create(
        user=ops_user,
        employee_id='OPS001',
        department='Billing',
        position='Billing Specialist',
        hire_date=date(2021, 1, 1)
    )


# =============================================================================
# Denormalization Signal Tests
# =============================================================================


@pytest.mark.django_db
class TestDenormalizationSignals:
    """Tests for denormalization signals on ClinicalUnit."""

    def test_root_unit_self_reference(self, facility):
        """Test that root units have root_unit pointing to themselves."""
        facility.refresh_from_db()
        assert facility.root_unit_id == facility.id

    def test_child_unit_inherits_root(self, facility, unit_types):
        """Test that child units inherit root_unit from parent."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )
        department.refresh_from_db()

        assert department.root_unit_id == facility.id

    def test_deeply_nested_unit_has_correct_root(self, facility, unit_types):
        """Test that deeply nested units have correct root_unit."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )

        team = ClinicalUnit.objects.create(
            code='TEAM-A',
            name='Team A',
            unit_type=unit_types['team'],
            parent=department
        )
        team.refresh_from_db()

        assert team.root_unit_id == facility.id

    def test_path_cache_single_node(self, facility):
        """Test path_cache for a single node."""
        facility.refresh_from_db()
        assert facility.path_cache == 'Main Hospital'

    def test_path_cache_nested_nodes(self, facility, unit_types):
        """Test path_cache for nested nodes."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )
        department.refresh_from_db()

        assert department.path_cache == 'Main Hospital > Surgery'

    def test_path_cache_deeply_nested(self, facility, unit_types):
        """Test path_cache for deeply nested nodes."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )

        team = ClinicalUnit.objects.create(
            code='TEAM-A',
            name='Team A',
            unit_type=unit_types['team'],
            parent=department
        )
        team.refresh_from_db()

        assert team.path_cache == 'Main Hospital > Surgery > Team A'

    def test_path_cache_updates_on_name_change(self, facility, unit_types):
        """Test that path_cache updates when name changes."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )

        team = ClinicalUnit.objects.create(
            code='TEAM-A',
            name='Team A',
            unit_type=unit_types['team'],
            parent=department
        )

        # Update department name
        department.name = 'General Surgery'
        department.save()

        # Check that team's path is updated
        team.refresh_from_db()
        assert 'General Surgery' in team.path_cache

    def test_full_path_property_uses_cache(self, facility, unit_types):
        """Test that full_path property uses path_cache."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )
        department.refresh_from_db()

        assert department.full_path == department.path_cache


# =============================================================================
# Cache Invalidation Signal Tests
# =============================================================================


@pytest.mark.django_db
class TestCacheInvalidationSignals:
    """Tests for cache invalidation signals."""

    def test_leadership_change_invalidates_cache(self, facility, user, leadership_roles, unit_types):
        """Test that creating leadership invalidates user cache."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )

        # Populate cache first
        UnitAccessService.get_accessible_unit_ids(user)

        # Check cache exists
        cache_key = facility_cache_key(f'user_unit_access:{user.id}')
        assert cache.get(cache_key) is not None

        # Create leadership (should invalidate cache)
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        # Cache should be invalidated
        assert cache.get(cache_key) is None

    def test_leadership_delete_invalidates_cache(self, facility, user, leadership_roles, unit_types):
        """Test that deleting leadership invalidates user cache."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )

        leadership = UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        # Populate cache
        UnitAccessService.get_accessible_unit_ids(user)
        cache_key = facility_cache_key(f'user_unit_access:{user.id}')
        assert cache.get(cache_key) is not None

        # Delete leadership
        leadership.delete()

        # Cache should be invalidated
        assert cache.get(cache_key) is None

    def test_staff_assignment_change_invalidates_cache(self, facility, practitioner, assignment_types, unit_types):
        """Test that staff assignment changes invalidate cache."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )

        user = practitioner.staff.user

        # Populate cache
        UnitAccessService.get_accessible_unit_ids(user)
        cache_key = facility_cache_key(f'user_unit_access:{user.id}')
        assert cache.get(cache_key) is not None

        # Create staff assignment
        StaffUnitAssignment.objects.create(
            unit=department,
            practitioner=practitioner,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        # Cache should be invalidated
        assert cache.get(cache_key) is None

    def test_coverage_change_invalidates_cache(self, facility, practitioner, unit_types):
        """Test that coverage schedule changes invalidate cache."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )

        user = practitioner.staff.user

        # Populate cache
        UnitAccessService.get_accessible_unit_ids(user)
        cache_key = facility_cache_key(f'user_unit_access:{user.id}')
        assert cache.get(cache_key) is not None

        # Create coverage
        now = timezone.now()
        CrossCoverageSchedule.objects.create(
            covered_unit=department,
            covering_practitioner=practitioner,
            start_datetime=now,
            end_datetime=now + timedelta(hours=8),
            coverage_type='on_call'
        )

        # Cache should be invalidated
        assert cache.get(cache_key) is None


@pytest.mark.django_db
class TestLeadershipAutoAssignmentSignals:
    """Tests for automatic staff assignment on leadership creation."""

    def test_leadership_creates_staff_assignment(self, facility, unit_types, leadership_roles, practitioner):
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='clinical_only'
        )

        leadership = UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=practitioner.staff.user,
            effective_from=timezone.now().date()
        )

        assignment = StaffUnitAssignment.objects.filter(
            unit=department,
            practitioner=practitioner,
            is_active=True
        ).first()

        assert assignment is not None
        assert assignment.effective_from == leadership.effective_from

    def test_leadership_creates_staff_assignment_for_mixed_unit(self, facility, unit_types, leadership_roles, practitioner):
        mixed_unit = ClinicalUnit.objects.create(
            code='MED',
            name='Medicine',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='mixed'
        )

        leadership = UnitLeadership.objects.create(
            unit=mixed_unit,
            role=leadership_roles['head'],
            user=practitioner.staff.user,
            effective_from=timezone.now().date()
        )

        assignment = StaffUnitAssignment.objects.filter(
            unit=mixed_unit,
            practitioner=practitioner,
            is_active=True
        ).first()

        assert assignment is not None
        assert assignment.effective_from == leadership.effective_from

    def test_leadership_creates_member_assignment_for_ops_unit(self, facility, unit_types, leadership_roles, ops_staff):
        ops_unit = ClinicalUnit.objects.create(
            code='BILL',
            name='Billing',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='ops_only'
        )

        leadership = UnitLeadership.objects.create(
            unit=ops_unit,
            role=leadership_roles['head'],
            user=ops_staff.user,
            effective_from=timezone.now().date()
        )

        assignment = UnitMemberAssignment.objects.filter(
            unit=ops_unit,
            staff=ops_staff,
            is_active=True
        ).first()

        assert assignment is not None
        assert assignment.effective_from == leadership.effective_from

    def test_leadership_creates_member_assignment_for_mixed_unit(self, facility, unit_types, leadership_roles, ops_staff):
        mixed_unit = ClinicalUnit.objects.create(
            code='ADM',
            name='Administration',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='mixed'
        )

        leadership = UnitLeadership.objects.create(
            unit=mixed_unit,
            role=leadership_roles['head'],
            user=ops_staff.user,
            effective_from=timezone.now().date()
        )

        assignment = UnitMemberAssignment.objects.filter(
            unit=mixed_unit,
            staff=ops_staff,
            is_active=True
        ).first()

        assert assignment is not None
        assert assignment.effective_from == leadership.effective_from


# =============================================================================
# MPTT Signal Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestMPTTIntegration:
    """Tests for MPTT integration with our signals."""

    def test_tree_structure_maintained_after_insert(self, facility, unit_types):
        """Test that MPTT tree structure is maintained after insert."""
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility
        )

        # Check MPTT fields are set correctly
        facility.refresh_from_db()
        department.refresh_from_db()

        assert facility.level == 0
        assert department.level == 1
        assert department.parent_id == facility.id
        assert facility.lft < department.lft
        assert facility.rght > department.rght

    def test_move_unit_updates_denormalized_fields(self, unit_types):
        """Test that moving a unit updates denormalized fields."""
        # Create two facilities
        facility1 = ClinicalUnit.objects.create(
            code='MAIN1',
            name='Hospital 1',
            unit_type=unit_types['facility']
        )
        facility2 = ClinicalUnit.objects.create(
            code='MAIN2',
            name='Hospital 2',
            unit_type=unit_types['facility']
        )

        # Create department under facility1
        department = ClinicalUnit.objects.create(
            code='SURG',
            name='Surgery',
            unit_type=unit_types['department'],
            parent=facility1
        )
        department.refresh_from_db()
        assert department.root_unit_id == facility1.id
        assert 'Hospital 1' in department.path_cache

        # Move to facility2
        department.parent = facility2
        department.save()
        department.refresh_from_db()

        assert department.root_unit_id == facility2.id
        assert 'Hospital 2' in department.path_cache
        assert 'Hospital 1' not in department.path_cache
