from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from .models import (
    NoteTemplate, NoteTemplateRevision, NoteEntry, NoteEntryVersion, Prescription
)
from .template_utils import (
    get_structure_sections,
    normalize_template_structure,
    infer_template_mode,
)
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
    template_mode = serializers.ChoiceField(
        choices=NoteTemplateRevision.MODE_CHOICES,
        required=False,
        write_only=True,
    )
    latest_published_revision_id = serializers.SerializerMethodField()
    latest_published_revision_version = serializers.SerializerMethodField()
    latest_published_revision_mode = serializers.SerializerMethodField()
    latest_published_revision_status = serializers.SerializerMethodField()

    class Meta:
        model = NoteTemplate
        fields = [
            'id', 'facility', 'title', 'description', 'is_active', 'template_mode', 'structure',
            # Visibility/sharing fields
            'visibility', 'visibility_display', 'department',
            # Organization fields
            'category', 'category_display', 'icon', 'estimated_steps',
            # Legacy field (deprecated)
            'is_public',
            # Ownership/audit fields
            'created_by', 'created_by_name', 'is_system_template',
            'latest_published_revision_id', 'latest_published_revision_version',
            'latest_published_revision_mode', 'latest_published_revision_status',
            'can_edit', 'can_delete',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'created_by', 'created_by_name', 'is_system_template',
            'can_edit', 'can_delete', 'created_at', 'updated_at',
            'visibility_display', 'category_display',
            'latest_published_revision_id', 'latest_published_revision_version',
            'latest_published_revision_mode', 'latest_published_revision_status',
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

    def _get_latest_published_revision_data(self, obj):
        """
        Resolve latest published revision metadata.
        Uses queryset annotations when available and falls back to a single DB lookup.
        """
        cache = getattr(self, '_latest_revision_cache', None)
        if cache is None:
            cache = {}
            self._latest_revision_cache = cache

        if obj.pk in cache:
            return cache[obj.pk]

        annotated_id = getattr(obj, 'latest_published_revision_id', None)
        annotated_version = getattr(obj, 'latest_published_revision_version', None)
        annotated_mode = getattr(obj, 'latest_published_revision_mode', None)
        annotated_status = getattr(obj, 'latest_published_revision_status', None)

        if any(value is not None for value in (annotated_id, annotated_version, annotated_mode, annotated_status)):
            data = {
                'id': annotated_id,
                'version': annotated_version,
                'mode': annotated_mode,
                'status': annotated_status,
            }
            cache[obj.pk] = data
            return data

        latest = obj.revisions.filter(status='published').only(
            'id', 'version', 'mode', 'status'
        ).order_by('-version').first()
        data = {
            'id': getattr(latest, 'id', None),
            'version': getattr(latest, 'version', None),
            'mode': getattr(latest, 'mode', None),
            'status': getattr(latest, 'status', None),
        }
        cache[obj.pk] = data
        return data

    def get_latest_published_revision_id(self, obj):
        return self._get_latest_published_revision_data(obj)['id']

    def get_latest_published_revision_version(self, obj):
        return self._get_latest_published_revision_data(obj)['version']

    def get_latest_published_revision_mode(self, obj):
        return self._get_latest_published_revision_data(obj)['mode']

    def get_latest_published_revision_status(self, obj):
        return self._get_latest_published_revision_data(obj)['status']

    @transaction.atomic
    def create(self, validated_data):
        request = self.context.get('request')
        # Check if this is a default/system template (should not have a creator)
        is_default = validated_data.pop('is_default', False)
        template_mode = validated_data.pop('template_mode', None)
        validated_data['structure'] = normalize_template_structure(validated_data.get('structure'))

        # Only set created_by if not a default template
        if not is_default and request and request.user:
            validated_data['created_by'] = request.user

        instance = super().create(validated_data)

        revision_mode = template_mode or infer_template_mode(instance.structure)
        NoteTemplateRevision.objects.create(
            template=instance,
            facility=instance.facility,
            version=1,
            status='published',
            mode=revision_mode,
            content=instance.structure,
            created_by=getattr(request, 'user', None),
            published_by=getattr(request, 'user', None),
            published_at=timezone.now(),
        )
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        request = self.context.get('request')
        template_mode = validated_data.pop('template_mode', None)
        structure_changed = 'structure' in validated_data
        if structure_changed:
            validated_data['structure'] = normalize_template_structure(validated_data.get('structure'))

        instance = super().update(instance, validated_data)

        if structure_changed or template_mode:
            latest_revision = instance.revisions.order_by('-version').first()
            next_version = (latest_revision.version + 1) if latest_revision else 1
            revision_mode = template_mode or infer_template_mode(instance.structure)

            # Keep only one published revision for deterministic template selection.
            instance.revisions.filter(status='published').update(status='archived')
            NoteTemplateRevision.objects.create(
                template=instance,
                facility=instance.facility,
                version=next_version,
                status='published',
                mode=revision_mode,
                content=instance.structure,
                created_by=getattr(request, 'user', None),
                published_by=getattr(request, 'user', None),
                published_at=timezone.now(),
            )
        return instance

    def validate(self, data):
        """Validate template data."""
        # If visibility is 'department', department field is required
        visibility = data.get('visibility', self.instance.visibility if self.instance else 'private')
        department = data.get('department', self.instance.department if self.instance else None)

        if visibility == 'department' and not department:
            raise serializers.ValidationError({
                'department': 'Department is required when visibility is set to "department".'
            })

        if 'structure' in data:
            normalized = normalize_template_structure(data['structure'])
            if not normalized.get('sections'):
                raise serializers.ValidationError({
                    'structure': 'Template structure must include at least one section.'
                })
            data['structure'] = normalized

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
    latest_published_revision_id = serializers.UUIDField(read_only=True)
    latest_published_revision_version = serializers.IntegerField(read_only=True)
    latest_published_revision_mode = serializers.CharField(read_only=True)
    latest_published_revision_status = serializers.CharField(read_only=True)

    class Meta:
        model = NoteTemplate
        fields = [
            'id', 'facility', 'title', 'description', 'is_active',
            'visibility', 'visibility_display', 'department',
            'category', 'category_display', 'icon', 'estimated_steps',
            'structure',  # Include structure for workflow step derivation
            'created_by', 'created_by_name',
            'latest_published_revision_id', 'latest_published_revision_version',
            'latest_published_revision_mode', 'latest_published_revision_status',
            'section_count', 'created_at', 'updated_at'
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.email
        return 'System'

    def get_section_count(self, obj):
        """Return the number of sections in the template."""
        return len(get_structure_sections(obj.structure))


class NoteTemplateRevisionSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    published_by_name = serializers.SerializerMethodField()

    class Meta:
        model = NoteTemplateRevision
        fields = [
            'id', 'template', 'facility', 'version', 'status', 'mode', 'content',
            'change_summary', 'created_by', 'created_by_name',
            'submitted_by', 'submitted_by_name', 'submitted_at',
            'published_by', 'published_by_name', 'published_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'template', 'facility', 'version', 'status',
            'created_by', 'created_by_name', 'submitted_by', 'submitted_by_name',
            'submitted_at', 'published_by', 'published_by_name', 'published_at',
            'created_at', 'updated_at',
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.email
        return 'System'

    def get_submitted_by_name(self, obj):
        if obj.submitted_by:
            return obj.submitted_by.get_full_name() or obj.submitted_by.email
        return None

    def get_published_by_name(self, obj):
        if obj.published_by:
            return obj.published_by.get_full_name() or obj.published_by.email
        return None


class NoteTemplateRevisionCreateSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=NoteTemplateRevision.MODE_CHOICES, required=False)
    content = serializers.JSONField(required=True)
    change_summary = serializers.CharField(required=False, allow_blank=True, max_length=255)


class NoteTemplateRenderSerializer(serializers.Serializer):
    patient_id = serializers.UUIDField(required=False)
    revision_id = serializers.UUIDField(required=False)
    apply_mode = serializers.ChoiceField(
        choices=[('all', 'All'), ('empty_only', 'Empty Only'), ('selected', 'Selected')],
        required=False,
        default='empty_only'
    )
    base_data = serializers.JSONField(required=False, default=dict)
    sections = serializers.ListField(
        required=False,
        child=serializers.CharField(),
        default=list,
        allow_empty=True,
    )
    extra_tokens = serializers.DictField(
        child=serializers.CharField(),
        required=False,
        default=dict,
    )


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
    template_revision = serializers.PrimaryKeyRelatedField(
        queryset=NoteTemplateRevision.objects.select_related('template'),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = NoteEntry
        fields = [
            'id', 'template', 'template_title', 'patient', 'patient_name',
            'encounter', 'practitioner', 'practitioner_name', 'composition_fhir_id',
            'template_revision', 'template_version',
            'data', 'copied_from', 'copied_from_id', 'copied_from_date',
            'version_count', 'has_edits',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'composition_fhir_id', 'copied_from_id', 'copied_from_date',
            'template_version', 'version_count', 'has_edits',
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
        template = data.get('template') or getattr(self.instance, 'template', None)
        if template and not template.is_active:
            raise serializers.ValidationError("The selected template is not active.")

        template_revision = data.get('template_revision')
        if template_revision and template and template_revision.template_id != template.id:
            raise serializers.ValidationError({
                'template_revision': 'Template revision does not belong to the selected template.'
            })

        # Validate that the data structure matches the template structure
        template_structure = template.structure if template else {}
        entry_data = data.get('data') or {}

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

    def create(self, validated_data):
        template = validated_data['template']
        template_revision = validated_data.get('template_revision')

        if template_revision is None:
            template_revision = template.revisions.filter(status='published').order_by('-version').first()
            if template_revision:
                validated_data['template_revision'] = template_revision

        if template_revision:
            validated_data['template_version'] = template_revision.version

        return super().create(validated_data)


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
            'template_version',
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
