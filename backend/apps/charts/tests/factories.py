"""
Chart Builder Test Factories

Factory classes for generating test data.
"""

import factory
from factory.django import DjangoModelFactory
from django.utils import timezone

from apps.charts.models import ChartTemplate, ChartField, ChartAssignment, ChartEntry
from apps.users.tests.factories import UserFactory, PatientProfileFactory, PractitionerProfileFactory
from apps.wards.tests.factories import AdmissionFactory
from apps.core.tests.factories import DefaultFacilityFactory


class ChartTemplateFactory(DjangoModelFactory):
    """Factory for ChartTemplate model."""

    class Meta:
        model = ChartTemplate

    facility = factory.SubFactory(DefaultFacilityFactory)
    name = factory.Sequence(lambda n: f"Test Chart Template {n}")
    description = factory.Faker('paragraph')
    icon = 'clipboard-list'
    visibility = 'facility'
    category = 'custom'
    default_interval = 'hourly'
    display_mode = 'table'
    columns_per_page = 24
    is_active = True
    is_system = False
    created_by = factory.SubFactory(UserFactory)


class ChartFieldFactory(DjangoModelFactory):
    """Factory for ChartField model."""

    class Meta:
        model = ChartField

    template = factory.SubFactory(ChartTemplateFactory)
    name = factory.Sequence(lambda n: f"Test Field {n}")
    field_key = factory.Sequence(lambda n: f"test_field_{n}")
    field_type = 'numeric'
    display_order = factory.Sequence(lambda n: n)
    is_required = False
    config = factory.LazyAttribute(lambda o: {
        'unit': 'units',
        'min': 0,
        'max': 100,
        'decimals': 0,
    })


class NumericFieldFactory(ChartFieldFactory):
    """Factory for numeric chart fields."""

    field_type = 'numeric'
    config = factory.LazyAttribute(lambda o: {
        'unit': 'mmHg',
        'min': 0,
        'max': 300,
        'decimals': 0,
        'critical_low': 90,
        'critical_high': 180,
    })


class SelectFieldFactory(ChartFieldFactory):
    """Factory for select chart fields."""

    field_type = 'select'
    config = factory.LazyAttribute(lambda o: {
        'options': [
            {'value': 'option1', 'label': 'Option 1'},
            {'value': 'option2', 'label': 'Option 2'},
            {'value': 'option3', 'label': 'Option 3'},
        ]
    })


class ScaleFieldFactory(ChartFieldFactory):
    """Factory for scale chart fields."""

    field_type = 'scale'
    config = factory.LazyAttribute(lambda o: {
        'min': 1,
        'max': 10,
        'step': 1,
        'labels': {'1': 'None', '5': 'Moderate', '10': 'Severe'},
    })


class CalculatedFieldFactory(ChartFieldFactory):
    """Factory for calculated chart fields."""

    field_type = 'calculated'
    config = factory.LazyAttribute(lambda o: {
        'formula': '{field_a} + {field_b}',
        'depends_on': ['field_a', 'field_b'],
    })


class PairedFieldFactory(ChartFieldFactory):
    """Factory for paired chart fields (like blood pressure)."""

    field_type = 'paired'
    config = factory.LazyAttribute(lambda o: {
        'fields': [
            {'key': 'systolic', 'label': 'Systolic'},
            {'key': 'diastolic', 'label': 'Diastolic'},
        ],
        'separator': '/',
        'unit': 'mmHg',
        'critical_low': {'systolic': 90, 'diastolic': 60},
        'critical_high': {'systolic': 180, 'diastolic': 110},
    })


class ChartAssignmentFactory(DjangoModelFactory):
    """Factory for ChartAssignment model."""

    class Meta:
        model = ChartAssignment

    template = factory.SubFactory(ChartTemplateFactory)
    patient = factory.SubFactory(PatientProfileFactory)
    admission = factory.SubFactory(AdmissionFactory)
    status = 'active'
    start_datetime = factory.LazyFunction(timezone.now)
    reason = factory.Faker('sentence')
    ordered_by = factory.SubFactory(PractitionerProfileFactory)
    created_by = factory.SubFactory(UserFactory)


class ChartEntryFactory(DjangoModelFactory):
    """Factory for ChartEntry model."""

    class Meta:
        model = ChartEntry

    assignment = factory.SubFactory(ChartAssignmentFactory)
    observation_datetime = factory.LazyFunction(timezone.now)
    data = factory.LazyAttribute(lambda o: {'test_field': 50})
    has_critical_values = False
    critical_fields = []
    notes = factory.Faker('sentence')
    recorded_by = factory.SubFactory(PractitionerProfileFactory)
    created_by = factory.SubFactory(UserFactory)


# =============================================================================
# Template Factories for Common Clinical Charts
# =============================================================================

class GCSTemplateFactory(ChartTemplateFactory):
    """Factory for Glasgow Coma Scale chart template."""

    name = "Glasgow Coma Scale (GCS)"
    category = 'neurological'
    default_interval = 'hourly'

    @factory.post_generation
    def create_fields(self, create, extracted, **kwargs):
        if not create:
            return

        # Eye Opening
        ChartFieldFactory(
            template=self,
            name='Eye Opening',
            field_key='eye_opening',
            field_type='scale',
            display_order=1,
            is_required=True,
            config={
                'min': 1,
                'max': 4,
                'step': 1,
                'labels': {
                    '1': 'None',
                    '2': 'To pain',
                    '3': 'To voice',
                    '4': 'Spontaneous',
                },
            }
        )

        # Verbal Response
        ChartFieldFactory(
            template=self,
            name='Verbal Response',
            field_key='verbal_response',
            field_type='scale',
            display_order=2,
            is_required=True,
            config={
                'min': 1,
                'max': 5,
                'step': 1,
                'labels': {
                    '1': 'None',
                    '2': 'Sounds',
                    '3': 'Words',
                    '4': 'Confused',
                    '5': 'Oriented',
                },
            }
        )

        # Motor Response
        ChartFieldFactory(
            template=self,
            name='Motor Response',
            field_key='motor_response',
            field_type='scale',
            display_order=3,
            is_required=True,
            config={
                'min': 1,
                'max': 6,
                'step': 1,
                'labels': {
                    '1': 'None',
                    '2': 'Extension',
                    '3': 'Abnormal flexion',
                    '4': 'Withdraws',
                    '5': 'Localizes',
                    '6': 'Obeys',
                },
            }
        )

        # Total GCS (Calculated)
        ChartFieldFactory(
            template=self,
            name='Total GCS',
            field_key='total_gcs',
            field_type='calculated',
            display_order=4,
            config={
                'formula': '{eye_opening} + {verbal_response} + {motor_response}',
                'depends_on': ['eye_opening', 'verbal_response', 'motor_response'],
                'critical_low': 8,
            }
        )


class PainAssessmentTemplateFactory(ChartTemplateFactory):
    """Factory for Pain Assessment chart template."""

    name = "Pain Assessment"
    category = 'pain'
    default_interval = '4hourly'

    @factory.post_generation
    def create_fields(self, create, extracted, **kwargs):
        if not create:
            return

        # Pain Level
        ChartFieldFactory(
            template=self,
            name='Pain Level',
            field_key='pain_level',
            field_type='scale',
            display_order=1,
            is_required=True,
            config={
                'min': 0,
                'max': 10,
                'step': 1,
                'labels': {
                    '0': 'No pain',
                    '5': 'Moderate',
                    '10': 'Worst pain',
                },
                'critical_value': 7,
                'critical_direction': 'above',
            }
        )

        # Pain Location
        ChartFieldFactory(
            template=self,
            name='Pain Location',
            field_key='pain_location',
            field_type='select',
            display_order=2,
            config={
                'options': [
                    {'value': 'head', 'label': 'Head'},
                    {'value': 'chest', 'label': 'Chest'},
                    {'value': 'abdomen', 'label': 'Abdomen'},
                    {'value': 'back', 'label': 'Back'},
                    {'value': 'limbs', 'label': 'Limbs'},
                    {'value': 'other', 'label': 'Other'},
                ]
            }
        )

        # Pain Type
        ChartFieldFactory(
            template=self,
            name='Pain Type',
            field_key='pain_type',
            field_type='select',
            display_order=3,
            config={
                'options': [
                    {'value': 'sharp', 'label': 'Sharp'},
                    {'value': 'dull', 'label': 'Dull'},
                    {'value': 'burning', 'label': 'Burning'},
                    {'value': 'throbbing', 'label': 'Throbbing'},
                    {'value': 'aching', 'label': 'Aching'},
                ]
            }
        )

        # Intervention
        ChartFieldFactory(
            template=self,
            name='Intervention',
            field_key='intervention',
            field_type='text',
            display_order=4,
            config={'max_length': 200}
        )
