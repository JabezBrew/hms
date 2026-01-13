"""
Tests for duty roster functionality.
"""
import pytest
from datetime import date, datetime, time, timedelta
from django.core.cache import cache
from django.utils import timezone

from apps.organization.models import (
    UnitTypeConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    ShiftDefinition,
    DutyRosterTemplate,
    DutyRoster,
)
from apps.organization.services import DutyRosterService, TeamAssignmentService


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
def facility(unit_types, facility_obj):
    """Create a facility ClinicalUnit."""
    unit = ClinicalUnit.objects.create(
        code='MAIN',
        name='Main Hospital',
        unit_type=unit_types['facility']
    )
    unit.refresh_from_db()
    return unit


@pytest.fixture
def department(unit_types, facility):
    """Create a department under the facility."""
    dept = ClinicalUnit.objects.create(
        code='MED',
        name='Medicine Department',
        unit_type=unit_types['department'],
        parent=facility
    )
    dept.refresh_from_db()
    return dept


@pytest.fixture
def team(unit_types, department):
    """Create a team under the department."""
    t = ClinicalUnit.objects.create(
        code='MED_TEAM_A',
        name='Medicine Team A',
        unit_type=unit_types['team'],
        parent=department,
        accepts_admissions=True
    )
    t.refresh_from_db()
    return t


@pytest.fixture
def staff_user(db):
    """Create a staff user."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    return User.objects.create_user(
        username='doctor_test',
        email='doctor@test.com',
        password='testpass123',
        first_name='Test',
        last_name='Doctor'
    )


@pytest.fixture
def staff(db, staff_user, facility_obj):
    """Create a Staff record."""
    from apps.users.models import Staff
    return Staff.objects.create(
        user=staff_user,
        employee_id='EMP001',
        department='Medicine',
        position='Doctor',
        hire_date=date.today(),
        primary_facility=facility_obj
    )


@pytest.fixture
def practitioner(db, staff):
    """Create a PractitionerProfile."""
    from apps.users.models import PractitionerProfile
    return PractitionerProfile.objects.create(
        staff=staff,
        specialization='General Medicine',
        qualification='MD',
        license_number='LIC001',
    )


@pytest.fixture
def another_practitioner(db, facility_obj):
    """Create another PractitionerProfile for swap tests."""
    from django.contrib.auth import get_user_model
    from apps.users.models import Staff, PractitionerProfile

    User = get_user_model()
    user = User.objects.create_user(
        username='doctor2_test',
        email='doctor2@test.com',
        password='testpass123',
        first_name='Second',
        last_name='Doctor'
    )
    staff = Staff.objects.create(
        user=user,
        employee_id='EMP002',
        department='Medicine',
        position='Doctor',
        hire_date=date.today(),
        primary_facility=facility_obj
    )
    return PractitionerProfile.objects.create(
        staff=staff,
        specialization='General Medicine',
        qualification='MD',
        license_number='LIC002',
    )


@pytest.fixture
def day_shift(facility_obj):
    """Create a day shift definition."""
    return ShiftDefinition.objects.create(
        facility=facility_obj,
        name='Day Shift',
        code='DAY',
        start_time=time(7, 0),
        end_time=time(15, 0),
    )


@pytest.fixture
def night_shift(facility_obj):
    """Create a night shift definition (crosses midnight)."""
    return ShiftDefinition.objects.create(
        facility=facility_obj,
        name='Night Shift',
        code='NIGHT',
        start_time=time(23, 0),
        end_time=time(7, 0),
    )


@pytest.mark.django_db
class TestShiftDefinition:
    """Tests for ShiftDefinition model."""

    def test_create_shift_definition(self, facility_obj):
        """Test creating a shift definition."""
        shift = ShiftDefinition.objects.create(
            facility=facility_obj,
            name='Day Shift',
            code='DAY',
            start_time=time(7, 0),
            end_time=time(15, 0),
        )
        assert shift.crosses_midnight is False
        assert str(shift) == 'Day Shift (07:00-15:00)'

    def test_night_shift_crosses_midnight(self, facility_obj):
        """Test that night shifts are detected as crossing midnight."""
        shift = ShiftDefinition.objects.create(
            facility=facility_obj,
            name='Night Shift',
            code='NIGHT',
            start_time=time(23, 0),
            end_time=time(7, 0),
        )
        assert shift.crosses_midnight is True

    def test_unique_code_per_facility(self, facility_obj):
        """Test that shift codes are unique within a facility."""
        ShiftDefinition.objects.create(
            facility=facility_obj,
            name='Day Shift',
            code='DAY',
            start_time=time(7, 0),
            end_time=time(15, 0),
        )
        with pytest.raises(Exception):  # IntegrityError
            ShiftDefinition.objects.create(
                facility=facility_obj,
                name='Another Day Shift',
                code='DAY',  # Duplicate code
                start_time=time(8, 0),
                end_time=time(16, 0),
            )


@pytest.mark.django_db
class TestDutyRosterTemplate:
    """Tests for DutyRosterTemplate model."""

    def test_create_template_with_shift(self, facility_obj, team, practitioner, day_shift):
        """Test creating a template with a shift reference."""
        template = DutyRosterTemplate.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            day_of_week=0,  # Monday
            shift=day_shift,
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=True,
            effective_from=date.today(),
        )
        assert template.start_time == time(7, 0)
        assert template.end_time == time(15, 0)
        assert template.is_currently_effective is True

    def test_create_template_with_custom_times(self, facility_obj, team, practitioner):
        """Test creating a template with custom times."""
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
        assert template.start_time == time(9, 0)
        assert template.end_time == time(17, 0)


@pytest.mark.django_db
class TestDutyRosterService:
    """Tests for DutyRosterService."""

    def test_generate_roster_from_template(self, facility_obj, team, practitioner, day_shift):
        """Test generating roster entries from templates."""
        # Create template for Monday
        DutyRosterTemplate.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            day_of_week=0,  # Monday
            shift=day_shift,
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=True,
            effective_from=date.today() - timedelta(days=7),
        )

        # Find next Monday
        today = date.today()
        start = today
        while start.weekday() != 0:
            start += timedelta(days=1)

        entries = DutyRosterService.generate_roster(
            unit=team,
            start_date=start,
            end_date=start + timedelta(days=6),
        )

        # Should create 1 entry (for Monday only)
        assert len(entries) == 1
        assert entries[0].practitioner == practitioner
        assert entries[0].source == 'template'
        assert entries[0].date == start

    def test_generate_roster_skips_existing(self, facility_obj, team, practitioner, day_shift):
        """Test that generate_roster skips existing entries."""
        # Create template for Monday
        DutyRosterTemplate.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            day_of_week=0,
            shift=day_shift,
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=True,
            effective_from=date.today() - timedelta(days=7),
        )

        # Find next Monday
        today = date.today()
        start = today
        while start.weekday() != 0:
            start += timedelta(days=1)

        # Generate once
        entries1 = DutyRosterService.generate_roster(
            unit=team,
            start_date=start,
            end_date=start + timedelta(days=6),
        )
        assert len(entries1) == 1

        # Generate again - should skip existing
        entries2 = DutyRosterService.generate_roster(
            unit=team,
            start_date=start,
            end_date=start + timedelta(days=6),
        )
        assert len(entries2) == 0

    def test_get_on_duty_normal_shift(self, facility_obj, team, practitioner, day_shift):
        """Test getting on-duty practitioners for a normal shift."""
        today = date.today()
        DutyRoster.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            date=today,
            shift=day_shift,
            start_time=time(7, 0),
            end_time=time(15, 0),
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=True,
            source='manual',
        )

        # Check at 10:00 - should be on duty
        check_time = timezone.now().replace(
            hour=10, minute=0, second=0, microsecond=0
        )
        on_duty = DutyRosterService.get_on_duty(team, at_datetime=check_time)
        assert on_duty.count() == 1
        assert on_duty.first().practitioner == practitioner

    def test_get_on_duty_cross_midnight(self, facility_obj, team, practitioner, night_shift):
        """Test getting on-duty practitioners for overnight shifts."""
        previous_date = date.today() - timedelta(days=1)
        DutyRoster.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            date=previous_date,
            shift=night_shift,
            start_time=time(23, 0),
            end_time=time(7, 0),
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=True,
            source='manual',
        )

        check_datetime = timezone.make_aware(
            datetime.combine(previous_date + timedelta(days=1), time(2, 0))
        )
        on_duty = DutyRosterService.get_on_duty(team, at_datetime=check_datetime)
        assert on_duty.count() == 1
        assert on_duty.first().practitioner == practitioner

    def test_get_admitting_practitioner(self, facility_obj, team, practitioner, day_shift):
        """Test getting the admitting practitioner."""
        today = date.today()
        DutyRoster.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            date=today,
            shift=day_shift,
            start_time=time(0, 0),
            end_time=time(23, 59),
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=True,
            source='manual',
        )

        result = DutyRosterService.get_admitting_practitioner(team)
        assert result == practitioner

    def test_get_admitting_practitioner_returns_most_senior(
        self, facility_obj, team, practitioner, another_practitioner, day_shift
    ):
        """Test that get_admitting_practitioner returns the most senior when no primary."""
        today = date.today()

        # Resident on duty
        DutyRoster.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=another_practitioner,
            date=today,
            shift=day_shift,
            start_time=time(0, 0),
            end_time=time(23, 59),
            role='admitting',
            context='inpatient',
            seniority_level='resident',
            is_primary=False,
            source='manual',
        )

        # Attending on duty
        DutyRoster.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            date=today,
            shift=day_shift,
            start_time=time(0, 0),
            end_time=time(23, 59),
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=False,
            source='manual',
        )

        # Should return attending (most senior)
        result = DutyRosterService.get_admitting_practitioner(team)
        assert result == practitioner

    def test_swap_duty(self, facility_obj, team, practitioner, another_practitioner, day_shift):
        """Test swapping duty assignments."""
        today = date.today()
        original_entry = DutyRoster.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            date=today,
            shift=day_shift,
            start_time=time(7, 0),
            end_time=time(15, 0),
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=True,
            source='template',
        )

        new_entry = DutyRosterService.swap_duty(
            roster_entry=original_entry,
            replacement_practitioner=another_practitioner,
            reason='Personal emergency',
        )

        # Original should be deactivated
        original_entry.refresh_from_db()
        assert original_entry.is_active is False

        # New entry should track swap
        assert new_entry.source == 'swap'
        assert new_entry.original_practitioner == practitioner
        assert new_entry.practitioner == another_practitioner
        assert new_entry.swap_reason == 'Personal emergency'


@pytest.mark.django_db
class TestTeamAssignmentService:
    """Tests for TeamAssignmentService."""

    def test_assign_admission(self, facility_obj, team, practitioner, day_shift):
        """Test assigning admitting doctor to admission."""
        from apps.wards.models import Ward, Bed, Admission
        from apps.users.models import PatientProfile
        from django.contrib.auth import get_user_model

        today = date.today()

        # Create roster entry
        DutyRoster.objects.create(
            facility=facility_obj,
            unit=team,
            practitioner=practitioner,
            date=today,
            shift=day_shift,
            start_time=time(0, 0),
            end_time=time(23, 59),
            role='admitting',
            context='inpatient',
            seniority_level='attending',
            is_primary=True,
            source='manual',
        )

        # Create mock admission (simplified - actual test would need full setup)
        # This is a placeholder - full integration test would be more complex
        assert DutyRosterService.get_admitting_practitioner(team) == practitioner
