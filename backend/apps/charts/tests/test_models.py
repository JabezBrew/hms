"""
Chart Builder Model Tests

Tests for ChartTemplate, ChartField, ChartAssignment, and ChartEntry models.
"""

import pytest
from django.utils import timezone
from datetime import timedelta

from apps.charts.models import ChartTemplate, ChartField, ChartAssignment, ChartEntry
from apps.charts.tests.factories import (
    ChartTemplateFactory, ChartFieldFactory, ChartAssignmentFactory, ChartEntryFactory,
    NumericFieldFactory, SelectFieldFactory, ScaleFieldFactory, CalculatedFieldFactory,
    PairedFieldFactory, GCSTemplateFactory,
)


@pytest.mark.django_db
class TestChartTemplate:
    """Tests for ChartTemplate model."""

    def test_create_template(self):
        """Test creating a basic chart template."""
        template = ChartTemplateFactory(
            name="Blood Glucose Monitoring",
            category="metabolic",
        )

        assert template.name == "Blood Glucose Monitoring"
        assert template.category == "metabolic"
        assert template.is_active is True
        assert template.is_system is False
        assert template.version == 1

    def test_template_str_representation(self):
        """Test string representation of template."""
        template = ChartTemplateFactory(name="Test Template", category="custom")
        assert str(template) == "Test Template (Custom)"

    def test_clone_template(self):
        """Test cloning a template."""
        original = ChartTemplateFactory(
            name="Original Template",
            visibility="facility",
        )

        # Add some fields
        NumericFieldFactory(template=original, name="Field 1", field_key="field_1")
        SelectFieldFactory(template=original, name="Field 2", field_key="field_2")

        # Clone
        cloned = original.clone(user=original.created_by, new_name="Cloned Template")

        assert cloned.name == "Cloned Template"
        assert cloned.visibility == "private"  # Cloned templates are private
        assert cloned.fields.count() == 2
        assert cloned.id != original.id

        # Verify fields were cloned
        cloned_field_keys = list(cloned.fields.values_list('field_key', flat=True))
        assert 'field_1' in cloned_field_keys
        assert 'field_2' in cloned_field_keys

    def test_clone_without_name(self):
        """Test cloning without specifying a new name."""
        original = ChartTemplateFactory(name="Original")
        cloned = original.clone(user=original.created_by)

        assert cloned.name == "Original (Copy)"

    def test_template_visibility_choices(self):
        """Test all visibility options are valid."""
        for visibility, _ in ChartTemplate.VISIBILITY_CHOICES:
            template = ChartTemplateFactory(visibility=visibility)
            assert template.visibility == visibility


@pytest.mark.django_db
class TestChartField:
    """Tests for ChartField model."""

    def test_create_numeric_field(self):
        """Test creating a numeric field."""
        template = ChartTemplateFactory()
        field = NumericFieldFactory(
            template=template,
            name="Temperature",
            field_key="temperature",
        )

        assert field.field_type == "numeric"
        assert field.config['unit'] == "mmHg"
        assert field.config['min'] == 0
        assert field.config['max'] == 300

    def test_create_select_field(self):
        """Test creating a select field."""
        template = ChartTemplateFactory()
        field = SelectFieldFactory(
            template=template,
            name="Pain Location",
            field_key="pain_location",
        )

        assert field.field_type == "select"
        assert len(field.config['options']) == 3

    def test_create_scale_field(self):
        """Test creating a scale field."""
        template = ChartTemplateFactory()
        field = ScaleFieldFactory(
            template=template,
            name="Pain Level",
            field_key="pain_level",
        )

        assert field.field_type == "scale"
        assert field.config['min'] == 1
        assert field.config['max'] == 10

    def test_create_calculated_field(self):
        """Test creating a calculated field."""
        template = ChartTemplateFactory()
        field = CalculatedFieldFactory(
            template=template,
            name="Total",
            field_key="total",
            config={
                'formula': '{a} + {b}',
                'depends_on': ['a', 'b'],
            }
        )

        assert field.field_type == "calculated"
        assert '{a}' in field.config['formula']

    def test_create_paired_field(self):
        """Test creating a paired field (e.g., blood pressure)."""
        template = ChartTemplateFactory()
        field = PairedFieldFactory(
            template=template,
            name="Blood Pressure",
            field_key="blood_pressure",
        )

        assert field.field_type == "paired"
        assert len(field.config['fields']) == 2
        assert field.config['separator'] == '/'

    def test_field_unique_together(self):
        """Test that field_key must be unique within a template."""
        template = ChartTemplateFactory()
        ChartFieldFactory(template=template, field_key="test_field")

        with pytest.raises(Exception):  # IntegrityError
            ChartFieldFactory(template=template, field_key="test_field")

    def test_field_str_representation(self):
        """Test string representation of field."""
        field = NumericFieldFactory(name="Temperature")
        assert str(field) == "Temperature (Numeric)"

    def test_get_default_value(self):
        """Test getting default values for different field types."""
        template = ChartTemplateFactory()

        numeric = NumericFieldFactory(template=template)
        assert numeric.get_default_value() is None

        select = SelectFieldFactory(template=template)
        assert select.get_default_value() is None

        # Test with explicit default in config
        field_with_default = ChartFieldFactory(
            template=template,
            field_type='numeric',
            config={'default': 98.6}
        )
        assert field_with_default.get_default_value() == 98.6


@pytest.mark.django_db
class TestChartAssignment:
    """Tests for ChartAssignment model."""

    def test_create_assignment(self):
        """Test creating a chart assignment."""
        assignment = ChartAssignmentFactory(
            status='active',
            reason="Post-operative monitoring",
        )

        assert assignment.status == 'active'
        assert assignment.reason == "Post-operative monitoring"
        assert assignment.template is not None
        assert assignment.patient is not None

    def test_effective_interval_default(self):
        """Test effective interval uses template default."""
        template = ChartTemplateFactory(default_interval='2hourly')
        assignment = ChartAssignmentFactory(
            template=template,
            monitoring_interval='',  # Empty - use default
        )

        assert assignment.effective_interval == '2hourly'

    def test_effective_interval_override(self):
        """Test effective interval can be overridden."""
        template = ChartTemplateFactory(default_interval='hourly')
        assignment = ChartAssignmentFactory(
            template=template,
            monitoring_interval='4hourly',
        )

        assert assignment.effective_interval == '4hourly'

    def test_discontinue_assignment(self):
        """Test discontinuing an assignment."""
        assignment = ChartAssignmentFactory(status='active')
        user = assignment.created_by

        assignment.discontinue(user=user, reason="Patient discharged")

        assert assignment.status == 'discontinued'
        assert assignment.discontinued_at is not None
        assert assignment.discontinued_by == user
        assert assignment.discontinuation_reason == "Patient discharged"

    def test_get_last_entry(self):
        """Test getting the most recent entry."""
        assignment = ChartAssignmentFactory()

        # Create entries at different times
        old_entry = ChartEntryFactory(
            assignment=assignment,
            observation_datetime=timezone.now() - timedelta(hours=2)
        )
        new_entry = ChartEntryFactory(
            assignment=assignment,
            observation_datetime=timezone.now()
        )

        last = assignment.get_last_entry()
        assert last.id == new_entry.id

    def test_get_last_entry_excludes_deleted(self):
        """Test that deleted entries are excluded from last entry."""
        assignment = ChartAssignmentFactory()

        old_entry = ChartEntryFactory(
            assignment=assignment,
            observation_datetime=timezone.now() - timedelta(hours=1)
        )
        deleted_entry = ChartEntryFactory(
            assignment=assignment,
            observation_datetime=timezone.now(),
            is_deleted=True
        )

        last = assignment.get_last_entry()
        assert last.id == old_entry.id

    def test_get_next_due(self):
        """Test calculating next due time."""
        assignment = ChartAssignmentFactory(monitoring_interval='hourly')

        # Create an entry
        entry = ChartEntryFactory(
            assignment=assignment,
            observation_datetime=timezone.now()
        )

        next_due = assignment.get_next_due()
        expected = entry.observation_datetime + timedelta(hours=1)

        # Allow small time difference
        assert abs((next_due - expected).total_seconds()) < 1

    def test_assignment_str_representation(self):
        """Test string representation of assignment."""
        assignment = ChartAssignmentFactory()
        expected = f"{assignment.template.name} for {assignment.patient}"
        assert str(assignment) == expected


@pytest.mark.django_db
class TestChartEntry:
    """Tests for ChartEntry model."""

    def test_create_entry(self):
        """Test creating a chart entry."""
        entry = ChartEntryFactory(
            data={'temperature': 37.5, 'heart_rate': 72},
            notes="Patient comfortable",
        )

        assert entry.data['temperature'] == 37.5
        assert entry.data['heart_rate'] == 72
        assert entry.notes == "Patient comfortable"

    def test_soft_delete_entry(self):
        """Test soft deleting an entry."""
        entry = ChartEntryFactory()
        user = entry.created_by

        entry.soft_delete(user=user, reason="Entered in error")

        assert entry.is_deleted is True
        assert entry.deleted_at is not None
        assert entry.deleted_by == user
        assert entry.deletion_reason == "Entered in error"

    def test_get_field_value(self):
        """Test getting a field value."""
        entry = ChartEntryFactory(data={'temp': 37.5, 'hr': 72})

        assert entry.get_field_value('temp') == 37.5
        assert entry.get_field_value('hr') == 72
        assert entry.get_field_value('nonexistent') is None

    def test_set_field_value(self):
        """Test setting a field value."""
        entry = ChartEntryFactory(data={'temp': 37.5})

        entry.set_field_value('hr', 80)
        entry.set_field_value('temp', 38.0)

        assert entry.data['hr'] == 80
        assert entry.data['temp'] == 38.0

    def test_entry_str_representation(self):
        """Test string representation of entry."""
        entry = ChartEntryFactory()
        assert entry.assignment.template.name in str(entry)

    def test_entry_ordering(self):
        """Test entries are ordered by observation_datetime descending."""
        assignment = ChartAssignmentFactory()

        entry1 = ChartEntryFactory(
            assignment=assignment,
            observation_datetime=timezone.now() - timedelta(hours=2)
        )
        entry2 = ChartEntryFactory(
            assignment=assignment,
            observation_datetime=timezone.now() - timedelta(hours=1)
        )
        entry3 = ChartEntryFactory(
            assignment=assignment,
            observation_datetime=timezone.now()
        )

        entries = list(ChartEntry.objects.filter(assignment=assignment))

        assert entries[0].id == entry3.id  # Most recent first
        assert entries[1].id == entry2.id
        assert entries[2].id == entry1.id


@pytest.mark.django_db
class TestGCSTemplate:
    """Tests for the GCS template factory."""

    def test_gcs_template_creation(self):
        """Test creating GCS template with all fields."""
        template = GCSTemplateFactory(create_fields=True)

        assert template.name == "Glasgow Coma Scale (GCS)"
        assert template.category == "neurological"
        assert template.fields.count() == 4

        # Verify specific fields
        field_keys = list(template.fields.values_list('field_key', flat=True))
        assert 'eye_opening' in field_keys
        assert 'verbal_response' in field_keys
        assert 'motor_response' in field_keys
        assert 'total_gcs' in field_keys

    def test_gcs_total_field_is_calculated(self):
        """Test that total GCS field is a calculated field."""
        template = GCSTemplateFactory(create_fields=True)

        total_field = template.fields.get(field_key='total_gcs')
        assert total_field.field_type == 'calculated'
        assert 'formula' in total_field.config
