import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db.models import Q
from django.utils import timezone
from decimal import Decimal

from ..users.models import PatientProfile
from ..wards.models import Admission
from ..appointments.models import AppointmentType

User = get_user_model()


def today_date():
    """Return today's date (not datetime) for DateField defaults."""
    return timezone.now().date()


class ServiceCategory(models.Model):
    """
    Model for categorizing billable services.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='service_categories',
        help_text="Facility that owns this service category"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_service_categories')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_service_categories')
    
    class Meta:
        verbose_name_plural = "Service Categories"
        ordering = ['name']
        indexes = [
            models.Index(fields=['facility', 'name']),
        ]
    
    def __str__(self):
        return self.name


class Service(models.Model):
    """
    Model for billable services.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='services',
        help_text="Facility that owns this service"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    category = models.ForeignKey(ServiceCategory, on_delete=models.CASCADE, related_name='services')
    code = models.CharField(max_length=20)
    
    # Pricing
    base_price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_services')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_services')
    
    class Meta:
        ordering = ['category__name', 'name']
        constraints = [
            models.UniqueConstraint(fields=['facility', 'code'], name='service_facility_code_uniq'),
        ]
        indexes = [
            models.Index(fields=['facility', 'code']),
            models.Index(fields=['facility', 'is_active']),
        ]
    
    def __str__(self):
        return f"{self.name} ({self.code})"
    
    @property
    def total_price(self):
        """
        Calculate the total price including tax.
        """
        return self.base_price * (1 + self.tax_rate / 100)


# =============================================================================
# Price Override Models (Multi-Facility Support)
# =============================================================================

class ServicePrice(models.Model):
    """
    Price overrides for services by facility, department, and time context.

    Falls back to Service.base_price if no override exists.

    Resolution order (most specific to least specific):
    1. Facility + Department + Context specific
    2. Facility + Context specific
    3. Department + Context specific (any facility)
    4. Context specific (any facility/dept)
    5. Service.base_price (global default)
    """

    PRICE_CONTEXT_CHOICES = [
        ('regular', 'Regular Hours'),
        ('after_hours', 'After Hours'),
        ('weekend', 'Weekend'),
        ('holiday', 'Holiday'),
        ('emergency', 'Emergency'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    service = models.ForeignKey(
        Service,
        on_delete=models.CASCADE,
        related_name='price_overrides'
    )

    # Scope (null = applies to all)
    facility = models.ForeignKey(
        'core.Facility',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='service_prices',
        help_text="Specific facility for this price (null = all facilities)"
    )
    department = models.ForeignKey(
        'core.Department',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='service_prices',
        help_text="Specific department for this price (null = all departments)"
    )
    clinical_unit = models.ForeignKey(
        'organization.ClinicalUnit',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='service_prices',
        help_text="Specific clinical unit for this price (null = all units)"
    )

    # Time context
    price_context = models.CharField(
        max_length=20,
        choices=PRICE_CONTEXT_CHOICES,
        default='regular'
    )

    # Pricing
    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Override price for this context"
    )
    tax_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Override tax rate (null = use service default)"
    )

    # Validity period (for time-limited pricing like promotions)
    effective_from = models.DateField(
        help_text="Date from which this price is effective"
    )
    effective_until = models.DateField(
        null=True,
        blank=True,
        help_text="Date until which this price is effective (null = indefinite)"
    )

    # Status
    is_active = models.BooleanField(default=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_service_prices'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_service_prices'
    )

    class Meta:
        verbose_name = "Service Price Override"
        verbose_name_plural = "Service Price Overrides"
        ordering = ['-effective_from', 'service__name']
        # Ensure unique combination of scope and context for a given effective date
        constraints = [
            models.UniqueConstraint(
                fields=['service', 'facility', 'department', 'clinical_unit', 'price_context', 'effective_from'],
                name='unique_service_price_override_v2'
            )
        ]
        indexes = [
            models.Index(fields=['service', 'facility', 'department', 'price_context']),
            models.Index(fields=['service', 'clinical_unit', 'price_context']),
            models.Index(fields=['service', 'is_active']),
            models.Index(fields=['effective_from', 'effective_until']),
        ]

    def __str__(self):
        parts = [self.service.name]
        if self.facility:
            parts.append(f"@ {self.facility.code}")
        if self.department:
            parts.append(f"/ {self.department.code}")
        if self.price_context != 'regular':
            parts.append(f"({self.get_price_context_display()})")
        return ' '.join(parts)

    def clean(self):
        """Validate the price override."""
        from django.core.exceptions import ValidationError

        # If department is specified, ensure it belongs to the specified facility
        if self.department and self.facility:
            if self.department.facility_id != self.facility_id:
                raise ValidationError({
                    'department': 'Department must belong to the specified facility.'
                })

        # Ensure effective_until is after effective_from
        if self.effective_until and self.effective_until < self.effective_from:
            raise ValidationError({
                'effective_until': 'Effective until date must be after effective from date.'
            })

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def is_currently_effective(self):
        """Check if this price override is currently effective."""
        today = timezone.now().date()
        if not self.is_active:
            return False
        if self.effective_from > today:
            return False
        if self.effective_until and self.effective_until < today:
            return False
        return True

    @property
    def effective_tax_rate(self):
        """Get the effective tax rate (override or service default)."""
        return self.tax_rate if self.tax_rate is not None else self.service.tax_rate

    @property
    def total_price(self):
        """Calculate total price including tax."""
        return self.price * (1 + self.effective_tax_rate / 100)


# =============================================================================
# Billing Rules Models
# =============================================================================

class BillingRule(models.Model):
    """
    Configurable billing rules for discounts, surcharges, and adjustments.

    Hybrid approach: predefined rule types with configurable parameters.
    This allows admins to configure rules without writing code while
    maintaining type safety and validation.

    Security notes:
    - JSON parameters are validated against predefined schemas
    - Only admins can create/modify rules
    - All changes are audited

    Performance notes:
    - Rules are cached after initial load
    - Priority ordering ensures efficient evaluation
    - Indexes on common query patterns
    """

    RULE_TYPE_CHOICES = [
        # Discount rules
        ('senior_discount', 'Senior Citizen Discount'),
        ('child_discount', 'Child Discount'),
        ('staff_discount', 'Staff/Employee Discount'),
        ('insurance_discount', 'Insurance Patient Discount'),
        ('loyalty_discount', 'Returning Patient Discount'),
        ('bulk_discount', 'Bulk Service Discount'),
        ('package_discount', 'Package/Bundle Discount'),

        # Surcharge rules
        ('emergency_surcharge', 'Emergency Service Surcharge'),
        ('after_hours_surcharge', 'After Hours Surcharge'),
        ('weekend_surcharge', 'Weekend Surcharge'),
        ('holiday_surcharge', 'Holiday Surcharge'),
        ('priority_surcharge', 'Priority/Express Surcharge'),

        # Adjustment rules
        ('rounding_adjustment', 'Rounding Adjustment'),
        ('minimum_charge', 'Minimum Charge'),
        ('maximum_discount', 'Maximum Discount Cap'),

        # Custom
        ('custom', 'Custom Rule'),
    ]

    ADJUSTMENT_TYPE_CHOICES = [
        ('percentage', 'Percentage'),
        ('fixed', 'Fixed Amount'),
    ]

    # Parameter schemas for validation (rule_type -> expected schema)
    PARAMETER_SCHEMAS = {
        'senior_discount': {
            'required': ['min_age'],
            'optional': ['discount_percent', 'discount_amount', 'max_discount'],
            'types': {'min_age': int, 'discount_percent': (int, float), 'discount_amount': (int, float), 'max_discount': (int, float)}
        },
        'child_discount': {
            'required': ['max_age'],
            'optional': ['discount_percent', 'discount_amount', 'max_discount'],
            'types': {'max_age': int, 'discount_percent': (int, float), 'discount_amount': (int, float), 'max_discount': (int, float)}
        },
        'staff_discount': {
            'required': [],
            'optional': ['discount_percent', 'discount_amount', 'max_discount', 'include_dependents'],
            'types': {'discount_percent': (int, float), 'discount_amount': (int, float), 'max_discount': (int, float), 'include_dependents': bool}
        },
        'bulk_discount': {
            'required': ['min_quantity'],
            'optional': ['discount_percent', 'discount_amount', 'service_codes'],
            'types': {'min_quantity': int, 'discount_percent': (int, float), 'discount_amount': (int, float), 'service_codes': list}
        },
        'package_discount': {
            'required': ['service_codes', 'bundle_price'],
            'optional': ['name'],
            'types': {'service_codes': list, 'bundle_price': (int, float), 'name': str}
        },
        'emergency_surcharge': {
            'required': [],
            'optional': ['surcharge_percent', 'surcharge_amount', 'max_surcharge'],
            'types': {'surcharge_percent': (int, float), 'surcharge_amount': (int, float), 'max_surcharge': (int, float)}
        },
        'after_hours_surcharge': {
            'required': [],
            'optional': ['surcharge_percent', 'surcharge_amount', 'start_time', 'end_time'],
            'types': {'surcharge_percent': (int, float), 'surcharge_amount': (int, float), 'start_time': str, 'end_time': str}
        },
        'weekend_surcharge': {
            'required': [],
            'optional': ['surcharge_percent', 'surcharge_amount', 'include_saturday', 'include_sunday'],
            'types': {'surcharge_percent': (int, float), 'surcharge_amount': (int, float), 'include_saturday': bool, 'include_sunday': bool}
        },
        'holiday_surcharge': {
            'required': [],
            'optional': ['surcharge_percent', 'surcharge_amount', 'holidays'],
            'types': {'surcharge_percent': (int, float), 'surcharge_amount': (int, float), 'holidays': list}
        },
        'minimum_charge': {
            'required': ['minimum_amount'],
            'optional': ['applies_to'],
            'types': {'minimum_amount': (int, float), 'applies_to': str}
        },
        'maximum_discount': {
            'required': ['max_discount_percent'],
            'optional': ['max_discount_amount'],
            'types': {'max_discount_percent': (int, float), 'max_discount_amount': (int, float)}
        },
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, help_text="Human-readable rule name")
    code = models.CharField(
        max_length=50,
        unique=True,
        help_text="Unique code for referencing this rule"
    )
    description = models.TextField(blank=True, help_text="Detailed description of what this rule does")

    # Scope (null = applies to all facilities)
    facility = models.ForeignKey(
        'core.Facility',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='billing_rules',
        help_text="Specific facility (null = all facilities)"
    )

    # Rule type and parameters
    rule_type = models.CharField(max_length=30, choices=RULE_TYPE_CHOICES)
    parameters = models.JSONField(
        default=dict,
        blank=True,
        help_text="Rule-specific parameters (validated against schema)"
    )

    # Adjustment configuration
    adjustment_type = models.CharField(
        max_length=20,
        choices=ADJUSTMENT_TYPE_CHOICES,
        default='percentage',
        help_text="How the adjustment is calculated"
    )
    adjustment_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text="Percentage (e.g., 10.00 for 10%) or fixed amount"
    )

    # Application rules
    priority = models.IntegerField(
        default=100,
        help_text="Lower number = higher priority (evaluated first)"
    )
    is_stackable = models.BooleanField(
        default=False,
        help_text="Can this rule be combined with other rules?"
    )
    applies_to_insurance = models.BooleanField(
        default=True,
        help_text="Does this rule apply to insured patients?"
    )
    applies_to_self_pay = models.BooleanField(
        default=True,
        help_text="Does this rule apply to self-pay patients?"
    )

    # Service restrictions (null = applies to all services)
    applicable_services = models.ManyToManyField(
        'billing.Service',
        blank=True,
        related_name='applicable_rules',
        help_text="Specific services this rule applies to (empty = all)"
    )
    applicable_categories = models.ManyToManyField(
        'billing.ServiceCategory',
        blank=True,
        related_name='applicable_rules',
        help_text="Specific categories this rule applies to (empty = all)"
    )

    # Validity period
    effective_from = models.DateField(help_text="Date from which this rule is effective")
    effective_until = models.DateField(
        null=True,
        blank=True,
        help_text="Date until which this rule is effective (null = indefinite)"
    )

    # Status
    is_active = models.BooleanField(default=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_billing_rules'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_billing_rules'
    )

    class Meta:
        verbose_name = "Billing Rule"
        verbose_name_plural = "Billing Rules"
        ordering = ['priority', 'name']
        indexes = [
            # Performance: Common query patterns
            models.Index(fields=['facility', 'is_active', 'priority']),
            models.Index(fields=['rule_type', 'is_active']),
            models.Index(fields=['effective_from', 'effective_until']),
            models.Index(fields=['is_active', 'priority']),
        ]

    def __str__(self):
        facility_str = f" @ {self.facility.code}" if self.facility else " (Global)"
        return f"{self.name}{facility_str}"

    def clean(self):
        """Validate rule parameters against schema."""
        from django.core.exceptions import ValidationError

        # Validate effective dates
        if self.effective_until and self.effective_until < self.effective_from:
            raise ValidationError({
                'effective_until': 'Effective until date must be after effective from date.'
            })

        # Validate parameters against schema
        schema = self.PARAMETER_SCHEMAS.get(self.rule_type)
        if schema:
            errors = self._validate_parameters(schema)
            if errors:
                raise ValidationError({'parameters': errors})

    def _validate_parameters(self, schema):
        """Validate parameters against schema. Returns list of errors."""
        errors = []
        params = self.parameters or {}

        # Check required fields
        for field in schema.get('required', []):
            if field not in params:
                errors.append(f"Missing required parameter: {field}")

        # Check types
        type_specs = schema.get('types', {})
        for field, value in params.items():
            if field in type_specs:
                expected_type = type_specs[field]
                if not isinstance(value, expected_type):
                    errors.append(
                        f"Parameter '{field}' must be {expected_type}, got {type(value).__name__}"
                    )

        # Check for unknown parameters (security: prevent injection)
        allowed = set(schema.get('required', [])) | set(schema.get('optional', []))
        unknown = set(params.keys()) - allowed
        if unknown:
            errors.append(f"Unknown parameters: {', '.join(unknown)}")

        return errors

    def save(self, *args, **kwargs):
        # Generate code if not provided
        if not self.code:
            self.code = f"{self.rule_type}_{self.id or 'new'}".upper()[:50]
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def is_currently_effective(self):
        """Check if this rule is currently effective."""
        today = timezone.now().date()
        if not self.is_active:
            return False
        if self.effective_from > today:
            return False
        if self.effective_until and self.effective_until < today:
            return False
        return True

    def get_adjustment_amount(self, base_amount):
        """
        Calculate the adjustment amount for a given base amount.

        Args:
            base_amount: Decimal amount to apply adjustment to

        Returns:
            Decimal adjustment amount (positive for surcharge, negative for discount)
        """
        if self.adjustment_type == 'percentage':
            return base_amount * (self.adjustment_value / Decimal('100'))
        else:  # fixed
            return self.adjustment_value


class FacilityBillingSettings(models.Model):
    """
    Facility-specific billing configuration.

    Each facility can have different:
    - Invoice numbering schemes
    - Tax settings
    - Payment methods
    - Auto-billing triggers
    - Operating hours (for time-based pricing)

    Security notes:
    - One-to-one with Facility prevents duplicates
    - Sensitive settings (payment) should be encrypted in production

    Performance notes:
    - Cached per facility
    - Select_related with Facility for efficient loading
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.OneToOneField(
        'core.Facility',
        on_delete=models.CASCADE,
        related_name='billing_settings'
    )

    # Invoice settings
    invoice_prefix = models.CharField(
        max_length=10,
        default='INV',
        help_text="Prefix for invoice numbers (e.g., INV -> INV-00001)"
    )
    invoice_number_length = models.PositiveSmallIntegerField(
        default=8,
        help_text="Total length of invoice number (excluding prefix)"
    )
    invoice_due_days = models.PositiveIntegerField(
        default=30,
        help_text="Default number of days until invoice is due"
    )
    invoice_footer_text = models.TextField(
        blank=True,
        help_text="Custom text to appear on invoice footer"
    )

    # Tax settings
    default_tax_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text="Default tax rate percentage"
    )
    tax_inclusive_pricing = models.BooleanField(
        default=False,
        help_text="Are displayed prices inclusive of tax?"
    )
    tax_registration_number = models.CharField(
        max_length=50,
        blank=True,
        help_text="Tax registration/VAT number for invoices"
    )

    # Payment settings
    PAYMENT_METHOD_CHOICES = [
        ('cash', 'Cash'),
        ('credit_card', 'Credit Card'),
        ('debit_card', 'Debit Card'),
        ('bank_transfer', 'Bank Transfer'),
        ('mobile_money', 'Mobile Money'),
        ('insurance', 'Insurance'),
        ('cheque', 'Cheque'),
    ]
    accepted_payment_methods = models.JSONField(
        default=list,
        blank=True,
        help_text="List of accepted payment method codes"
    )
    default_payment_method = models.CharField(
        max_length=20,
        choices=PAYMENT_METHOD_CHOICES,
        default='cash'
    )

    # Auto-billing settings
    auto_generate_invoice_on_encounter_complete = models.BooleanField(
        default=True,
        help_text="Automatically generate invoice when outpatient encounter completes"
    )
    auto_generate_invoice_on_discharge = models.BooleanField(
        default=True,
        help_text="Automatically generate invoice on patient discharge"
    )

    # Draft invoice auto-sync (fully automatic billing)
    default_consultation_service = models.ForeignKey(
        'billing.Service',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='as_default_consultation_for',
        help_text="Default consultation Service to bill for outpatient encounters when no appointment-specific mapping exists."
    )
    ward_stay_service = models.ForeignKey(
        'billing.Service',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='as_ward_stay_for',
        help_text="Service used for inpatient ward/bed stay (quantity = LOS in days). Unit price can be overridden per ward/bed."
    )

    LAB_CHARGE_TRIGGER_CHOICES = [
        ('ordered', 'Ordered'),
        ('collected', 'Collected'),
        ('completed', 'Completed'),
    ]
    lab_charge_trigger = models.CharField(
        max_length=20,
        choices=LAB_CHARGE_TRIGGER_CHOICES,
        default='collected',
        help_text="When to add lab test charges to draft invoices (NHIS can override to completed)."
    )

    require_deposit_for_admission = models.BooleanField(
        default=False,
        help_text="Require deposit before admission"
    )
    minimum_deposit_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text="Minimum deposit amount for admission"
    )
    minimum_deposit_percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text="Minimum deposit as percentage of estimated bill"
    )

    # Operating hours (for time-based pricing context)
    regular_hours_start = models.TimeField(
        default='08:00',
        help_text="Start of regular operating hours"
    )
    regular_hours_end = models.TimeField(
        default='17:00',
        help_text="End of regular operating hours"
    )
    weekend_hours_start = models.TimeField(
        null=True,
        blank=True,
        help_text="Start of weekend operating hours (null = closed)"
    )
    weekend_hours_end = models.TimeField(
        null=True,
        blank=True,
        help_text="End of weekend operating hours"
    )

    # Holiday configuration
    holidays = models.JSONField(
        default=list,
        blank=True,
        help_text="List of holiday dates (ISO format: YYYY-MM-DD)"
    )

    # Currency settings (can override facility default)
    currency_override = models.CharField(
        max_length=3,
        blank=True,
        help_text="Override facility currency for billing"
    )
    decimal_places = models.PositiveSmallIntegerField(
        default=2,
        help_text="Decimal places for currency display"
    )
    rounding_method = models.CharField(
        max_length=20,
        choices=[
            ('none', 'No Rounding'),
            ('round_half_up', 'Round Half Up'),
            ('round_down', 'Round Down'),
            ('round_up', 'Round Up'),
            ('nearest_5', 'Nearest 5'),
            ('nearest_10', 'Nearest 10'),
        ],
        default='round_half_up'
    )

    # Cash controls (CFO-grade reconciliation)
    cash_control_enabled = models.BooleanField(
        default=False,
        help_text="Require cash sessions for payment recording and enable close-of-day reconciliation"
    )
    cash_variance_threshold_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text="Flag a cash session when abs(variance) exceeds this amount"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_billing_settings'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_billing_settings'
    )

    class Meta:
        verbose_name = "Facility Billing Settings"
        verbose_name_plural = "Facility Billing Settings"

    def __str__(self):
        return f"Billing Settings for {self.facility.name}"

    def clean(self):
        """Validate settings."""
        from django.core.exceptions import ValidationError

        # Validate operating hours
        if self.regular_hours_end <= self.regular_hours_start:
            raise ValidationError({
                'regular_hours_end': 'End time must be after start time.'
            })

        if self.weekend_hours_start and self.weekend_hours_end:
            if self.weekend_hours_end <= self.weekend_hours_start:
                raise ValidationError({
                    'weekend_hours_end': 'Weekend end time must be after start time.'
                })

        # Validate payment methods
        valid_methods = {choice[0] for choice in self.PAYMENT_METHOD_CHOICES}
        for method in self.accepted_payment_methods:
            if method not in valid_methods:
                raise ValidationError({
                    'accepted_payment_methods': f"Invalid payment method: {method}"
                })

        # Validate holidays format
        import re
        date_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        for holiday in self.holidays:
            if not date_pattern.match(holiday):
                raise ValidationError({
                    'holidays': f"Invalid date format: {holiday}. Use YYYY-MM-DD."
                })

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def currency(self):
        """Get effective currency (override or facility default)."""
        return self.currency_override or self.facility.currency

    def is_within_operating_hours(self, timestamp=None):
        """Check if timestamp is within regular operating hours."""
        if timestamp is None:
            timestamp = timezone.now()

        current_time = timestamp.time()
        weekday = timestamp.weekday()

        # Weekend (Saturday=5, Sunday=6)
        if weekday >= 5:
            if self.weekend_hours_start and self.weekend_hours_end:
                return self.weekend_hours_start <= current_time <= self.weekend_hours_end
            return False  # Closed on weekends

        # Weekday
        return self.regular_hours_start <= current_time <= self.regular_hours_end

    def is_holiday(self, check_date=None):
        """Check if date is a configured holiday."""
        if check_date is None:
            check_date = timezone.now().date()

        date_str = check_date.isoformat()
        return date_str in self.holidays

    def get_price_context(self, timestamp=None, is_emergency=False):
        """
        Determine the appropriate price context based on time and settings.

        Returns: 'regular', 'after_hours', 'weekend', 'holiday', or 'emergency'
        """
        if is_emergency:
            return 'emergency'

        if timestamp is None:
            timestamp = timezone.now()

        # Check holiday first
        if self.is_holiday(timestamp.date()):
            return 'holiday'

        # Check weekend
        if timestamp.weekday() >= 5:
            return 'weekend'

        # Check operating hours
        if not self.is_within_operating_hours(timestamp):
            return 'after_hours'

        return 'regular'

    def generate_invoice_number(self):
        """
        Generate the next invoice number for this facility.

        Thread-safe using database sequence.
        """
        from django.db import transaction

        prefix = self.invoice_prefix or 'INV'
        number_length = self.invoice_number_length or 8

        with transaction.atomic():
            seq, _ = FacilityInvoiceSequence.objects.select_for_update().get_or_create(
                facility=self.facility,
                defaults={'next_number': 1}
            )
            next_number = int(seq.next_number)
            seq.next_number = next_number + 1
            seq.save(update_fields=['next_number', 'updated_at'])

        return f"{prefix}-{str(next_number).zfill(number_length)}"


class FacilityInvoiceSequence(models.Model):
    """
    Per-facility invoice number sequence.

    SECURITY/PERF:
    - Avoids table scans (no COUNT/MAX on billing_invoice)
    - Uses row-level locking via select_for_update() when incrementing
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.OneToOneField(
        'core.Facility',
        on_delete=models.CASCADE,
        related_name='invoice_sequence',
    )
    next_number = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Facility Invoice Sequence"
        verbose_name_plural = "Facility Invoice Sequences"


class InsuranceProvider(models.Model):
    """
    Model for insurance providers.
    """
    PAYER_TYPE_CHOICES = (
        ('nhis', 'NHIS'),
        ('private', 'Private'),
        ('other', 'Other'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='insurance_providers',
        help_text="Facility that owns this insurance provider"
    )
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20)
    payer_type = models.CharField(
        max_length=20,
        choices=PAYER_TYPE_CHOICES,
        default='private',
        help_text="Payer classification (NHIS vs private).",
    )
    contact_person = models.CharField(max_length=100, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_insurance_providers')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_insurance_providers')
    
    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['facility', 'code'], name='insurance_provider_facility_code_uniq'),
        ]
        indexes = [
            models.Index(fields=['facility', 'name']),
            models.Index(fields=['facility', 'payer_type']),
        ]
    
    def __str__(self):
        return self.name


class InsurancePlan(models.Model):
    """
    Model for insurance plans.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='insurance_plans',
        help_text="Facility that owns this insurance plan"
    )
    provider = models.ForeignKey(InsuranceProvider, on_delete=models.CASCADE, related_name='plans')
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20)
    description = models.TextField(blank=True, null=True)
    
    # Coverage details
    coverage_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=80.00)
    annual_limit = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_insurance_plans')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_insurance_plans')
    
    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['facility', 'provider', 'code'], name='insurance_plan_facility_provider_code_uniq'),
        ]
        ordering = ['provider__name', 'name']
        indexes = [
            models.Index(fields=['facility', 'provider']),
        ]
    
    def __str__(self):
        return f"{self.provider.name} - {self.name}"


class PayerServiceCode(models.Model):
    """
    Map internal billable Services to payer-specific external codes (NHIS/other).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='payer_service_codes',
    )
    payer = models.ForeignKey(
        InsuranceProvider,
        on_delete=models.PROTECT,
        related_name='service_codes',
        help_text="Payer/provider this code applies to (e.g. NHIS).",
    )
    service = models.ForeignKey(
        Service,
        on_delete=models.PROTECT,
        related_name='payer_codes',
    )
    external_code = models.CharField(max_length=50)
    effective_from = models.DateField()
    effective_until = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_payer_service_codes',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_payer_service_codes',
    )

    class Meta:
        ordering = ['payer__name', 'service__name', '-effective_from']
        constraints = [
            models.UniqueConstraint(
                fields=['facility', 'payer', 'service', 'external_code', 'effective_from'],
                name='payer_service_code_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['facility', 'payer', 'is_active']),
            models.Index(fields=['service', 'payer']),
            models.Index(fields=['effective_from', 'effective_until']),
        ]

    def __str__(self):
        return f"{self.payer.code}:{self.service.code}:{self.external_code}"


class PatientInsurance(models.Model):
    """
    Model for patient insurance information.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='insurances')
    plan = models.ForeignKey(InsurancePlan, on_delete=models.CASCADE, related_name='patient_insurances')
    policy_number = models.CharField(max_length=50)
    
    # Validity period
    valid_from = models.DateField()
    valid_until = models.DateField(null=True, blank=True)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Additional details
    notes = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_patient_insurances')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_patient_insurances')
    
    class Meta:
        ordering = ['-valid_from']
    
    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.plan.provider.name} - {self.policy_number}"
    
    @property
    def is_valid(self):
        """
        Check if the insurance is currently valid.
        """
        today = timezone.now().date()
        if not self.is_active:
            return False
        if self.valid_until and self.valid_until < today:
            return False
        return self.valid_from <= today


class Invoice(models.Model):
    """
    Model for patient invoices.

    Multi-facility support:
    - facility: Required for multi-facility billing
    - department: Optional, for department-specific pricing
    - encounter: Links to clinical events for auto-generation

    Applied rules tracking:
    - applied_rules: JSON list of rule IDs that were applied
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice_number = models.CharField(max_length=20, unique=True)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='invoices')

    # Multi-facility support
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        null=True,  # Nullable for backward compatibility during migration
        blank=True,
        related_name='invoices',
        help_text="Facility where services were rendered"
    )
    department = models.ForeignKey(
        'core.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoices',
        help_text="Department for department-specific pricing"
    )
    rendering_unit = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='rendered_invoices',
        help_text="Clinical unit that rendered the services"
    )

    # Clinical context
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoices',
        help_text="Associated clinical encounter"
    )

    # Dates
    invoice_date = models.DateField(default=timezone.now)
    due_date = models.DateField()

    # Related records (legacy - kept for backward compatibility)
    admission = models.ForeignKey(Admission, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    appointment_type = models.ForeignKey(AppointmentType, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')

    # FHIR references
    fhir_encounter_id = models.CharField(max_length=100, blank=True, null=True)
    fhir_claim_id = models.CharField(max_length=100, blank=True, null=True)
    
    # Amounts
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    
    # Insurance
    patient_insurance = models.ForeignKey(PatientInsurance, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    insurance_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    patient_responsibility = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    
    # Status
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('pending', 'Pending'),
        ('paid', 'Paid'),
        ('partially_paid', 'Partially Paid'),
        ('overdue', 'Overdue'),
        ('cancelled', 'Cancelled'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')

    # Auto-billing draft sync:
    # When enabled, the system may upsert/remove auto-generated invoice items based on clinical events.
    # Payments should not be posted against an auto-updating invoice (finalize first).
    auto_update_enabled = models.BooleanField(
        default=False,
        help_text="If true, this invoice is a draft that may be auto-updated from clinical events."
    )

    # Billing rules applied
    applied_rules = models.JSONField(
        default=list,
        blank=True,
        help_text="List of billing rule IDs that were applied to this invoice"
    )
    price_context = models.CharField(
        max_length=20,
        choices=[
            ('regular', 'Regular Hours'),
            ('after_hours', 'After Hours'),
            ('weekend', 'Weekend'),
            ('holiday', 'Holiday'),
            ('emergency', 'Emergency'),
        ],
        default='regular',
        help_text="Price context when invoice was generated"
    )

    # Notes
    notes = models.TextField(blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_invoices')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_invoices')

    class Meta:
        ordering = ['-invoice_date']
        indexes = [
            models.Index(fields=['facility', 'status']),
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['invoice_date', 'status']),
            models.Index(fields=['encounter']),
        ]
    
    def __str__(self):
        # Avoid embedding patient identifiers in string representations
        return f"Invoice #{self.invoice_number}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to calculate totals.
        """
        # Calculate totals if this is a new invoice
        if not self.pk:
            self.calculate_totals()
        
        super().save(*args, **kwargs)
    
    def calculate_totals(self):
        """
        Calculate invoice totals.
        """
        # Calculate subtotal from line items (pre-tax, pre-invoice-discount)
        if self.pk:
            self.subtotal = sum(
                (Decimal(str(item.quantity)) * Decimal(str(item.unit_price)))
                for item in self.items.all()
            )
            self.tax_amount = sum(Decimal(str(item.tax_amount)) for item in self.items.all())
        else:
            self.subtotal = Decimal('0.00')
            self.tax_amount = Decimal('0.00')

        # Ensure discount_amount is Decimal (model default may be float)
        discount = Decimal(str(self.discount_amount)) if self.discount_amount else Decimal('0.00')

        # Calculate total amount
        self.total_amount = self.subtotal + self.tax_amount - discount

        # Calculate insurance amount and patient responsibility
        if self.patient_insurance and self.patient_insurance.is_valid:
            coverage_percentage = Decimal(str(self.patient_insurance.plan.coverage_percentage)) / Decimal('100')
            self.insurance_amount = self.total_amount * coverage_percentage
            self.patient_responsibility = self.total_amount - self.insurance_amount
        else:
            self.insurance_amount = Decimal('0.00')
            self.patient_responsibility = self.total_amount
    
    @property
    def amount_paid(self):
        """
        Back-compat: Amount paid by the patient (posted, non-voided).
        """
        return self.patient_paid

    def _iter_payments_cached(self):
        """
        Iterate payments using prefetch cache when available to avoid N+1 queries.
        """
        try:
            prefetched = getattr(self, '_prefetched_objects_cache', {})
            cached = prefetched.get('payments')
        except Exception:
            cached = None

        if cached is not None:
            for p in cached:
                yield p
            return

        for p in self.payments.all():
            yield p

    @property
    def patient_paid(self):
        total = Decimal('0.00')
        for payment in self._iter_payments_cached():
            if getattr(payment, 'status', 'posted') != 'posted':
                continue
            if getattr(payment, 'payer', 'patient') != 'patient':
                continue
            total += Decimal(str(payment.amount))
        return total

    @property
    def insurance_paid(self):
        total = Decimal('0.00')
        for payment in self._iter_payments_cached():
            if getattr(payment, 'status', 'posted') != 'posted':
                continue
            if getattr(payment, 'payer', 'patient') != 'insurance':
                continue
            total += Decimal(str(payment.amount))
        return total

    @property
    def total_paid(self):
        total = Decimal('0.00')
        for payment in self._iter_payments_cached():
            if getattr(payment, 'status', 'posted') != 'posted':
                continue
            total += Decimal(str(payment.amount))
        return total
    
    @property
    def balance_due(self):
        """
        Back-compat: Remaining patient balance due (patient responsibility minus patient paid).
        """
        return self.patient_balance_due

    @property
    def patient_balance_due(self):
        return Decimal(str(self.patient_responsibility)) - self.patient_paid

    @property
    def insurance_balance_due(self):
        return Decimal(str(self.insurance_amount)) - self.insurance_paid

    @property
    def total_balance_due(self):
        return Decimal(str(self.total_amount)) - self.total_paid
    
    @property
    def is_fully_paid(self):
        """
        Fully settled only when both patient and insurance balances are paid (i.e. total balance due <= 0).
        """
        return self.total_balance_due <= 0

    @property
    def is_patient_paid(self):
        """Patient portion settled (useful for cashier UX)."""
        return self.patient_balance_due <= 0


class InvoiceItem(models.Model):
    """
    Model for invoice line items.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='items')
    service = models.ForeignKey(Service, on_delete=models.CASCADE, related_name='invoice_items')
    
    # Quantities and pricing
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    # SECURITY: Prevent discount manipulation (negative or >100%)
    discount_percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=0.00,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))]
    )
    
    # Description
    description = models.TextField(blank=True, null=True)

    # Auto-generated line tracking (for draft invoice sync/upsert)
    is_auto_generated = models.BooleanField(
        default=False,
        help_text="True if this line was generated by the auto-billing engine."
    )
    source_type = models.CharField(
        max_length=30,
        blank=True,
        help_text="Auto-billing source type (e.g. consult, lab_test, ward_stay, supply_dispense)."
    )
    source_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="Auto-billing source UUID (e.g. Encounter.id, LabOrderTest.id, SupplyRequest.id)."
    )
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_invoice_items')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_invoice_items')
    
    class Meta:
        ordering = ['service__name']
        constraints = [
            models.UniqueConstraint(
                fields=['invoice', 'source_type', 'source_id'],
                condition=Q(is_auto_generated=True, source_type__gt='', source_id__isnull=False),
                name='invoice_item_auto_source_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['invoice', 'is_auto_generated'], name='inv_item_auto_idx'),
        ]
    
    def __str__(self):
        return f"{self.service.name} x {self.quantity}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to set default values from service.
        """
        # Do not overwrite authoritative pricing if unit_price/tax_rate were provided.
        if not self.pk and self.service:
            if self.unit_price is None:
                self.unit_price = self.service.base_price
            if self.tax_rate is None:
                self.tax_rate = self.service.tax_rate
        
        super().save(*args, **kwargs)
        
        # Update invoice totals
        self.invoice.calculate_totals()
        self.invoice.save()
    
    @property
    def subtotal(self):
        """
        Calculate the subtotal before tax and discount.
        """
        return self.quantity * self.unit_price
    
    @property
    def discount_amount(self):
        """
        Calculate the discount amount.
        """
        return self.subtotal * (self.discount_percentage / 100)
    
    @property
    def tax_amount(self):
        """
        Calculate the tax amount.
        """
        return (self.subtotal - self.discount_amount) * (self.tax_rate / 100)
    
    @property
    def total_price(self):
        """
        Calculate the total price including tax and discount.
        """
        return self.subtotal - self.discount_amount + self.tax_amount


class Payment(models.Model):
    """
    Model for invoice payments.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    
    # Payment details
    payment_date = models.DateField(default=today_date)
    # SECURITY: Prevent negative payment amounts to avoid billing manipulation
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))]
    )

    PAYER_CHOICES = (
        ('patient', 'Patient'),
        ('insurance', 'Insurance'),
    )
    payer = models.CharField(
        max_length=20,
        choices=PAYER_CHOICES,
        default='patient',
        help_text="Who is paying this amount (patient vs insurance remittance)"
    )

    STATUS_CHOICES = (
        ('posted', 'Posted'),
        ('voided', 'Voided'),
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='posted'
    )
    
    # Payment method
    PAYMENT_METHOD_CHOICES = (
        ('cash', 'Cash'),
        ('credit_card', 'Credit Card'),
        ('debit_card', 'Debit Card'),
        ('bank_transfer', 'Bank Transfer'),
        ('mobile_money', 'Mobile Money'),
        ('insurance', 'Insurance'),
        ('cheque', 'Cheque'),
        ('other', 'Other'),
    )
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    
    # Reference information
    reference_number = models.CharField(max_length=50, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)

    # Cash controls (optional)
    cash_session = models.ForeignKey(
        'billing.CashSession',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='payments',
        help_text="Cash session during which this payment was recorded"
    )

    # Void metadata (non-destructive correction)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='voided_payments'
    )
    void_reason = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_payments')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_payments')
    
    class Meta:
        ordering = ['-payment_date']
        indexes = [
            # Performance: Dashboard metrics queries filter by date and facility
            models.Index(fields=['payment_date'], name='billing_pay_payment_date_idx'),
            models.Index(fields=['invoice', 'payment_date'], name='billing_pay_inv_date_idx'),
            models.Index(fields=['payment_method', 'payment_date'], name='billing_pay_method_date_idx'),
        ]

    def __str__(self):
        return f"Payment of {self.amount} for Invoice #{self.invoice.invoice_number}"

    @property
    def is_voided(self):
        return self.status == 'voided'

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.payer == 'insurance' and self.payment_method != 'insurance':
            raise ValidationError({'payment_method': 'Insurance payer must use insurance payment_method.'})
        if self.payer == 'patient' and self.payment_method == 'insurance':
            raise ValidationError({'payment_method': 'Patient payments cannot use insurance payment_method.'})

        if self.status == 'voided':
            if not self.void_reason:
                raise ValidationError({'void_reason': 'Void reason is required.'})
            if not self.voided_at:
                raise ValidationError({'voided_at': 'voided_at is required when voiding.'})
            if not self.voided_by_id:
                raise ValidationError({'voided_by': 'voided_by is required when voiding.'})


class PaymentIntent(models.Model):
    """
    Provider-agnostic payment intent for PSP collections.

    Notes:
    - Never include PHI in descriptions or external references.
    - Designed for idempotent posting via webhooks (exactly-once semantics
      enforced via intent row lock + payment FK).
    """
    PROVIDER_CHOICES = (
        ('hubtel', 'Hubtel'),
    )
    STATUS_CHOICES = (
        ('created', 'Created'),
        ('pending', 'Pending'),
        ('succeeded', 'Succeeded'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
        ('expired', 'Expired'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='payment_intents',
    )
    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name='payment_intents',
    )

    payer = models.CharField(
        max_length=20,
        choices=Payment.PAYER_CHOICES,
        default='patient',
    )
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    currency = models.CharField(max_length=3, default='GHS')
    payment_method = models.CharField(
        max_length=20,
        choices=Payment.PAYMENT_METHOD_CHOICES,
        help_text="Intended payment method for this intent (e.g. mobile_money, credit_card)",
    )

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='created')
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)

    # Provider correlation identifiers
    client_reference = models.CharField(
        max_length=100,
        unique=True,
        help_text="Client-side unique reference used to correlate webhooks (no PHI).",
    )
    provider_reference = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Provider reference (e.g. paylinkId).",
    )
    checkout_url = models.URLField(max_length=500, blank=True, null=True)
    expires_at = models.DateTimeField(blank=True, null=True)

    # Cashier attribution (optional)
    initiated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='initiated_payment_intents',
    )
    cash_session = models.ForeignKey(
        'billing.CashSession',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='payment_intents',
    )

    # Fulfillment
    payment = models.OneToOneField(
        Payment,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='payment_intent',
    )
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    fee_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['provider', 'provider_reference'],
                condition=Q(provider_reference__isnull=False),
                name='psp_intent_provider_reference_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at'], name='psp_intent_fac_stat_idx'),
            models.Index(fields=['invoice', 'status', '-created_at'], name='psp_intent_inv_stat_idx'),
            models.Index(fields=['provider', 'provider_reference'], name='psp_intent_provider_ref_idx'),
        ]

    def __str__(self):
        return f"PaymentIntent {self.id} ({self.provider})"


class PSPWebhookEvent(models.Model):
    """
    Encrypted-at-rest webhook payload capture for PSP callbacks.

    SECURITY:
    - Payload is encrypted (may contain personal identifiers such as phone number).
    - Do not store or log PHI. Store only minimal headers.
    """
    PROVIDER_CHOICES = PaymentIntent.PROVIDER_CHOICES
    PROCESSING_STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('processed', 'Processed'),
        ('ignored', 'Ignored'),
        ('failed', 'Failed'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)
    provider_reference = models.CharField(max_length=100, blank=True, null=True)
    client_reference = models.CharField(max_length=100, blank=True, null=True)
    received_at = models.DateTimeField(default=timezone.now)

    # Minimal safe header subset (e.g. signature headers). Avoid storing tokens/cookies.
    headers = models.JSONField(default=dict, blank=True)
    payload_hash = models.CharField(max_length=64, db_index=True)
    payload_encrypted = models.TextField(blank=True)

    processing_status = models.CharField(
        max_length=20,
        choices=PROCESSING_STATUS_CHOICES,
        default='pending',
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-received_at']
        constraints = [
            models.UniqueConstraint(
                fields=['provider', 'payload_hash'],
                name='psp_webhook_provider_payload_hash_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['provider', 'provider_reference', '-received_at'], name='psp_webhook_provider_ref_idx'),
            models.Index(fields=['provider', 'processing_status', '-received_at'], name='psp_webhook_provider_stat_idx'),
        ]

    def __str__(self):
        return f"PSPWebhookEvent {self.provider}:{self.payload_hash[:8]}"


class SettlementBatch(models.Model):
    """
    Imported PSP settlement statement (CSV payload stored encrypted).
    """
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('ready', 'Ready'),
        ('failed', 'Failed'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='settlement_batches',
    )
    provider = models.CharField(max_length=20, choices=PaymentIntent.PROVIDER_CHOICES)
    statement_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    file_name = models.CharField(max_length=255, blank=True)
    payload_encrypted = models.TextField(blank=True)
    payload_checksum = models.CharField(max_length=64, blank=True)
    error_message = models.TextField(blank=True)

    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='uploaded_settlement_batches',
    )
    processed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'provider', 'status', '-created_at'], name='settle_batch_fac_prov_stat_idx'),
            models.Index(fields=['facility', 'statement_date'], name='settle_batch_fac_date_idx'),
        ]

    def __str__(self):
        return f"SettlementBatch {self.id} ({self.provider})"


class SettlementLine(models.Model):
    """
    Individual settlement line from a provider statement.
    """
    MATCH_STATUS_CHOICES = (
        ('matched', 'Matched'),
        ('unmatched', 'Unmatched'),
        ('mismatch', 'Mismatch'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        SettlementBatch,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    provider_reference = models.CharField(max_length=100, blank=True, null=True)
    client_reference = models.CharField(max_length=100, blank=True, null=True)
    status = models.CharField(max_length=50, blank=True)

    amount_gross = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    fee_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    amount_net = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    match_status = models.CharField(max_length=20, choices=MATCH_STATUS_CHOICES, default='unmatched')
    matched_intent = models.ForeignKey(
        PaymentIntent,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='settlement_lines',
    )
    matched_payment = models.ForeignKey(
        Payment,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='settlement_lines',
    )
    mismatch_reason = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['batch', 'match_status'], name='settle_line_batch_match_idx'),
            models.Index(fields=['provider_reference'], name='settle_line_provider_ref_idx'),
            models.Index(fields=['client_reference'], name='settle_line_client_ref_idx'),
        ]

    def __str__(self):
        return f"SettlementLine {self.id} ({self.match_status})"


class CashDrawer(models.Model):
    """
    A physical or logical cash drawer/register at a facility.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='cash_drawers'
    )
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=100)
    location = models.CharField(max_length=100, blank=True, null=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_cash_drawers'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_cash_drawers'
    )

    class Meta:
        ordering = ['code']
        constraints = [
            models.UniqueConstraint(fields=['facility', 'code'], name='cash_drawer_facility_code_uniq'),
        ]
        indexes = [
            models.Index(fields=['facility', 'is_active']),
        ]

    def __str__(self):
        return f"{self.code} ({self.facility.code})"


class CashSession(models.Model):
    """
    Cashier shift/session used for close-of-day reconciliation.
    """
    STATUS_CHOICES = (
        ('open', 'Open'),
        ('closed', 'Closed'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='cash_sessions'
    )
    drawer = models.ForeignKey(
        CashDrawer,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='sessions'
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='open')

    opened_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='opened_cash_sessions'
    )
    opened_at = models.DateTimeField(default=timezone.now)
    opening_float_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))]
    )

    closed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='closed_cash_sessions'
    )
    closed_at = models.DateTimeField(null=True, blank=True)

    # Stored at close time
    expected_totals = models.JSONField(default=dict, blank=True)
    expected_cash_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    counted_cash_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    variance_cash_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))

    is_flagged = models.BooleanField(default=False)
    reviewed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='reviewed_cash_sessions'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True, null=True)

    notes = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-opened_at']
        constraints = [
            models.UniqueConstraint(
                fields=['facility', 'opened_by'],
                condition=Q(status='open'),
                name='uniq_open_cash_session_per_user_per_facility'
            ),
            models.UniqueConstraint(
                fields=['facility', 'drawer'],
                condition=Q(status='open') & Q(drawer__isnull=False),
                name='uniq_open_cash_session_per_drawer_per_facility'
            ),
        ]
        indexes = [
            models.Index(fields=['facility', 'status', 'opened_at']),
            models.Index(fields=['facility', 'opened_by', 'status']),
            models.Index(fields=['facility', 'is_flagged', 'opened_at']),
        ]

    def __str__(self):
        return f"CashSession {self.id} ({self.facility.code})"


class CashMovement(models.Model):
    """
    Non-payment cash movement during a cash session (float in/out, drops, adjustments).
    """
    DIRECTION_CHOICES = (
        ('in', 'In'),
        ('out', 'Out'),
    )
    MOVEMENT_TYPE_CHOICES = (
        ('float_in', 'Float In'),
        ('float_out', 'Float Out'),
        ('cash_drop', 'Cash Drop'),
        ('expense', 'Expense'),
        ('adjustment', 'Adjustment'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        CashSession,
        on_delete=models.CASCADE,
        related_name='movements'
    )
    direction = models.CharField(max_length=5, choices=DIRECTION_CHOICES)
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_TYPE_CHOICES)
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))]
    )
    reference = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_cash_movements'
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['session', 'created_at']),
        ]

    def __str__(self):
        return f"CashMovement {self.movement_type} {self.amount} ({self.session_id})"

    @property
    def net_amount(self):
        amt = Decimal(str(self.amount))
        return amt if self.direction == 'in' else -amt


class NHISClaimBatch(models.Model):
    """
    Batch of NHIS claims for export/submission.
    """
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('exported', 'Exported'),
        ('submitted', 'Submitted'),
        ('closed', 'Closed'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='nhis_claim_batches',
    )
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    notes = models.TextField(blank=True, null=True)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_nhis_claim_batches',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_nhis_claim_batches',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-period_end', '-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['facility', 'period_start', 'period_end'],
                name='nhis_batch_fac_period_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at'], name='nhis_batch_fac_stat_idx'),
            models.Index(fields=['facility', 'period_start', 'period_end'], name='nhis_batch_fac_period_idx'),
        ]

    def __str__(self):
        return f"NHISClaimBatch {self.facility.code} {self.period_start}..{self.period_end}"


class Claim(models.Model):
    """
    Model for insurance claims.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    claim_number = models.CharField(max_length=32, unique=True)
    invoice = models.OneToOneField(Invoice, on_delete=models.CASCADE, related_name='claim')

    # NHIS batching / submission metadata
    batch = models.ForeignKey(
        NHISClaimBatch,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='claims',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='submitted_claims',
    )
    submission_reference = models.CharField(max_length=100, blank=True)
    paid_amount_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    last_paid_at = models.DateTimeField(null=True, blank=True)
    
    # Claim details
    submission_date = models.DateField(default=timezone.now)
    
    # FHIR reference
    fhir_claim_id = models.CharField(max_length=100, blank=True, null=True)
    fhir_explanation_of_benefit_id = models.CharField(max_length=100, blank=True, null=True)
    
    # Status
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('submitted', 'Submitted'),
        ('in_review', 'In Review'),
        ('approved', 'Approved'),
        ('partially_approved', 'Partially Approved'),
        ('rejected', 'Rejected'),
        ('paid', 'Paid'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    
    # Amounts
    claimed_amount = models.DecimalField(max_digits=10, decimal_places=2)
    approved_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    
    # Response details
    response_date = models.DateField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_claims')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_claims')
    
    class Meta:
        ordering = ['-submission_date']
        indexes = [
            # Performance: Dashboard metrics queries filter by status
            models.Index(fields=['status'], name='billing_claim_status_idx'),
            models.Index(fields=['status', 'submission_date'], name='billing_claim_stat_date_idx'),
        ]

    def __str__(self):
        return f"Claim #{self.claim_number} for Invoice #{self.invoice.invoice_number}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to set default values.
        """
        # Set default claimed amount from invoice
        if not self.pk and self.invoice:
            self.claimed_amount = self.invoice.insurance_amount
        
        super().save(*args, **kwargs)
    
    @property
    def is_fully_approved(self):
        """
        Check if the claim is fully approved.
        """
        return self.status == 'approved' and self.approved_amount >= self.claimed_amount
    
    @property
    def is_partially_approved(self):
        """
        Check if the claim is partially approved.
        """
        return self.status == 'partially_approved' or (self.status == 'approved' and self.approved_amount < self.claimed_amount)


class ClaimValidationIssue(models.Model):
    """
    Lint issues for claim exports. Avoid storing any free-text PHI.
    """
    SEVERITY_CHOICES = (
        ('error', 'Error'),
        ('warning', 'Warning'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    claim = models.ForeignKey(
        Claim,
        on_delete=models.CASCADE,
        related_name='validation_issues',
    )
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES, default='error')
    code = models.CharField(max_length=50)
    message = models.CharField(max_length=255)
    field = models.CharField(max_length=100, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['severity', 'code', '-created_at']
        indexes = [
            models.Index(fields=['claim', 'severity'], name='claim_issue_claim_sev_idx'),
        ]

    def __str__(self):
        return f"{self.claim_id}:{self.severity}:{self.code}"


class NHISClaimExportJob(models.Model):
    """
    Facility-scoped export job for NHIS Claim-it submissions.
    """
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('ready', 'Ready'),
        ('failed', 'Failed'),
        ('delivered', 'Delivered'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='nhis_export_jobs',
    )
    batch = models.ForeignKey(
        NHISClaimBatch,
        on_delete=models.CASCADE,
        related_name='export_jobs',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    payload_encrypted = models.TextField(blank=True)
    payload_checksum = models.CharField(max_length=64, blank=True)
    error_message = models.TextField(blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_nhis_export_jobs',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at'], name='nhis_exp_fac_stat_idx'),
            models.Index(fields=['expires_at'], name='nhis_exp_expires_idx'),
        ]

    def __str__(self):
        return f"NHISExportJob {self.id} ({self.status})"


class RemittanceImportJob(models.Model):
    """
    Facility-scoped remittance import job (CSV/XLSX payload stored encrypted).
    """
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('ready', 'Ready'),
        ('failed', 'Failed'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='remittance_import_jobs',
    )
    payer = models.ForeignKey(
        InsuranceProvider,
        on_delete=models.PROTECT,
        related_name='remittance_import_jobs',
        help_text="Payer/provider whose remittance format is being imported (e.g. NHIS).",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    file_name = models.CharField(max_length=255, blank=True)
    payload_encrypted = models.TextField(blank=True)
    payload_checksum = models.CharField(max_length=64, blank=True)
    error_message = models.TextField(blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_remittance_import_jobs',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at'], name='remit_job_fac_stat_idx'),
        ]

    def __str__(self):
        return f"RemittanceImportJob {self.id} ({self.status})"


class RemittanceLine(models.Model):
    """
    Parsed remittance line (minimal fields only; do not store patient names).
    """
    MATCH_STATUS_CHOICES = (
        ('matched', 'Matched'),
        ('unmatched', 'Unmatched'),
        ('underpaid', 'Underpaid'),
        ('denied', 'Denied'),
        ('error', 'Error'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(
        RemittanceImportJob,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    claim_number = models.CharField(max_length=50, blank=True)
    invoice_number = models.CharField(max_length=50, blank=True)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    paid_date = models.DateField(null=True, blank=True)
    match_status = models.CharField(max_length=20, choices=MATCH_STATUS_CHOICES, default='unmatched')

    matched_claim = models.ForeignKey(
        Claim,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='remittance_lines',
    )
    matched_invoice = models.ForeignKey(
        Invoice,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='remittance_lines',
    )

    error_message = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['job', 'match_status'], name='remit_line_job_match_idx'),
            models.Index(fields=['claim_number'], name='remit_line_claim_num_idx'),
            models.Index(fields=['invoice_number'], name='remit_line_inv_num_idx'),
        ]

    def __str__(self):
        return f"RemittanceLine {self.id} ({self.match_status})"


class InsurancePosting(models.Model):
    """
    Link a remittance line to an insurance payment posted into the ledger.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    remittance_line = models.OneToOneField(
        RemittanceLine,
        on_delete=models.CASCADE,
        related_name='posting',
    )
    payment = models.OneToOneField(
        Payment,
        on_delete=models.PROTECT,
        related_name='insurance_posting',
    )
    posted_at = models.DateTimeField(default=timezone.now)
    posted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='insurance_postings',
    )

    class Meta:
        indexes = [
            models.Index(fields=['posted_at'], name='ins_post_posted_at_idx'),
        ]

    def __str__(self):
        return f"InsurancePosting {self.id}"


class PayerServiceCodeImportJob(models.Model):
    """
    Bulk import job for payer service code mappings (NHIS/other).

    Workflow:
    - Upload file -> preview parse/validate (async) -> apply (async).

    SECURITY:
    - Payloads are stored encrypted at rest (no PHI expected, but keep consistent).
    - Facility-scoped; payer/service must belong to active facility.
    """
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('preview_ready', 'Preview Ready'),
        ('applying', 'Applying'),
        ('applied', 'Applied'),
        ('failed', 'Failed'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='payer_service_code_import_jobs',
    )
    payer = models.ForeignKey(
        InsuranceProvider,
        on_delete=models.PROTECT,
        related_name='payer_service_code_import_jobs',
        help_text="Payer/provider whose codes are being imported (e.g. NHIS).",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    seed_services = models.BooleanField(
        default=False,
        help_text="If true, create missing ServiceCategory/Service records (services created inactive by default).",
    )

    file_name = models.CharField(max_length=255, blank=True)
    payload_encrypted = models.TextField(blank=True)
    payload_checksum = models.CharField(max_length=64, blank=True)

    # Parsed, normalized rows (JSON) stored encrypted for apply step.
    parsed_payload_encrypted = models.TextField(blank=True)

    # Preview summary + first N row issues (avoid unbounded growth).
    summary = models.JSONField(default=dict, blank=True)
    issues = models.JSONField(default=list, blank=True)
    error_message = models.TextField(blank=True)

    processed_at = models.DateTimeField(null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_payer_service_code_import_jobs',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at'], name='psc_imp_fac_stat_idx'),
            models.Index(fields=['facility', 'payer', '-created_at'], name='psc_imp_fac_payer_idx'),
        ]

    def __str__(self):
        return f"PayerServiceCodeImportJob {self.id} ({self.status})"


class Receipt(models.Model):
    """
    Model for payment receipts.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    receipt_number = models.CharField(max_length=30, unique=True)
    payment = models.OneToOneField(Payment, on_delete=models.CASCADE, related_name='receipt')
    
    # Receipt details
    receipt_date = models.DateField(default=today_date)
    
    # Additional information
    notes = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_receipts')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_receipts')
    
    class Meta:
        ordering = ['-receipt_date']
    
    def __str__(self):
        return f"Receipt #{self.receipt_number} for Payment of {self.payment.amount}"
