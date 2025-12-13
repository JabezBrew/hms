"""
Core models for system-wide configuration.
"""
import ipaddress
from django.db import models
from django.core.exceptions import ValidationError
from django.core.cache import cache


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
        cache.delete('site_networks')

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        # Clear cache when networks change
        cache.delete('site_networks')

    @classmethod
    def get_active_networks(cls):
        """Get all active networks, with caching."""
        networks = cache.get('site_networks')
        if networks is None:
            networks = list(cls.objects.filter(is_active=True).values_list('cidr', flat=True))
            cache.set('site_networks', networks, 300)  # Cache for 5 minutes
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
        cache.delete('offsite_settings')

    @classmethod
    def get_settings(cls):
        """Get settings with caching."""
        settings = cache.get('offsite_settings')
        if settings is None:
            settings, _ = cls.objects.get_or_create(pk=1)
            cache.set('offsite_settings', settings, 300)  # Cache for 5 minutes
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
        cache.delete('facility_fluid_balance_settings')

    @classmethod
    def get_settings(cls):
        """Get settings with caching."""
        settings = cache.get('facility_fluid_balance_settings')
        if settings is None:
            settings, _ = cls.objects.get_or_create(pk=1)
            cache.set('facility_fluid_balance_settings', settings, 300)  # Cache for 5 minutes
        return settings
