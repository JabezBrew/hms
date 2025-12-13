"""
Factory Boy factories for the wards app.

Provides factories for:
- Ward
- Bed
- BedAmenity
- WardSection
- Admission
- BedAllocationLog
- WardTransfer
- Encounter
"""
import factory
from factory.django import DjangoModelFactory
from django.utils import timezone
from decimal import Decimal
from datetime import timedelta

from apps.wards.models import (
    Ward, Bed, Admission, BedAllocationLog, Encounter,
    WardTransfer, BedAmenity, WardSection
)
from apps.users.tests.factories import UserFactory, PatientProfileFactory, PractitionerProfileFactory


class WardFactory(DjangoModelFactory):
    """Factory for creating Ward instances."""

    class Meta:
        model = Ward

    name = factory.Sequence(lambda n: f'Test Ward {n}')
    description = factory.Faker('paragraph')
    ward_type = 'general'
    is_active = True
    total_beds = 10
    base_rate_per_night = Decimal('100.00')
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class BedAmenityFactory(DjangoModelFactory):
    """Factory for creating BedAmenity instances."""

    class Meta:
        model = BedAmenity

    code = factory.Sequence(lambda n: f'AMENITY_{n:03d}')
    name = factory.Faker('word')
    description = factory.Faker('sentence')
    category = 'medical'
    additional_rate = Decimal('10.00')
    is_active = True


class WardSectionFactory(DjangoModelFactory):
    """Factory for creating WardSection instances."""

    class Meta:
        model = WardSection

    ward = factory.SubFactory(WardFactory)
    name = factory.Sequence(lambda n: f'Section {n}')
    description = factory.Faker('sentence')
    display_order = factory.Sequence(lambda n: n)
    gender_restriction = 'mixed'
    accommodation_tier = 'open'
    rate_multiplier = Decimal('1.00')
    is_isolation_capable = False
    has_negative_pressure = False
    default_isolation_type = 'none'
    max_beds = 0
    is_active = True
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class BedFactory(DjangoModelFactory):
    """Factory for creating Bed instances."""

    class Meta:
        model = Bed

    ward = factory.SubFactory(WardFactory)
    bed_number = factory.Sequence(lambda n: f'BED-{n:03d}')
    bed_type = 'standard'
    status = 'available'
    additional_rate = Decimal('0.00')
    location_x = factory.Sequence(lambda n: n % 10)
    location_y = factory.Sequence(lambda n: n // 10)
    is_isolation_capable = False
    has_negative_pressure = False
    current_isolation_type = 'none'
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class AdmissionFactory(DjangoModelFactory):
    """Factory for creating Admission instances."""

    class Meta:
        model = Admission

    patient = factory.SubFactory(PatientProfileFactory)
    bed = factory.SubFactory(BedFactory, status='available')
    admission_date = factory.LazyFunction(timezone.now)
    expected_discharge_date = factory.LazyAttribute(
        lambda obj: obj.admission_date + timedelta(days=7)
    )
    status = 'admitted'
    admission_type = 'elective'
    admission_notes = factory.Faker('paragraph')
    daily_rate = Decimal('100.00')
    is_billed = False
    admitting_doctor = factory.SubFactory(PractitionerProfileFactory)
    created_by = factory.SubFactory(UserFactory, user_type='admin')
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)

    @factory.post_generation
    def update_bed_status(self, create, extracted, **kwargs):
        """Update bed status to occupied after admission is created."""
        if create and self.status == 'admitted' and self.bed:
            self.bed.status = 'occupied'
            self.bed.save()


class BedAllocationLogFactory(DjangoModelFactory):
    """Factory for creating BedAllocationLog instances."""

    class Meta:
        model = BedAllocationLog

    bed = factory.SubFactory(BedFactory)
    previous_status = 'available'
    new_status = 'occupied'
    notes = factory.Faker('sentence')
    created_by = factory.SubFactory(UserFactory, user_type='nurse')


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
    updated_by = factory.LazyAttribute(lambda obj: obj.created_by)


class WardTransferFactory(DjangoModelFactory):
    """Factory for creating WardTransfer instances."""

    class Meta:
        model = WardTransfer

    patient = factory.SubFactory(PatientProfileFactory)
    from_admission = factory.SubFactory(AdmissionFactory)
    to_admission = factory.SubFactory(AdmissionFactory)
    reason = factory.Faker('paragraph')
    transfer_time = factory.LazyFunction(timezone.now)
    created_by = factory.SubFactory(UserFactory, user_type='nurse')
