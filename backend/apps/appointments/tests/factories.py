"""
Factory Boy factories for the appointments app.

Provides factories for:
- AppointmentType
- AppointmentFHIRMapping
- RecurringAppointmentRule
- ScheduleFHIRMapping
- RecurringSchedule
- BlockedTime
"""
import factory
from factory.django import DjangoModelFactory
from django.utils import timezone
from datetime import time, date, timedelta

from apps.appointments.models import (
    AppointmentType, AppointmentFHIRMapping, RecurringAppointmentRule,
    ScheduleFHIRMapping, RecurringSchedule, BlockedTime
)
from apps.users.tests.factories import UserFactory, PractitionerProfileFactory


class AppointmentTypeFactory(DjangoModelFactory):
    """Factory for creating AppointmentType instances."""

    class Meta:
        model = AppointmentType

    name = factory.Sequence(lambda n: f'Appointment Type {n}')
    description = factory.Faker('paragraph')
    duration_minutes = 30
    color = '#1976D2'
    is_active = True
    category = 'in_person'
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class AppointmentFHIRMappingFactory(DjangoModelFactory):
    """Factory for creating AppointmentFHIRMapping instances."""

    class Meta:
        model = AppointmentFHIRMapping

    appointment_type = factory.SubFactory(AppointmentTypeFactory)
    fhir_appointment_id = factory.Sequence(lambda n: f'fhir-appointment-{n}')
    fhir_schedule_id = factory.Sequence(lambda n: f'fhir-schedule-{n}')
    fhir_slot_id = factory.Sequence(lambda n: f'fhir-slot-{n}')
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class RecurringAppointmentRuleFactory(DjangoModelFactory):
    """Factory for creating RecurringAppointmentRule instances."""

    class Meta:
        model = RecurringAppointmentRule

    appointment_type = factory.SubFactory(AppointmentTypeFactory)
    frequency = 'weekly'
    interval = 1
    start_date = factory.LazyFunction(date.today)
    end_date = factory.LazyAttribute(
        lambda obj: obj.start_date + timedelta(days=90)
    )
    max_occurrences = None
    monday = True
    tuesday = True
    wednesday = True
    thursday = True
    friday = True
    saturday = False
    sunday = False
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class ScheduleFHIRMappingFactory(DjangoModelFactory):
    """Factory for creating ScheduleFHIRMapping instances."""

    class Meta:
        model = ScheduleFHIRMapping

    fhir_schedule_id = factory.Sequence(lambda n: f'schedule-{n}')
    practitioner = factory.SubFactory(PractitionerProfileFactory)
    start_date = factory.LazyFunction(date.today)
    end_date = factory.LazyAttribute(
        lambda obj: obj.start_date + timedelta(days=30)
    )
    status = 'active'
    slots_count = 100
    created_by = factory.SubFactory(UserFactory, user_type='admin')


class RecurringScheduleFactory(DjangoModelFactory):
    """Factory for creating RecurringSchedule instances."""

    class Meta:
        model = RecurringSchedule

    name = factory.Sequence(lambda n: f'Schedule {n}')
    practitioner = factory.SubFactory(PractitionerProfileFactory)
    facility = factory.SelfAttribute('practitioner.staff.primary_facility')
    days_of_week = [0, 1, 2, 3, 4]  # Monday to Friday
    start_time = time(9, 0)
    end_time = time(17, 0)
    slot_duration = 30
    active_from = factory.LazyFunction(date.today)
    active_to = None
    breaks = []
    is_active = True
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class BlockedTimeFactory(DjangoModelFactory):
    """Factory for creating BlockedTime instances."""

    class Meta:
        model = BlockedTime

    practitioner = factory.SubFactory(PractitionerProfileFactory)
    facility = factory.SelfAttribute('practitioner.staff.primary_facility')
    date = factory.LazyFunction(lambda: date.today() + timedelta(days=7))
    start_time = time(12, 0)
    end_time = time(13, 0)
    reason = factory.Faker('sentence')
    is_all_day = False
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)
