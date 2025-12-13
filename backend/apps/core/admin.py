"""
Admin configuration for core models.
"""
from django.contrib import admin
from .models import SiteNetwork, OffSiteAccessSettings, FacilityFluidBalanceSettings


@admin.register(SiteNetwork)
class SiteNetworkAdmin(admin.ModelAdmin):
    """Admin interface for managing site networks."""
    list_display = ['name', 'cidr', 'is_active', 'created_at', 'updated_at']
    list_filter = ['is_active']
    search_fields = ['name', 'cidr', 'description']
    ordering = ['name']
    readonly_fields = ['created_at', 'updated_at']

    fieldsets = (
        (None, {
            'fields': ('name', 'cidr', 'is_active')
        }),
        ('Details', {
            'fields': ('description',),
            'classes': ('collapse',)
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(OffSiteAccessSettings)
class OffSiteAccessSettingsAdmin(admin.ModelAdmin):
    """Admin interface for off-site access settings (singleton)."""
    list_display = ['__str__', 'offsite_mode', 'allow_admin_override', 'updated_at']
    readonly_fields = ['updated_at']

    fieldsets = (
        ('Access Mode', {
            'fields': ('offsite_mode', 'allow_admin_override')
        }),
        ('Testing', {
            'fields': ('treat_localhost_as_offsite',),
            'description': 'Options for testing off-site access from localhost'
        }),
        ('Messages', {
            'fields': ('readonly_message', 'deny_message'),
            'classes': ('collapse',)
        }),
        ('Timestamps', {
            'fields': ('updated_at',),
            'classes': ('collapse',)
        }),
    )

    def has_add_permission(self, request):
        # Only allow one instance
        return not OffSiteAccessSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        # Don't allow deletion
        return False


@admin.register(FacilityFluidBalanceSettings)
class FacilityFluidBalanceSettingsAdmin(admin.ModelAdmin):
    """Admin interface for fluid balance alert settings (singleton)."""
    list_display = [
        '__str__',
        'min_daily_intake_target',
        'max_daily_output_threshold',
        'enable_balance_alerts',
        'updated_at'
    ]
    readonly_fields = ['updated_at']

    fieldsets = (
        ('Alert Thresholds (ml)', {
            'fields': (
                'min_daily_intake_target',
                'max_daily_output_threshold',
                'negative_balance_alert_threshold',
                'positive_balance_alert_threshold',
            ),
            'description': 'Configure threshold values in milliliters (ml) that trigger alerts.'
        }),
        ('Enable/Disable Alerts', {
            'fields': (
                'enable_intake_alerts',
                'enable_output_alerts',
                'enable_balance_alerts',
            ),
            'description': 'Toggle which types of alerts are active.'
        }),
        ('Timestamps', {
            'fields': ('updated_at',),
            'classes': ('collapse',)
        }),
    )

    def has_add_permission(self, request):
        # Only allow one instance (singleton)
        return not FacilityFluidBalanceSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        # Don't allow deletion
        return False
