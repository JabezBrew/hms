"""
Encounter serializers for API data transformation.
"""
from rest_framework import serializers

from .models import Encounter
from apps.users.serializers import PatientProfileSerializer, PractitionerProfileSerializer


class EncounterSerializer(serializers.ModelSerializer):
    """
    Serializer for reading Encounter data.
    """
    patient_name = serializers.ReadOnlyField()
    practitioner_name = serializers.ReadOnlyField()
    duration_minutes = serializers.ReadOnlyField()
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    practitioner_details = PractitionerProfileSerializer(source='practitioner', read_only=True)

    class Meta:
        model = Encounter
        fields = [
            'id', 'patient', 'patient_details', 'patient_name',
            'practitioner', 'practitioner_details', 'practitioner_name',
            'encounter_type', 'status', 'start_time', 'end_time',
            'reason', 'service_type', 'location',
            'admission_source', 'discharge_disposition', 'destination',
            'admission', 'duration_minutes',
            'fhir_id', 'fhir_synced', 'fhir_last_synced',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'patient_name', 'practitioner_name', 'duration_minutes',
            'fhir_id', 'fhir_synced', 'fhir_last_synced',
            'created_at', 'updated_at'
        ]


class EncounterListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for listing Encounters (faster queries).
    """
    patient_name = serializers.ReadOnlyField()
    practitioner_name = serializers.ReadOnlyField()
    patient_id = serializers.UUIDField(source='patient.id', read_only=True)
    practitioner_id = serializers.UUIDField(source='practitioner.id', read_only=True, allow_null=True)

    class Meta:
        model = Encounter
        fields = [
            'id', 'patient_id', 'patient_name',
            'practitioner_id', 'practitioner_name',
            'encounter_type', 'status', 'start_time', 'end_time',
            'reason', 'service_type', 'location',
            'created_at', 'updated_at'
        ]


class EncounterCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating a new Encounter.
    """
    patient_id = serializers.UUIDField(write_only=True)
    practitioner_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Encounter
        fields = [
            'patient_id', 'practitioner_id',
            'encounter_type', 'status', 'start_time',
            'reason', 'service_type', 'location',
            'admission_source'
        ]

    def validate_patient_id(self, value):
        """Validate patient exists."""
        from apps.users.models import PatientProfile
        try:
            PatientProfile.objects.get(id=value)
        except PatientProfile.DoesNotExist:
            raise serializers.ValidationError("Patient not found.")
        return value

    def validate_practitioner_id(self, value):
        """Validate practitioner exists if provided."""
        if value:
            from apps.users.models import PractitionerProfile
            try:
                PractitionerProfile.objects.get(id=value)
            except PractitionerProfile.DoesNotExist:
                raise serializers.ValidationError("Practitioner not found.")
        return value

    def create(self, validated_data):
        """Create encounter with patient and practitioner references."""
        from apps.users.models import PatientProfile, PractitionerProfile

        patient_id = validated_data.pop('patient_id')
        practitioner_id = validated_data.pop('practitioner_id', None)

        validated_data['patient'] = PatientProfile.objects.get(id=patient_id)
        if practitioner_id:
            validated_data['practitioner'] = PractitionerProfile.objects.get(id=practitioner_id)

        return super().create(validated_data)


class EncounterUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for updating an Encounter.
    """
    class Meta:
        model = Encounter
        fields = [
            'status', 'end_time',
            'discharge_disposition', 'destination'
        ]

    def update(self, instance, validated_data):
        """Mark encounter for re-sync when updated."""
        instance = super().update(instance, validated_data)
        instance.fhir_synced = False
        instance.save(update_fields=['fhir_synced'])
        return instance
