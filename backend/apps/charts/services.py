"""
Chart Builder Services

Provides business logic for formula evaluation, critical value detection,
and chart entry processing.
"""

import re
import operator
from decimal import Decimal, InvalidOperation
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from apps.charts.models import ChartEntry


# Safe operators for formula evaluation
SAFE_OPERATORS = {
    '+': operator.add,
    '-': operator.sub,
    '*': operator.mul,
    '/': operator.truediv,
}


class FormulaEvaluator:
    """
    Safely evaluates arithmetic formulas with field references.

    Supported syntax:
    - Field references: {field_key}
    - Operators: +, -, *, /
    - Parentheses for grouping
    - Functions: sum(), avg(), min(), max()

    Examples:
    - GCS Total: "{eye_opening} + {verbal_response} + {motor_response}"
    - BMI: "{weight} / ({height} * {height})"
    - MAP: "({systolic} + 2 * {diastolic}) / 3"
    """

    # Pattern to match field references like {field_key}
    FIELD_PATTERN = re.compile(r'\{([a-z_][a-z0-9_]*)\}')

    # Pattern to match functions like sum(a, b, c)
    FUNCTION_PATTERN = re.compile(r'(sum|avg|min|max)\(([^)]+)\)')

    @classmethod
    def evaluate(cls, formula: str, data: dict) -> Any:
        """
        Evaluate a formula with the given data values.

        Args:
            formula: The formula string (e.g., "{a} + {b}")
            data: Dictionary mapping field_key to value

        Returns:
            The calculated result, or None if evaluation fails

        Raises:
            ValueError: If formula is invalid or references undefined fields
        """
        if not formula or not isinstance(formula, str):
            return None

        try:
            # Step 1: Replace function calls
            processed = cls._process_functions(formula, data)

            # Step 2: Replace field references with values
            processed = cls._substitute_fields(processed, data)

            # Step 3: Safely evaluate the expression
            result = cls._safe_eval(processed)

            # Round to reasonable precision
            if isinstance(result, float):
                result = round(result, 2)

            return result

        except (ValueError, ZeroDivisionError, InvalidOperation) as e:
            # Return None for invalid calculations
            return None

    @classmethod
    def _process_functions(cls, formula: str, data: dict) -> str:
        """Process function calls in the formula."""

        def replace_function(match):
            func_name = match.group(1)
            args_str = match.group(2)

            # Parse arguments (field references or numbers)
            args = [arg.strip() for arg in args_str.split(',')]
            values = []

            for arg in args:
                # Check if it's a field reference
                field_match = cls.FIELD_PATTERN.match(arg)
                if field_match:
                    field_key = field_match.group(1)
                    value = data.get(field_key)
                    if value is not None:
                        values.append(float(value))
                else:
                    # Try to parse as number
                    try:
                        values.append(float(arg))
                    except ValueError:
                        pass

            if not values:
                return '0'

            # Calculate function result
            if func_name == 'sum':
                return str(sum(values))
            elif func_name == 'avg':
                return str(sum(values) / len(values))
            elif func_name == 'min':
                return str(min(values))
            elif func_name == 'max':
                return str(max(values))

            return '0'

        return cls.FUNCTION_PATTERN.sub(replace_function, formula)

    @classmethod
    def _substitute_fields(cls, formula: str, data: dict) -> str:
        """Replace field references with their values."""

        def replace_field(match):
            field_key = match.group(1)
            value = data.get(field_key)

            if value is None:
                raise ValueError(f"Field '{field_key}' has no value")

            # Handle paired field values (e.g., blood pressure)
            if isinstance(value, dict):
                # For paired fields, we can't directly substitute
                raise ValueError(f"Field '{field_key}' is a paired field")

            return str(float(value))

        return cls.FIELD_PATTERN.sub(replace_field, formula)

    @classmethod
    def _safe_eval(cls, expression: str) -> float:
        """
        Safely evaluate an arithmetic expression.
        Only allows numbers, operators, parentheses, and whitespace.
        """
        # Validate expression contains only safe characters
        allowed = set('0123456789.+-*/() ')
        if not all(c in allowed for c in expression):
            raise ValueError("Invalid characters in expression")

        # Remove whitespace
        expression = expression.replace(' ', '')

        if not expression:
            raise ValueError("Empty expression")

        # Use a simple recursive descent parser for safety
        return cls._parse_expression(expression)

    @classmethod
    def _parse_expression(cls, expr: str) -> float:
        """Parse and evaluate expression using recursive descent."""
        pos = [0]  # Use list to allow modification in nested function

        def parse_number():
            start = pos[0]
            while pos[0] < len(expr) and (expr[pos[0]].isdigit() or expr[pos[0]] == '.'):
                pos[0] += 1
            if start == pos[0]:
                raise ValueError("Expected number")
            return float(expr[start:pos[0]])

        def parse_factor():
            if pos[0] < len(expr) and expr[pos[0]] == '(':
                pos[0] += 1
                result = parse_expr()
                if pos[0] >= len(expr) or expr[pos[0]] != ')':
                    raise ValueError("Missing closing parenthesis")
                pos[0] += 1
                return result
            elif pos[0] < len(expr) and expr[pos[0]] == '-':
                pos[0] += 1
                return -parse_factor()
            else:
                return parse_number()

        def parse_term():
            result = parse_factor()
            while pos[0] < len(expr) and expr[pos[0]] in '*/':
                op = expr[pos[0]]
                pos[0] += 1
                right = parse_factor()
                if op == '*':
                    result *= right
                else:
                    if right == 0:
                        raise ZeroDivisionError("Division by zero")
                    result /= right
            return result

        def parse_expr():
            result = parse_term()
            while pos[0] < len(expr) and expr[pos[0]] in '+-':
                op = expr[pos[0]]
                pos[0] += 1
                right = parse_term()
                if op == '+':
                    result += right
                else:
                    result -= right
            return result

        result = parse_expr()
        if pos[0] != len(expr):
            raise ValueError("Unexpected characters at end of expression")
        return result

    @classmethod
    def get_dependencies(cls, formula: str) -> list:
        """Extract all field keys that a formula depends on."""
        if not formula:
            return []

        dependencies = set()

        # Find direct field references
        for match in cls.FIELD_PATTERN.finditer(formula):
            dependencies.add(match.group(1))

        # Find field references in function arguments
        for match in cls.FUNCTION_PATTERN.finditer(formula):
            args_str = match.group(2)
            for arg in args_str.split(','):
                arg = arg.strip()
                field_match = cls.FIELD_PATTERN.match(arg)
                if field_match:
                    dependencies.add(field_match.group(1))

        return sorted(list(dependencies))


class CriticalValueChecker:
    """
    Checks chart entry values against critical ranges defined in field config.
    """

    COMPARISON_OPERATORS = {
        'equals': lambda a, b: a == b,
        'not_equals': lambda a, b: a != b,
        'greater_than': lambda a, b: a > b,
        'less_than': lambda a, b: a < b,
        'greater_than_or_equal': lambda a, b: a >= b,
        'less_than_or_equal': lambda a, b: a <= b,
        'in': lambda a, b: a in b if isinstance(b, (list, tuple)) else a == b,
        'not_in': lambda a, b: a not in b if isinstance(b, (list, tuple)) else a != b,
    }

    @classmethod
    def check_entry(cls, entry) -> tuple:
        """
        Check all values in a chart entry for critical values.

        Args:
            entry: ChartEntry instance

        Returns:
            Tuple of (has_critical, list_of_critical_field_keys)
        """
        critical_fields = []
        template = entry.assignment.template

        for field in template.fields.all():
            value = entry.data.get(field.field_key)

            if value is None:
                continue

            if cls._is_critical(field, value):
                critical_fields.append(field.field_key)

        return (len(critical_fields) > 0, critical_fields)

    @classmethod
    def _is_critical(cls, field, value) -> bool:
        """Check if a single value is critical based on field config."""
        config = field.config or {}

        if field.field_type == 'numeric':
            return cls._check_numeric_critical(value, config)
        elif field.field_type == 'scale':
            return cls._check_scale_critical(value, config)
        elif field.field_type == 'paired':
            return cls._check_paired_critical(value, config)

        return False

    @classmethod
    def _check_numeric_critical(cls, value, config: dict) -> bool:
        """Check if numeric value is outside critical range."""
        try:
            num_value = float(value)
        except (TypeError, ValueError):
            return False

        critical_low = config.get('critical_low')
        critical_high = config.get('critical_high')

        if critical_low is not None and num_value < float(critical_low):
            return True
        if critical_high is not None and num_value > float(critical_high):
            return True

        return False

    @classmethod
    def _check_scale_critical(cls, value, config: dict) -> bool:
        """Check if scale value hits critical threshold."""
        try:
            num_value = int(value)
        except (TypeError, ValueError):
            return False

        critical_value = config.get('critical_value')
        critical_direction = config.get('critical_direction', 'above')

        if critical_value is not None:
            if critical_direction == 'above' and num_value >= int(critical_value):
                return True
            if critical_direction == 'below' and num_value <= int(critical_value):
                return True

        return False

    @classmethod
    def _check_paired_critical(cls, value, config: dict) -> bool:
        """Check if paired field values are critical."""
        if not isinstance(value, dict):
            return False

        fields_config = config.get('fields', [])
        critical_low = config.get('critical_low', {})
        critical_high = config.get('critical_high', {})

        for field_def in fields_config:
            key = field_def.get('key')
            if not key or key not in value:
                continue

            try:
                num_value = float(value[key])
            except (TypeError, ValueError):
                continue

            low = critical_low.get(key)
            high = critical_high.get(key)

            if low is not None and num_value < float(low):
                return True
            if high is not None and num_value > float(high):
                return True

        return False


class ChartEntryService:
    """
    Service for creating and processing chart entries.
    """

    @classmethod
    def create_entry(cls, assignment, data: dict, recorded_by, user, notes: str = '',
                     observation_datetime=None) -> 'ChartEntry':
        """
        Create a new chart entry with computed fields and critical value detection.

        Args:
            assignment: ChartAssignment instance
            data: Dictionary of field_key -> value
            recorded_by: PractitionerProfile who recorded the entry
            user: User creating the entry (for audit)
            notes: Optional notes
            observation_datetime: When the observation was made (defaults to now)

        Returns:
            Created ChartEntry instance
        """
        from apps.charts.models import ChartEntry

        # Process calculated fields
        processed_data = cls._compute_calculated_fields(assignment.template, data)

        # Create entry
        entry = ChartEntry(
            assignment=assignment,
            data=processed_data,
            recorded_by=recorded_by,
            created_by=user,
            notes=notes,
        )

        if observation_datetime:
            entry.observation_datetime = observation_datetime

        # Check for critical values
        has_critical, critical_fields = CriticalValueChecker.check_entry(entry)
        entry.has_critical_values = has_critical
        entry.critical_fields = critical_fields

        entry.save()

        # Create alert if critical
        if has_critical:
            cls._create_critical_alert(entry, critical_fields)

        return entry

    @classmethod
    def _compute_calculated_fields(cls, template, data: dict) -> dict:
        """Compute values for calculated fields."""
        result = data.copy()

        for field in template.fields.filter(field_type='calculated'):
            config = field.config or {}
            formula = config.get('formula')

            if formula:
                computed_value = FormulaEvaluator.evaluate(formula, result)
                if computed_value is not None:
                    result[field.field_key] = computed_value

        return result

    @classmethod
    def _create_critical_alert(cls, entry, critical_fields: list):
        """Create a nursing alert for critical values."""
        try:
            from apps.nursing.models import NursingAlert

            # Get field names for the message
            field_names = []
            for field in entry.assignment.template.fields.filter(field_key__in=critical_fields):
                value = entry.data.get(field.field_key)
                field_names.append(f"{field.name}: {value}")

            message = f"Critical values recorded in {entry.assignment.template.name}: {', '.join(field_names)}"

            NursingAlert.objects.create(
                patient=entry.assignment.patient,
                facility=entry.assignment.patient.facility,
                alert_type='vital_signs',
                severity='high',
                message=message,
            )
        except ImportError:
            # NursingAlert not available, skip alert creation
            pass

    @classmethod
    def get_entry_summary(cls, assignment, start_date=None, end_date=None) -> dict:
        """
        Get summary statistics for chart entries.

        Returns dict with:
        - total_entries: count
        - critical_entries: count of entries with critical values
        - field_summaries: dict of field_key -> {min, max, avg, latest}
        """
        from django.db.models import Count, Avg, Min, Max, FloatField, Value, Case, When, Q
        from django.db.models.functions import Cast
        from django.db.models.fields.json import KeyTextTransform
        from apps.charts.models import ChartEntry

        entries = assignment.entries.filter(is_deleted=False)

        if start_date:
            entries = entries.filter(observation_datetime__gte=start_date)
        if end_date:
            entries = entries.filter(observation_datetime__lte=end_date)

        counts = entries.aggregate(
            total_entries=Count('id'),
            critical_entries=Count('id', filter=Q(has_critical_values=True)),
        )
        total = counts['total_entries'] or 0
        critical = counts['critical_entries'] or 0

        # Calculate field summaries for numeric fields
        field_summaries = {}
        numeric_fields = list(assignment.template.fields.filter(
            field_type__in=['numeric', 'scale', 'calculated']
        ).values_list('field_key', flat=True))

        aggregates = {}
        for field_key in numeric_fields:
            value_text = KeyTextTransform(field_key, 'data')
            numeric_value = Case(
                When(
                    **{f"data__{field_key}__regex": r"^-?\d+(\.\d+)?$"},
                    then=Cast(value_text, FloatField())
                ),
                default=Value(None),
                output_field=FloatField(),
            )
            aggregates[f"{field_key}__min"] = Min(numeric_value)
            aggregates[f"{field_key}__max"] = Max(numeric_value)
            aggregates[f"{field_key}__avg"] = Avg(numeric_value)
            aggregates[f"{field_key}__count"] = Count(numeric_value)

        if aggregates:
            agg_results = entries.aggregate(**aggregates)
            for field_key in numeric_fields:
                min_val = agg_results.get(f"{field_key}__min")
                if min_val is None:
                    continue
                avg_val = agg_results.get(f"{field_key}__avg")
                field_summaries[field_key] = {
                    'min': min_val,
                    'max': agg_results.get(f"{field_key}__max"),
                    'avg': round(avg_val, 2) if avg_val is not None else None,
                    'count': agg_results.get(f"{field_key}__count") or 0,
                }

        # Get latest entry
        latest = entries.order_by('-observation_datetime').first()

        return {
            'total_entries': total,
            'critical_entries': critical,
            'field_summaries': field_summaries,
            'latest_entry': latest,
            'start_date': start_date,
            'end_date': end_date,
        }

    @classmethod
    def get_trend_data(
        cls,
        assignment,
        field_key: str,
        limit: int = 50,
        component: str | None = None,
        start_date=None,
        end_date=None,
    ) -> list:
        """
        Get trend data for a specific field.

        Returns list of {datetime, value} dicts ordered chronologically.
        """
        field = assignment.template.fields.filter(field_key=field_key).first()
        entries = assignment.entries.filter(is_deleted=False)
        if start_date:
            entries = entries.filter(observation_datetime__gte=start_date)
        if end_date:
            entries = entries.filter(observation_datetime__lte=end_date)
        entries = entries.order_by('observation_datetime')[:limit]

        trend_data = []
        for entry in entries:
            value = cls._extract_trend_value(entry.data.get(field_key), component=component)
            if value is not None:
                trend_data.append({
                    'datetime': entry.observation_datetime.isoformat(),
                    'value': value,
                    'is_critical': field_key in entry.critical_fields,
                    'field_key': field_key,
                    'component': component or '',
                    'label': cls._resolve_trend_label(field, component=component),
                })

        return trend_data

    @staticmethod
    def _extract_trend_value(value, *, component=None):
        if isinstance(value, dict):
            if not component:
                return None
            value = value.get(component)

        if value is None:
            return None

        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _resolve_trend_label(field, *, component=None):
        if not field:
            return component or ''
        if not component:
            return field.name

        for field_def in (field.config or {}).get('fields', []):
            if field_def.get('key') == component:
                return field_def.get('label', component)
        return component


class ConditionalFieldChecker:
    """
    Evaluates conditional display rules for chart fields.
    """

    @classmethod
    def should_show_field(cls, field, data: dict) -> bool:
        """
        Check if a field should be shown based on its show_when condition.

        Args:
            field: ChartField instance
            data: Current form data

        Returns:
            True if field should be shown, False otherwise
        """
        if not field.show_when:
            return True

        condition = field.show_when
        target_field = condition.get('field')
        op = condition.get('operator', 'equals')
        expected_value = condition.get('value')

        if not target_field:
            return True

        actual_value = data.get(target_field)

        comparator = CriticalValueChecker.COMPARISON_OPERATORS.get(op)
        if comparator:
            try:
                return comparator(actual_value, expected_value)
            except (TypeError, ValueError):
                return False

        return True

    @classmethod
    def get_visible_fields(cls, template, data: dict) -> list:
        """
        Get list of fields that should be visible given current data.

        Args:
            template: ChartTemplate instance
            data: Current form data

        Returns:
            List of ChartField instances that should be shown
        """
        visible = []
        for field in template.fields.order_by('display_order'):
            if cls.should_show_field(field, data):
                visible.append(field)
        return visible
