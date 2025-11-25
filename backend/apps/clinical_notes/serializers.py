from rest_framework import serializers
from .models import NoteTemplate, NoteEntry, Prescription
from ..users.models import PractitionerProfile, PatientProfile


class NoteTemplateSerializer(serializers.ModelSerializer):
    """
    Serializer for NoteTemplate model.
    """
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = NoteTemplate
        fields = [
            'id', 'title', 'description', 'is_active', 'is_public', 'structure',
            'created_by', 'created_by_name', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_by', 'created_by_name', 'created_at', 'updated_at']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def create(self, validated_data):
        # Check if this is a default template (should not have a creator)
        is_default = validated_data.pop('is_default', False)

        # Only set created_by if not a default template
        if not is_default:
            validated_data['created_by'] = self.context['request'].user

        return super().create(validated_data)


class NoteEntrySerializer(serializers.ModelSerializer):
    """
    Serializer for NoteEntry model.
    """
    template_title = serializers.SerializerMethodField()
    practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = NoteEntry
        fields = [
            'id', 'template', 'template_title', 'encounter_id',
            'practitioner', 'practitioner_name', 'composition_fhir_id',
            'data', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'composition_fhir_id', 'created_at', 'updated_at']

    def get_template_title(self, obj):
        return obj.template.title

    def get_practitioner_name(self, obj):
        if obj.practitioner and obj.practitioner.staff and obj.practitioner.staff.user:
            return obj.practitioner.staff.user.get_full_name() or obj.practitioner.staff.user.username
        return None

    def validate(self, data):
        # Validate that the template is active
        if not data['template'].is_active:
            raise serializers.ValidationError("The selected template is not active.")

        # Validate that the data structure matches the template structure
        template_structure = data['template'].structure
        entry_data = data['data']

        # Basic validation - check that all required sections are present
        template_sections = [section['section'] for section in template_structure]
        entry_sections = entry_data.keys()

        missing_sections = set(template_sections) - set(entry_sections)
        if missing_sections:
            raise serializers.ValidationError(f"Missing data for sections: {', '.join(missing_sections)}")

        # Additional validation could be added here based on section types

        return data


class PrescriptionSerializer(serializers.ModelSerializer):
    """
    Serializer for reading Prescription data.
    """
    prescribed_by_name = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    route_display = serializers.CharField(source='get_route_display', read_only=True)
    frequency_display = serializers.CharField(source='get_frequency_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Prescription
        fields = [
            'id', 'patient', 'patient_name', 'prescribed_by', 'prescribed_by_name',
            'medication_name', 'dosage', 'route', 'route_display',
            'frequency', 'frequency_display', 'duration_days',
            'start_date', 'end_date', 'instructions', 'reason',
            'status', 'status_display', 'encounter_id',
            'created_at', 'updated_at', 'is_active', 'days_remaining',
            'discontinued_at', 'discontinued_by', 'discontinue_reason'
        ]
        read_only_fields = [
            'id', 'prescribed_by', 'created_at', 'updated_at',
            'discontinued_at', 'discontinued_by'
        ]

    def get_prescribed_by_name(self, obj):
        if obj.prescribed_by and obj.prescribed_by.staff and obj.prescribed_by.staff.user:
            return obj.prescribed_by.staff.user.get_full_name() or obj.prescribed_by.staff.user.username
        return None

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name() or obj.patient.user.username
        return None


class PrescriptionCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating Prescription records.
    """
    class Meta:
        model = Prescription
        fields = [
            'patient', 'medication_name', 'dosage', 'route', 'frequency',
            'duration_days', 'start_date', 'end_date', 'instructions',
            'reason', 'encounter_id'
        ]

    def validate(self, data):
        # Validate that medication_name and dosage are provided
        if not data.get('medication_name'):
            raise serializers.ValidationError({'medication_name': 'Medication name is required'})
        if not data.get('dosage'):
            raise serializers.ValidationError({'dosage': 'Dosage is required'})
        return data


class PrescriptionUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for updating Prescription records.
    """
    class Meta:
        model = Prescription
        fields = [
            'dosage', 'frequency', 'duration_days', 'end_date',
            'instructions', 'reason', 'status'
        ]


class PrescriptionDiscontinueSerializer(serializers.Serializer):
    """
    Serializer for discontinuing a prescription.
    """
    reason = serializers.CharField(required=True, help_text='Reason for discontinuation')
