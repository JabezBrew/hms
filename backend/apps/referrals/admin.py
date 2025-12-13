from django.contrib import admin
from .models import Referral


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
