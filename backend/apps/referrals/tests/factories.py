"""
Factory Boy factories for the referrals app.

Provides factories for:
- Referral
"""
import factory
from factory.django import DjangoModelFactory
from django.utils import timezone

from apps.referrals.models import Referral
from apps.users.tests.factories import (
    PatientProfileFactory, PractitionerProfileFactory
)
from apps.encounters.tests.factories import EncounterFactory


class ReferralFactory(DjangoModelFactory):
    """Factory for creating Referral instances."""

    class Meta:
        model = Referral

    patient = factory.SubFactory(PatientProfileFactory)
    encounter = factory.SubFactory(EncounterFactory)
    referring_provider = factory.SubFactory(PractitionerProfileFactory)
    referring_department = factory.Faker('random_element', elements=[
        'Internal Medicine', 'Emergency', 'General Practice', 'Pediatrics'
    ])
    referred_to_department = factory.Faker('random_element', elements=[
        'Cardiology', 'Neurology', 'Orthopedics', 'Gastroenterology',
        'Pulmonology', 'Nephrology', 'Oncology', 'Dermatology'
    ])
    referred_to_specialty = factory.LazyAttribute(lambda o: o.referred_to_department)
    urgency = 'routine'
    status = 'draft'
    reason = factory.Faker('paragraph')
    clinical_summary = factory.Faker('paragraph')
    questions_for_specialist = factory.Faker('sentence')
    referral_type = 'opd'
    fhir_synced = False
