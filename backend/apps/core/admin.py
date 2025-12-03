"""
Admin configuration for core models.
"""
from django.contrib import admin
from .models import SiteNetwork, OffSiteAccessSettings


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
