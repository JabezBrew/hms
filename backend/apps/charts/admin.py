"""
Chart Builder Admin Configuration
"""

from django.contrib import admin
from apps.charts.models import ChartTemplate, ChartField, ChartAssignment, ChartEntry


class ChartFieldInline(admin.TabularInline):
    model = ChartField
    extra = 0
    fields = ['name', 'field_key', 'field_type', 'display_order', 'is_required', 'group_name']
    ordering = ['display_order']


@admin.register(ChartTemplate)
class ChartTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'category', 'visibility', 'default_interval', 'is_active', 'is_system', 'created_by', 'created_at']
    list_filter = ['category', 'visibility', 'is_active', 'is_system']
    search_fields = ['name', 'description']
    ordering = ['category', 'name']
    inlines = [ChartFieldInline]
    readonly_fields = ['id', 'version', 'created_at', 'updated_at']

    fieldsets = (
        (None, {
            'fields': ('id', 'name', 'description', 'icon')
        }),
        ('Organization', {
            'fields': ('category', 'visibility', 'department')
        }),
        ('Display Settings', {
            'fields': ('default_interval', 'display_mode', 'columns_per_page')
        }),
        ('Status', {
            'fields': ('is_active', 'is_system', 'version')
        }),
        ('Audit', {
            'fields': ('created_by', 'created_at', 'updated_by', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(ChartField)
class ChartFieldAdmin(admin.ModelAdmin):
    list_display = ['name', 'template', 'field_key', 'field_type', 'display_order', 'is_required']
    list_filter = ['field_type', 'is_required', 'template']
    search_fields = ['name', 'field_key', 'template__name']
    ordering = ['template', 'display_order']
    readonly_fields = ['id', 'created_at', 'updated_at']


@admin.register(ChartAssignment)
class ChartAssignmentAdmin(admin.ModelAdmin):
    list_display = ['template', 'patient', 'status', 'start_datetime', 'ordered_by', 'created_at']
    list_filter = ['status', 'template']
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'template__name']
    ordering = ['-created_at']
    readonly_fields = ['id', 'created_at', 'updated_at', 'discontinued_at']
    raw_id_fields = ['patient', 'admission', 'encounter', 'ordered_by']


@admin.register(ChartEntry)
class ChartEntryAdmin(admin.ModelAdmin):
    list_display = ['assignment', 'observation_datetime', 'has_critical_values', 'recorded_by', 'is_deleted']
    list_filter = ['has_critical_values', 'is_deleted', 'assignment__template']
    search_fields = ['assignment__patient__user__first_name', 'assignment__patient__user__last_name']
    ordering = ['-observation_datetime']
    readonly_fields = ['id', 'has_critical_values', 'critical_fields', 'created_at', 'updated_at', 'deleted_at']
    raw_id_fields = ['assignment', 'recorded_by']
