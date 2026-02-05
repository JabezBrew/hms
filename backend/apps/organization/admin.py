"""
Django admin configuration for the organization app.
"""
from django.contrib import admin
from mptt.admin import MPTTModelAdmin

from .models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
    UnitWardAllocation,
)


# =============================================================================
# Configuration Admins
# =============================================================================


@admin.register(UnitTypeConfig)
class UnitTypeConfigAdmin(admin.ModelAdmin):
    list_display = [
        'code', 'name', 'can_be_root', 'depth_level',
        'can_admit_patients', 'can_consult', 'can_have_wards',
        'display_order', 'is_active'
    ]
    list_filter = ['is_active', 'can_be_root', 'can_admit_patients', 'can_consult']
    search_fields = ['code', 'name']
    filter_horizontal = ['allowed_parent_types']
    ordering = ['display_order', 'name']
    fieldsets = [
        (None, {
            'fields': ['code', 'name', 'is_active']
        }),
        ('Hierarchy', {
            'fields': ['allowed_parent_types', 'can_be_root', 'depth_level']
        }),
        ('Capabilities', {
            'fields': ['can_have_wards', 'can_admit_patients', 'can_consult', 'can_have_budget']
        }),
        ('Custom Attributes', {
            'fields': ['attributes_schema'],
            'classes': ['collapse']
        }),
        ('Display', {
            'fields': ['icon', 'color', 'display_order']
        }),
    ]


@admin.register(LeadershipRoleConfig)
class LeadershipRoleConfigAdmin(admin.ModelAdmin):
    list_display = [
        'code', 'name', 'is_primary_leader', 'max_per_unit',
        'can_approve', 'can_manage_staff', 'can_view_all_data',
        'display_order', 'is_active'
    ]
    list_filter = ['is_active', 'is_primary_leader', 'can_approve', 'can_manage_staff']
    search_fields = ['code', 'name']
    filter_horizontal = ['applicable_unit_types']
    ordering = ['display_order', 'name']
    fieldsets = [
        (None, {
            'fields': ['code', 'name', 'is_active']
        }),
        ('Configuration', {
            'fields': ['applicable_unit_types', 'is_primary_leader', 'max_per_unit']
        }),
        ('Permissions', {
            'fields': ['can_approve', 'can_manage_staff', 'can_manage_budget', 'can_view_all_data']
        }),
        ('Display', {
            'fields': ['display_order']
        }),
    ]


@admin.register(StaffAssignmentTypeConfig)
class StaffAssignmentTypeConfigAdmin(admin.ModelAdmin):
    list_display = [
        'code', 'name', 'requires_primary', 'allows_secondary',
        'allows_multiple_primary', 'supports_date_ranges', 'is_active'
    ]
    list_filter = ['is_active', 'requires_primary', 'supports_date_ranges']
    search_fields = ['code', 'name']
    ordering = ['name']
    fieldsets = [
        (None, {
            'fields': ['code', 'name', 'is_active']
        }),
        ('Assignment Rules', {
            'fields': [
                'requires_primary', 'allows_secondary',
                'allows_multiple_primary', 'supports_date_ranges'
            ]
        }),
        ('Applicability', {
            'fields': ['applicable_user_types']
        }),
    ]


# =============================================================================
# Core Model Admins
# =============================================================================


@admin.register(ClinicalUnit)
class ClinicalUnitAdmin(MPTTModelAdmin):
    """Admin for ClinicalUnit with MPTT tree support."""
    list_display = [
        'name', 'code', 'unit_type', 'parent',
        'is_active', 'accepts_admissions', 'staffing_mode', 'created_at'
    ]
    list_filter = ['is_active', 'unit_type', 'accepts_admissions', 'accepts_referrals']
    search_fields = ['name', 'code', 'short_name']
    raw_id_fields = ['parent', 'root_unit', 'created_by', 'updated_by']
    readonly_fields = ['id', 'path_cache', 'root_unit', 'created_at', 'updated_at']
    mptt_level_indent = 20

    fieldsets = [
        (None, {
            'fields': ['id', 'parent', 'unit_type', 'code', 'name', 'short_name', 'description']
        }),
        ('Cached Fields (Read-only)', {
            'fields': ['path_cache', 'root_unit'],
            'classes': ['collapse']
        }),
        ('Location', {
            'fields': ['location', 'floor', 'building'],
            'classes': ['collapse']
        }),
        ('Contact', {
            'fields': ['phone', 'email'],
            'classes': ['collapse']
        }),
        ('Operating Hours', {
            'fields': ['operates_24_hours', 'operating_hours_start', 'operating_hours_end'],
            'classes': ['collapse']
        }),
        ('Settings', {
            'fields': ['timezone', 'currency'],
            'classes': ['collapse']
        }),
        ('Financial', {
            'fields': ['has_own_budget', 'cost_center_code'],
            'classes': ['collapse']
        }),
        ('Clinical', {
            'fields': ['accepts_referrals', 'accepts_admissions', 'staffing_mode']
        }),
        ('Custom Attributes', {
            'fields': ['custom_attributes'],
            'classes': ['collapse']
        }),
        ('Status', {
            'fields': ['is_active', 'effective_from', 'effective_until']
        }),
        ('Audit', {
            'fields': ['created_at', 'updated_at', 'created_by', 'updated_by'],
            'classes': ['collapse']
        }),
    ]


@admin.register(UnitLeadership)
class UnitLeadershipAdmin(admin.ModelAdmin):
    list_display = [
        'user', 'role', 'unit', 'effective_from', 'effective_until',
        'is_active', 'is_currently_effective'
    ]
    list_filter = ['is_active', 'role', 'effective_from']
    search_fields = ['user__email', 'user__first_name', 'user__last_name', 'unit__name']
    raw_id_fields = ['unit', 'user', 'created_by']
    readonly_fields = ['id', 'created_at', 'is_currently_effective']
    date_hierarchy = 'effective_from'

    fieldsets = [
        (None, {
            'fields': ['id', 'unit', 'role', 'user']
        }),
        ('Effective Period', {
            'fields': ['effective_from', 'effective_until', 'is_active', 'is_currently_effective']
        }),
        ('Audit', {
            'fields': ['created_at', 'created_by'],
            'classes': ['collapse']
        }),
    ]

    @admin.display(boolean=True, description='Currently Effective')
    def is_currently_effective(self, obj):
        return obj.is_currently_effective


# =============================================================================
# Staff Assignment Admins
# =============================================================================


@admin.register(StaffUnitAssignment)
class StaffUnitAssignmentAdmin(admin.ModelAdmin):
    list_display = [
        'practitioner', 'unit', 'assignment_type',
        'is_primary', 'is_secondary', 'fte_percentage',
        'is_active', 'assigned_at'
    ]
    list_filter = ['is_active', 'is_primary', 'is_secondary', 'assignment_type']
    search_fields = [
        'practitioner__staff__user__email',
        'practitioner__staff__user__first_name',
        'practitioner__staff__user__last_name',
        'unit__name'
    ]
    raw_id_fields = ['unit', 'practitioner', 'assigned_by']
    readonly_fields = ['id', 'assigned_at', 'updated_at']
    date_hierarchy = 'assigned_at'

    fieldsets = [
        (None, {
            'fields': ['id', 'unit', 'practitioner', 'assignment_type']
        }),
        ('Assignment Details', {
            'fields': ['is_primary', 'is_secondary', 'role_description', 'fte_percentage']
        }),
        ('Effective Period', {
            'fields': ['effective_from', 'effective_until', 'is_active']
        }),
        ('Audit', {
            'fields': ['assigned_at', 'updated_at', 'assigned_by'],
            'classes': ['collapse']
        }),
    ]


@admin.register(UnitMemberAssignment)
class UnitMemberAssignmentAdmin(admin.ModelAdmin):
    list_display = [
        'staff', 'unit', 'assignment_type',
        'is_primary', 'is_secondary', 'fte_percentage',
        'is_active', 'assigned_at'
    ]
    list_filter = ['is_active', 'is_primary', 'is_secondary', 'assignment_type']
    search_fields = [
        'staff__user__email',
        'staff__user__first_name',
        'staff__user__last_name',
        'unit__name'
    ]
    raw_id_fields = ['unit', 'staff', 'assigned_by']
    readonly_fields = ['id', 'assigned_at', 'updated_at']
    date_hierarchy = 'assigned_at'

    fieldsets = [
        (None, {
            'fields': ['id', 'unit', 'staff', 'assignment_type']
        }),
        ('Assignment Details', {
            'fields': ['is_primary', 'is_secondary', 'role_description', 'fte_percentage']
        }),
        ('Effective Period', {
            'fields': ['effective_from', 'effective_until', 'is_active']
        }),
        ('Audit', {
            'fields': ['assigned_at', 'updated_at', 'assigned_by'],
            'classes': ['collapse']
        }),
    ]


@admin.register(CrossCoverageSchedule)
class CrossCoverageScheduleAdmin(admin.ModelAdmin):
    list_display = [
        'covered_unit', 'covering_practitioner', 'covering_unit',
        'coverage_type', 'start_datetime', 'end_datetime', 'is_active'
    ]
    list_filter = ['is_active', 'coverage_type', 'start_datetime']
    search_fields = [
        'covered_unit__name',
        'covering_unit__name',
        'covering_practitioner__staff__user__email'
    ]
    raw_id_fields = ['covered_unit', 'covering_practitioner', 'covering_unit', 'created_by']
    readonly_fields = ['id', 'created_at']
    date_hierarchy = 'start_datetime'

    fieldsets = [
        (None, {
            'fields': ['id', 'covered_unit', 'coverage_type']
        }),
        ('Coverage Provider', {
            'fields': ['covering_practitioner', 'covering_unit'],
            'description': 'Set either a practitioner OR a unit, not both.'
        }),
        ('Schedule', {
            'fields': ['start_datetime', 'end_datetime', 'is_active']
        }),
        ('Notes', {
            'fields': ['notes'],
            'classes': ['collapse']
        }),
        ('Audit', {
            'fields': ['created_at', 'created_by'],
            'classes': ['collapse']
        }),
    ]


@admin.register(UnitWardAllocation)
class UnitWardAllocationAdmin(admin.ModelAdmin):
    list_display = [
        'unit', 'ward', 'allocation_type',
        'allocated_beds', 'min_beds', 'max_beds', 'priority',
        'is_active'
    ]
    list_filter = ['is_active', 'allocation_type']
    search_fields = ['unit__name', 'ward__name']
    raw_id_fields = ['unit', 'ward', 'created_by']
    readonly_fields = ['id', 'created_at', 'updated_at']

    fieldsets = [
        (None, {
            'fields': ['id', 'unit', 'ward', 'allocation_type']
        }),
        ('Bed Allocation', {
            'fields': ['allocated_beds', 'min_beds', 'max_beds', 'priority']
        }),
        ('Effective Period', {
            'fields': ['effective_from', 'effective_until', 'days_of_week', 'is_active']
        }),
        ('Audit', {
            'fields': ['created_at', 'updated_at', 'created_by'],
            'classes': ['collapse']
        }),
    ]
