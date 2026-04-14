"""
Chart Builder Service Tests

Tests for formula evaluation, critical value detection, and entry processing.
"""

import pytest
from datetime import timedelta
from django.utils import timezone

from apps.charts.services import (
    FormulaEvaluator,
    CriticalValueChecker,
    ChartEntryService,
    ConditionalFieldChecker,
)
from apps.charts.tests.factories import (
    ChartTemplateFactory, ChartFieldFactory, ChartAssignmentFactory, ChartEntryFactory,
    NumericFieldFactory, ScaleFieldFactory, PairedFieldFactory,
)


class TestFormulaEvaluator:
    """Tests for FormulaEvaluator service."""

    def test_simple_addition(self):
        """Test simple addition formula."""
        result = FormulaEvaluator.evaluate("{a} + {b}", {'a': 5, 'b': 3})
        assert result == 8

    def test_simple_subtraction(self):
        """Test simple subtraction formula."""
        result = FormulaEvaluator.evaluate("{a} - {b}", {'a': 10, 'b': 3})
        assert result == 7

    def test_multiplication(self):
        """Test multiplication formula."""
        result = FormulaEvaluator.evaluate("{a} * {b}", {'a': 4, 'b': 5})
        assert result == 20

    def test_division(self):
        """Test division formula."""
        result = FormulaEvaluator.evaluate("{a} / {b}", {'a': 20, 'b': 4})
        assert result == 5

    def test_complex_formula(self):
        """Test complex formula with multiple operations."""
        # GCS total
        result = FormulaEvaluator.evaluate(
            "{eye} + {verbal} + {motor}",
            {'eye': 4, 'verbal': 5, 'motor': 6}
        )
        assert result == 15

    def test_formula_with_parentheses(self):
        """Test formula with parentheses."""
        # Mean Arterial Pressure: (SBP + 2*DBP) / 3
        result = FormulaEvaluator.evaluate(
            "({sbp} + 2 * {dbp}) / 3",
            {'sbp': 120, 'dbp': 80}
        )
        assert round(result, 2) == 93.33

    def test_formula_with_decimals(self):
        """Test formula with decimal numbers."""
        result = FormulaEvaluator.evaluate("{a} + {b}", {'a': 1.5, 'b': 2.5})
        assert result == 4.0

    def test_division_by_zero(self):
        """Test division by zero returns None."""
        result = FormulaEvaluator.evaluate("{a} / {b}", {'a': 10, 'b': 0})
        assert result is None

    def test_missing_field_value(self):
        """Test missing field value returns None."""
        result = FormulaEvaluator.evaluate("{a} + {b}", {'a': 5})
        assert result is None

    def test_invalid_formula(self):
        """Test invalid formula returns None."""
        result = FormulaEvaluator.evaluate("{a} % {b}", {'a': 10, 'b': 3})  # % not allowed
        assert result is None

    def test_empty_formula(self):
        """Test empty formula returns None."""
        result = FormulaEvaluator.evaluate("", {'a': 5})
        assert result is None

    def test_null_formula(self):
        """Test null formula returns None."""
        result = FormulaEvaluator.evaluate(None, {'a': 5})
        assert result is None

    def test_get_dependencies(self):
        """Test extracting field dependencies from formula."""
        deps = FormulaEvaluator.get_dependencies("{eye} + {verbal} + {motor}")
        assert sorted(deps) == ['eye', 'motor', 'verbal']

    def test_get_dependencies_empty(self):
        """Test dependencies with no fields."""
        deps = FormulaEvaluator.get_dependencies("1 + 2")
        assert deps == []

    def test_sum_function(self):
        """Test sum function in formula."""
        result = FormulaEvaluator.evaluate(
            "sum({a}, {b}, {c})",
            {'a': 1, 'b': 2, 'c': 3}
        )
        assert float(result) == 6.0

    def test_avg_function(self):
        """Test avg function in formula."""
        result = FormulaEvaluator.evaluate(
            "avg({a}, {b}, {c})",
            {'a': 3, 'b': 6, 'c': 9}
        )
        assert float(result) == 6.0

    def test_min_function(self):
        """Test min function in formula."""
        result = FormulaEvaluator.evaluate(
            "min({a}, {b}, {c})",
            {'a': 5, 'b': 2, 'c': 8}
        )
        assert float(result) == 2.0

    def test_max_function(self):
        """Test max function in formula."""
        result = FormulaEvaluator.evaluate(
            "max({a}, {b}, {c})",
            {'a': 5, 'b': 2, 'c': 8}
        )
        assert float(result) == 8.0

    def test_negative_numbers(self):
        """Test formulas with negative numbers."""
        result = FormulaEvaluator.evaluate("{a} + {b}", {'a': -5, 'b': 10})
        assert result == 5

    def test_result_rounding(self):
        """Test that results are rounded to 2 decimal places."""
        result = FormulaEvaluator.evaluate("{a} / {b}", {'a': 10, 'b': 3})
        assert result == 3.33


@pytest.mark.django_db
class TestCriticalValueChecker:
    """Tests for CriticalValueChecker service."""

    def test_numeric_below_critical_low(self):
        """Test detecting value below critical low."""
        template = ChartTemplateFactory()
        field = NumericFieldFactory(
            template=template,
            field_key='bp_systolic',
            config={
                'unit': 'mmHg',
                'min': 0,
                'max': 300,
                'critical_low': 90,
                'critical_high': 180,
            }
        )

        assignment = ChartAssignmentFactory(template=template)
        entry = ChartEntryFactory(
            assignment=assignment,
            data={'bp_systolic': 85}  # Below critical low
        )

        has_critical, critical_fields = CriticalValueChecker.check_entry(entry)

        assert has_critical is True
        assert 'bp_systolic' in critical_fields

    def test_numeric_above_critical_high(self):
        """Test detecting value above critical high."""
        template = ChartTemplateFactory()
        field = NumericFieldFactory(
            template=template,
            field_key='bp_systolic',
            config={
                'unit': 'mmHg',
                'min': 0,
                'max': 300,
                'critical_low': 90,
                'critical_high': 180,
            }
        )

        assignment = ChartAssignmentFactory(template=template)
        entry = ChartEntryFactory(
            assignment=assignment,
            data={'bp_systolic': 200}  # Above critical high
        )

        has_critical, critical_fields = CriticalValueChecker.check_entry(entry)

        assert has_critical is True
        assert 'bp_systolic' in critical_fields

    def test_numeric_within_range(self):
        """Test value within normal range."""
        template = ChartTemplateFactory()
        field = NumericFieldFactory(
            template=template,
            field_key='bp_systolic',
            config={
                'unit': 'mmHg',
                'min': 0,
                'max': 300,
                'critical_low': 90,
                'critical_high': 180,
            }
        )

        assignment = ChartAssignmentFactory(template=template)
        entry = ChartEntryFactory(
            assignment=assignment,
            data={'bp_systolic': 120}  # Normal
        )

        has_critical, critical_fields = CriticalValueChecker.check_entry(entry)

        assert has_critical is False
        assert len(critical_fields) == 0

    def test_scale_critical_above(self):
        """Test scale critical detection (above threshold)."""
        template = ChartTemplateFactory()
        field = ScaleFieldFactory(
            template=template,
            field_key='pain_level',
            config={
                'min': 0,
                'max': 10,
                'critical_value': 7,
                'critical_direction': 'above',
            }
        )

        assignment = ChartAssignmentFactory(template=template)
        entry = ChartEntryFactory(
            assignment=assignment,
            data={'pain_level': 8}  # Above threshold
        )

        has_critical, critical_fields = CriticalValueChecker.check_entry(entry)

        assert has_critical is True
        assert 'pain_level' in critical_fields

    def test_scale_below_threshold(self):
        """Test scale value below threshold (not critical)."""
        template = ChartTemplateFactory()
        field = ScaleFieldFactory(
            template=template,
            field_key='pain_level',
            config={
                'min': 0,
                'max': 10,
                'critical_value': 7,
                'critical_direction': 'above',
            }
        )

        assignment = ChartAssignmentFactory(template=template)
        entry = ChartEntryFactory(
            assignment=assignment,
            data={'pain_level': 5}  # Below threshold
        )

        has_critical, critical_fields = CriticalValueChecker.check_entry(entry)

        assert has_critical is False

    def test_paired_field_critical(self):
        """Test paired field critical detection."""
        template = ChartTemplateFactory()
        field = PairedFieldFactory(
            template=template,
            field_key='blood_pressure',
        )

        assignment = ChartAssignmentFactory(template=template)
        entry = ChartEntryFactory(
            assignment=assignment,
            data={'blood_pressure': {'systolic': 85, 'diastolic': 70}}  # Systolic below critical
        )

        has_critical, critical_fields = CriticalValueChecker.check_entry(entry)

        assert has_critical is True
        assert 'blood_pressure' in critical_fields

    def test_null_value_not_critical(self):
        """Test that null values are not flagged as critical."""
        template = ChartTemplateFactory()
        field = NumericFieldFactory(
            template=template,
            field_key='temperature',
            config={'critical_low': 36, 'critical_high': 39}
        )

        assignment = ChartAssignmentFactory(template=template)
        entry = ChartEntryFactory(
            assignment=assignment,
            data={'temperature': None}
        )

        has_critical, critical_fields = CriticalValueChecker.check_entry(entry)

        assert has_critical is False


@pytest.mark.django_db
class TestChartEntryService:
    """Tests for ChartEntryService."""

    def test_create_entry_with_calculated_fields(self):
        """Test creating entry computes calculated fields."""
        template = ChartTemplateFactory()

        # Create component fields
        ChartFieldFactory(
            template=template,
            name='Field A',
            field_key='field_a',
            field_type='numeric',
            config={'min': 0, 'max': 10}
        )
        ChartFieldFactory(
            template=template,
            name='Field B',
            field_key='field_b',
            field_type='numeric',
            config={'min': 0, 'max': 10}
        )
        ChartFieldFactory(
            template=template,
            name='Total',
            field_key='total',
            field_type='calculated',
            config={
                'formula': '{field_a} + {field_b}',
                'depends_on': ['field_a', 'field_b']
            }
        )

        assignment = ChartAssignmentFactory(template=template)

        entry = ChartEntryService.create_entry(
            assignment=assignment,
            data={'field_a': 3, 'field_b': 4},
            recorded_by=assignment.ordered_by,
            user=assignment.created_by,
        )

        assert entry.data['total'] == 7

    def test_create_entry_detects_critical_values(self):
        """Test creating entry detects critical values."""
        template = ChartTemplateFactory()
        NumericFieldFactory(
            template=template,
            field_key='bp_systolic',
            config={'critical_low': 90, 'critical_high': 180}
        )

        assignment = ChartAssignmentFactory(template=template)

        entry = ChartEntryService.create_entry(
            assignment=assignment,
            data={'bp_systolic': 200},  # Critical
            recorded_by=assignment.ordered_by,
            user=assignment.created_by,
        )

        assert entry.has_critical_values is True
        assert 'bp_systolic' in entry.critical_fields

    def test_get_entry_summary(self):
        """Test getting entry summary statistics."""
        template = ChartTemplateFactory()
        NumericFieldFactory(template=template, field_key='value')

        assignment = ChartAssignmentFactory(template=template)

        # Create entries
        ChartEntryFactory(assignment=assignment, data={'value': 10})
        ChartEntryFactory(assignment=assignment, data={'value': 20})
        ChartEntryFactory(assignment=assignment, data={'value': 30})
        ChartEntryFactory(assignment=assignment, data={'value': 40}, has_critical_values=True)

        summary = ChartEntryService.get_entry_summary(assignment)

        assert summary['total_entries'] == 4
        assert summary['critical_entries'] == 1
        assert 'value' in summary['field_summaries']
        assert summary['field_summaries']['value']['min'] == 10
        assert summary['field_summaries']['value']['max'] == 40
        assert summary['field_summaries']['value']['avg'] == 25.0

    def test_get_trend_data(self):
        """Test getting trend data for a field."""
        template = ChartTemplateFactory()
        NumericFieldFactory(template=template, field_key='temperature')

        assignment = ChartAssignmentFactory(template=template)

        # Create entries with different timestamps
        from datetime import timedelta
        base_time = timezone.now()

        ChartEntryFactory(
            assignment=assignment,
            observation_datetime=base_time - timedelta(hours=2),
            data={'temperature': 37.0}
        )
        ChartEntryFactory(
            assignment=assignment,
            observation_datetime=base_time - timedelta(hours=1),
            data={'temperature': 37.5}
        )
        ChartEntryFactory(
            assignment=assignment,
            observation_datetime=base_time,
            data={'temperature': 38.0}
        )

        trend = ChartEntryService.get_trend_data(assignment, 'temperature')

        assert len(trend) == 3
        # Should be in chronological order
        assert trend[0]['value'] == 37.0
        assert trend[1]['value'] == 37.5
        assert trend[2]['value'] == 38.0

    def test_get_trend_data_for_paired_field_component(self):
        """Paired fields should expose component-specific trend lines."""
        template = ChartTemplateFactory()
        PairedFieldFactory(template=template, field_key='blood_pressure')
        assignment = ChartAssignmentFactory(template=template)
        base_time = timezone.now()

        ChartEntryFactory(
            assignment=assignment,
            observation_datetime=base_time,
            data={'blood_pressure': {'systolic': 118, 'diastolic': 76}},
        )
        ChartEntryFactory(
            assignment=assignment,
            observation_datetime=base_time + timedelta(hours=1),
            data={'blood_pressure': {'systolic': 124, 'diastolic': 82}},
        )

        trend = ChartEntryService.get_trend_data(
            assignment,
            'blood_pressure',
            component='systolic',
        )

        assert [point['value'] for point in trend] == [118.0, 124.0]
        assert all(point['component'] == 'systolic' for point in trend)


class TestConditionalFieldChecker:
    """Tests for ConditionalFieldChecker service."""

    @pytest.mark.django_db
    def test_field_without_condition(self):
        """Test field without show_when condition is always shown."""
        field = ChartFieldFactory(show_when=None)
        result = ConditionalFieldChecker.should_show_field(field, {})
        assert result is True

    @pytest.mark.django_db
    def test_condition_equals_true(self):
        """Test equals condition when true."""
        field = ChartFieldFactory(
            show_when={
                'field': 'status',
                'operator': 'equals',
                'value': 'critical'
            }
        )

        result = ConditionalFieldChecker.should_show_field(
            field, {'status': 'critical'}
        )
        assert result is True

    @pytest.mark.django_db
    def test_condition_equals_false(self):
        """Test equals condition when false."""
        field = ChartFieldFactory(
            show_when={
                'field': 'status',
                'operator': 'equals',
                'value': 'critical'
            }
        )

        result = ConditionalFieldChecker.should_show_field(
            field, {'status': 'normal'}
        )
        assert result is False

    @pytest.mark.django_db
    def test_condition_greater_than(self):
        """Test greater_than condition."""
        field = ChartFieldFactory(
            show_when={
                'field': 'pain_level',
                'operator': 'greater_than',
                'value': 5
            }
        )

        assert ConditionalFieldChecker.should_show_field(field, {'pain_level': 7}) is True
        assert ConditionalFieldChecker.should_show_field(field, {'pain_level': 3}) is False

    @pytest.mark.django_db
    def test_condition_in_list(self):
        """Test in condition with list of values."""
        field = ChartFieldFactory(
            show_when={
                'field': 'location',
                'operator': 'in',
                'value': ['head', 'chest', 'abdomen']
            }
        )

        assert ConditionalFieldChecker.should_show_field(field, {'location': 'head'}) is True
        assert ConditionalFieldChecker.should_show_field(field, {'location': 'back'}) is False

    @pytest.mark.django_db
    def test_get_visible_fields(self):
        """Test getting list of visible fields based on conditions."""
        template = ChartTemplateFactory()

        # Always visible
        ChartFieldFactory(
            template=template,
            field_key='always_visible',
            show_when=None
        )

        # Only visible when pain > 5
        ChartFieldFactory(
            template=template,
            field_key='pain_details',
            show_when={
                'field': 'pain_level',
                'operator': 'greater_than',
                'value': 5
            }
        )

        # Test with low pain
        visible = ConditionalFieldChecker.get_visible_fields(
            template, {'pain_level': 3}
        )
        field_keys = [f.field_key for f in visible]
        assert 'always_visible' in field_keys
        assert 'pain_details' not in field_keys

        # Test with high pain
        visible = ConditionalFieldChecker.get_visible_fields(
            template, {'pain_level': 7}
        )
        field_keys = [f.field_key for f in visible]
        assert 'always_visible' in field_keys
        assert 'pain_details' in field_keys
