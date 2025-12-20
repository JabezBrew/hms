"""
Admin configuration for the encounters app.
"""
from django.contrib import admin

from .models import Encounter


@admin.register(Encounter)
class EncounterAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'patient', 'practitioner', 'encounter_type',
        'status', 'start_time', 'end_time', 'fhir_synced'
    ]
    list_filter = ['encounter_type', 'status', 'fhir_synced', 'start_time']
    search_fields = [
        'patient__user__first_name', 'patient__user__last_name',
        'patient__medical_record_number', 'reason', 'location'
    ]
    readonly_fields = [
        'id', 'fhir_id', 'fhir_synced', 'fhir_last_synced',
        'created_at', 'updated_at', 'created_by', 'updated_by'
    ]
    raw_id_fields = ['patient', 'practitioner', 'admission']
    date_hierarchy = 'start_time'
    ordering = ['-start_time']
