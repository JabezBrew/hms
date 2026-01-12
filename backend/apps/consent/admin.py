from django.contrib import admin

from .models import ConsentGrant, CrossFacilityReferral, ConsentAccessToken


@admin.register(ConsentGrant)
class ConsentGrantAdmin(admin.ModelAdmin):
    list_display = ('patient_identity', 'source_facility_code', 'target_facility_code', 'status', 'scope')
    list_filter = ('status', 'scope')
    search_fields = ('patient_identity__id', 'source_facility_code', 'target_facility_code')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(CrossFacilityReferral)
class CrossFacilityReferralAdmin(admin.ModelAdmin):
    list_display = ('patient_identity', 'source_facility_code', 'target_facility_code', 'status')
    list_filter = ('status',)
    search_fields = ('patient_identity__id', 'source_facility_code', 'target_facility_code')
    readonly_fields = ('created_at', 'updated_at', 'responded_at')


@admin.register(ConsentAccessToken)
class ConsentAccessTokenAdmin(admin.ModelAdmin):
    list_display = ('consent_grant', 'target_facility_code', 'expires_at', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('consent_grant__id', 'target_facility_code')
    readonly_fields = ('created_at', 'last_used_at')
