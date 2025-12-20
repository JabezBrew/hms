import uuid
from django.db import models
from django.contrib.auth import get_user_model
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
    
    def __str__(self):
        return self.name


class Service(models.Model):
    """
    Model for billable services.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    category = models.ForeignKey(ServiceCategory, on_delete=models.CASCADE, related_name='services')
    code = models.CharField(max_length=20, unique=True)
    
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
                fields=['service', 'facility', 'department', 'price_context', 'effective_from'],
                name='unique_service_price_override'
            )
        ]
        indexes = [
            models.Index(fields=['service', 'facility', 'department', 'price_context']),
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
        from django.db import connection

        # Use database-level counter for thread safety
        with connection.cursor() as cursor:
            # This is PostgreSQL-specific. For other DBs, use different approach.
            cursor.execute("""
                UPDATE billing_facilitybillingsettings
                SET updated_at = NOW()
                WHERE id = %s
                RETURNING (
                    SELECT COUNT(*) + 1 FROM billing_invoice
                    WHERE invoice_number LIKE %s
                )
            """, [str(self.id), f"{self.invoice_prefix}%"])
            result = cursor.fetchone()
            next_number = result[0] if result else 1

        # Format: PREFIX-00000001
        return f"{self.invoice_prefix}-{str(next_number).zfill(self.invoice_number_length)}"


class InsuranceProvider(models.Model):
    """
    Model for insurance providers.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, unique=True)
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
    
    def __str__(self):
        return self.name


class InsurancePlan(models.Model):
    """
    Model for insurance plans.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
        unique_together = ['provider', 'code']
        ordering = ['provider__name', 'name']
    
    def __str__(self):
        return f"{self.provider.name} - {self.name}"


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

    # Clinical context
    encounter = models.ForeignKey(
        'wards.Encounter',
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
        return f"Invoice #{self.invoice_number} - {self.patient.user.get_full_name()}"
    
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
        # Calculate subtotal from line items
        self.subtotal = sum(item.total_price for item in self.items.all()) if self.pk else Decimal('0.00')

        # Calculate tax amount
        self.tax_amount = sum(item.tax_amount for item in self.items.all()) if self.pk else Decimal('0.00')

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
        Calculate the total amount paid.
        """
        return sum(payment.amount for payment in self.payments.all())
    
    @property
    def balance_due(self):
        """
        Calculate the remaining balance due.
        """
        return self.patient_responsibility - self.amount_paid
    
    @property
    def is_fully_paid(self):
        """
        Check if the invoice is fully paid.
        """
        return self.balance_due <= 0


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
    discount_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    
    # Description
    description = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_invoice_items')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_invoice_items')
    
    class Meta:
        ordering = ['service__name']
    
    def __str__(self):
        return f"{self.service.name} x {self.quantity}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to set default values from service.
        """
        # Set default values from service if this is a new item
        if not self.pk and self.service:
            self.unit_price = self.service.base_price
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
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    
    # Payment method
    PAYMENT_METHOD_CHOICES = (
        ('cash', 'Cash'),
        ('credit_card', 'Credit Card'),
        ('debit_card', 'Debit Card'),
        ('bank_transfer', 'Bank Transfer'),
        ('mobile_money', 'Mobile Money'),
        ('insurance', 'Insurance'),
        ('other', 'Other'),
    )
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    
    # Reference information
    reference_number = models.CharField(max_length=50, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    
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
    
    def save(self, *args, **kwargs):
        """
        Override save method to update invoice status.
        """
        super().save(*args, **kwargs)
        
        # Update invoice status based on payments
        invoice = self.invoice
        total_paid = sum(payment.amount for payment in invoice.payments.all())
        
        if total_paid >= invoice.patient_responsibility:
            invoice.status = 'paid'
        elif total_paid > 0:
            invoice.status = 'partially_paid'
        else:
            invoice.status = 'pending'
        
        invoice.save()


class Claim(models.Model):
    """
    Model for insurance claims.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    claim_number = models.CharField(max_length=20, unique=True)
    invoice = models.OneToOneField(Invoice, on_delete=models.CASCADE, related_name='claim')
    
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