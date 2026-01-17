"""
Factory Boy factories for the referrals app.

Provides factories for:
- Referral
"""
import factory
from factory.django import DjangoModelFactory
from django.utils import timezone

from apps.referrals.models import Referral, ReferralNotification
from apps.users.tests.factories import (
    PatientProfileFactory, PractitionerProfileFactory, DoctorUserFactory
)
from apps.encounters.tests.factories import EncounterFactory


class ReferralFactory(DjangoModelFactory):
    """Factory for creating Referral instances."""

    class Meta:
        model = Referral

    patient = factory.SubFactory(PatientProfileFactory)
    encounter = factory.SubFactory(
        EncounterFactory,
        patient=factory.SelfAttribute('..patient')
    )
    facility = factory.SelfAttribute('patient.facility')
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


class ReferralNotificationFactory(DjangoModelFactory):
    """Factory for creating ReferralNotification instances."""

    class Meta:
        model = ReferralNotification

    referral = factory.SubFactory(ReferralFactory)
    facility = factory.SelfAttribute('referral.facility')
    recipient = factory.SubFactory(
        DoctorUserFactory,
        primary_facility=factory.SelfAttribute('..facility')
    )
    actor = factory.SubFactory(
        DoctorUserFactory,
        primary_facility=factory.SelfAttribute('..facility')
    )
    event = 'submitted'
    status = factory.LazyAttribute(lambda o: o.referral.status)
    urgency = factory.LazyAttribute(lambda o: o.referral.urgency)
    is_read = False

    @factory.post_generation
    def sync_facility(self, create, extracted, **kwargs):
        if not create:
            return
        if self.referral.facility_id != self.facility_id:
            self.referral.facility = self.facility
            self.referral.save(update_fields=['facility'])
