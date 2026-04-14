"""
Chart Builder Serializers

Follows the List/Detail serializer pattern for API payload optimization.
"""

from datetime import timedelta
from rest_framework import serializers
from django.utils import timezone

from apps.charts.models import ChartTemplate, ChartField, ChartAssignment, ChartEntry
from apps.charts.services import FormulaEvaluator, ConditionalFieldChecker


# =============================================================================
# Field Serializers
# =============================================================================

class ChartFieldSerializer(serializers.ModelSerializer):
    """Full serializer for chart field configuration."""

    class Meta:
        model = ChartField
        fields = [
            'id', 'name', 'field_key', 'field_type',
            'display_order', 'group_name', 'help_text', 'icon',
            'is_required', 'config', 'show_when',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ChartFieldCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating chart fields with validation."""

    class Meta:
        model = ChartField
        fields = [
            'id', 'name', 'field_key', 'field_type',
            'display_order', 'group_name', 'help_text', 'icon',
            'is_required', 'config', 'show_when',
        ]
        read_only_fields = ['id']

    def validate_field_key(self, value):
        """Ensure field_key is snake_case and valid."""
        import re
        if not re.match(r'^[a-z][a-z0-9_]*$', value):
            raise serializers.ValidationError(
                "Field key must be lowercase with underscores (snake_case)"
            )
        return value

    def validate_config(self, value):
        """Validate config based on field_type."""
        field_type = self.initial_data.get('field_type', '')

        if field_type == 'numeric':
            return self._validate_numeric_config(value)
        elif field_type == 'select':
            return self._validate_select_config(value)
        elif field_type == 'scale':
            return self._validate_scale_config(value)
        elif field_type == 'calculated':
            return self._validate_calculated_config(value)
        elif field_type == 'paired':
            return self._validate_paired_config(value)
        elif field_type == 'body_map':
            return self._validate_body_map_config(value)

        return value

    def _validate_numeric_config(self, config):
        """Validate numeric field config."""
        if 'min' in config and 'max' in config:
            if config['min'] >= config['max']:
                raise serializers.ValidationError("min must be less than max")

        if 'critical_low' in config and 'critical_high' in config:
            if config['critical_low'] >= config['critical_high']:
                raise serializers.ValidationError(
                    "critical_low must be less than critical_high"
                )

        return config

    def _validate_select_config(self, config):
        """Validate select field config."""
        options = config.get('options', [])
        if not options:
            raise serializers.ValidationError("Select fields require at least one option")

        for opt in options:
            if 'value' not in opt or 'label' not in opt:
                raise serializers.ValidationError(
                    "Each option must have 'value' and 'label' properties"
                )

        return config

    def _validate_scale_config(self, config):
        """Validate scale field config."""
        if 'min' not in config or 'max' not in config:
            raise serializers.ValidationError("Scale fields require min and max")

        if config['min'] >= config['max']:
            raise serializers.ValidationError("min must be less than max")

        return config

    def _validate_calculated_config(self, config):
        """Validate calculated field config."""
        formula = config.get('formula')
        if not formula:
            raise serializers.ValidationError("Calculated fields require a formula")

        # Extract dependencies
        depends_on = FormulaEvaluator.get_dependencies(formula)
        config['depends_on'] = depends_on

        return config

    def _validate_paired_config(self, config):
        """Validate paired field config."""
        fields = config.get('fields', [])
        if len(fields) < 2:
            raise serializers.ValidationError(
                "Paired fields require at least two sub-fields"
            )

        for field in fields:
            if 'key' not in field or 'label' not in field:
                raise serializers.ValidationError(
                    "Each paired field must have 'key' and 'label' properties"
                )

        return config

    def _validate_body_map_config(self, config):
        mode = config.get('mode', 'pain')
        if mode not in {'pain', 'wound'}:
            raise serializers.ValidationError("Body map mode must be 'pain' or 'wound'")
        return config


# =============================================================================
# Template Serializers
# =============================================================================

class ChartTemplateListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for template lists."""

    created_by_name = serializers.SerializerMethodField()
    field_count = serializers.SerializerMethodField()
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    interval_display = serializers.CharField(source='get_default_interval_display', read_only=True)
    scope_type_display = serializers.CharField(source='get_scope_type_display', read_only=True)

    class Meta:
        model = ChartTemplate
        fields = [
            'id', 'facility', 'name', 'description', 'icon',
            'category', 'category_display',
            'scope_type', 'scope_type_display', 'system_key',
            'visibility', 'default_interval', 'interval_display',
            'field_count', 'is_active', 'is_system',
            'created_by_name', 'created_at',
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_field_count(self, obj):
        return getattr(obj, 'field_count_annotation', obj.fields.count())


class ChartTemplateSerializer(serializers.ModelSerializer):
    """Full serializer with nested fields."""

    fields = ChartFieldSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    interval_display = serializers.CharField(source='get_default_interval_display', read_only=True)
    visibility_display = serializers.CharField(source='get_visibility_display', read_only=True)
    display_mode_display = serializers.CharField(source='get_display_mode_display', read_only=True)
    scope_type_display = serializers.CharField(source='get_scope_type_display', read_only=True)

    class Meta:
        model = ChartTemplate
        fields = [
            'id', 'facility', 'name', 'description', 'icon',
            'visibility', 'visibility_display', 'department',
            'category', 'category_display',
            'scope_type', 'scope_type_display', 'system_key',
            'default_interval', 'interval_display',
            'display_mode', 'display_mode_display',
            'columns_per_page',
            'is_active', 'is_system', 'version',
            'fields',
            'created_by', 'created_by_name', 'created_at',
            'updated_by', 'updated_by_name', 'updated_at',
        ]
        read_only_fields = ['id', 'facility', 'is_system', 'version', 'created_by', 'created_at', 'updated_by', 'updated_at']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_updated_by_name(self, obj):
        if obj.updated_by:
            return obj.updated_by.get_full_name() or obj.updated_by.username
        return None


class ChartTemplateCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating templates."""

    class Meta:
        model = ChartTemplate
        fields = [
            'id', 'name', 'description', 'icon',
            'visibility', 'department',
            'category', 'scope_type', 'system_key', 'default_interval', 'display_mode',
            'columns_per_page', 'is_active',
        ]
        read_only_fields = ['id']

    def validate_name(self, value):
        """Ensure name is not empty and reasonably sized."""
        if not value or len(value.strip()) < 3:
            raise serializers.ValidationError("Name must be at least 3 characters")
        return value.strip()

    def validate(self, attrs):
        if not attrs.get('scope_type'):
            attrs['scope_type'] = ChartTemplate.resolve_default_scope_type(
                category=attrs.get('category'),
                system_key=attrs.get('system_key'),
            )
        return attrs


# =============================================================================
# Assignment Serializers
# =============================================================================

class ChartAssignmentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for assignment lists."""

    template_name = serializers.CharField(source='template.name', read_only=True)
    template_icon = serializers.CharField(source='template.icon', read_only=True)
    template_category = serializers.CharField(source='template.category', read_only=True)
    template_scope_type = serializers.CharField(source='template.scope_type', read_only=True)
    template_system_key = serializers.CharField(source='template.system_key', read_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    ordered_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    effective_interval = serializers.CharField(read_only=True)
    last_entry_at = serializers.SerializerMethodField()
    next_due_at = serializers.SerializerMethodField()
    entry_count = serializers.SerializerMethodField()

    class Meta:
        model = ChartAssignment
        fields = [
            'id', 'template', 'template_name', 'template_icon', 'template_category',
            'template_scope_type', 'template_system_key',
            'patient', 'patient_name', 'patient_mrn',
            'admission', 'encounter',
            'status', 'status_display',
            'effective_interval',
            'start_datetime', 'end_datetime',
            'ordered_by_name',
            'last_entry_at', 'next_due_at', 'entry_count',
            'created_at',
        ]

    def get_patient_name(self, obj):
        return obj.patient.user.get_full_name()

    def get_ordered_by_name(self, obj):
        if obj.ordered_by and obj.ordered_by.staff:
            return obj.ordered_by.staff.user.get_full_name()
        return None

    def get_last_entry_at(self, obj):
        last_entry_at = getattr(obj, 'last_entry_at', None)
        if last_entry_at:
            return last_entry_at
        last = obj.get_last_entry()
        return last.observation_datetime if last else None

    def get_next_due_at(self, obj):
        if obj.status != 'active':
            return None
        last_entry_at = getattr(obj, 'last_entry_at', None)
        base_time = last_entry_at or obj.start_datetime

        interval_minutes = {
            '15min': 15,
            '30min': 30,
            'hourly': 60,
            '2hourly': 120,
            '4hourly': 240,
            '6hourly': 360,
            '8hourly': 480,
            'shift': 480,
            'daily': 1440,
        }
        minutes = interval_minutes.get(obj.effective_interval)
        if not minutes or not base_time:
            return None

        return base_time + timedelta(minutes=minutes)

    def get_entry_count(self, obj):
        entry_count = getattr(obj, 'entry_count', None)
        if entry_count is not None:
            return entry_count
        return obj.entries.filter(is_deleted=False).count()


class ChartAssignmentSerializer(serializers.ModelSerializer):
    """Full serializer with template and patient details."""

    template = ChartTemplateSerializer(read_only=True)
    template_id = serializers.UUIDField(write_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    ordered_by_name = serializers.SerializerMethodField()
    discontinued_by_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    effective_interval = serializers.CharField(read_only=True)
    scope_type = serializers.CharField(source='template.scope_type', read_only=True)
    system_key = serializers.CharField(source='template.system_key', read_only=True)
    last_entry = serializers.SerializerMethodField()
    next_due_at = serializers.SerializerMethodField()
    entry_count = serializers.SerializerMethodField()
    critical_entry_count = serializers.SerializerMethodField()

    class Meta:
        model = ChartAssignment
        fields = [
            'id', 'template', 'template_id',
            'scope_type', 'system_key',
            'patient', 'patient_name', 'patient_mrn',
            'admission', 'encounter',
            'monitoring_interval', 'effective_interval',
            'start_datetime', 'end_datetime',
            'status', 'status_display',
            'reason', 'instructions',
            'ordered_by', 'ordered_by_name',
            'discontinued_at', 'discontinued_by', 'discontinued_by_name',
            'discontinuation_reason',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
            'last_entry', 'next_due_at',
            'entry_count', 'critical_entry_count',
        ]
        read_only_fields = [
            'id', 'template', 'discontinued_at', 'discontinued_by',
            'created_at', 'updated_at', 'created_by',
        ]

    def get_patient_name(self, obj):
        return obj.patient.user.get_full_name()

    def get_ordered_by_name(self, obj):
        if obj.ordered_by and obj.ordered_by.staff:
            return obj.ordered_by.staff.user.get_full_name()
        return None

    def get_discontinued_by_name(self, obj):
        if obj.discontinued_by:
            return obj.discontinued_by.get_full_name() or obj.discontinued_by.username
        return None

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_last_entry(self, obj):
        last = obj.get_last_entry()
        if last:
            return ChartEntryListSerializer(last).data
        return None

    def get_next_due_at(self, obj):
        if obj.status != 'active':
            return None
        return obj.get_next_due()

    def get_entry_count(self, obj):
        return obj.entries.filter(is_deleted=False).count()

    def get_critical_entry_count(self, obj):
        return obj.entries.filter(is_deleted=False, has_critical_values=True).count()


class ChartAssignmentCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating assignments."""

    template_id = serializers.UUIDField()

    class Meta:
        model = ChartAssignment
        fields = [
            'id', 'template_id', 'patient', 'admission', 'encounter',
            'monitoring_interval', 'start_datetime', 'end_datetime',
            'reason', 'instructions', 'ordered_by',
        ]
        read_only_fields = ['id']

    def validate(self, data):
        """Ensure template exists and admission belongs to patient."""
        template_id = data.get('template_id')
        try:
            template = ChartTemplate.objects.get(id=template_id, is_active=True)
            data['template'] = template
        except ChartTemplate.DoesNotExist:
            raise serializers.ValidationError({"template_id": "Template not found or inactive"})

        patient = data.get('patient')
        admission = data.get('admission')
        encounter = data.get('encounter')

        if admission and admission.patient != patient:
            raise serializers.ValidationError(
                {"admission": "Admission does not belong to selected patient"}
            )

        template_scope = template.scope_type

        if template_scope == 'encounter':
            if not encounter:
                raise serializers.ValidationError(
                    {"encounter": "Encounter-scoped charts require an encounter"}
                )
            if getattr(encounter, 'patient_id', None) != patient.id:
                raise serializers.ValidationError(
                    {"encounter": "Encounter does not belong to selected patient"}
                )
            data['admission'] = None
        elif template_scope == 'admission':
            if not admission:
                raise serializers.ValidationError(
                    {"admission": "Admission-scoped charts require an admission"}
                )
            data['encounter'] = None
        else:
            data['encounter'] = None
            data['admission'] = None

        return data

    def create(self, validated_data):
        validated_data.pop('template_id', None)
        return super().create(validated_data)


# =============================================================================
# Entry Serializers
# =============================================================================

class ChartEntryListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for entry lists (no JSON payload)."""

    recorded_by_name = serializers.SerializerMethodField()
    template_name = serializers.CharField(source='assignment.template.name', read_only=True)
    template_system_key = serializers.CharField(source='assignment.template.system_key', read_only=True)

    class Meta:
        model = ChartEntry
        fields = [
            'id', 'assignment',
            'observation_datetime',
            'has_critical_values',
            'recorded_by_name', 'template_name', 'template_system_key',
            'created_at',
        ]

    def get_recorded_by_name(self, obj):
        if obj.recorded_by and obj.recorded_by.staff:
            return obj.recorded_by.staff.user.get_full_name()
        return None


class ChartEntryListWithDataSerializer(ChartEntryListSerializer):
    """List serializer that includes entry data for grid views."""

    class Meta(ChartEntryListSerializer.Meta):
        fields = ChartEntryListSerializer.Meta.fields + ['data']


class ChartEntrySerializer(serializers.ModelSerializer):
    """Full serializer with assignment details."""

    recorded_by_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    modified_by_name = serializers.SerializerMethodField()
    deleted_by_name = serializers.SerializerMethodField()
    template_name = serializers.CharField(source='assignment.template.name', read_only=True)
    template_system_key = serializers.CharField(source='assignment.template.system_key', read_only=True)
    patient_name = serializers.SerializerMethodField()

    class Meta:
        model = ChartEntry
        fields = [
            'id', 'assignment',
            'observation_datetime',
            'data',
            'has_critical_values', 'critical_fields',
            'notes',
            'recorded_by', 'recorded_by_name',
            'template_name', 'template_system_key', 'patient_name',
            'is_deleted', 'deleted_at', 'deleted_by', 'deleted_by_name',
            'deletion_reason',
            'created_at', 'updated_at',
            'created_by', 'created_by_name',
            'modified_by', 'modified_by_name',
        ]
        read_only_fields = [
            'id', 'has_critical_values', 'critical_fields',
            'is_deleted', 'deleted_at', 'deleted_by', 'deletion_reason',
            'created_at', 'updated_at', 'created_by', 'modified_by',
        ]

    def get_recorded_by_name(self, obj):
        if obj.recorded_by and obj.recorded_by.staff:
            return obj.recorded_by.staff.user.get_full_name()
        return None

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_modified_by_name(self, obj):
        if obj.modified_by:
            return obj.modified_by.get_full_name() or obj.modified_by.username
        return None

    def get_deleted_by_name(self, obj):
        if obj.deleted_by:
            return obj.deleted_by.get_full_name() or obj.deleted_by.username
        return None

    def get_patient_name(self, obj):
        return obj.assignment.patient.user.get_full_name()


class ChartEntryCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating entries with validation against template schema."""

    class Meta:
        model = ChartEntry
        fields = [
            'id', 'assignment', 'observation_datetime',
            'data', 'notes', 'recorded_by',
        ]
        read_only_fields = ['id']

    def validate(self, data):
        """Validate data against template field definitions."""
        assignment = data.get('assignment')
        entry_data = data.get('data', {})

        if not assignment:
            raise serializers.ValidationError({"assignment": "Assignment is required"})

        if assignment.status != 'active':
            raise serializers.ValidationError(
                {"assignment": "Cannot add entries to inactive chart assignment"}
            )

        # Validate each field against template
        template = assignment.template
        errors = {}

        for field in template.fields.all():
            value = entry_data.get(field.field_key)

            # Check required fields
            if field.is_required and value is None:
                # Check if field should be shown based on conditions
                if ConditionalFieldChecker.should_show_field(field, entry_data):
                    errors[field.field_key] = f"{field.name} is required"
                    continue

            if value is not None:
                field_error = self._validate_field_value(field, value)
                if field_error:
                    errors[field.field_key] = field_error

        if errors:
            raise serializers.ValidationError({"data": errors})

        return data

    def _validate_field_value(self, field, value):
        """Validate a single field value against its config."""
        config = field.config or {}

        if field.field_type == 'numeric':
            return self._validate_numeric(value, config)
        elif field.field_type == 'select':
            return self._validate_select(value, config)
        elif field.field_type == 'multi_select':
            return self._validate_multi_select(value, config)
        elif field.field_type == 'scale':
            return self._validate_scale(value, config)
        elif field.field_type == 'text':
            return self._validate_text(value, config)
        elif field.field_type == 'textarea':
            return self._validate_text(value, config)
        elif field.field_type == 'paired':
            return self._validate_paired(value, config)
        elif field.field_type == 'boolean':
            return self._validate_boolean(value)
        elif field.field_type == 'body_map':
            return self._validate_body_map(value)

        return None

    def _validate_numeric(self, value, config):
        try:
            num = float(value)
        except (TypeError, ValueError):
            return "Must be a number"

        min_val = config.get('min')
        max_val = config.get('max')

        if min_val is not None and num < min_val:
            return f"Must be at least {min_val}"
        if max_val is not None and num > max_val:
            return f"Must be at most {max_val}"

        return None

    def _validate_select(self, value, config):
        options = config.get('options', [])
        valid_values = [opt.get('value') for opt in options]

        if value not in valid_values:
            return "Invalid selection"

        return None

    def _validate_multi_select(self, value, config):
        if not isinstance(value, list):
            return "Must be a list of selections"

        options = config.get('options', [])
        valid_values = [opt.get('value') for opt in options]

        for v in value:
            if v not in valid_values:
                return f"Invalid selection: {v}"

        return None

    def _validate_scale(self, value, config):
        try:
            num = int(value)
        except (TypeError, ValueError):
            return "Must be an integer"

        min_val = config.get('min', 1)
        max_val = config.get('max', 10)

        if num < min_val or num > max_val:
            return f"Must be between {min_val} and {max_val}"

        return None

    def _validate_text(self, value, config):
        if not isinstance(value, str):
            return "Must be text"

        max_length = config.get('max_length')
        if max_length and len(value) > max_length:
            return f"Must be at most {max_length} characters"

        return None

    def _validate_paired(self, value, config):
        if not isinstance(value, dict):
            return "Must be an object with paired values"

        fields = config.get('fields', [])
        for field_def in fields:
            key = field_def.get('key')
            if key and key not in value:
                return f"Missing value for {field_def.get('label', key)}"

        return None

    def _validate_boolean(self, value):
        if not isinstance(value, bool):
            return "Must be true or false"
        return None

    def _validate_body_map(self, value):
        if not isinstance(value, dict):
            return "Must be an object with body map coordinates"
        if not value.get('region'):
            return "Body map requires a region"
        return None


class ChartEntrySummarySerializer(serializers.Serializer):
    """Serializer for entry summary data."""

    total_entries = serializers.IntegerField()
    critical_entries = serializers.IntegerField()
    field_summaries = serializers.DictField()
    latest_entry = ChartEntryListSerializer(allow_null=True)
    start_date = serializers.DateTimeField(allow_null=True)
    end_date = serializers.DateTimeField(allow_null=True)


class ChartEntryTrendSerializer(serializers.Serializer):
    """Serializer for trend data."""

    datetime = serializers.DateTimeField()
    value = serializers.FloatField()
    is_critical = serializers.BooleanField()
    field_key = serializers.CharField(required=False)
    component = serializers.CharField(required=False, allow_blank=True)
    label = serializers.CharField(required=False, allow_blank=True)
