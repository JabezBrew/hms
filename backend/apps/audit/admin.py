from django.contrib import admin
from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Django admin configuration for audit logs."""

    list_display = [
        'timestamp',
        'user_email',
        'user_type',
        'action',
        'category',
        'resource_type',
        'resource_name',
    ]

    list_filter = [
        'category',
        'action',
        'user_type',
        'timestamp',
    ]

    search_fields = [
        'user_email',
        'description',
        'resource_name',
        'resource_id',
    ]

    readonly_fields = [
        'id',
        'user',
        'user_email',
        'user_type',
        'action',
        'category',
        'resource_type',
        'resource_id',
        'resource_name',
        'description',
        'changes',
        'ip_address',
        'user_agent',
        'timestamp',
    ]

    date_hierarchy = 'timestamp'
    ordering = ['-timestamp']

    def has_add_permission(self, request):
        """Audit logs should not be created manually."""
        return False

    def has_change_permission(self, request, obj=None):
        """Audit logs should not be modified."""
        return False

    def has_delete_permission(self, request, obj=None):
        """Only superusers can delete audit logs."""
        return request.user.is_superuser
