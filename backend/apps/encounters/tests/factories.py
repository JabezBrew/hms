"""
Factories for creating test Encounter instances.
"""
import factory
from factory.django import DjangoModelFactory
from django.utils import timezone

from apps.encounters.models import Encounter, EncounterCareTeam
from apps.users.tests.factories import UserFactory, PatientProfileFactory, PractitionerProfileFactory


class EncounterFactory(DjangoModelFactory):
    """Factory for creating Encounter instances."""

    class Meta:
        model = Encounter

    patient = factory.SubFactory(PatientProfileFactory)
    facility = factory.SelfAttribute('patient.facility')
    practitioner = factory.SubFactory(PractitionerProfileFactory)
    encounter_type = 'outpatient'
    status = 'in-progress'
    start_time = factory.LazyFunction(timezone.now)
    reason = factory.Faker('sentence')
    service_type = 'General Practice'
    location = factory.Faker('word')
    fhir_synced = False
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    primary_team = None
    admitted_by_team = factory.LazyAttribute(lambda o: o.primary_team)


class EncounterCareTeamFactory(DjangoModelFactory):
    """Factory for creating EncounterCareTeam instances."""

    class Meta:
        model = EncounterCareTeam

    encounter = factory.SubFactory(EncounterFactory)
    team = factory.LazyAttribute(lambda o: __import__(
        'apps.organization.tests.factories', fromlist=['ClinicalUnitFactory']
    ).ClinicalUnitFactory())
    role = 'consulting'
    status = 'active'
    is_active = True
