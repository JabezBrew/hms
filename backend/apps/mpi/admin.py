from django.contrib import admin

from .models import PatientIdentity, PatientFacilityLink


@admin.register(PatientIdentity)
class PatientIdentityAdmin(admin.ModelAdmin):
    list_display = ('last_name', 'first_name', 'date_of_birth', 'nhis_id', 'is_active')
    search_fields = ('last_name', 'first_name', 'nhis_id', 'email', 'phone')
    list_filter = ('is_active',)
    readonly_fields = ('created_at', 'updated_at')


@admin.register(PatientFacilityLink)
class PatientFacilityLinkAdmin(admin.ModelAdmin):
    list_display = ('facility_code', 'patient_identity', 'facility_patient_id', 'is_active')
    search_fields = ('facility_code', 'facility_patient_id')
    list_filter = ('facility_code', 'is_active')
    readonly_fields = ('linked_at', 'last_seen_at')
