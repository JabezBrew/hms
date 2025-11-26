from django.contrib import admin
from .models import PatientAllergy, DrugSafetyAlert, DrugInteractionCache


@admin.register(PatientAllergy)
class PatientAllergyAdmin(admin.ModelAdmin):
    list_display = ['patient', 'allergen_name', 'allergy_type', 'severity', 'is_active', 'created_at']
    list_filter = ['allergy_type', 'severity', 'is_active', 'created_at']
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'allergen_name']
    readonly_fields = ['created_at', 'updated_at', 'fhir_id', 'fhir_synced']
    fieldsets = (
        ('Patient Information', {
            'fields': ('patient', 'created_by')
        }),
        ('Allergy Details', {
            'fields': ('allergen_name', 'allergen_code', 'allergen_code_system', 'allergy_type', 'severity')
        }),
        ('Reaction Information', {
            'fields': ('reaction', 'onset_date')
        }),
        ('Status', {
            'fields': ('is_active', 'verified_by', 'verified_at')
        }),
        ('FHIR Sync', {
            'fields': ('fhir_id', 'fhir_synced'),
            'classes': ('collapse',)
        }),
        ('Audit', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(DrugSafetyAlert)
class DrugSafetyAlertAdmin(admin.ModelAdmin):
    list_display = ['patient', 'alert_type', 'severity', 'title', 'is_overridden', 'created_at']
    list_filter = ['alert_type', 'severity', 'is_overridden', 'created_at']
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'triggering_medication', 'conflicting_medication']
    readonly_fields = ['created_at']
    fieldsets = (
        ('Patient & Context', {
            'fields': ('patient', 'prescription', 'encounter')
        }),
        ('Alert Details', {
            'fields': ('alert_type', 'severity', 'title', 'description')
        }),
        ('Drug Information', {
            'fields': ('triggering_medication', 'conflicting_medication')
        }),
        ('Override Information', {
            'fields': ('is_overridden', 'override_reason', 'overridden_by', 'overridden_at')
        }),
        ('Audit', {
            'fields': ('created_at',),
            'classes': ('collapse',)
        }),
    )


@admin.register(DrugInteractionCache)
class DrugInteractionCacheAdmin(admin.ModelAdmin):
    list_display = ['drug1_rxcui', 'drug2_rxcui', 'severity', 'source', 'fetched_at', 'expires_at', 'is_expired']
    list_filter = ['severity', 'source', 'fetched_at']
    search_fields = ['drug1_rxcui', 'drug2_rxcui', 'description']
    readonly_fields = ['fetched_at']
    fieldsets = (
        ('Drug Pair', {
            'fields': ('drug1_rxcui', 'drug2_rxcui')
        }),
        ('Interaction', {
            'fields': ('severity', 'description', 'source')
        }),
        ('Cache Management', {
            'fields': ('fetched_at', 'expires_at')
        }),
    )

    def is_expired(self, obj):
        return obj.is_expired()
    is_expired.boolean = True
    is_expired.short_description = 'Expired'
