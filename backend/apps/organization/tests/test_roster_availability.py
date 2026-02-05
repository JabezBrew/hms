"""
Tests for the RosterAvailabilityService.

This tests the roster-based availability computation that serves as the
single source of truth for practitioner scheduling.
"""
from datetime import date, datetime, time, timedelta

import pytest
from django.utils import timezone

from apps.organization.models import (
    ClinicalUnit,
    DepartmentDutyType,
    RosterEntry,
    StaffUnitAssignment,
    StaffAssignmentTypeConfig,
)
from apps.organization.services import RosterAvailabilityService
from apps.appointments.models import BlockedTime, Appointment, AppointmentType
from apps.users.models import PractitionerProfile, Staff
from apps.core.models import Facility


@pytest.fixture
def seed_organization_data(db):
    """Seed the organization configuration data."""
    from django.core.management import call_command
    call_command('seed_organization')


@pytest.fixture
def unit_types(seed_organization_data):
    """Get all seeded unit types."""
    from apps.organization.models import UnitTypeConfig
    return {ut.code: ut for ut in UnitTypeConfig.objects.all()}


@pytest.fixture
def facility(db):
    """Create or get a facility."""
    facility, _ = Facility.objects.get_or_create(
        code='MAIN',
        defaults={
            'name': 'Main Hospital',
            'facility_type': 'hospital',
            'is_active': True,
        }
    )
    return facility


@pytest.fixture
def facility_unit(unit_types, facility):
    """Create a clinical unit for the facility."""
    return ClinicalUnit.objects.create(
        code=facility.code,
        name='Main Facility Unit',
        unit_type=unit_types['facility'],
    )


@pytest.fixture
def department(unit_types, facility_unit):
    """Create a department under the facility."""
    return ClinicalUnit.objects.create(
        code='MED',
        name='Medicine Department',
        unit_type=unit_types['department'],
        parent=facility_unit,
    )


@pytest.fixture
def team(unit_types, department):
    """Create a team under the department."""
    return ClinicalUnit.objects.create(
        code='MED-TEAM-A',
        name='Medicine Team A',
        unit_type=unit_types['team'],
        parent=department,
    )


@pytest.fixture
def practitioner(db, django_user_model):
    """Create a practitioner profile."""
    user = django_user_model.objects.create_user(
        username='dr_smith',
        email='dr.smith@hospital.com',
        password='testpass123',
        user_type='doctor',
        first_name='John',
        last_name='Smith',
    )
    staff = Staff.objects.create(
        user=user,
        employee_id='DOC001',
        department='Medicine',
        position='Attending Physician',
        hire_date=date(2020, 1, 1)
    )
    return PractitionerProfile.objects.create(
        staff=staff,
        license_number='LIC001',
        specialization='Internal Medicine',
        qualification='MD'
    )


@pytest.fixture
def assignment_type(db):
    """Get or create an assignment type."""
    assignment_type, _ = StaffAssignmentTypeConfig.objects.get_or_create(
        code='single',
        defaults={'name': 'Single Assignment'}
    )
    return assignment_type


@pytest.fixture
def clinic_duty_type(department, facility):
    """Create a clinic-type duty type that generates appointment slots."""
    return DepartmentDutyType.objects.create(
        department=department,
        name='Morning Clinic',
        code='AM-CLINIC',
        category='clinic',
        rotation_type='none',
        applicable_days=[0, 1, 2, 3, 4],  # Monday-Friday
        is_24_hour=False,
        start_time=time(8, 0),
        end_time=time(12, 0),
        slot_duration_minutes=15,
        max_patients_per_slot=1,
        breaks=[{'start': '10:00', 'end': '10:15'}],  # 15-min break
        display_order=1,
        is_active=True,
    )


@pytest.fixture
def ward_duty_type(department):
    """Create a ward-type duty type (non-clinic)."""
    return DepartmentDutyType.objects.create(
        department=department,
        name='Ward Duty',
        code='WARD',
        category='ward',
        rotation_type='sequential',
        applicable_days=[0, 1, 2, 3, 4, 5, 6],
        is_24_hour=False,
        start_time=time(8, 0),
        end_time=time(17, 0),
        display_order=2,
        is_active=True,
    )


@pytest.fixture
def appointment_type(db):
    """Create an appointment type."""
    return AppointmentType.objects.create(
        name='Follow-up',
        duration_minutes=15,
        category='in_person',
    )


@pytest.fixture
def published_clinic_entry(department, clinic_duty_type, practitioner, team, assignment_type):
    """Create a published roster entry for a clinic duty."""
    # First assign practitioner to the team
    StaffUnitAssignment.objects.get_or_create(
        unit=team,
        practitioner=practitioner,
        defaults={
            'assignment_type': assignment_type,
            'is_primary': True,
            'is_active': True,
        }
    )

    # Create a roster entry for tomorrow with direct practitioner assignment
    tomorrow = timezone.now().date() + timedelta(days=1)

    # Make sure the duty type has proper slot settings
    clinic_duty_type.category = 'clinic'
    clinic_duty_type.slot_duration_minutes = 15
    clinic_duty_type.save()

    return RosterEntry.objects.create(
        department=department,
        duty_type=clinic_duty_type,
        date=tomorrow,
        practitioner=practitioner,  # Direct practitioner assignment
        start_time=time(8, 0),
        end_time=time(12, 0),
        source='manual',
        status='published',
    )


@pytest.mark.django_db
class TestRosterAvailabilityService:
    """Tests for the RosterAvailabilityService."""

    def test_compute_slots_for_clinic_duty(self, published_clinic_entry, practitioner):
        """Test that clinic-type roster entries generate appointment slots."""
        tomorrow = timezone.now().date() + timedelta(days=1)
        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = RosterAvailabilityService.compute_available_slots(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Should have slots from 8:00-12:00 with 15-min duration
        # That's 16 slots total, minus 1 slot during break (10:00-10:15)
        # Actually: 8:00-10:00 = 8 slots, 10:15-12:00 = 7 slots = 15 slots
        assert len(slots) > 0

        # All slots should have correct structure
        for slot in slots:
            assert 'id' in slot
            assert slot['id'].startswith('roster-')
            assert slot['resourceType'] == 'Slot'
            assert slot['status'] in ['free', 'busy', 'busy-unavailable']
            assert 'start' in slot
            assert 'end' in slot
            assert slot['source'] == 'roster'
            assert slot['duty_type_name'] == 'Morning Clinic'

    def test_no_slots_for_ward_duty(self, department, ward_duty_type, practitioner):
        """Test that ward-type roster entries don't generate appointment slots."""
        tomorrow = timezone.now().date() + timedelta(days=1)

        # Create ward entry (not clinic)
        RosterEntry.objects.create(
            department=department,
            duty_type=ward_duty_type,
            date=tomorrow,
            practitioner=practitioner,
            start_time=time(8, 0),
            end_time=time(17, 0),
            source='manual',
            status='published',
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = RosterAvailabilityService.compute_available_slots(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Should have no slots because ward duty doesn't generate appointment slots
        assert len(slots) == 0

    def test_slots_respect_breaks(self, published_clinic_entry, practitioner):
        """Test that slots don't overlap with break periods."""
        tomorrow = timezone.now().date() + timedelta(days=1)
        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = RosterAvailabilityService.compute_available_slots(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Check no slots overlap with 10:00-10:15 break
        break_start = datetime.combine(tomorrow, time(10, 0))
        break_end = datetime.combine(tomorrow, time(10, 15))

        for slot in slots:
            slot_start = datetime.fromisoformat(slot['start'])
            slot_end = datetime.fromisoformat(slot['end'])

            # No slot should overlap with break
            assert not (slot_start < break_end and slot_end > break_start), \
                f"Slot {slot_start}-{slot_end} overlaps with break {break_start}-{break_end}"

    def test_slots_marked_busy_for_appointments(
        self, published_clinic_entry, practitioner, facility, appointment_type
    ):
        """Test that slots are marked as busy when appointments exist."""
        tomorrow = timezone.now().date() + timedelta(days=1)

        # Create a patient profile for the appointment using factory
        from apps.users.tests.factories import PatientProfileFactory
        patient = PatientProfileFactory(facility=facility)

        # Use timezone-aware datetimes
        appt_start = timezone.make_aware(datetime.combine(tomorrow, time(9, 0)))
        appt_end = timezone.make_aware(datetime.combine(tomorrow, time(9, 15)))

        Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            appointment_type=appointment_type,
            start_time=appt_start,
            end_time=appt_end,
            status='booked',
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = RosterAvailabilityService.compute_available_slots(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Find the 9:00-9:15 slot
        slot_900 = None
        for slot in slots:
            slot_start = datetime.fromisoformat(slot['start'])
            if slot_start.time() == time(9, 0):
                slot_900 = slot
                break

        assert slot_900 is not None, "Should have a slot starting at 9:00"
        assert slot_900['status'] == 'busy', "9:00 slot should be marked as busy"

    def test_slots_marked_unavailable_for_blocked_time(
        self, published_clinic_entry, practitioner, facility
    ):
        """Test that slots are marked as busy-unavailable when blocked."""
        tomorrow = timezone.now().date() + timedelta(days=1)

        # Block 11:00-12:00
        BlockedTime.objects.create(
            practitioner=practitioner,
            facility=facility,
            date=tomorrow,
            start_time=time(11, 0),
            end_time=time(12, 0),
            reason='Meeting',
            is_all_day=False,
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = RosterAvailabilityService.compute_available_slots(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        # All slots from 11:00-12:00 should be marked as busy-unavailable
        for slot in slots:
            slot_start = datetime.fromisoformat(slot['start'])
            if time(11, 0) <= slot_start.time() < time(12, 0):
                assert slot['status'] == 'busy-unavailable', \
                    f"Slot at {slot_start.time()} should be busy-unavailable"

    def test_draft_entries_not_included(
        self, department, clinic_duty_type, practitioner
    ):
        """Test that draft roster entries don't generate slots."""
        tomorrow = timezone.now().date() + timedelta(days=1)

        # Make sure duty type is clinic
        clinic_duty_type.category = 'clinic'
        clinic_duty_type.slot_duration_minutes = 15
        clinic_duty_type.save()

        # Create a draft entry (not published)
        RosterEntry.objects.create(
            department=department,
            duty_type=clinic_duty_type,
            date=tomorrow,
            practitioner=practitioner,
            start_time=time(8, 0),
            end_time=time(12, 0),
            source='generated',
            status='draft',  # Draft, not published
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = RosterAvailabilityService.compute_available_slots(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Should have no slots because entry is draft
        assert len(slots) == 0

    def test_has_roster_availability_returns_true_when_exists(
        self, published_clinic_entry, practitioner
    ):
        """Test has_roster_availability returns True when roster entries exist."""
        tomorrow = timezone.now().date() + timedelta(days=1)
        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        result = RosterAvailabilityService.has_roster_availability(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        assert result is True

    def test_has_roster_availability_returns_false_when_none(
        self, practitioner
    ):
        """Test has_roster_availability returns False when no entries exist."""
        tomorrow = timezone.now().date() + timedelta(days=1)
        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        result = RosterAvailabilityService.has_roster_availability(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        assert result is False

    def test_team_based_roster_entry(
        self, department, clinic_duty_type, practitioner, team, assignment_type
    ):
        """Test that team-based roster entries resolve to individual practitioners."""
        # Make sure duty type is clinic
        clinic_duty_type.category = 'clinic'
        clinic_duty_type.slot_duration_minutes = 15
        clinic_duty_type.save()

        # Assign practitioner to team
        StaffUnitAssignment.objects.get_or_create(
            unit=team,
            practitioner=practitioner,
            defaults={
                'assignment_type': assignment_type,
                'is_primary': True,
                'is_active': True,
            }
        )

        tomorrow = timezone.now().date() + timedelta(days=1)

        # Create a team-based entry (no practitioner, only team)
        RosterEntry.objects.create(
            department=department,
            duty_type=clinic_duty_type,
            date=tomorrow,
            team=team,  # Team, not practitioner
            start_time=time(8, 0),
            end_time=time(12, 0),
            source='generated',
            status='published',
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = RosterAvailabilityService.compute_available_slots(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Should have slots because practitioner is assigned to the team
        assert len(slots) > 0

    def test_multiple_days_range(
        self, department, clinic_duty_type, practitioner
    ):
        """Test computing slots across multiple days."""
        today = timezone.now().date()

        # Make sure duty type is clinic
        clinic_duty_type.category = 'clinic'
        clinic_duty_type.slot_duration_minutes = 15
        clinic_duty_type.save()

        # Create entries for next 3 days (Mon-Wed or next available weekdays)
        entries_created = 0
        for i in range(1, 8):  # Try up to 7 days to get 3 weekdays
            entry_date = today + timedelta(days=i)
            if entry_date.weekday() < 5:  # Only weekdays
                RosterEntry.objects.create(
                    department=department,
                    duty_type=clinic_duty_type,
                    date=entry_date,
                    practitioner=practitioner,
                    start_time=time(8, 0),
                    end_time=time(12, 0),
                    source='manual',
                    status='published',
                )
                entries_created += 1
                if entries_created >= 3:
                    break

        start_date = (today + timedelta(days=1)).strftime('%Y-%m-%d')
        end_date = (today + timedelta(days=7)).strftime('%Y-%m-%d')

        slots = RosterAvailabilityService.compute_available_slots(
            practitioner_id=practitioner.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Should have slots from multiple days
        dates_with_slots = set()
        for slot in slots:
            slot_start = datetime.fromisoformat(slot['start'])
            dates_with_slots.add(slot_start.date())

        assert len(dates_with_slots) >= 2, "Should have slots from multiple days"


@pytest.mark.django_db
class TestClinicAvailabilityService:
    """Tests for the clinic-wide availability computation (efficient multi-practitioner query)."""

    def test_compute_clinic_slots_for_multiple_practitioners(
        self, department, clinic_duty_type, team, assignment_type, django_user_model
    ):
        """Test that clinic slots are computed for all practitioners in one efficient call."""
        # Make sure duty type is clinic
        clinic_duty_type.category = 'clinic'
        clinic_duty_type.slot_duration_minutes = 15
        clinic_duty_type.save()

        # Create 3 practitioners and assign them to the team
        practitioners = []
        for i in range(3):
            user = django_user_model.objects.create_user(
                username=f'dr_clinic_{i}',
                email=f'dr{i}@clinic.com',
                password='testpass123',
                user_type='doctor',
                first_name=f'Doctor',
                last_name=f'Clinic{i}',
            )
            staff = Staff.objects.create(
                user=user,
                employee_id=f'CLINIC{i:03d}',
                department='Medicine',
                position='Attending',
                hire_date=date(2020, 1, 1)
            )
            prac = PractitionerProfile.objects.create(
                staff=staff,
                license_number=f'LIC{i:03d}',
                specialization='Internal Medicine',
                qualification='MD'
            )
            practitioners.append(prac)

            # Assign to team
            StaffUnitAssignment.objects.create(
                unit=team,
                practitioner=prac,
                assignment_type=assignment_type,
                is_primary=True,
                is_active=True,
            )

        tomorrow = timezone.now().date() + timedelta(days=1)

        # Create a team-based roster entry
        RosterEntry.objects.create(
            department=department,
            duty_type=clinic_duty_type,
            date=tomorrow,
            team=team,
            start_time=time(9, 0),
            end_time=time(12, 0),
            source='generated',
            status='published',
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        # Call the efficient clinic-wide method
        result = RosterAvailabilityService.compute_clinic_available_slots(
            duty_type_id=clinic_duty_type.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Should have all 3 practitioners
        assert len(result['practitioners']) == 3

        # Each practitioner should have slots
        assert len(result['slots_by_practitioner']) == 3

        # All slots combined
        assert len(result['all_slots']) > 0

        # Each practitioner's slots should be independent
        for prac in practitioners:
            prac_slots = result['slots_by_practitioner'].get(str(prac.id), [])
            assert len(prac_slots) > 0
            # All slots should have this practitioner's info
            for slot in prac_slots:
                assert slot['practitioner_id'] == str(prac.id)

    def test_clinic_slots_respects_individual_appointments(
        self, department, clinic_duty_type, team, assignment_type, facility, appointment_type, django_user_model
    ):
        """Test that one doctor's appointment doesn't block another doctor's slot."""
        clinic_duty_type.category = 'clinic'
        clinic_duty_type.slot_duration_minutes = 15
        clinic_duty_type.save()

        # Create 2 practitioners
        practitioners = []
        for i in range(2):
            user = django_user_model.objects.create_user(
                username=f'dr_indep_{i}',
                email=f'dr_indep{i}@clinic.com',
                password='testpass123',
                user_type='doctor',
                first_name=f'Doctor',
                last_name=f'Independent{i}',
            )
            staff = Staff.objects.create(
                user=user,
                employee_id=f'INDEP{i:03d}',
                department='Medicine',
                position='Attending',
                hire_date=date(2020, 1, 1)
            )
            prac = PractitionerProfile.objects.create(
                staff=staff,
                license_number=f'INDEP{i:03d}',
                specialization='Internal Medicine',
                qualification='MD'
            )
            practitioners.append(prac)

            StaffUnitAssignment.objects.create(
                unit=team,
                practitioner=prac,
                assignment_type=assignment_type,
                is_primary=True,
                is_active=True,
            )

        tomorrow = timezone.now().date() + timedelta(days=1)

        RosterEntry.objects.create(
            department=department,
            duty_type=clinic_duty_type,
            date=tomorrow,
            team=team,
            start_time=time(9, 0),
            end_time=time(10, 0),
            source='generated',
            status='published',
        )

        # Book an appointment for practitioner 0 at 9:00
        from apps.users.tests.factories import PatientProfileFactory
        patient = PatientProfileFactory(facility=facility)

        appt_start = timezone.make_aware(datetime.combine(tomorrow, time(9, 0)))
        appt_end = timezone.make_aware(datetime.combine(tomorrow, time(9, 15)))

        Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioners[0],
            appointment_type=appointment_type,
            start_time=appt_start,
            end_time=appt_end,
            status='booked',
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        result = RosterAvailabilityService.compute_clinic_available_slots(
            duty_type_id=clinic_duty_type.id,
            start_date=start_date,
            end_date=end_date,
        )

        # Practitioner 0's 9:00 slot should be busy
        prac0_slots = result['slots_by_practitioner'][str(practitioners[0].id)]
        slot_900_prac0 = next((s for s in prac0_slots if '09:00' in s['start']), None)
        assert slot_900_prac0 is not None
        assert slot_900_prac0['status'] == 'busy'

        # Practitioner 1's 9:00 slot should be FREE (independent)
        prac1_slots = result['slots_by_practitioner'][str(practitioners[1].id)]
        slot_900_prac1 = next((s for s in prac1_slots if '09:00' in s['start']), None)
        assert slot_900_prac1 is not None
        assert slot_900_prac1['status'] == 'free'


@pytest.mark.django_db
class TestAvailabilityServiceIntegration:
    """Integration tests for AvailabilityService with roster fallback."""

    def test_roster_takes_precedence_over_recurring_schedule(
        self, published_clinic_entry, practitioner, facility
    ):
        """Test that roster-based availability takes precedence."""
        from apps.appointments.services import AvailabilityService
        from apps.appointments.models import RecurringSchedule

        tomorrow = timezone.now().date() + timedelta(days=1)
        today = timezone.now().date()

        # Create a recurring schedule (legacy) for same practitioner
        RecurringSchedule.objects.create(
            name='Legacy Schedule',
            facility=facility,
            practitioner=practitioner,
            days_of_week=[tomorrow.weekday()],
            start_time=time(14, 0),  # Different time than roster
            end_time=time(17, 0),
            slot_duration=30,
            active_from=today - timedelta(days=30),
            is_active=True,
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = AvailabilityService.compute_available_slots(
            practitioner_id=str(practitioner.id),
            start_date=start_date,
            end_date=end_date,
        )

        # Slots should be from roster (morning), not recurring schedule (afternoon)
        for slot in slots:
            slot_start = datetime.fromisoformat(slot['start'])
            assert slot_start.time() < time(12, 0), \
                "Slots should be from roster (morning), not recurring schedule"
            assert slot.get('source') == 'roster', \
                "Slots should indicate roster as source"

    def test_fallback_to_recurring_schedule_when_no_roster(
        self, practitioner, facility
    ):
        """Test fallback to RecurringSchedule when no roster entries exist."""
        from apps.appointments.services import AvailabilityService
        from apps.appointments.models import RecurringSchedule

        tomorrow = timezone.now().date() + timedelta(days=1)
        today = timezone.now().date()

        # Create only a recurring schedule (no roster)
        RecurringSchedule.objects.create(
            name='Only Schedule',
            facility=facility,
            practitioner=practitioner,
            days_of_week=[tomorrow.weekday()],
            start_time=time(14, 0),
            end_time=time(16, 0),
            slot_duration=30,
            active_from=today - timedelta(days=30),
            is_active=True,
        )

        start_date = tomorrow.strftime('%Y-%m-%d')
        end_date = tomorrow.strftime('%Y-%m-%d')

        slots = AvailabilityService.compute_available_slots(
            practitioner_id=str(practitioner.id),
            start_date=start_date,
            end_date=end_date,
        )

        # Should get slots from recurring schedule
        assert len(slots) > 0
        for slot in slots:
            # Slots from recurring schedule have different source
            assert slot.get('source') == 'recurring_schedule', \
                "Slots should indicate recurring_schedule as source"
