"""
Factory Boy factories for users app models.

Provides test data factories for:
- User (all user types)
- Staff
- PractitionerProfile
- PatientProfile
- PasswordResetToken
- UserPatientList
"""
import factory
from factory import fuzzy
from datetime import date, timedelta
from django.contrib.auth import get_user_model

from apps.users.models import (
    Staff, PractitionerProfile, PatientProfile,
    PasswordResetToken, UserPatientList
)
from apps.core.tests.factories import DefaultFacilityFactory

User = get_user_model()


class UserFactory(factory.django.DjangoModelFactory):
    """Factory for creating User instances."""

    class Meta:
        model = User
        skip_postgeneration_save = True

    email = factory.LazyAttribute(lambda o: f"{o.username}@test.com")
    username = factory.Sequence(lambda n: f"user_{n}")
    first_name = factory.Faker('first_name')
    last_name = factory.Faker('last_name')
    phone_number = factory.Faker('numerify', text='###-###-####')
    user_type = 'patient'
    is_active = True
    is_staff = False
    is_superuser = False
    primary_facility = factory.SubFactory(DefaultFacilityFactory)

    @classmethod
    def _create(cls, model_class, *args, **kwargs):
        """Override create to use create_user manager method."""
        password = kwargs.pop('password', 'testpass123')
        user = model_class.objects.create_user(*args, **kwargs)
        user.set_password(password)
        user.save()
        return user


class AdminUserFactory(UserFactory):
    """Factory for creating admin users."""

    user_type = 'admin'
    is_staff = True
    is_superuser = True


class DoctorUserFactory(UserFactory):
    """Factory for creating doctor users."""

    user_type = 'doctor'
    first_name = factory.Faker('first_name')
    last_name = factory.LazyAttribute(lambda o: f"Dr_{o.first_name}")


class NurseUserFactory(UserFactory):
    """Factory for creating nurse users."""

    user_type = 'nurse'


class ReceptionistUserFactory(UserFactory):
    """Factory for creating receptionist users."""

    user_type = 'receptionist'


class LabTechnicianUserFactory(UserFactory):
    """Factory for creating lab technician users."""

    user_type = 'lab_technician'


class PharmacistUserFactory(UserFactory):
    """Factory for creating pharmacist users."""

    user_type = 'pharmacist'


class PatientUserFactory(UserFactory):
    """Factory for creating patient users."""

    user_type = 'patient'


class StaffFactory(factory.django.DjangoModelFactory):
    """Factory for creating Staff instances."""

    class Meta:
        model = Staff

    user = factory.SubFactory(
        DoctorUserFactory,
        primary_facility=factory.SelfAttribute('..primary_facility')
    )
    employee_id = factory.Sequence(lambda n: f"EMP{n:05d}")
    department = factory.Faker('random_element', elements=[
        'Cardiology', 'Neurology', 'Orthopedics', 'Pediatrics',
        'Emergency', 'Internal Medicine', 'Surgery', 'Radiology'
    ])
    position = factory.Faker('random_element', elements=[
        'Senior Doctor', 'Junior Doctor', 'Head Nurse', 'Staff Nurse',
        'Resident', 'Consultant', 'Intern'
    ])
    hire_date = factory.LazyFunction(lambda: date.today() - timedelta(days=365))
    primary_facility = factory.SubFactory(DefaultFacilityFactory)
    created_by = factory.LazyAttribute(lambda o: o.user)
    updated_by = factory.LazyAttribute(lambda o: o.user)


class PractitionerProfileFactory(factory.django.DjangoModelFactory):
    """Factory for creating PractitionerProfile instances."""

    class Meta:
        model = PractitionerProfile

    staff = factory.SubFactory(StaffFactory)
    license_number = factory.Sequence(lambda n: f"LIC{n:08d}")
    specialization = factory.Faker('random_element', elements=[
        'Internal Medicine', 'Cardiology', 'Neurology', 'Orthopedics',
        'Pediatrics', 'General Surgery', 'Emergency Medicine', 'Radiology',
        'Nursing', 'Critical Care Nursing'
    ])
    qualification = factory.Faker('random_element', elements=[
        'MD', 'MBBS', 'MD, MBBS', 'RN', 'RN, BSN', 'DO', 'MD, PhD'
    ])
    created_by = factory.LazyAttribute(lambda o: o.staff.user)
    updated_by = factory.LazyAttribute(lambda o: o.staff.user)


class PatientProfileFactory(factory.django.DjangoModelFactory):
    """Factory for creating PatientProfile instances."""

    class Meta:
        model = PatientProfile

    facility = factory.SubFactory(DefaultFacilityFactory)
    user = factory.SubFactory(
        PatientUserFactory,
        primary_facility=factory.SelfAttribute('..facility')
    )
    medical_record_number = factory.Sequence(lambda n: f"MRN{n:08d}")
    nhis_id = factory.LazyFunction(lambda: None)
    blood_group = factory.Faker('random_element', elements=[
        'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'
    ])
    allergies = factory.Faker('random_element', elements=[
        None, 'Penicillin', 'Sulfa', 'Penicillin, Sulfa',
        'Latex', 'Aspirin', 'None known'
    ])
    emergency_contact_name = factory.Faker('name')
    emergency_contact_phone = factory.Faker('numerify', text='###-###-####')
    emergency_contact_relationship = factory.Faker('random_element', elements=[
        'Spouse', 'Parent', 'Child', 'Sibling', 'Friend', 'Other'
    ])

    @factory.lazy_attribute
    def created_by(self):
        """Get or create an admin user for created_by field."""
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin

    @factory.lazy_attribute
    def updated_by(self):
        """Get or create an admin user for updated_by field."""
        return self.created_by


class PasswordResetTokenFactory(factory.django.DjangoModelFactory):
    """Factory for creating PasswordResetToken instances."""

    class Meta:
        model = PasswordResetToken

    user = factory.SubFactory(UserFactory)
    token_hash = factory.LazyFunction(
        lambda: PasswordResetToken.hash_token(PasswordResetToken.generate_token())
    )
    expires_at = factory.LazyFunction(
        lambda: factory.fuzzy.FuzzyDateTime(
            start_dt=factory.django.get_now(),
            end_dt=factory.django.get_now() + timedelta(hours=1)
        ).fuzz()
    )
    reset_type = 'self_service'
    is_used = False


class UserPatientListFactory(factory.django.DjangoModelFactory):
    """Factory for creating UserPatientList instances."""

    class Meta:
        model = UserPatientList

    user = factory.SubFactory(DoctorUserFactory)
    patient = factory.SubFactory(
        PatientProfileFactory,
        facility=factory.SelfAttribute('..user.primary_facility')
    )
    notes = factory.Faker('sentence')
    is_pinned = factory.Faker('boolean', chance_of_getting_true=30)


# =============================================================================
# Batch Creation Helpers
# =============================================================================

def create_users_of_all_types():
    """Create one user of each type for testing RBAC."""
    return {
        'admin': AdminUserFactory(),
        'doctor': DoctorUserFactory(),
        'nurse': NurseUserFactory(),
        'receptionist': ReceptionistUserFactory(),
        'lab_technician': LabTechnicianUserFactory(),
        'pharmacist': PharmacistUserFactory(),
        'patient': PatientUserFactory(),
    }


def create_multiple_patients(count=5):
    """Create multiple patient profiles for list testing."""
    return [PatientProfileFactory() for _ in range(count)]


def create_doctor_with_practitioner_profile():
    """Create a doctor user with staff and practitioner profile."""
    doctor = DoctorUserFactory()
    staff = StaffFactory(user=doctor)
    practitioner = PractitionerProfileFactory(staff=staff)
    return doctor, staff, practitioner


def create_nurse_with_practitioner_profile():
    """Create a nurse user with staff and practitioner profile."""
    nurse = NurseUserFactory()
    staff = StaffFactory(user=nurse, position='Staff Nurse', department='Nursing')
    practitioner = PractitionerProfileFactory(
        staff=staff,
        specialization='Nursing',
        qualification='RN, BSN'
    )
    return nurse, staff, practitioner
