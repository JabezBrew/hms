from django.contrib import admin

from .models import Problem, ProblemCode, ProblemLink, ProblemStatusEvent


@admin.register(ProblemCode)
class ProblemCodeAdmin(admin.ModelAdmin):
    list_display = ('code_system', 'code', 'display', 'category', 'is_quick_pick', 'is_active', 'needs_clinical_review')
    list_filter = ('code_system', 'category', 'is_quick_pick', 'is_active', 'needs_clinical_review')
    search_fields = ('code', 'display')
    ordering = ('code_system', 'code')


@admin.register(Problem)
class ProblemAdmin(admin.ModelAdmin):
    list_display = ('patient', 'display_label', 'clinical_status', 'verification_status', 'priority', 'recorded_at')
    list_filter = ('clinical_status', 'verification_status', 'priority', 'chronicity')
    search_fields = ('patient__user__first_name', 'patient__user__last_name', 'free_text_label', 'code__display')
    raw_id_fields = ('patient', 'code', 'recorded_by', 'last_updated_by')


@admin.register(ProblemStatusEvent)
class ProblemStatusEventAdmin(admin.ModelAdmin):
    list_display = ('problem', 'from_status', 'to_status', 'changed_by', 'changed_at')
    raw_id_fields = ('problem', 'changed_by')


@admin.register(ProblemLink)
class ProblemLinkAdmin(admin.ModelAdmin):
    list_display = ('problem', 'note_entry', 'prescription', 'lab_order', 'encounter', 'linked_at')
    raw_id_fields = ('problem', 'note_entry', 'prescription', 'lab_order', 'encounter', 'linked_by')
