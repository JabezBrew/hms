from django.contrib import admin
from .models import (
    LabTestCatalog, LabPanel, LabOrder, LabOrderTest,
    LabSpecimen, LabResult
)


@admin.register(LabTestCatalog)
class LabTestCatalogAdmin(admin.ModelAdmin):
    list_display = ['code', 'short_name', 'name', 'category', 'specimen_type', 'tat_hours', 'price', 'is_active']
    list_filter = ['category', 'is_active', 'specimen_type']
    search_fields = ['code', 'name', 'short_name', 'loinc_code']
    readonly_fields = ['created_at', 'updated_at']
    fieldsets = (
        ('Test Identification', {
            'fields': ('code', 'loinc_code', 'name', 'short_name', 'category', 'description')
        }),
        ('Specimen Requirements', {
            'fields': ('specimen_type', 'container_type', 'volume_required', 'special_instructions')
        }),
        ('Reference Ranges', {
            'fields': ('reference_ranges', 'unit')
        }),
        ('Operations', {
            'fields': ('tat_hours', 'price', 'is_active')
        }),
        ('Audit', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(LabPanel)
class LabPanelAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'price', 'is_active']
    list_filter = ['is_active']
    search_fields = ['code', 'name']
    filter_horizontal = ['tests']
    readonly_fields = ['created_at', 'updated_at']
    fieldsets = (
        ('Panel Information', {
            'fields': ('code', 'name', 'description', 'price', 'is_active')
        }),
        ('Tests in Panel', {
            'fields': ('tests',)
        }),
        ('Audit', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


class LabOrderTestInline(admin.TabularInline):
    model = LabOrderTest
    extra = 1
    readonly_fields = ['status']


class LabSpecimenInline(admin.TabularInline):
    model = LabSpecimen
    extra = 0
    readonly_fields = ['barcode', 'collected_at', 'status']
    fields = ['barcode', 'specimen_type', 'container_type', 'collected_by', 'collected_at', 'status']


@admin.register(LabOrder)
class LabOrderAdmin(admin.ModelAdmin):
    list_display = ['order_number', 'patient', 'ordering_provider', 'priority', 'status', 'ordered_at']
    list_filter = ['status', 'priority', 'ordered_at']
    search_fields = ['order_number', 'patient__user__first_name', 'patient__user__last_name']
    readonly_fields = ['order_number', 'created_at', 'updated_at', 'fhir_id', 'fhir_synced']
    inlines = [LabOrderTestInline, LabSpecimenInline]
    filter_horizontal = ['panels']
    fieldsets = (
        ('Order Information', {
            'fields': ('order_number', 'patient', 'encounter', 'ordering_provider')
        }),
        ('Order Details', {
            'fields': ('priority', 'status', 'clinical_notes', 'fasting_required', 'panels')
        }),
        ('Status Timestamps', {
            'fields': ('ordered_at', 'collected_at', 'received_at', 'completed_at', 'cancelled_at', 'cancellation_reason')
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


@admin.register(LabOrderTest)
class LabOrderTestAdmin(admin.ModelAdmin):
    list_display = ['order', 'test', 'status']
    list_filter = ['status']
    search_fields = ['order__order_number', 'test__name']


@admin.register(LabSpecimen)
class LabSpecimenAdmin(admin.ModelAdmin):
    list_display = ['barcode', 'order', 'specimen_type', 'collected_by', 'collected_at', 'status', 'is_rejected']
    list_filter = ['status', 'is_rejected', 'specimen_type', 'collected_at']
    search_fields = ['barcode', 'order__order_number']
    readonly_fields = ['created_at', 'updated_at']
    fieldsets = (
        ('Specimen Identification', {
            'fields': ('barcode', 'order')
        }),
        ('Specimen Details', {
            'fields': ('specimen_type', 'container_type', 'volume_collected')
        }),
        ('Collection Information', {
            'fields': ('collected_by', 'collection_site', 'collected_at')
        }),
        ('Status', {
            'fields': ('status', 'is_rejected', 'rejection_reason')
        }),
        ('Lab Receipt', {
            'fields': ('received_by', 'received_at', 'storage_location')
        }),
        ('Audit', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(LabResult)
class LabResultAdmin(admin.ModelAdmin):
    list_display = ['order_test', 'value', 'unit', 'flag', 'is_verified', 'performed_at']
    list_filter = ['flag', 'is_verified', 'performed_at']
    search_fields = ['order_test__order__order_number', 'order_test__test__name']
    readonly_fields = ['created_at', 'updated_at', 'fhir_id', 'fhir_synced']
    fieldsets = (
        ('Test Information', {
            'fields': ('order_test', 'specimen')
        }),
        ('Result Values', {
            'fields': ('value', 'unit', 'reference_low', 'reference_high', 'flag', 'interpretation')
        }),
        ('Performer', {
            'fields': ('performed_by', 'performed_at')
        }),
        ('Verification', {
            'fields': ('is_verified', 'verified_by', 'verified_at')
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
