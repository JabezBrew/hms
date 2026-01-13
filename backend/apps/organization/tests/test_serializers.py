"""
Serializer tests for the organization app.
"""
import pytest
from datetime import date, time, timedelta
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.organization.models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
    DutyRosterTemplate,
)
from apps.organization.serializers import (
    ClinicalUnitSerializer,
    ClinicalUnitCreateSerializer,
    ClinicalUnitTreeSerializer,
    CrossCoverageScheduleSerializer,
    UnitLeadershipListSerializer,
    StaffUnitAssignmentSerializer,
    UnitMemberAssignmentSerializer,
    DutyRosterTemplateSerializer,
)


@pytest.fixture
def request_factory():
    """Create a request factory."""
    return APIRequestFactory()


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
def facility_obj(db):
    """Create a Facility object."""
    from apps.core.models import Facility
    return Facility.objects.create(
        code='MAIN',
        name='Main Hospital',
        is_active=True
    )


@pytest.fixture
def ops_user(db, django_user_model):
    """Create a non-clinical user."""
    return django_user_model.objects.create_user(
        username='opsuser',
        email='opsuser@test.com',
        password='testpass123',
        user_type='billing'
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
def ops_staff(db, ops_user):
    """Create a non-clinical staff profile."""
    from datetime import date
    from apps.users.models import Staff

    return Staff.objects.create(
        user=ops_user,
        employee_id='OPS001',
        department='Billing',
        position='Billing Specialist',
        hire_date=date(2021, 1, 1)
    )


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
def user(db, django_user_model):
    """Create a user."""
    return django_user_model.objects.create_user(
        username='testuser',
        email='testuser@test.com',
        password='testpass123',
        first_name='Test',
        last_name='User',
        user_type='doctor'
    )


# =============================================================================
# ClinicalUnitSerializer Tests
# =============================================================================


@pytest.mark.django_db
class TestClinicalUnitSerializer:
    """Tests for ClinicalUnitSerializer."""

    def test_serialize_unit(self, department, request_factory):
        """Test basic serialization of a unit."""
        request = request_factory.get('/')
        serializer = ClinicalUnitSerializer(department, context={'request': Request(request)})
        data = serializer.data

        assert data['code'] == 'SURG'
        assert data['name'] == 'Surgery Department'
        assert data['unit_type_name'] == 'Department'

    def test_serialize_includes_full_path(self, team, request_factory):
        """Test that serialization includes full path."""
        team.refresh_from_db()
        request = request_factory.get('/')
        serializer = ClinicalUnitSerializer(team, context={'request': Request(request)})
        data = serializer.data

        assert 'Main Hospital' in data['full_path']
        assert 'Surgery Department' in data['full_path']
        assert 'Surgery Team A' in data['full_path']

    def test_validate_non_root_without_parent(self, unit_types):
        """Test that non-root types require a parent."""
        serializer = ClinicalUnitSerializer(data={
            'code': 'ORPHAN',
            'name': 'Orphan Team',
            'unit_type': unit_types['team'].id,
        })
        assert not serializer.is_valid()
        assert 'parent' in serializer.errors

    def test_validate_root_type_without_parent(self, unit_types):
        """Test that root types can be created without parent."""
        serializer = ClinicalUnitSerializer(data={
            'code': 'NEW-FACILITY',
            'name': 'New Facility',
            'unit_type': unit_types['facility'].id,
        })
        assert serializer.is_valid(), serializer.errors


@pytest.mark.django_db
class TestClinicalUnitCreateSerializer:
    """Tests for ClinicalUnitCreateSerializer."""

    def test_create_sets_created_by(self, unit_types, user, request_factory):
        """Test that create sets created_by from request user."""
        from django.contrib.auth.models import AnonymousUser
        from rest_framework.test import force_authenticate

        request = request_factory.post('/')
        force_authenticate(request, user=user)
        drf_request = Request(request)

        serializer = ClinicalUnitCreateSerializer(
            data={
                'code': 'NEW',
                'name': 'New Facility',
                'unit_type': unit_types['facility'].id,
            },
            context={'request': drf_request}
        )
        assert serializer.is_valid(), serializer.errors
        instance = serializer.save()

        assert instance.created_by == user

    def test_update_sets_updated_by(self, facility, user, request_factory):
        """Test that update sets updated_by from request user."""
        from rest_framework.test import force_authenticate

        request = request_factory.patch('/')
        force_authenticate(request, user=user)
        drf_request = Request(request)

        serializer = ClinicalUnitCreateSerializer(
            facility,
            data={'name': 'Updated Hospital'},
            partial=True,
            context={'request': drf_request}
        )
        assert serializer.is_valid(), serializer.errors
        instance = serializer.save()

        assert instance.updated_by == user

    def test_create_defaults_mixed_for_facility(self, unit_types, request_factory):
        """Test that facility defaults to mixed staffing when omitted."""
        request = request_factory.post('/')
        serializer = ClinicalUnitCreateSerializer(
            data={
                'code': 'MAIN',
                'name': 'Main Facility',
                'unit_type': unit_types['facility'].id,
            },
            context={'request': Request(request)}
        )
        assert serializer.is_valid(), serializer.errors
        instance = serializer.save()

        assert instance.staffing_mode == 'mixed'

    def test_create_does_not_inherit_staffing_mode_from_parent(self, facility, unit_types, request_factory):
        """Test that staffing_mode does not inherit from the parent when omitted."""
        ops_parent = ClinicalUnit.objects.create(
            code='BILL',
            name='Billing',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='ops_only'
        )

        request = request_factory.post('/')
        serializer = ClinicalUnitCreateSerializer(
            data={
                'code': 'BILL-TEAM',
                'name': 'Billing Team',
                'unit_type': unit_types['team'].id,
                'parent': ops_parent.id,
            },
            context={'request': Request(request)}
        )
        assert serializer.is_valid(), serializer.errors
        instance = serializer.save()

        assert instance.staffing_mode == 'clinical_only'


@pytest.mark.django_db
class TestClinicalUnitTreeSerializer:
    """Tests for ClinicalUnitTreeSerializer."""

    def test_serialize_tree(self, facility, department, team, request_factory):
        """Test that tree serializer includes nested children."""
        request = request_factory.get('/')
        serializer = ClinicalUnitTreeSerializer(facility, context={'request': Request(request)})
        data = serializer.data

        assert data['code'] == 'MAIN'
        assert len(data['children']) == 1
        assert data['children'][0]['code'] == 'SURG'
        assert len(data['children'][0]['children']) == 1
        assert data['children'][0]['children'][0]['code'] == 'TEAM-A'

    def test_tree_excludes_inactive(self, facility, department, team, unit_types, request_factory):
        """Test that tree excludes inactive children."""
        # Make team inactive
        team.is_active = False
        team.save()

        request = request_factory.get('/')
        serializer = ClinicalUnitTreeSerializer(facility, context={'request': Request(request)})
        data = serializer.data

        # Department should have no children (team is inactive)
        assert len(data['children'][0]['children']) == 0


# =============================================================================
# UnitLeadershipListSerializer Tests
# =============================================================================


@pytest.mark.django_db
class TestUnitLeadershipListSerializer:
    """Tests for UnitLeadershipListSerializer."""

    def test_serialize_leadership(self, department, user, leadership_roles, request_factory):
        """Test basic serialization of leadership."""
        leadership = UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date()
        )

        request = request_factory.get('/')
        serializer = UnitLeadershipListSerializer(leadership, context={'request': Request(request)})
        data = serializer.data

        assert data['unit_name'] == 'Surgery Department'
        assert data['role_name'] == 'Head'
        assert data['user_name'] == 'Test User'
        assert data['is_currently_effective'] is True

    def test_serialize_expired_leadership(self, department, user, leadership_roles, request_factory):
        """Test serialization of expired leadership."""
        leadership = UnitLeadership.objects.create(
            unit=department,
            role=leadership_roles['head'],
            user=user,
            effective_from=timezone.now().date() - timedelta(days=30),
            effective_until=timezone.now().date() - timedelta(days=1)
        )

        request = request_factory.get('/')
        serializer = UnitLeadershipListSerializer(leadership, context={'request': Request(request)})
        data = serializer.data

        assert data['is_currently_effective'] is False


# =============================================================================
# CrossCoverageScheduleSerializer Tests
# =============================================================================


@pytest.mark.django_db
class TestCrossCoverageScheduleSerializer:
    """Tests for CrossCoverageScheduleSerializer."""

    @pytest.fixture
    def practitioner(self, db, user):
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

    def test_validate_requires_covering_entity(self, department):
        """Test that validation requires either practitioner or unit."""
        now = timezone.now()
        serializer = CrossCoverageScheduleSerializer(data={
            'covered_unit': str(department.id),
            'start_datetime': now.isoformat(),
            'end_datetime': (now + timedelta(hours=8)).isoformat(),
            'coverage_type': 'on_call',
        })
        assert not serializer.is_valid()


# =============================================================================
# DutyRosterTemplateSerializer Tests
# =============================================================================


@pytest.mark.django_db
class TestDutyRosterTemplateSerializer:
    """Tests for DutyRosterTemplateSerializer."""

    def test_partial_update_uses_existing_times(self, facility_obj, team, practitioner):
        """Test partial updates without overriding shift/times."""
        template = DutyRosterTemplate.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            day_of_week=0,
            custom_start_time=time(9, 0),
            custom_end_time=time(17, 0),
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            effective_from=date.today(),
        )

        serializer = DutyRosterTemplateSerializer(
            template,
            data={'is_active': False},
            partial=True
        )
        assert serializer.is_valid(), serializer.errors


# =============================================================================
# Assignment Serializer Validation Tests
# =============================================================================


@pytest.mark.django_db
class TestAssignmentSerializerValidation:
    """Tests for assignment serializer validation rules."""

    def test_staff_assignment_rejects_ops_unit(self, facility, unit_types, practitioner, assignment_types):
        ops_unit = ClinicalUnit.objects.create(
            code='BILL',
            name='Billing',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='ops_only'
        )

        serializer = StaffUnitAssignmentSerializer(data={
            'unit': str(ops_unit.id),
            'practitioner': str(practitioner.id),
            'assignment_type': str(assignment_types['single'].id),
            'is_primary': True
        })
        assert not serializer.is_valid()
        assert 'unit' in serializer.errors

    def test_member_assignment_rejects_clinical_unit(self, department, ops_staff, assignment_types):
        clinical_unit = ClinicalUnit.objects.create(
            code='CLIN',
            name='Clinical Only',
            unit_type=department.unit_type,
            parent=department.parent,
            staffing_mode='clinical_only'
        )
        serializer = UnitMemberAssignmentSerializer(data={
            'unit': str(clinical_unit.id),
            'staff': str(ops_staff.id),
            'assignment_type': str(assignment_types['single'].id),
            'is_primary': True
        })
        assert not serializer.is_valid()
        assert 'unit' in serializer.errors

    def test_member_assignment_rejects_practitioner(self, facility, unit_types, practitioner, assignment_types):
        ops_unit = ClinicalUnit.objects.create(
            code='OPS',
            name='Operations',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='ops_only'
        )
        serializer = UnitMemberAssignmentSerializer(data={
            'unit': str(ops_unit.id),
            'staff': str(practitioner.staff.id),
            'assignment_type': str(assignment_types['single'].id),
            'is_primary': True
        })
        assert not serializer.is_valid()
        assert 'staff' in serializer.errors

    def test_member_assignment_allows_ops_staff(self, facility, unit_types, ops_staff, assignment_types):
        ops_unit = ClinicalUnit.objects.create(
            code='OPS2',
            name='Operations',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='ops_only'
        )
        serializer = UnitMemberAssignmentSerializer(data={
            'unit': str(ops_unit.id),
            'staff': str(ops_staff.id),
            'assignment_type': str(assignment_types['single'].id),
            'is_primary': False
        })
        assert serializer.is_valid(), serializer.errors

    def test_member_assignment_allows_mixed_unit(self, facility, unit_types, ops_staff, assignment_types):
        mixed_unit = ClinicalUnit.objects.create(
            code='ADM',
            name='Administration',
            unit_type=unit_types['department'],
            parent=facility,
            staffing_mode='mixed'
        )
        serializer = UnitMemberAssignmentSerializer(data={
            'unit': str(mixed_unit.id),
            'staff': str(ops_staff.id),
            'assignment_type': str(assignment_types['single'].id),
            'is_primary': False
        })
        assert serializer.is_valid(), serializer.errors

    def test_validate_not_both_covering_entities(self, department, team, practitioner):
        """Test that validation rejects both practitioner and unit."""
        now = timezone.now()
        serializer = CrossCoverageScheduleSerializer(data={
            'covered_unit': str(department.id),
            'covering_practitioner': str(practitioner.id),
            'covering_unit': str(team.id),
            'start_datetime': now.isoformat(),
            'end_datetime': (now + timedelta(hours=8)).isoformat(),
            'coverage_type': 'on_call',
        })
        assert not serializer.is_valid()

    def test_valid_with_practitioner(self, department, practitioner):
        """Test valid serializer with covering practitioner."""
        now = timezone.now()
        serializer = CrossCoverageScheduleSerializer(data={
            'covered_unit': str(department.id),
            'covering_practitioner': str(practitioner.id),
            'start_datetime': now.isoformat(),
            'end_datetime': (now + timedelta(hours=8)).isoformat(),
            'coverage_type': 'on_call',
        })
        assert serializer.is_valid(), serializer.errors

    def test_valid_with_covering_unit(self, department, team):
        """Test valid serializer with covering unit."""
        now = timezone.now()
        serializer = CrossCoverageScheduleSerializer(data={
            'covered_unit': str(department.id),
            'covering_unit': str(team.id),
            'start_datetime': now.isoformat(),
            'end_datetime': (now + timedelta(hours=8)).isoformat(),
            'coverage_type': 'backup',
        })
        assert serializer.is_valid(), serializer.errors
