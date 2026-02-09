"""
Core models for system-wide configuration.
"""
import uuid
import ipaddress
from django.db import models
from django.contrib.auth import get_user_model
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.cache import cache

from .cache_utils import facility_cache_key, facility_cache_key_for_code

User = get_user_model()


# =============================================================================
# Multi-Facility Foundation Models
# =============================================================================

class Facility(models.Model):
    """
    Represents a hospital, clinic, or healthcare location in the network.

    This is the foundation model for multi-facility support, enabling:
    - Different pricing per facility
    - Facility-specific billing rules
    - Department organization within facilities
    - Hierarchical facility networks (parent/child relationships)
    """

    FACILITY_TYPE_CHOICES = [
        ('hospital', 'Hospital'),
        ('clinic', 'Clinic'),
        ('diagnostic_center', 'Diagnostic Center'),
        ('pharmacy', 'Pharmacy'),
        ('laboratory', 'Laboratory'),
        ('rehabilitation', 'Rehabilitation Center'),
        ('urgent_care', 'Urgent Care'),
    ]
    FACILITY_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('ready', 'Ready'),
        ('failed', 'Failed'),
        ('suspended', 'Suspended'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(
        max_length=20,
        unique=True,
        help_text="Unique facility code (e.g., 'MAIN', 'BRANCH-A')"
    )
    name = models.CharField(max_length=200)
    facility_type = models.CharField(
        max_length=20,
        choices=FACILITY_TYPE_CHOICES,
        default='hospital'
    )

    # Location
    address = models.TextField(help_text="Full street address")
    city = models.CharField(max_length=100)
    region = models.CharField(
        max_length=100,
        blank=True,
        help_text="State/Region/Province"
    )
    country = models.CharField(max_length=100, default='Ghana')
    postal_code = models.CharField(max_length=20, blank=True)
    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        help_text="GPS latitude for mapping"
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        help_text="GPS longitude for mapping"
    )

    # Contact
    phone = models.CharField(max_length=20)
    email = models.EmailField()
    website = models.URLField(blank=True)

    # Hierarchy (for hospital networks)
    parent_facility = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='child_facilities',
        help_text="Parent facility for branch locations"
    )

    # Settings
    timezone = models.CharField(
        max_length=50,
        default='Africa/Accra',
        help_text="Timezone for scheduling and timestamps"
    )
    currency = models.CharField(
        max_length=3,
        default='GHS',
        help_text="ISO 4217 currency code"
    )
    tax_id = models.CharField(
        max_length=50,
        blank=True,
        help_text="Tax identification number"
    )
    license_number = models.CharField(
        max_length=100,
        blank=True,
        help_text="Healthcare facility license number"
    )

    # Operational
    status = models.CharField(
        max_length=20,
        choices=FACILITY_STATUS_CHOICES,
        default='ready',
        help_text="Provisioning status for this facility"
    )
    is_active = models.BooleanField(default=True)
    is_headquarters = models.BooleanField(
        default=False,
        help_text="Whether this is the main/headquarters facility"
    )
    provisioned_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When this facility was provisioned"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_facilities'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_facilities'
    )

    class Meta:
        verbose_name = "Facility"
        verbose_name_plural = "Facilities"
        ordering = ['name']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['facility_type', 'is_active']),
            models.Index(fields=['parent_facility']),
        ]

    def __str__(self):
        return f"{self.name} ({self.code})"

    def save(self, *args, **kwargs):
        # Ensure code is uppercase
        self.code = self.code.upper()
        super().save(*args, **kwargs)
        # Clear facility cache for all facility contexts.
        #
        # Note: facility_cache_key() prefixes keys using the current facility context,
        # which can differ from self.code (e.g., DEFAULT_FACILITY_CODE in tests).
        cache.delete('active_facilities')  # legacy/unscoped key
        cache.delete(facility_cache_key('active_facilities'))
        cache.delete(facility_cache_key(f'facility_{self.code}'))

        codes = set(Facility.objects.values_list('code', flat=True))
        default_code = getattr(settings, 'DEFAULT_FACILITY_CODE', None)
        if default_code:
            codes.add(str(default_code).strip().upper())

        for code in codes:
            cache.delete(facility_cache_key_for_code(code, 'active_facilities'))
            cache.delete(facility_cache_key_for_code(code, f'facility_{self.code}'))

    @classmethod
    def get_active_facilities(cls):
        """Get all active facilities with caching."""
        cache_key = facility_cache_key('active_facilities')
        facilities = cache.get(cache_key)
        if facilities is None:
            facilities = list(cls.objects.filter(is_active=True))
            cache.set(cache_key, facilities, 300)  # 5 min cache
        return facilities

    @classmethod
    def get_by_code(cls, code):
        """Get facility by code with caching."""
        cache_key = facility_cache_key(f'facility_{code.upper()}')
        facility = cache.get(cache_key)
        if facility is None:
            try:
                facility = cls.objects.get(code=code.upper(), is_active=True)
                cache.set(cache_key, facility, 300)
            except cls.DoesNotExist:
                return None
        return facility

    @property
    def full_address(self):
        """Return formatted full address."""
        parts = [self.address, self.city]
        if self.region:
            parts.append(self.region)
        if self.postal_code:
            parts.append(self.postal_code)
        parts.append(self.country)
        return ', '.join(parts)

    @property
    def is_branch(self):
        """Check if this facility is a branch (has parent)."""
        return self.parent_facility is not None


class Department(models.Model):
    """
    Represents a department within a facility.

    Used for:
    - Department-specific pricing
    - Organizing staff and services
    - Routing and workflows
    """

    DEPARTMENT_TYPE_CHOICES = [
        ('clinical', 'Clinical'),
        ('diagnostic', 'Diagnostic'),
        ('surgical', 'Surgical'),
        ('emergency', 'Emergency'),
        ('support', 'Support Services'),
        ('administrative', 'Administrative'),
        ('pharmacy', 'Pharmacy'),
        ('laboratory', 'Laboratory'),
        ('radiology', 'Radiology'),
        ('nursing', 'Nursing'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        Facility,
        on_delete=models.CASCADE,
        related_name='departments'
    )
    code = models.CharField(
        max_length=20,
        help_text="Department code (unique within facility)"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    department_type = models.CharField(
        max_length=20,
        choices=DEPARTMENT_TYPE_CHOICES,
        default='clinical'
    )

    # Contact
    phone_extension = models.CharField(
        max_length=10,
        blank=True,
        help_text="Internal phone extension"
    )
    email = models.EmailField(blank=True)
    location = models.CharField(
        max_length=100,
        blank=True,
        help_text="Physical location within facility (e.g., 'Building A, Floor 2')"
    )

    # Head of department
    head = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='headed_departments',
        help_text="Department head/manager"
    )

    # Operational
    is_active = models.BooleanField(default=True)
    is_clinical = models.BooleanField(
        default=True,
        help_text="Whether this department provides clinical services"
    )
    accepts_referrals = models.BooleanField(
        default=True,
        help_text="Whether this department accepts patient referrals"
    )

    # Operating hours (can be overridden from facility)
    operating_hours_start = models.TimeField(
        null=True,
        blank=True,
        help_text="Department opening time (leave blank to use facility default)"
    )
    operating_hours_end = models.TimeField(
        null=True,
        blank=True,
        help_text="Department closing time (leave blank to use facility default)"
    )
    operates_24_hours = models.BooleanField(
        default=False,
        help_text="Whether department operates 24/7"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_departments'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_departments'
    )

    class Meta:
        verbose_name = "Department"
        verbose_name_plural = "Departments"
        ordering = ['facility__name', 'name']
        unique_together = ['facility', 'code']
        indexes = [
            models.Index(fields=['facility', 'code']),
            models.Index(fields=['department_type', 'is_active']),
        ]

    def __str__(self):
        return f"{self.name} - {self.facility.code}"

    def save(self, *args, **kwargs):
        # Ensure code is uppercase
        self.code = self.code.upper()
        super().save(*args, **kwargs)
        # Clear department cache across facility contexts
        cache.delete(facility_cache_key_for_code(self.facility.code, f'facility_departments_{self.facility_id}'))
        cache.delete(facility_cache_key(f'facility_departments_{self.facility_id}'))

    @classmethod
    def get_facility_departments(cls, facility_id):
        """Get all active departments for a facility with caching."""
        cache_key = facility_cache_key(f'facility_departments_{facility_id}')
        departments = cache.get(cache_key)
        if departments is None:
            departments = list(cls.objects.filter(
                facility_id=facility_id,
                is_active=True
            ).select_related('head'))
            cache.set(cache_key, departments, 300)
        return departments

    @property
    def full_name(self):
        """Return department name with facility."""
        return f"{self.name} ({self.facility.name})"


# =============================================================================
# Network and Access Control Models
# =============================================================================

class SiteNetwork(models.Model):
    """
    Defines IP networks that are considered "on-site" (within hospital network).
    Users accessing from IPs not matching any of these networks will be in
    read-only mode for security compliance.
    """
    name = models.CharField(
        max_length=100,
        help_text="Descriptive name for this network (e.g., 'Main Hospital LAN')"
    )
    cidr = models.CharField(
        max_length=43,  # IPv6 CIDR can be up to 43 chars
        help_text="Network in CIDR notation (e.g., '192.168.1.0/24' or '10.0.0.0/8')"
    )
    description = models.TextField(
        blank=True,
        help_text="Additional details about this network"
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Only active networks are checked for on-site access"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Site Network"
        verbose_name_plural = "Site Networks"
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.cidr})"

    def clean(self):
        """Validate CIDR notation."""
        try:
            ipaddress.ip_network(self.cidr, strict=False)
        except ValueError as e:
            raise ValidationError({'cidr': f"Invalid CIDR notation: {e}"})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)
        # Clear cache when networks change
        cache.delete(facility_cache_key('site_networks'))

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        # Clear cache when networks change
        cache.delete(facility_cache_key('site_networks'))

    @classmethod
    def get_active_networks(cls):
        """Get all active networks, with caching."""
        cache_key = facility_cache_key('site_networks')
        networks = cache.get(cache_key)
        if networks is None:
            networks = list(cls.objects.filter(is_active=True).values_list('cidr', flat=True))
            cache.set(cache_key, networks, 300)  # Cache for 5 minutes
        return networks

    @classmethod
    def is_ip_on_site(cls, ip_address):
        """
        Check if an IP address is within any of the on-site networks.

        Args:
            ip_address: IP address string to check

        Returns:
            bool: True if IP is on-site, False if off-site
        """
        if not ip_address:
            return False

        # Check if localhost should be treated as off-site (for testing)
        from apps.core.models import OffSiteAccessSettings
        settings = OffSiteAccessSettings.get_settings()

        # Handle localhost - normally on-site unless testing mode is enabled
        if ip_address in ('127.0.0.1', '::1', 'localhost'):
            if settings.treat_localhost_as_offsite:
                return False  # Treat localhost as off-site for testing
            return True  # Normal behavior: localhost is on-site

        try:
            ip = ipaddress.ip_address(ip_address)
        except ValueError:
            return False

        # Check against all active networks
        networks = cls.get_active_networks()

        # If no networks configured, consider all IPs as on-site (open mode)
        if not networks:
            return True

        for cidr in networks:
            try:
                network = ipaddress.ip_network(cidr, strict=False)
                if ip in network:
                    return True
            except ValueError:
                continue

        return False


class OffSiteAccessSettings(models.Model):
    """
    Singleton model for off-site access configuration.
    """
    OFFSITE_MODE_CHOICES = [
        ('readonly', 'Read-Only Mode'),
        ('deny', 'Deny Access'),
        ('allow', 'Allow Full Access'),
    ]

    offsite_mode = models.CharField(
        max_length=20,
        choices=OFFSITE_MODE_CHOICES,
        default='readonly',
        help_text="How to handle off-site access attempts"
    )
    readonly_message = models.TextField(
        default="You are accessing from outside the hospital network. Write operations are disabled for security.",
        help_text="Message shown to users in read-only mode"
    )
    deny_message = models.TextField(
        default="Access denied. Please connect from within the hospital network.",
        help_text="Message shown when access is denied"
    )
    allow_admin_override = models.BooleanField(
        default=True,
        help_text="Allow admin users to bypass off-site restrictions"
    )
    treat_localhost_as_offsite = models.BooleanField(
        default=False,
        help_text="For testing: treat localhost (127.0.0.1) as off-site instead of on-site"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Off-Site Access Settings"
        verbose_name_plural = "Off-Site Access Settings"

    def __str__(self):
        return "Off-Site Access Settings"

    def save(self, *args, **kwargs):
        # Ensure only one instance exists (singleton pattern)
        self.pk = 1
        super().save(*args, **kwargs)
        # Clear cache when settings change
        cache.delete(facility_cache_key('offsite_settings'))

    @classmethod
    def get_settings(cls):
        """Get settings with caching."""
        cache_key = facility_cache_key('offsite_settings')
        settings = cache.get(cache_key)
        if settings is not None:
            return settings

        settings = cls.objects.filter(pk=1).first()
        if settings is None:
            settings = cls()
        cache.set(cache_key, settings, 300)  # Cache for 5 minutes
        return settings


class FacilityFluidBalanceSettings(models.Model):
    """
    Singleton model for facility-level fluid balance alert thresholds.

    Configurable per facility to support different clinical protocols.
    Allows facilities to set their own thresholds for monitoring patient
    fluid intake/output and triggering alerts when values exceed limits.
    """

    # Alert thresholds (all in ml)
    min_daily_intake_target = models.PositiveIntegerField(
        default=1500,
        help_text="Minimum daily intake target in ml. Alert when patient intake is below this."
    )
    max_daily_output_threshold = models.PositiveIntegerField(
        default=3000,
        help_text="Maximum daily output threshold in ml. Alert when output exceeds this."
    )
    negative_balance_alert_threshold = models.IntegerField(
        default=-500,
        help_text="Alert when daily balance (intake - output) falls below this value in ml."
    )
    positive_balance_alert_threshold = models.PositiveIntegerField(
        default=2000,
        help_text="Alert when daily balance exceeds this value in ml (indicates fluid retention)."
    )

    # Enable/disable individual alert types
    enable_intake_alerts = models.BooleanField(
        default=True,
        help_text="Enable alerts for low daily intake."
    )
    enable_output_alerts = models.BooleanField(
        default=True,
        help_text="Enable alerts for high daily output."
    )
    enable_balance_alerts = models.BooleanField(
        default=True,
        help_text="Enable alerts for abnormal fluid balance."
    )

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Facility Fluid Balance Settings"
        verbose_name_plural = "Facility Fluid Balance Settings"

    def __str__(self):
        return "Facility Fluid Balance Settings"

    def save(self, *args, **kwargs):
        # Ensure only one instance exists (singleton pattern)
        self.pk = 1
        super().save(*args, **kwargs)
        # Clear cache when settings change
        cache.delete(facility_cache_key('facility_fluid_balance_settings'))

    @classmethod
    def get_settings(cls):
        """Get settings with caching."""
        cache_key = facility_cache_key('facility_fluid_balance_settings')
        settings = cache.get(cache_key)
        if settings is None:
            settings, _ = cls.objects.get_or_create(pk=1)
            cache.set(cache_key, settings, 300)  # Cache for 5 minutes
        return settings


class IdempotencyRecord(models.Model):
    """
    Stores idempotency keys and their responses for deduplication.

    Records are automatically cleaned up after their TTL expires.
    Uses both database and cache for reliability and performance.
    """
    key = models.CharField(
        max_length=128,
        unique=True,
        db_index=True,
        help_text="Unique idempotency key (typically hashed)"
    )
    operation_type = models.CharField(
        max_length=64,
        help_text="Type of operation (e.g., 'payment', 'admission', 'discharge')"
    )
    request_path = models.CharField(
        max_length=255,
        blank=True,
        help_text="API endpoint path"
    )
    request_hash = models.CharField(
        max_length=64,
        blank=True,
        help_text="Hash of request body for validation"
    )
    response_status = models.IntegerField(
        help_text="HTTP status code of the response"
    )
    response_body = models.JSONField(
        help_text="Serialized response data"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(
        db_index=True,
        help_text="When this record can be cleaned up"
    )

    class Meta:
        verbose_name = "Idempotency Record"
        verbose_name_plural = "Idempotency Records"
        indexes = [
            models.Index(fields=['key', 'operation_type']),
            models.Index(fields=['expires_at']),
        ]

    def __str__(self):
        return f"{self.operation_type}:{self.key[:16]}..."


class BreakGlassEvent(models.Model):
    """
    Records time-bound emergency access overrides for patient data.
    """
    SCOPE_CHOICES = (
        ('clinical', 'Clinical'),
        ('lab', 'Laboratory'),
        ('pharmacy', 'Pharmacy'),
        ('billing', 'Billing'),
        ('demographics', 'Demographics'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='break_glass_events'
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='break_glass_events'
    )
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default='clinical')
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'patient', 'scope']),
            models.Index(fields=['patient', 'scope']),
            models.Index(fields=['expires_at']),
        ]

    def __str__(self):
        return f"Break-glass {self.scope} for {self.patient_id} by {self.user_id}"
