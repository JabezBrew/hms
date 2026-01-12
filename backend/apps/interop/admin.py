from django.contrib import admin

from .models import RecordExportJob


@admin.register(RecordExportJob)
class RecordExportJobAdmin(admin.ModelAdmin):
    list_display = ('patient', 'target_facility_code', 'status', 'created_at')
    list_filter = ('status', 'target_facility_code')
    search_fields = ('patient__id', 'target_facility_code')
    readonly_fields = ('created_at', 'updated_at')
