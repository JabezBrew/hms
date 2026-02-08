from django.contrib import admin
from .models import (
    Referral,
    ReferralSLAPolicy,
    ReferralSLAEvent,
    ClinicWaitlistEntry,
)


@admin.register(Referral)
class ReferralAdmin(admin.ModelAdmin):
    list_display = [
        'referral_number', 'patient', 'referring_provider',
        'referred_to_department', 'urgency', 'status', 'submitted_at'
    ]
    list_filter = ['status', 'urgency', 'referred_to_department', 'submitted_at']
    search_fields = [
        'referral_number',
        'patient__user__first_name', 'patient__user__last_name',
        'referring_provider__staff__user__first_name',
        'referring_provider__staff__user__last_name',
        'referred_to_department', 'referred_to_specialty'
    ]
    readonly_fields = [
        'referral_number', 'created_at', 'updated_at',
        'fhir_id', 'fhir_synced', 'days_since_submission'
    ]
    fieldsets = (
        ('Referral Information', {
            'fields': ('referral_number', 'patient', 'encounter')
        }),
        ('Referring Provider', {
            'fields': ('referring_provider', 'referring_department')
        }),
        ('Referral Destination', {
            'fields': (
                'referred_to_provider', 'referred_to_department',
                'referred_to_specialty'
            )
        }),
        ('Referral Details', {
            'fields': (
                'urgency', 'status', 'reason',
                'clinical_summary', 'questions_for_specialist'
            )
        }),
        ('Specialist Response', {
            'fields': ('specialist_notes', 'recommendations'),
            'classes': ('collapse',)
        }),
        ('Scheduling', {
            'fields': ('scheduled_appointment_id',)
        }),
        ('Status Tracking', {
            'fields': (
                'submitted_at', 'accepted_at', 'completed_at',
                'declined_at', 'decline_reason', 'days_since_submission'
            ),
            'classes': ('collapse',)
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

    def days_since_submission(self, obj):
        """Display days since submission."""
        days = obj.days_since_submission
        if days is not None:
            return f"{days} days"
        return "Not submitted"
    days_since_submission.short_description = 'Days Since Submission'


@admin.register(ReferralSLAPolicy)
class ReferralSLAPolicyAdmin(admin.ModelAdmin):
    list_display = ['facility', 'referred_to_department', 'urgency', 'target_hours', 'is_active']
    list_filter = ['facility', 'urgency', 'is_active']
    search_fields = ['facility__code', 'referred_to_department']


@admin.register(ReferralSLAEvent)
class ReferralSLAEventAdmin(admin.ModelAdmin):
    list_display = ['referral', 'event_type', 'consumed_percent', 'deadline_at', 'triggered_at']
    list_filter = ['event_type', 'facility']
    search_fields = ['referral__referral_number']
    readonly_fields = ['triggered_at']


@admin.register(ClinicWaitlistEntry)
class ClinicWaitlistEntryAdmin(admin.ModelAdmin):
    list_display = ['clinic', 'patient', 'urgency', 'deadline_risk', 'status', 'wait_started_at']
    list_filter = ['facility', 'clinic', 'status', 'urgency', 'deadline_risk', 'vulnerability_flag']
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'clinic__name']
