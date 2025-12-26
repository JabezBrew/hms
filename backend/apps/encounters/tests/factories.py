"""
Factories for creating test Encounter instances.
"""
import factory
from factory.django import DjangoModelFactory
from django.utils import timezone

from apps.encounters.models import Encounter
from apps.users.tests.factories import UserFactory, PatientProfileFactory, PractitionerProfileFactory


class EncounterFactory(DjangoModelFactory):
    """Factory for creating Encounter instances."""

    class Meta:
        model = Encounter

    patient = factory.SubFactory(PatientProfileFactory)
    practitioner = factory.SubFactory(PractitionerProfileFactory)
    encounter_type = 'outpatient'
    status = 'in-progress'
    start_time = factory.LazyFunction(timezone.now)
    reason = factory.Faker('sentence')
    service_type = 'General Practice'
    location = factory.Faker('word')
    fhir_synced = False
    created_by = factory.SubFactory(UserFactory, user_type='admin')
