from django.contrib import admin
from .models import NoteTemplate, NoteTemplateRevision, NoteEntry


@admin.register(NoteTemplate)
class NoteTemplateAdmin(admin.ModelAdmin):
    list_display = ('title', 'is_active', 'created_by', 'created_at')
    list_filter = ('is_active', 'created_at')
    search_fields = ('title', 'description')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(NoteTemplateRevision)
class NoteTemplateRevisionAdmin(admin.ModelAdmin):
    list_display = ('template', 'version', 'status', 'mode', 'created_by', 'published_at')
    list_filter = ('status', 'mode', 'created_at')
    search_fields = ('template__title', 'change_summary')
    readonly_fields = ('created_at', 'updated_at', 'submitted_at', 'published_at')


@admin.register(NoteEntry)
class NoteEntryAdmin(admin.ModelAdmin):
    list_display = ('template', 'template_version', 'encounter_id', 'practitioner', 'created_at')
    list_filter = ('template', 'created_at')
    search_fields = ('encounter_id', 'composition_fhir_id')
    readonly_fields = ('created_at', 'updated_at')
