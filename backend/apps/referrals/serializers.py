from rest_framework import serializers
from django.utils import timezone
from .models import Referral, ReferralStatus, ReferralUrgency, ReferralNotification


class ReferralSerializer(serializers.ModelSerializer):
    """
    Serializer for referrals with full details.
    """
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    referring_provider_name = serializers.SerializerMethodField()
    referred_to_provider_name = serializers.SerializerMethodField()

    urgency_display = serializers.CharField(source='get_urgency_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    # Computed properties
    is_urgent = serializers.BooleanField(read_only=True)
    days_since_submission = serializers.IntegerField(read_only=True)
    requires_action = serializers.BooleanField(read_only=True)

    # New fields for consultation workflow integration
    consultation_workflow_id = serializers.UUIDField(source='consultation_workflow.id', read_only=True, allow_null=True)
    consultation_encounter_id = serializers.UUIDField(source='consultation_encounter.id', read_only=True, allow_null=True)

    class Meta:
        model = Referral
        fields = [
            'id', 'referral_number',
            'patient', 'patient_name', 'patient_mrn', 'encounter',
            'referring_provider', 'referring_provider_name', 'referring_department',
            'referred_to_provider', 'referred_to_provider_name',
            'referred_to_department', 'referred_to_specialty',
            'urgency', 'urgency_display', 'status', 'status_display',
            'reason', 'clinical_summary', 'questions_for_specialist',
            'specialist_notes', 'recommendations',
            'scheduled_appointment_id',
            'referral_type', 'consultation_workflow_id', 'consultation_encounter_id',
            'submitted_at', 'accepted_at', 'completed_at',
            'declined_at', 'decline_reason',
            'is_urgent', 'days_since_submission', 'requires_action',
            'fhir_id', 'fhir_synced',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'referral_number', 'created_at', 'updated_at',
            'patient_name', 'patient_mrn', 'referring_provider_name',
            'referred_to_provider_name', 'urgency_display', 'status_display',
            'is_urgent', 'days_since_submission', 'requires_action',
            'submitted_at', 'accepted_at', 'completed_at', 'declined_at',
            'consultation_workflow_id', 'consultation_encounter_id'
        ]

    def get_referring_provider_name(self, obj):
        """Get referring provider full name."""
        return obj.referring_provider.staff.user.get_full_name()

    def get_referred_to_provider_name(self, obj):
        """Get referred-to provider full name."""
        if obj.referred_to_provider:
            return obj.referred_to_provider.staff.user.get_full_name()
        return None


class ReferralCreateSerializer(serializers.ModelSerializer):
    """
    Create serializer for referrals with validation.
    """
    # referring_provider is optional - auto-set from current user in perform_create
    referring_provider = serializers.PrimaryKeyRelatedField(
        queryset=Referral._meta.get_field('referring_provider').related_model.objects.all(),
        required=False,
        allow_null=True
    )
    # referred_to_specialty is optional - defaults to department if not provided
    referred_to_specialty = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Referral
        fields = [
            'id', 'referral_number',
            'patient', 'encounter', 'referring_provider', 'referring_department',
            'referred_to_provider', 'referred_to_department', 'referred_to_specialty',
            'urgency', 'reason', 'clinical_summary', 'questions_for_specialist',
            'referral_type'
        ]
        read_only_fields = ['id', 'referral_number']

    def validate(self, data):
        """Validate referral data."""
        # Ensure reason is provided
        if not data.get('reason') or len(data.get('reason', '').strip()) < 10:
            raise serializers.ValidationError(
                "Reason for referral must be at least 10 characters."
            )

        # Ensure department is provided
        if not data.get('referred_to_department'):
            raise serializers.ValidationError(
                "Target department is required."
            )

        # Default specialty to department if not provided
        if not data.get('referred_to_specialty'):
            data['referred_to_specialty'] = data.get('referred_to_department', '')

        return data


class ReferralSubmitSerializer(serializers.Serializer):
    """
    Serializer for submitting a referral.
    """
    pass  # No additional fields needed, just triggers status change


class ReferralAcceptSerializer(serializers.Serializer):
    """
    Serializer for accepting a referral.
    """
    acceptance_notes = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Notes from specialist about acceptance"
    )


class ReferralDeclineSerializer(serializers.Serializer):
    """
    Serializer for declining a referral.
    """
    decline_reason = serializers.CharField(
        required=True,
        min_length=10,
        help_text="Reason for declining referral (minimum 10 characters)"
    )


class ReferralScheduleSerializer(serializers.Serializer):
    """
    Serializer for scheduling an appointment for referral.
    """
    scheduled_appointment_id = serializers.CharField(
        required=True,
        help_text="Appointment ID for the scheduled consultation"
    )


class ReferralCompleteSerializer(serializers.Serializer):
    """
    Serializer for completing a referral.
    """
    specialist_notes = serializers.CharField(
        required=True,
        min_length=10,
        help_text="Specialist's notes and findings (minimum 10 characters)"
    )
    recommendations = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Recommendations back to referring provider"
    )


class ReferralResponseSerializer(serializers.Serializer):
    """
    Serializer for specialist response to referral.
    """
    specialist_notes = serializers.CharField(
        required=True,
        min_length=10,
        help_text="Specialist's notes and findings"
    )
    recommendations = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Recommendations back to referring provider"
    )


class ReferralSearchSerializer(serializers.Serializer):
    """
    Serializer for referral search parameters.
    """
    patient_id = serializers.UUIDField(required=False)
    referring_provider_id = serializers.UUIDField(required=False)
    referred_to_provider_id = serializers.UUIDField(required=False)
    department = serializers.CharField(required=False)
    specialty = serializers.CharField(required=False)
    status = serializers.ChoiceField(
        choices=ReferralStatus.choices,
        required=False
    )
    urgency = serializers.ChoiceField(
        choices=ReferralUrgency.choices,
        required=False
    )
    date_from = serializers.DateTimeField(required=False)
    date_to = serializers.DateTimeField(required=False)
    pending_only = serializers.BooleanField(required=False)
    urgent_only = serializers.BooleanField(required=False)


class ReferralListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for referral lists (inbox/sent).
    """
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    referring_provider_name = serializers.SerializerMethodField()
    referred_to_provider_name = serializers.SerializerMethodField()

    urgency_display = serializers.CharField(source='get_urgency_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    is_urgent = serializers.BooleanField(read_only=True)
    days_since_submission = serializers.IntegerField(read_only=True)

    # Consultation workflow fields
    consultation_workflow_id = serializers.UUIDField(source='consultation_workflow.id', read_only=True, allow_null=True)

    class Meta:
        model = Referral
        fields = [
            'id', 'referral_number',
            'patient', 'patient_name', 'patient_mrn',
            'referring_provider_name', 'referring_department',
            'referred_to_provider_name', 'referred_to_department', 'referred_to_specialty',
            'urgency', 'urgency_display', 'status', 'status_display',
            'reason', 'submitted_at', 'accepted_at', 'completed_at',
            'specialist_notes', 'recommendations',
            'is_urgent', 'days_since_submission',
            'referral_type', 'consultation_workflow_id',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['__all__']

    def get_referring_provider_name(self, obj):
        """Get referring provider full name."""
        return obj.referring_provider.staff.user.get_full_name()

    def get_referred_to_provider_name(self, obj):
        """Get referred-to provider full name."""
        if obj.referred_to_provider:
            return obj.referred_to_provider.staff.user.get_full_name()
        return None


class ReferralNotificationSerializer(serializers.ModelSerializer):
    """
    Serializer for referral in-app notifications.
    """
    referral_number = serializers.CharField(source='referral.referral_number', read_only=True)
    referred_to_department = serializers.CharField(source='referral.referred_to_department', read_only=True)
    referred_to_specialty = serializers.CharField(source='referral.referred_to_specialty', read_only=True)
    event_display = serializers.CharField(source='get_event_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    urgency_display = serializers.CharField(source='get_urgency_display', read_only=True)

    class Meta:
        model = ReferralNotification
        fields = [
            'id', 'referral', 'referral_number',
            'event', 'event_display',
            'status', 'status_display',
            'urgency', 'urgency_display',
            'referred_to_department', 'referred_to_specialty',
            'is_read', 'created_at'
        ]
        read_only_fields = ['__all__']
