"""
Service layer tests for the organization app.
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
from apps.organization.services import UnitAccessService, UnitHierarchyService


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


@pytest.fixture
def another_department(unit_types, facility):
    """Create another department for testing access control."""
    dept = ClinicalUnit.objects.create(
        code='CARD',
        name='Cardiology Department',
        unit_type=unit_types['department'],
        parent=facility
    )
    dept.refresh_from_db()
    return dept


@pytest.fixture
def user(db, django_user_model):
    """Create a user."""
    return django_user_model.objects.create_user(
        username='testuser',
        email='testuser@test.com',
        password='testpass123',
        user_type='doctor'
    )


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


# =============================================================================
# UnitAccessService Tests
# =============================================================================


@pytest.mark.django_db
class TestUnitAccessService:
    """Tests for the UnitAccessService."""

    def test_unauthenticated_user_gets_no_access(self):
        """Test that unauthenticated users have no access."""
        unit_ids = UnitAccessService.get_accessible_unit_ids(None)
        assert unit_ids == set()

    def test_user_without_assignments_gets_no_access(self, user, facility):
        """Test that users without assignments have no access."""
        unit_ids = UnitAccessService.get_accessible_unit_ids(user)
        assert unit_ids == set()

    def test_leadership_grants_access(self, user, department, leadership_roles):
        """Test that leadership positions grant access."""
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(user)
        assert department.id in unit_ids

    def test_staff_assignment_grants_access(self, practitioner, department, assignment_types):
        """Test that staff assignments grant access."""
        StaffUnitAssignment.objects.create(
            unit=department,
            practitioner=practitioner,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(practitioner.staff.user)
        assert department.id in unit_ids

    def test_ops_member_grants_access(self, facility, unit_types, django_user_model):
        """Test that ops member assignments grant access."""
        from datetime import date
        from apps.users.models import Staff

        ops_user = django_user_model.objects.create_user(
            username='opsuser',
            email='opsuser@test.com',
            password='testpass123',
            user_type='billing'
        )
        ops_staff = Staff.objects.create(
            user=ops_user,
            employee_id='OPS001',
            department='Billing',
            position='Billing Specialist',
            hire_date=date(2021, 1, 1)
        )
        ops_unit = ClinicalUnit.objects.create(
            code='BILL',
            name='Billing',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='ops_only'
        )
        UnitMemberAssignment.objects.create(
            unit=ops_unit,
            staff=ops_staff,
            assignment_type=StaffAssignmentTypeConfig.objects.filter(code='single').first(),
            is_primary=True
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(ops_user)
        assert ops_unit.id in unit_ids

    def test_cross_coverage_grants_access(self, practitioner, department):
        """Test that cross coverage grants access."""
        now = timezone.now()
        CrossCoverageSchedule.objects.create(
            covered_unit=department,
            covering_practitioner=practitioner,
            start_datetime=now - timedelta(hours=1),
            end_datetime=now + timedelta(hours=7),
            coverage_type='on_call'
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(practitioner.staff.user)
        assert department.id in unit_ids

    def test_expired_leadership_no_access(self, user, department, leadership_roles):
        """Test that expired leadership doesn't grant access."""
        yesterday = timezone.now().date() - timedelta(days=1)
        last_week = timezone.now().date() - timedelta(days=7)

        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=last_week,
            effective_until=yesterday
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(user)
        assert department.id not in unit_ids

    def test_future_leadership_no_access(self, user, department, leadership_roles):
        """Test that future leadership doesn't grant access yet."""
        tomorrow = timezone.now().date() + timedelta(days=1)

        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=tomorrow
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(user)
        assert department.id not in unit_ids

    def test_access_includes_descendants(self, user, department, team, leadership_roles):
        """Test that access to a unit includes descendants."""
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(user, include_descendants=True)
        assert department.id in unit_ids
        assert team.id in unit_ids

    def test_mixed_unit_includes_clinical_descendants(self, practitioner, facility, unit_types, assignment_types):
        """Test that mixed units include clinical descendants for practitioners."""
        mixed_department = ClinicalUnit.objects.create(
            code='MED',
            name='Medicine',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='mixed'
        )
        team = ClinicalUnit.objects.create(
            code='MED-TEAM',
            name='Medicine Team',
            unit_type=unit_types['team'],
            parent=mixed_department,
            staffing_mode='clinical_only'
        )
        StaffUnitAssignment.objects.create(
            unit=mixed_department,
            practitioner=practitioner,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(practitioner.staff.user, include_descendants=True)
        assert team.id in unit_ids

    def test_mixed_unit_includes_ops_descendants_for_members(self, facility, unit_types, django_user_model, assignment_types):
        """Test that mixed units include ops descendants for ops members."""
        from datetime import date
        from apps.users.models import Staff

        ops_user = django_user_model.objects.create_user(
            username='opsuser2',
            email='opsuser2@test.com',
            password='testpass123',
            user_type='billing'
        )
        ops_staff = Staff.objects.create(
            user=ops_user,
            employee_id='OPS002',
            department='Administration',
            position='Admin Assistant',
            hire_date=date(2021, 1, 1)
        )
        mixed_department = ClinicalUnit.objects.create(
            code='ADM',
            name='Administration',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='mixed'
        )
        ops_team = ClinicalUnit.objects.create(
            code='ADM-OPS',
            name='Admin Ops',
            unit_type=unit_types['team'],
            parent=mixed_department,
            staffing_mode='ops_only'
        )
        UnitMemberAssignment.objects.create(
            unit=mixed_department,
            staff=ops_staff,
            assignment_type=assignment_types['single'],
            is_primary=True
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(ops_user, include_descendants=True)
        assert ops_team.id in unit_ids

    def test_access_without_descendants(self, user, department, team, leadership_roles):
        """Test that access can be limited to direct assignments."""
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        unit_ids = UnitAccessService.get_accessible_unit_ids(user, include_descendants=False)
        assert department.id in unit_ids
        assert team.id not in unit_ids

    def test_access_is_cached(self, user, department, leadership_roles):
        """Test that access results are cached."""
        leadership = UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        # First call populates cache
        unit_ids1 = UnitAccessService.get_accessible_unit_ids(user)

        # Manually clear and re-populate cache to test caching works
        # (signals auto-invalidate on delete, so we test the caching mechanism differently)
        cache_key = f'user_unit_access:{user.id}'

        # Verify cache was set
        cached_value = cache.get(cache_key)
        assert cached_value is not None
        assert department.id in cached_value

        # Second call should use cached data (no DB query needed)
        unit_ids2 = UnitAccessService.get_accessible_unit_ids(user)
        assert unit_ids1 == unit_ids2
        assert department.id in unit_ids2

    def test_cache_invalidation(self, user, department, leadership_roles):
        """Test that cache can be invalidated."""
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        # First call populates cache
        unit_ids1 = UnitAccessService.get_accessible_unit_ids(user)
        assert department.id in unit_ids1

        # Delete the leadership
        UnitLeadership.objects.all().delete()

        # Invalidate cache
        UnitAccessService.invalidate_user_cache(user.id)

        # Now should get updated access
        unit_ids2 = UnitAccessService.get_accessible_unit_ids(user)
        assert department.id not in unit_ids2

    def test_user_has_access_method(self, user, department, leadership_roles):
        """Test the per-object access check."""
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        assert UnitAccessService.user_has_access(user, department) is True

    def test_filter_queryset_by_access(self, user, department, another_department, leadership_roles, django_user_model):
        """Test filtering querysets by user access."""
        # Create a second user for the other department's leadership
        other_user = django_user_model.objects.create_user(
            username='otheruser',
            email='other@test.com',
            password='testpass123',
            user_type='doctor'
        )

        # User only has access to surgery department
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        # Create some leadership assignments to test filtering
        # (filtering is for models with a 'unit' FK, not ClinicalUnit itself)
        surg_lead = UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['deputy'],
            user=user,
            effective_from=timezone.now().date()
        )
        # Use a different user for another_department so 'user' doesn't get access to it
        card_lead = UnitLeadership.objects.create(
            unit=another_department,
            role=leadership_roles['head'],
            user=other_user,
            effective_from=timezone.now().date()
        )

        # Filter by access - this filters UnitLeadership by which units user can access
        all_leadership = UnitLeadership.objects.all()
        filtered = UnitAccessService.filter_queryset_by_access(all_leadership, user)

        # Should only see leadership for units user has access to
        filtered_unit_ids = set(filtered.values_list('unit_id', flat=True))
        assert department.id in filtered_unit_ids
        # User has access to department but not another_department
        assert another_department.id not in filtered_unit_ids

    def test_admin_user_has_full_access(self, admin_user, department, another_department, leadership_roles):
        """Test that admin users can access all units."""
        # Create leadership assignments in multiple departments
        UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=admin_user,
            effective_from=timezone.now().date()
        )
        UnitLeadership.objects.create(
            unit=another_department,
            role=leadership_roles['head'],
            user=admin_user,
            effective_from=timezone.now().date()
        )

        all_leadership = UnitLeadership.objects.all()
        filtered = UnitAccessService.filter_queryset_by_access(all_leadership, admin_user)

        # Admin should see all leadership assignments
        filtered_unit_ids = set(filtered.values_list('unit_id', flat=True))
        assert department.id in filtered_unit_ids
        assert another_department.id in filtered_unit_ids


# =============================================================================
# UnitHierarchyService Tests
# =============================================================================


@pytest.mark.django_db
class TestUnitHierarchyService:
    """Tests for the UnitHierarchyService."""

    def test_get_facility_for_unit(self, facility, department, team):
        """Test getting the facility for a unit."""
        team.refresh_from_db()

        result = UnitHierarchyService.get_facility_for_unit(team)
        assert result.id == facility.id

    def test_get_units_by_type(self, facility, department, team, unit_types):
        """Test getting units by type."""
        departments = UnitHierarchyService.get_units_by_type('department')
        assert department in departments

        teams = UnitHierarchyService.get_units_by_type('team')
        assert team in teams

    def test_get_units_by_type_with_facility_filter(self, facility, department, unit_types):
        """Test filtering units by facility."""
        # Create another facility with its own department
        other_facility = ClinicalUnit.objects.create(
            code='OTHER',
            name='Other Hospital',
            unit_type=unit_types['facility']
        )
        other_dept = ClinicalUnit.objects.create(
            code='OTHER-DEPT',
            name='Other Department',
            unit_type=unit_types['department'],
            parent=other_facility
        )

        # Get departments for main facility only
        departments = UnitHierarchyService.get_units_by_type('department', facility=facility)

        assert department in departments
        assert other_dept not in departments

    def test_get_units_by_type_excludes_inactive(self, facility, department, unit_types):
        """Test that inactive units are excluded by default."""
        inactive_dept = ClinicalUnit.objects.create(
            code='INACTIVE',
            name='Inactive Department',
            unit_type=unit_types['department'],
            parent=facility,
            is_active=False
        )

        departments = UnitHierarchyService.get_units_by_type('department', active_only=True)
        assert department in departments
        assert inactive_dept not in departments

    def test_get_teams_for_admission(self, facility, department, team, unit_types):
        """Test getting teams that can admit patients."""
        # Make sure the department can admit
        department.accepts_admissions = True
        department.save()

        teams = UnitHierarchyService.get_teams_for_admission(facility=facility)
        # Should include department (if unit_type allows) and team
        assert all(t.accepts_admissions for t in teams)

    def test_get_consulting_teams(self, facility, department, unit_types):
        """Test getting teams that can consult."""
        department.accepts_referrals = True
        department.save()

        teams = UnitHierarchyService.get_consulting_teams(facility=facility)
        assert all(t.accepts_referrals for t in teams)
