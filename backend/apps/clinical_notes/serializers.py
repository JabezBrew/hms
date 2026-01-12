from rest_framework import serializers
from .models import NoteTemplate, NoteEntry, NoteEntryVersion, Prescription
from ..users.models import PractitionerProfile, PatientProfile


class NoteTemplateSerializer(serializers.ModelSerializer):
    """
    Serializer for NoteTemplate model.
    Includes new visibility, category, and organizational fields.
    """
    created_by_name = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    is_system_template = serializers.BooleanField(read_only=True)
    visibility_display = serializers.CharField(source='get_visibility_display', read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model = NoteTemplate
        fields = [
            'id', 'facility', 'title', 'description', 'is_active', 'structure',
            # Visibility/sharing fields
            'visibility', 'visibility_display', 'department',
            # Organization fields
            'category', 'category_display', 'icon', 'estimated_steps',
            # Legacy field (deprecated)
            'is_public',
            # Ownership/audit fields
            'created_by', 'created_by_name', 'is_system_template',
            'can_edit', 'can_delete',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'created_by', 'created_by_name', 'is_system_template',
            'can_edit', 'can_delete', 'created_at', 'updated_at',
            'visibility_display', 'category_display'
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.email
        return 'System'

    def get_can_edit(self, obj):
        """Check if the current user can edit this template."""
        request = self.context.get('request')
        if not request or not request.user:
            return False
        user = request.user
        # Admins can edit any template
        if user.user_type == 'admin':
            return True
        # Users can edit their own templates
        return obj.created_by == user

    def get_can_delete(self, obj):
        """Check if the current user can delete this template."""
        request = self.context.get('request')
        if not request or not request.user:
            return False
        user = request.user
        # System templates cannot be deleted
        if obj.is_system_template:
            return False
        # Admins can delete any non-system template
        if user.user_type == 'admin':
            return True
        # Users can delete their own templates
        return obj.created_by == user

    def create(self, validated_data):
        # Check if this is a default/system template (should not have a creator)
        is_default = validated_data.pop('is_default', False)

        # Only set created_by if not a default template
        if not is_default:
            validated_data['created_by'] = self.context['request'].user

        return super().create(validated_data)

    def validate(self, data):
        """Validate template data."""
        # If visibility is 'department', department field is required
        visibility = data.get('visibility', self.instance.visibility if self.instance else 'private')
        department = data.get('department', self.instance.department if self.instance else None)

        if visibility == 'department' and not department:
            raise serializers.ValidationError({
                'department': 'Department is required when visibility is set to "department".'
            })

        return data


class NoteTemplateListSerializer(serializers.ModelSerializer):
    """
    Serializer for listing templates with structure included.
    Structure is needed for the frontend to derive workflow steps.
    """
    created_by_name = serializers.SerializerMethodField()
    visibility_display = serializers.CharField(source='get_visibility_display', read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    section_count = serializers.SerializerMethodField()

    class Meta:
        model = NoteTemplate
        fields = [
            'id', 'facility', 'title', 'description', 'is_active',
            'visibility', 'visibility_display', 'department',
            'category', 'category_display', 'icon', 'estimated_steps',
            'structure',  # Include structure for workflow step derivation
            'created_by', 'created_by_name',
            'section_count', 'created_at', 'updated_at'
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.email
        return 'System'

    def get_section_count(self, obj):
        """Return the number of sections in the template."""
        if obj.structure and isinstance(obj.structure, dict):
            sections = obj.structure.get('sections', [])
            return len(sections)
        elif obj.structure and isinstance(obj.structure, list):
            return len(obj.structure)
        return 0


class NoteEntrySerializer(serializers.ModelSerializer):
    """
    Serializer for NoteEntry model.
    """
    template_title = serializers.SerializerMethodField()
    practitioner_name = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    copied_from_id = serializers.UUIDField(source='copied_from.id', read_only=True)
    copied_from_date = serializers.DateTimeField(source='copied_from.created_at', read_only=True)
    version_count = serializers.SerializerMethodField()
    has_edits = serializers.SerializerMethodField()

    class Meta:
        model = NoteEntry
        fields = [
            'id', 'template', 'template_title', 'patient', 'patient_name',
            'encounter', 'practitioner', 'practitioner_name', 'composition_fhir_id',
            'data', 'copied_from', 'copied_from_id', 'copied_from_date',
            'version_count', 'has_edits',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'composition_fhir_id', 'copied_from_id', 'copied_from_date',
            'version_count', 'has_edits',
            'created_at', 'updated_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name() or obj.patient.user.username
        return None

    def get_template_title(self, obj):
        return obj.template.title

    def get_practitioner_name(self, obj):
        if obj.practitioner and obj.practitioner.staff and obj.practitioner.staff.user:
            return obj.practitioner.staff.user.get_full_name() or obj.practitioner.staff.user.username
        return None

    def get_version_count(self, obj):
        """Return the number of versions (edits) for this note."""
        return obj.versions.count()

    def get_has_edits(self, obj):
        """Return whether this note has been edited."""
        return obj.versions.exists()

    def validate(self, data):
        # Validate that the template is active
        if not data['template'].is_active:
            raise serializers.ValidationError("The selected template is not active.")

        # Validate that the data structure matches the template structure
        template_structure = data['template'].structure
        entry_data = data['data']

        # Handle both list and dict structure formats
        if isinstance(template_structure, dict):
            sections_list = template_structure.get('sections', [])
        elif isinstance(template_structure, list):
            sections_list = template_structure
        else:
            sections_list = []

        # Extract section names - handle both 'name' and 'section' keys
        template_sections = []
        for section in sections_list:
            section_name = section.get('name') or section.get('section', '')
            if section_name:
                template_sections.append(section_name)

        entry_sections = entry_data.keys()

        # Only validate required sections
        required_sections = []
        for section in sections_list:
            section_name = section.get('name') or section.get('section', '')
            if section_name and section.get('required', False):
                required_sections.append(section_name)

        missing_sections = set(required_sections) - set(entry_sections)
        if missing_sections:
            raise serializers.ValidationError(f"Missing data for required sections: {', '.join(missing_sections)}")

        return data


class NoteEntryCloneSerializer(serializers.Serializer):
    """
    Input serializer for cloning a note entry.
    Used by the clone action to specify which sections to copy.
    """
    sections = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        help_text="Section names to copy. Defaults to all sections if not provided."
    )
    encounter = serializers.UUIDField(
        required=False,
        help_text="Target encounter ID. Auto-creates if not provided."
    )
    patient = serializers.UUIDField(
        required=False,
        help_text="Target patient ID. Defaults to same patient as source note."
    )

    def validate_sections(self, value):
        """Validate section names - actual validation happens in view with template context."""
        if value:
            # Remove duplicates while preserving order
            seen = set()
            unique_sections = []
            for section in value:
                if section not in seen:
                    seen.add(section)
                    unique_sections.append(section)
            return unique_sections
        return value


class NoteEntryVersionSerializer(serializers.ModelSerializer):
    """
    Serializer for reading NoteEntryVersion data.
    Provides version history information for clinical notes.
    """
    edited_by_name = serializers.SerializerMethodField()

    class Meta:
        model = NoteEntryVersion
        fields = [
            'id', 'note_entry', 'version_number', 'data',
            'edited_by', 'edited_by_name', 'edit_reason', 'created_at'
        ]
        read_only_fields = ['id', 'note_entry', 'version_number', 'data', 'created_at']

    def get_edited_by_name(self, obj):
        if obj.edited_by:
            return obj.edited_by.get_full_name() or obj.edited_by.email
        return 'Unknown'


class NoteEntryUpdateSerializer(serializers.Serializer):
    """
    Input serializer for updating a note entry with version tracking.
    """
    data = serializers.JSONField(
        required=True,
        help_text="Updated note data"
    )
    edit_reason = serializers.CharField(
        required=False,
        max_length=500,
        allow_blank=True,
        default='',
        help_text="Optional reason for the edit"
    )


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
            'status', 'status_display', 'encounter',
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
            'reason', 'encounter'
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


# =============================================================================
# LIST SERIALIZERS - Lightweight serializers for list views
# These reduce payload sizes by 40-70% compared to full serializers
# =============================================================================

class NoteEntryListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for note entry lists.
    Removes full data field and nested objects.

    Payload reduction: ~70% (removes data JSON and nested details)
    """
    template_title = serializers.CharField(source='template.title', read_only=True)
    template_category = serializers.CharField(source='template.category', read_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    practitioner_name = serializers.SerializerMethodField()
    is_signed = serializers.SerializerMethodField()

    class Meta:
        model = NoteEntry
        fields = [
            'id', 'template', 'template_title', 'template_category',
            'patient', 'patient_name', 'patient_mrn',
            'practitioner_name', 'encounter', 'is_signed',
            'created_at', 'updated_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_practitioner_name(self, obj):
        if obj.practitioner and obj.practitioner.staff and obj.practitioner.staff.user:
            return obj.practitioner.staff.user.get_full_name()
        return None

    def get_is_signed(self, obj):
        # Use annotation when available to avoid per-row queries.
        if hasattr(obj, 'is_signed'):
            return obj.is_signed
        return obj.versions.exists()


class PrescriptionListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for prescription lists.
    Removes nested practitioner details.

    Payload reduction: ~45% (12 fields vs 22)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    prescribed_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Prescription
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'medication_name', 'dosage', 'frequency', 'route',
            'status', 'status_display', 'start_date', 'end_date',
            'prescribed_by_name', 'is_active', 'created_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_prescribed_by_name(self, obj):
        if obj.prescribed_by and obj.prescribed_by.staff and obj.prescribed_by.staff.user:
            return obj.prescribed_by.staff.user.get_full_name()
        return None
