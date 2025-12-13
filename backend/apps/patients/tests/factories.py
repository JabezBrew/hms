"""
Factory Boy factories for patients app models.

Provides test data factories for:
- PatientFHIRMapping
- PatientSearch
- RecentPatient
- PatientRegistrationValidation
- PatientNote
"""
import factory
from factory import fuzzy
from datetime import datetime, timedelta
from django.utils import timezone

from apps.patients.models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from apps.users.tests.factories import (
    UserFactory, AdminUserFactory, PatientProfileFactory
)


class PatientFHIRMappingFactory(factory.django.DjangoModelFactory):
    """Factory for creating PatientFHIRMapping instances."""

    class Meta:
        model = PatientFHIRMapping

    patient_profile = factory.SubFactory(PatientProfileFactory)
    fhir_patient_id = factory.Sequence(lambda n: f"patient-fhir-{n:08d}")
    fhir_resource_version = factory.Sequence(lambda n: str(n))
    is_synced = True

    @factory.lazy_attribute
    def created_by(self):
        """Get or create an admin user for created_by field."""
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin

    @factory.lazy_attribute
    def updated_by(self):
        return self.created_by


class PatientSearchFactory(factory.django.DjangoModelFactory):
    """Factory for creating PatientSearch instances."""

    class Meta:
        model = PatientSearch

    user = factory.SubFactory(UserFactory)
    search_query = factory.Faker('sentence', nb_words=3)


class RecentPatientFactory(factory.django.DjangoModelFactory):
    """Factory for creating RecentPatient instances."""

    class Meta:
        model = RecentPatient

    user = factory.SubFactory(UserFactory)
    patient_profile = factory.SubFactory(PatientProfileFactory)


class PatientRegistrationValidationFactory(factory.django.DjangoModelFactory):
    """Factory for creating PatientRegistrationValidation instances."""

    class Meta:
        model = PatientRegistrationValidation

    field_name = factory.Faker('random_element', elements=[
        'phone_number', 'email', 'nhis_id', 'emergency_contact_phone'
    ])
    validation_regex = factory.LazyAttribute(lambda o:
        r'^\d{10}$' if o.field_name == 'phone_number' else
        r'^[\w\.-]+@[\w\.-]+\.\w+$' if o.field_name == 'email' else
        None
    )
    validation_message = factory.LazyAttribute(lambda o:
        f'{o.field_name.replace("_", " ").title()} is not valid'
    )
    is_required = factory.Faker('boolean', chance_of_getting_true=50)
    is_active = True

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin

    @factory.lazy_attribute
    def updated_by(self):
        return self.created_by


class PatientNoteFactory(factory.django.DjangoModelFactory):
    """Factory for creating PatientNote instances."""

    class Meta:
        model = PatientNote

    patient_profile = factory.SubFactory(PatientProfileFactory)
    note_text = factory.Faker('paragraph')
    is_private = factory.Faker('boolean', chance_of_getting_true=30)

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin

    @factory.lazy_attribute
    def updated_by(self):
        return self.created_by


# =============================================================================
# Batch Creation Helpers
# =============================================================================

def create_patient_with_fhir_mapping():
    """Create a patient with associated FHIR mapping."""
    patient_profile = PatientProfileFactory()
    fhir_mapping = PatientFHIRMappingFactory(patient_profile=patient_profile)
    return patient_profile, fhir_mapping


def create_patient_with_notes(count=3):
    """Create a patient with multiple notes."""
    patient_profile = PatientProfileFactory()
    notes = [PatientNoteFactory(patient_profile=patient_profile) for _ in range(count)]
    return patient_profile, notes


def create_search_history(user, count=5):
    """Create search history for a user."""
    return [PatientSearchFactory(user=user) for _ in range(count)]


def create_recent_patients(user, count=5):
    """Create recent patient entries for a user."""
    return [RecentPatientFactory(user=user) for _ in range(count)]
