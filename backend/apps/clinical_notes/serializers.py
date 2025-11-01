from rest_framework import serializers
from .models import NoteTemplate, NoteEntry
from ..users.models import PractitionerProfile


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
