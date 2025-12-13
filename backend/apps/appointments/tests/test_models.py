"""
Tests for appointments app models.

Tests cover:
- AppointmentType model (creation, validation, string representation)
- RecurringSchedule model (creation, days_of_week, breaks)
- BlockedTime model (creation, all-day blocking)
- RecurringAppointmentRule model (recurrence patterns)
- ScheduleFHIRMapping model
- AppointmentFHIRMapping model
"""
import pytest
from datetime import time, date, timedelta

from apps.appointments.models import (
    AppointmentType, AppointmentFHIRMapping, RecurringAppointmentRule,
    ScheduleFHIRMapping, RecurringSchedule, BlockedTime
)
from .factories import (
    AppointmentTypeFactory, AppointmentFHIRMappingFactory,
    RecurringAppointmentRuleFactory, ScheduleFHIRMappingFactory,
    RecurringScheduleFactory, BlockedTimeFactory
)
from apps.users.tests.factories import PractitionerProfileFactory


@pytest.mark.tier1
class TestAppointmentTypeModel:
    """Tests for the AppointmentType model."""

    def test_create_appointment_type(self, db):
        """Test basic appointment type creation."""
        apt_type = AppointmentTypeFactory(
            name='Consultation',
            duration_minutes=30,
            category='in_person'
        )
        assert apt_type.name == 'Consultation'
        assert apt_type.duration_minutes == 30
        assert apt_type.category == 'in_person'
        assert apt_type.is_active is True

    def test_appointment_type_str(self, db):
        """Test appointment type string representation."""
        apt_type = AppointmentTypeFactory(name='Follow-up Visit')
        assert str(apt_type) == 'Follow-up Visit'

    def test_appointment_type_categories(self, db):
        """Test all appointment type categories."""
        categories = ['in_person', 'telemedicine', 'walk_in', 'recurring']
        for category in categories:
            apt_type = AppointmentTypeFactory(category=category)
            assert apt_type.category == category

    def test_appointment_type_color(self, db):
        """Test appointment type color field."""
        apt_type = AppointmentTypeFactory(color='#FF5733')
        assert apt_type.color == '#FF5733'


@pytest.mark.tier1
class TestRecurringScheduleModel:
    """Tests for the RecurringSchedule model."""

    def test_create_recurring_schedule(self, db):
        """Test basic recurring schedule creation."""
        practitioner = PractitionerProfileFactory()
        schedule = RecurringScheduleFactory(
            name='Morning Clinic',
            practitioner=practitioner,
            days_of_week=[0, 1, 2, 3, 4],  # Mon-Fri
            start_time=time(9, 0),
            end_time=time(12, 0),
            slot_duration=30
        )
        assert schedule.name == 'Morning Clinic'
        assert schedule.practitioner == practitioner
        assert schedule.days_of_week == [0, 1, 2, 3, 4]
        assert schedule.slot_duration == 30

    def test_recurring_schedule_str(self, db):
        """Test recurring schedule string representation."""
        schedule = RecurringScheduleFactory(name='Test Schedule')
        assert 'Test Schedule' in str(schedule)

    def test_recurring_schedule_with_breaks(self, db):
        """Test recurring schedule with break times."""
        schedule = RecurringScheduleFactory(
            start_time=time(9, 0),
            end_time=time(17, 0),
            breaks=[
                {'start': '12:00', 'end': '13:00'},
                {'start': '15:30', 'end': '15:45'}
            ]
        )
        assert len(schedule.breaks) == 2
        assert schedule.breaks[0]['start'] == '12:00'
        assert schedule.breaks[0]['end'] == '13:00'

    def test_recurring_schedule_all_days(self, db):
        """Test recurring schedule for all days of the week."""
        schedule = RecurringScheduleFactory(days_of_week=[0, 1, 2, 3, 4, 5, 6])
        assert len(schedule.days_of_week) == 7

    def test_recurring_schedule_active_dates(self, db):
        """Test recurring schedule with active date range."""
        start = date.today()
        end = date.today() + timedelta(days=90)
        schedule = RecurringScheduleFactory(
            active_from=start,
            active_to=end
        )
        assert schedule.active_from == start
        assert schedule.active_to == end

    def test_recurring_schedule_inactive(self, db):
        """Test inactive recurring schedule."""
        schedule = RecurringScheduleFactory(is_active=False)
        assert schedule.is_active is False


@pytest.mark.tier1
class TestBlockedTimeModel:
    """Tests for the BlockedTime model."""

    def test_create_blocked_time(self, db):
        """Test basic blocked time creation."""
        practitioner = PractitionerProfileFactory()
        blocked = BlockedTimeFactory(
            practitioner=practitioner,
            date=date.today() + timedelta(days=7),
            start_time=time(10, 0),
            end_time=time(12, 0),
            reason='Meeting'
        )
        assert blocked.practitioner == practitioner
        assert blocked.reason == 'Meeting'
        assert blocked.is_all_day is False

    def test_blocked_time_str_partial(self, db):
        """Test blocked time string representation for partial day."""
        blocked = BlockedTimeFactory(
            date=date(2024, 6, 15),
            start_time=time(10, 0),
            end_time=time(12, 0),
            reason='Training',
            is_all_day=False
        )
        string_repr = str(blocked)
        assert '2024-06-15' in string_repr
        assert 'Training' in string_repr

    def test_blocked_time_str_all_day(self, db):
        """Test blocked time string representation for all day."""
        blocked = BlockedTimeFactory(
            date=date(2024, 6, 15),
            reason='Vacation',
            is_all_day=True
        )
        string_repr = str(blocked)
        assert 'All Day' in string_repr
        assert 'Vacation' in string_repr

    def test_blocked_time_all_day(self, db):
        """Test all-day blocked time."""
        blocked = BlockedTimeFactory(is_all_day=True)
        assert blocked.is_all_day is True


@pytest.mark.tier2
class TestRecurringAppointmentRuleModel:
    """Tests for the RecurringAppointmentRule model."""

    def test_create_rule_weekly(self, db):
        """Test weekly recurring appointment rule."""
        rule = RecurringAppointmentRuleFactory(
            frequency='weekly',
            interval=1,
            monday=True,
            tuesday=False,
            wednesday=True,
            thursday=False,
            friday=True,
            saturday=False,
            sunday=False
        )
        assert rule.frequency == 'weekly'
        assert rule.monday is True
        assert rule.tuesday is False
        assert rule.wednesday is True
        assert rule.friday is True

    def test_create_rule_monthly(self, db):
        """Test monthly recurring appointment rule."""
        rule = RecurringAppointmentRuleFactory(
            frequency='monthly',
            interval=1,
            day_of_month=15
        )
        assert rule.frequency == 'monthly'
        assert rule.day_of_month == 15

    def test_create_rule_daily(self, db):
        """Test daily recurring appointment rule."""
        rule = RecurringAppointmentRuleFactory(
            frequency='daily',
            interval=2  # Every 2 days
        )
        assert rule.frequency == 'daily'
        assert rule.interval == 2

    def test_rule_str(self, db):
        """Test recurring rule string representation."""
        apt_type = AppointmentTypeFactory(name='Follow-up')
        rule = RecurringAppointmentRuleFactory(
            appointment_type=apt_type,
            frequency='weekly'
        )
        assert 'Weekly' in str(rule)
        assert 'Follow-up' in str(rule)

    def test_rule_with_end_date(self, db):
        """Test rule with specific end date."""
        start = date.today()
        end = date.today() + timedelta(days=180)
        rule = RecurringAppointmentRuleFactory(
            start_date=start,
            end_date=end
        )
        assert rule.start_date == start
        assert rule.end_date == end

    def test_rule_with_max_occurrences(self, db):
        """Test rule with max occurrences limit."""
        rule = RecurringAppointmentRuleFactory(
            end_date=None,
            max_occurrences=10
        )
        assert rule.max_occurrences == 10
        assert rule.end_date is None


@pytest.mark.tier2
class TestScheduleFHIRMappingModel:
    """Tests for the ScheduleFHIRMapping model."""

    def test_create_mapping(self, db):
        """Test basic FHIR mapping creation."""
        practitioner = PractitionerProfileFactory()
        mapping = ScheduleFHIRMappingFactory(
            fhir_schedule_id='schedule-123',
            practitioner=practitioner,
            slots_count=50
        )
        assert mapping.fhir_schedule_id == 'schedule-123'
        assert mapping.practitioner == practitioner
        assert mapping.slots_count == 50
        assert mapping.status == 'active'

    def test_mapping_str(self, db):
        """Test mapping string representation."""
        mapping = ScheduleFHIRMappingFactory(fhir_schedule_id='schedule-456')
        assert 'schedule-456' in str(mapping)


@pytest.mark.tier2
class TestAppointmentFHIRMappingModel:
    """Tests for the AppointmentFHIRMapping model."""

    def test_create_mapping(self, db):
        """Test basic appointment FHIR mapping creation."""
        apt_type = AppointmentTypeFactory(name='Checkup')
        mapping = AppointmentFHIRMappingFactory(
            appointment_type=apt_type,
            fhir_appointment_id='apt-123',
            fhir_slot_id='slot-456'
        )
        assert mapping.appointment_type == apt_type
        assert mapping.fhir_appointment_id == 'apt-123'
        assert mapping.fhir_slot_id == 'slot-456'

    def test_mapping_str(self, db):
        """Test mapping string representation."""
        apt_type = AppointmentTypeFactory(name='Surgery')
        mapping = AppointmentFHIRMappingFactory(appointment_type=apt_type)
        assert 'Surgery' in str(mapping)
