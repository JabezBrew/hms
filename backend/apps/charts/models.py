"""
Clinical Chart Builder Models

This module provides a flexible chart building system that allows practitioners
to create custom clinical monitoring charts without code changes.
"""

import uuid
from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.utils import timezone


class ChartTemplate(models.Model):
    """
    Defines a reusable chart structure (e.g., "Neurological Observation Chart").
    Practitioners can create templates with various field types and validation rules.
    """

    VISIBILITY_CHOICES = [
        ('private', 'Private'),
        ('role', 'Same Role'),
        ('department', 'Department'),
        ('facility', 'Facility-Wide'),
    ]

    CATEGORY_CHOICES = [
        ('neurological', 'Neurological'),
        ('cardiovascular', 'Cardiovascular'),
        ('respiratory', 'Respiratory'),
        ('metabolic', 'Metabolic'),
        ('fluid_balance', 'Fluid Balance'),
        ('pain', 'Pain Assessment'),
        ('wound', 'Wound Care'),
        ('infection', 'Infection Control'),
        ('nutrition', 'Nutrition'),
        ('mobility', 'Mobility'),
        ('safety', 'Safety Assessment'),
        ('custom', 'Custom'),
    ]

    INTERVAL_CHOICES = [
        ('15min', 'Every 15 Minutes'),
        ('30min', 'Every 30 Minutes'),
        ('hourly', 'Hourly'),
        ('2hourly', 'Every 2 Hours'),
        ('4hourly', 'Every 4 Hours'),
        ('6hourly', 'Every 6 Hours'),
        ('8hourly', 'Every 8 Hours'),
        ('shift', 'Per Shift'),
        ('daily', 'Daily'),
        ('custom', 'Custom'),
    ]

    DISPLAY_MODE_CHOICES = [
        ('table', 'Table View'),
        ('grid', 'Grid View'),
        ('timeline', 'Timeline View'),
    ]

    SCOPE_TYPE_CHOICES = [
        ('encounter', 'Encounter'),
        ('admission', 'Admission'),
        ('patient', 'Patient'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='chart_templates',
        help_text="Facility that owns this chart template"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, default='clipboard-list')

    # Sharing/visibility controls
    visibility = models.CharField(
        max_length=20,
        choices=VISIBILITY_CHOICES,
        default='private'
    )
    department = models.CharField(max_length=100, blank=True, null=True)

    # Organization
    category = models.CharField(
        max_length=50,
        choices=CATEGORY_CHOICES,
        default='custom'
    )
    scope_type = models.CharField(
        max_length=20,
        choices=SCOPE_TYPE_CHOICES,
        default='patient',
        help_text='Primary clinical scope for assignments and review context'
    )
    system_key = models.CharField(
        max_length=50,
        blank=True,
        default='',
        help_text='Stable key for seeded system templates'
    )

    # Display configuration
    default_interval = models.CharField(
        max_length=20,
        choices=INTERVAL_CHOICES,
        default='hourly'
    )
    display_mode = models.CharField(
        max_length=20,
        choices=DISPLAY_MODE_CHOICES,
        default='table'
    )
    columns_per_page = models.PositiveSmallIntegerField(
        default=24,
        validators=[MinValueValidator(1), MaxValueValidator(48)],
        help_text='Number of time columns to display (for table/grid view)'
    )

    # Status flags
    is_active = models.BooleanField(default=True)
    is_system = models.BooleanField(
        default=False,
        help_text='System-provided templates cannot be deleted'
    )

    # Version tracking for template changes
    version = models.PositiveIntegerField(default=1)

    # Audit fields
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_chart_templates'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_chart_templates'
    )

    class Meta:
        ordering = ['category', 'name']
        indexes = [
            models.Index(fields=['facility', 'visibility']),
            models.Index(fields=['visibility', 'is_active']),
            models.Index(fields=['category', 'is_active']),
            models.Index(fields=['scope_type', 'is_active']),
            models.Index(fields=['created_by', 'visibility']),
            models.Index(fields=['name']),
            models.Index(fields=['facility', 'system_key']),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_category_display()})"

    @classmethod
    def resolve_default_scope_type(cls, *, category=None, system_key=None):
        if system_key in {'vital_signs', 'pain_assessment'}:
            return 'encounter'
        if system_key in {'fluid_balance', 'gcs', 'wound_body_map'}:
            return 'admission'

        category_defaults = {
            'cardiovascular': 'encounter',
            'respiratory': 'encounter',
            'pain': 'encounter',
            'fluid_balance': 'admission',
            'neurological': 'admission',
            'wound': 'admission',
        }
        return category_defaults.get(category, 'patient')

    def clone(self, user, new_name=None):
        """Create a copy of this template for customization."""
        cloned = ChartTemplate.objects.create(
            name=new_name or f"{self.name} (Copy)",
            description=self.description,
            icon=self.icon,
            visibility='private',
            department=self.department,
            category=self.category,
            scope_type=self.scope_type,
            default_interval=self.default_interval,
            display_mode=self.display_mode,
            columns_per_page=self.columns_per_page,
            created_by=user,
            facility=self.facility,
        )

        # Clone all fields
        for field in self.fields.all():
            ChartField.objects.create(
                template=cloned,
                name=field.name,
                field_key=field.field_key,
                field_type=field.field_type,
                display_order=field.display_order,
                group_name=field.group_name,
                help_text=field.help_text,
                icon=field.icon,
                is_required=field.is_required,
                config=field.config.copy() if field.config else {},
                show_when=field.show_when.copy() if field.show_when else None,
            )

        return cloned


class ChartField(models.Model):
    """
    Defines individual fields within a chart template.
    Supports various field types with type-specific configuration.
    """

    FIELD_TYPE_CHOICES = [
        ('numeric', 'Numeric'),
        ('select', 'Single Select'),
        ('multi_select', 'Multi Select'),
        ('scale', 'Scale'),
        ('text', 'Text'),
        ('textarea', 'Text Area'),
        ('calculated', 'Calculated'),
        ('paired', 'Paired Fields'),
        ('time', 'Time'),
        ('boolean', 'Yes/No'),
        ('body_map', 'Body Map'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        ChartTemplate,
        on_delete=models.CASCADE,
        related_name='fields'
    )

    # Field definition
    name = models.CharField(max_length=100, help_text='Display name for the field')
    field_key = models.CharField(
        max_length=50,
        help_text='Internal key for data storage (snake_case)'
    )
    field_type = models.CharField(max_length=20, choices=FIELD_TYPE_CHOICES)

    # Display settings
    display_order = models.PositiveSmallIntegerField(default=0)
    group_name = models.CharField(
        max_length=100,
        blank=True,
        help_text='Group related fields together'
    )
    help_text = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True)

    # Validation
    is_required = models.BooleanField(default=False)

    # Type-specific configuration (stored as JSON)
    # Examples by type:
    # numeric: {"unit": "mmHg", "min": 0, "max": 300, "decimals": 0,
    #           "critical_low": 90, "critical_high": 180}
    # select: {"options": [{"value": "alert", "label": "Alert"}], "searchable": false}
    # scale: {"min": 1, "max": 10, "step": 1, "labels": {"1": "None", "10": "Severe"}}
    # calculated: {"formula": "{systolic} - {diastolic}", "depends_on": ["systolic", "diastolic"]}
    # paired: {"fields": [{"key": "systolic", "label": "Systolic"},
    #          {"key": "diastolic", "label": "Diastolic"}], "separator": "/", "unit": "mmHg"}
    config = models.JSONField(default=dict, blank=True)

    # Conditional display
    # Example: {"field": "consciousness", "operator": "equals", "value": "unconscious"}
    show_when = models.JSONField(null=True, blank=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['template', 'display_order', 'name']
        unique_together = ('template', 'field_key')
        indexes = [
            models.Index(fields=['template', 'display_order']),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_field_type_display()})"

    def get_default_value(self):
        """Return the default value based on field type."""
        defaults = {
            'numeric': None,
            'select': None,
            'multi_select': [],
            'scale': None,
            'text': '',
            'textarea': '',
            'calculated': None,
            'paired': {},
            'time': None,
            'boolean': None,
            'body_map': {},
        }
        return self.config.get('default', defaults.get(self.field_type))


class ChartAssignment(models.Model):
    """
    Assigns a chart template to a patient/admission for monitoring.
    Tracks which charts are actively being used for a patient.
    """

    STATUS_CHOICES = [
        ('active', 'Active'),
        ('paused', 'Paused'),
        ('completed', 'Completed'),
        ('discontinued', 'Discontinued'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        ChartTemplate,
        on_delete=models.PROTECT,
        related_name='assignments'
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='chart_assignments'
    )
    admission = models.ForeignKey(
        'wards.Admission',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='chart_assignments'
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='chart_assignments'
    )

    # Monitoring configuration (can override template defaults)
    monitoring_interval = models.CharField(
        max_length=20,
        choices=ChartTemplate.INTERVAL_CHOICES,
        blank=True,
        help_text='Override template default interval'
    )
    start_datetime = models.DateTimeField(default=timezone.now)
    end_datetime = models.DateTimeField(null=True, blank=True)

    # Status
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='active'
    )

    # Clinical context
    reason = models.TextField(
        blank=True,
        help_text='Why this chart was ordered'
    )
    instructions = models.TextField(
        blank=True,
        help_text='Special instructions for recording'
    )

    # Ordering practitioner
    ordered_by = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.SET_NULL,
        null=True,
        related_name='chart_orders'
    )

    # Discontinuation tracking
    discontinued_at = models.DateTimeField(null=True, blank=True)
    discontinued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='discontinued_chart_assignments'
    )
    discontinuation_reason = models.TextField(blank=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_chart_assignments'
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['admission', 'status']),
            models.Index(fields=['template', 'status']),
            models.Index(fields=['status', '-created_at']),
        ]

    def __str__(self):
        return f"{self.template.name} for {self.patient}"

    @property
    def scope_type(self):
        return self.template.scope_type

    def clean(self):
        from django.core.exceptions import ValidationError

        template_scope = self.template.scope_type if self.template_id and self.template else None

        if template_scope == 'encounter':
            if not self.encounter_id:
                raise ValidationError({'encounter': 'Encounter-scoped charts require an encounter.'})
            self.admission = None
        elif template_scope == 'admission':
            if not self.admission_id:
                raise ValidationError({'admission': 'Admission-scoped charts require an admission.'})
            self.encounter = None
        elif template_scope == 'patient':
            self.encounter = None
            self.admission = None

    def save(self, **kwargs):
        if self.template_id:
            scope = self.template.scope_type
            if scope == 'encounter':
                self.admission = None
            elif scope == 'admission':
                self.encounter = None
            elif scope == 'patient':
                self.encounter = None
                self.admission = None
        super().save(**kwargs)

    @property
    def effective_interval(self):
        """Return the monitoring interval to use (override or template default)."""
        return self.monitoring_interval or self.template.default_interval

    def get_last_entry(self):
        """Return the most recent entry for this assignment."""
        return self.entries.filter(is_deleted=False).order_by('-observation_datetime').first()

    def get_next_due(self):
        """Calculate when the next entry is due based on interval."""
        from datetime import timedelta

        interval_minutes = {
            '15min': 15,
            '30min': 30,
            'hourly': 60,
            '2hourly': 120,
            '4hourly': 240,
            '6hourly': 360,
            '8hourly': 480,
            'shift': 480,  # Assume 8-hour shifts
            'daily': 1440,
            'custom': None,
        }

        last_entry = self.get_last_entry()
        minutes = interval_minutes.get(self.effective_interval)

        if not minutes:
            return None

        base_time = last_entry.observation_datetime if last_entry else self.start_datetime
        return base_time + timedelta(minutes=minutes)

    def discontinue(self, user, reason=''):
        """Discontinue this chart assignment."""
        self.status = 'discontinued'
        self.discontinued_at = timezone.now()
        self.discontinued_by = user
        self.discontinuation_reason = reason
        self.save()


class ChartEntry(models.Model):
    """
    Individual observation entry for a chart.
    Stores time-stamped data following the template structure.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    assignment = models.ForeignKey(
        ChartAssignment,
        on_delete=models.CASCADE,
        related_name='entries'
    )

    # Time of observation
    observation_datetime = models.DateTimeField(default=timezone.now)

    # Data storage - keys match ChartField.field_key
    data = models.JSONField(default=dict)

    # Computed values (denormalized for quick access)
    has_critical_values = models.BooleanField(default=False)
    critical_fields = models.JSONField(
        default=list,
        help_text='List of field_keys with critical values'
    )

    # Notes
    notes = models.TextField(blank=True)

    # Staff attribution
    recorded_by = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.SET_NULL,
        null=True,
        related_name='chart_entries'
    )

    # Soft delete support
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_chart_entries'
    )
    deletion_reason = models.TextField(blank=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_chart_entries'
    )
    modified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='modified_chart_entries'
    )

    class Meta:
        ordering = ['-observation_datetime']
        verbose_name_plural = 'Chart entries'
        indexes = [
            models.Index(fields=['assignment', '-observation_datetime']),
            models.Index(fields=['assignment', 'is_deleted', '-observation_datetime']),
            models.Index(fields=['has_critical_values', '-observation_datetime']),
            models.Index(fields=['recorded_by', '-observation_datetime']),
        ]

    def __str__(self):
        return f"{self.assignment.template.name} entry at {self.observation_datetime}"

    def soft_delete(self, user, reason=''):
        """Soft delete this entry with audit trail."""
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.deleted_by = user
        self.deletion_reason = reason
        self.save()

    def get_field_value(self, field_key):
        """Get the value for a specific field."""
        return self.data.get(field_key)

    def set_field_value(self, field_key, value):
        """Set the value for a specific field."""
        self.data[field_key] = value
