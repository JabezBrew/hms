from django.contrib import admin
from .models import ClinicalWorkflow, ConsultationWorkflow, WorkflowTemplate


@admin.register(ClinicalWorkflow)
class ClinicalWorkflowAdmin(admin.ModelAdmin):
    list_display = ['id', 'workflow_type', 'patient', 'user', 'status', 'current_step', 'total_steps', 'created_at']
    list_filter = ['workflow_type', 'status', 'created_at']
    search_fields = ['patient__first_name', 'patient__last_name', 'user__username']
    readonly_fields = ['created_at', 'updated_at', 'last_autosave', 'completed_at']

    fieldsets = (
        ('Workflow Information', {
            'fields': ('workflow_type', 'status', 'user', 'patient', 'encounter')
        }),
        ('Progress', {
            'fields': ('current_step', 'total_steps', 'steps_completed')
        }),
        ('Data', {
            'fields': ('context_data',),
            'classes': ('collapse',)
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at', 'last_autosave', 'completed_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(ConsultationWorkflow)
class ConsultationWorkflowAdmin(admin.ModelAdmin):
    list_display = ['id', 'workflow', 'appointment_id', 'chief_complaint_preview', 'template_used']
    search_fields = ['chief_complaint', 'assessment', 'plan']
    readonly_fields = ['workflow']

    fieldsets = (
        ('Reference', {
            'fields': ('workflow', 'appointment_id', 'template_used')
        }),
        ('Clinical Documentation', {
            'fields': ('chief_complaint', 'hpi', 'ros', 'physical_exam', 'assessment', 'plan')
        }),
    )

    def chief_complaint_preview(self, obj):
        return obj.chief_complaint[:50] + '...' if len(obj.chief_complaint) > 50 else obj.chief_complaint
    chief_complaint_preview.short_description = 'Chief Complaint'


@admin.register(WorkflowTemplate)
class WorkflowTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'workflow_type', 'specialty', 'is_public', 'usage_count', 'created_by', 'created_at']
    list_filter = ['workflow_type', 'is_public', 'specialty', 'created_at']
    search_fields = ['name', 'description']
    readonly_fields = ['usage_count', 'created_at', 'updated_at']

    fieldsets = (
        ('Template Information', {
            'fields': ('name', 'workflow_type', 'description', 'specialty')
        }),
        ('Access', {
            'fields': ('is_public', 'created_by')
        }),
        ('Content', {
            'fields': ('template_data',)
        }),
        ('Statistics', {
            'fields': ('usage_count', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
