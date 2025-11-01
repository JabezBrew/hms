from django.contrib import admin
from .models import VitalSigns, NursingTask, NursingAlert, MedicationAdministration, ShiftHandoff

@admin.register(VitalSigns)
class VitalSignsAdmin(admin.ModelAdmin):
    list_display = ['patient', 'recorded_by', 'recorded_at', 'temperature', 'heart_rate', 'blood_pressure', 'oxygen_saturation']
    list_filter = ['recorded_at', 'is_critical']
    search_fields = ['patient__user__first_name', 'patient__user__last_name']
    date_hierarchy = 'recorded_at'


@admin.register(NursingTask)
class NursingTaskAdmin(admin.ModelAdmin):
    list_display = ['patient', 'task_type', 'priority', 'status', 'scheduled_time', 'assigned_to']
    list_filter = ['task_type', 'priority', 'status', 'scheduled_time']
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'description']


@admin.register(NursingAlert)
class NursingAlertAdmin(admin.ModelAdmin):
    list_display = ['patient', 'alert_type', 'severity', 'is_acknowledged', 'created_at']
    list_filter = ['alert_type', 'severity', 'is_acknowledged', 'created_at']
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'message']


@admin.register(MedicationAdministration)
class MedicationAdministrationAdmin(admin.ModelAdmin):
    list_display = ['patient', 'medication_name', 'scheduled_time', 'administered_time', 'status', 'administered_by']
    list_filter = ['status', 'scheduled_time', 'administered_time']
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'medication_name']


@admin.register(ShiftHandoff)
class ShiftHandoffAdmin(admin.ModelAdmin):
    list_display = ['patient', 'shift_date', 'shift_type', 'from_nurse', 'to_nurse', 'created_at']
    list_filter = ['shift_date', 'shift_type', 'created_at']
    search_fields = ['patient__user__first_name', 'patient__user__last_name']
