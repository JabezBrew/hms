"""
Factory Boy factories for the laboratory app.

Provides factories for:
- LabTestCatalog
- LabPanel
- LabOrder
- LabOrderTest
- LabSpecimen
- LabResult
"""
import factory
from factory.django import DjangoModelFactory
from django.utils import timezone
from decimal import Decimal
from datetime import timedelta

from apps.laboratory.models import (
    LabTestCatalog, LabPanel, LabOrder, LabOrderTest, LabSpecimen, LabResult
)
from apps.users.tests.factories import (
    UserFactory, PatientProfileFactory, PractitionerProfileFactory, StaffFactory
)
from apps.encounters.tests.factories import EncounterFactory
from apps.core.tests.factories import DefaultFacilityFactory


class LabTestCatalogFactory(DjangoModelFactory):
    """Factory for creating LabTestCatalog instances."""

    class Meta:
        model = LabTestCatalog

    facility = factory.SubFactory(DefaultFacilityFactory)
    code = factory.Sequence(lambda n: f'TEST-{n:04d}')
    loinc_code = factory.Sequence(lambda n: f'{1000 + n}-0')
    name = factory.Sequence(lambda n: f'Test Name {n}')
    short_name = factory.Sequence(lambda n: f'TST{n}')
    category = 'chemistry'
    description = factory.Faker('paragraph')
    specimen_type = 'Serum'
    container_type = 'Red Top'
    volume_required = '5 mL'
    special_instructions = ''
    reference_ranges = {
        'adult_male': {'low': 10, 'high': 50, 'unit': 'mg/dL'},
        'adult_female': {'low': 8, 'high': 45, 'unit': 'mg/dL'}
    }
    unit = 'mg/dL'
    tat_hours = 24
    price = Decimal('50.00')
    is_active = True
    is_system_default = False
    is_facility_modified = False
    system_defaults = {}


class LabPanelFactory(DjangoModelFactory):
    """Factory for creating LabPanel instances."""

    class Meta:
        model = LabPanel

    facility = factory.SubFactory(DefaultFacilityFactory)
    code = factory.Sequence(lambda n: f'PANEL-{n:04d}')
    name = factory.Sequence(lambda n: f'Panel Name {n}')
    description = factory.Faker('paragraph')
    price = Decimal('150.00')
    is_active = True
    is_system_default = False
    is_facility_modified = False
    system_defaults = {}

    @factory.post_generation
    def tests(self, create, extracted, **kwargs):
        if not create:
            return
        if extracted:
            for test in extracted:
                self.tests.add(test)


class LabOrderFactory(DjangoModelFactory):
    """Factory for creating LabOrder instances."""

    class Meta:
        model = LabOrder

    patient = factory.SubFactory(PatientProfileFactory)
    facility = factory.SelfAttribute('patient.facility')
    encounter = factory.SubFactory(EncounterFactory)
    ordering_provider = factory.SubFactory(PractitionerProfileFactory)
    priority = 'routine'
    status = 'ordered'
    clinical_notes = factory.Faker('sentence')
    fasting_required = False
    ordered_at = factory.LazyFunction(timezone.now)
    fhir_synced = False


class LabOrderTestFactory(DjangoModelFactory):
    """Factory for creating LabOrderTest instances."""

    class Meta:
        model = LabOrderTest

    order = factory.SubFactory(LabOrderFactory)
    facility = factory.SelfAttribute('order.facility')
    test = factory.SubFactory(LabTestCatalogFactory)
    status = 'ordered'
    notes = ''


class LabSpecimenFactory(DjangoModelFactory):
    """Factory for creating LabSpecimen instances."""

    class Meta:
        model = LabSpecimen

    barcode = factory.Sequence(lambda n: f'SPEC-{n:08d}')
    order = factory.SubFactory(LabOrderFactory)
    facility = factory.SelfAttribute('order.facility')
    specimen_type = 'Serum'
    container_type = 'Red Top'
    volume_collected = '5 mL'
    collected_by = factory.SubFactory(StaffFactory)
    collection_site = 'Left arm'
    collected_at = factory.LazyFunction(timezone.now)
    status = 'collected'
    is_rejected = False


class LabResultFactory(DjangoModelFactory):
    """Factory for creating LabResult instances."""

    class Meta:
        model = LabResult

    order_test = factory.SubFactory(LabOrderTestFactory)
    specimen = factory.SubFactory(LabSpecimenFactory)
    facility = factory.SelfAttribute('order_test.order.facility')
    value = '25.5'
    unit = 'mg/dL'
    reference_low = Decimal('10.0')
    reference_high = Decimal('50.0')
    flag = 'normal'
    interpretation = ''
    performed_by = factory.SubFactory(StaffFactory)
    performed_at = factory.LazyFunction(timezone.now)
    verified_by = factory.SubFactory(StaffFactory)
    verified_at = factory.LazyFunction(timezone.now)
    is_verified = False
    fhir_synced = False
