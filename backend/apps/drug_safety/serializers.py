from rest_framework import serializers
from .models import PatientAllergy, DrugSafetyAlert, DrugInteractionCache


class PatientAllergySerializer(serializers.ModelSerializer):
    """Serializer for patient allergies with display names."""
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    verified_by_name = serializers.CharField(source='verified_by.staff.user.get_full_name', read_only=True, allow_null=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True, allow_null=True)

    class Meta:
        model = PatientAllergy
        fields = [
            'id', 'patient', 'patient_name', 'allergen_name', 'allergen_code',
            'allergen_code_system', 'allergy_type', 'severity', 'reaction',
            'onset_date', 'is_active', 'verified_by', 'verified_by_name',
            'verified_at', 'fhir_id', 'fhir_synced', 'created_at', 'updated_at',
            'created_by', 'created_by_name'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'fhir_id', 'fhir_synced']


class PatientAllergyCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating patient allergies."""

    class Meta:
        model = PatientAllergy
        fields = [
            'patient', 'allergen_name', 'allergen_code', 'allergen_code_system',
            'allergy_type', 'severity', 'reaction', 'onset_date', 'is_active',
            'verified_by', 'verified_at', 'created_by'
        ]

    def validate(self, data):
        """Validate allergy data."""
        # Check for duplicate allergies
        existing = PatientAllergy.objects.filter(
            patient=data['patient'],
            allergen_name__iexact=data['allergen_name'],
            is_active=True
        ).exists()

        if existing:
            raise serializers.ValidationError(
                f"Active allergy to {data['allergen_name']} already exists for this patient."
            )

        return data


class DrugSafetyAlertSerializer(serializers.ModelSerializer):
    """Serializer for drug safety alerts with display names."""
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    overridden_by_name = serializers.CharField(source='overridden_by.staff.user.get_full_name', read_only=True, allow_null=True)
    severity_display = serializers.CharField(source='get_severity_display', read_only=True)
    alert_type_display = serializers.CharField(source='get_alert_type_display', read_only=True)
    requires_override_reason = serializers.BooleanField(source='requires_override_reason', read_only=True)

    class Meta:
        model = DrugSafetyAlert
        fields = [
            'id', 'patient', 'patient_name', 'prescription', 'encounter',
            'alert_type', 'alert_type_display', 'severity', 'severity_display',
            'title', 'description', 'triggering_medication', 'conflicting_medication',
            'is_overridden', 'override_reason', 'overridden_by', 'overridden_by_name',
            'overridden_at', 'requires_override_reason', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class DrugSafetyAlertOverrideSerializer(serializers.Serializer):
    """Serializer for overriding a drug safety alert."""
    override_reason = serializers.CharField(required=True, min_length=10)

    def validate_override_reason(self, value):
        """Ensure override reason is substantive."""
        if len(value.strip()) < 10:
            raise serializers.ValidationError(
                "Override reason must be at least 10 characters and provide clear justification."
            )
        return value


class DrugSafetyCheckRequestSerializer(serializers.Serializer):
    """Serializer for drug safety check requests."""
    patient_id = serializers.UUIDField(required=True)
    medication_name = serializers.CharField(required=True, max_length=255)
    encounter_id = serializers.UUIDField(required=False, allow_null=True)


class DrugSafetyCheckResponseSerializer(serializers.Serializer):
    """Serializer for drug safety check responses."""
    has_alerts = serializers.BooleanField()
    alert_count = serializers.IntegerField()
    highest_severity = serializers.CharField(allow_null=True, required=False)
    has_critical_alerts = serializers.BooleanField()
    alerts = DrugSafetyAlertSerializer(many=True)


class DrugSearchSerializer(serializers.Serializer):
    """Serializer for drug search results from RxNorm."""
    rxcui = serializers.CharField(allow_null=True)
    name = serializers.CharField()
    score = serializers.FloatField(required=False, allow_null=True)
    rank = serializers.IntegerField(required=False, allow_null=True)


class DrugInteractionCacheSerializer(serializers.ModelSerializer):
    """Serializer for drug interaction cache."""
    is_expired = serializers.BooleanField(source='is_expired', read_only=True)

    class Meta:
        model = DrugInteractionCache
        fields = [
            'id', 'drug1_rxcui', 'drug2_rxcui', 'severity', 'description',
            'source', 'fetched_at', 'expires_at', 'is_expired'
        ]
        read_only_fields = ['id', 'fetched_at']
