"""
Serializers for Problem List API.

List endpoints return lightweight serializers (5-8 fields, flattened) per AGENTS.md.
Detail endpoints include full nested structure.
"""
from rest_framework import serializers

from .models import (
    ClinicalStatus,
    Problem,
    ProblemCode,
    ProblemLink,
    ProblemStatusEvent,
)


class ProblemCodeSearchSerializer(serializers.ModelSerializer):
    """Lightweight result for /search-codes/ — used in pickers."""

    class Meta:
        model = ProblemCode
        fields = (
            'id',
            'code',
            'code_system',
            'display',
            'category',
            'is_chronic_default',
            'is_quick_pick',
        )


class ProblemListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for sidebar widget. Flattened, no nesting."""

    label = serializers.CharField(source='display_label', read_only=True)
    code_value = serializers.CharField(source='code.code', read_only=True, allow_null=True)
    code_system = serializers.CharField(source='code.code_system', read_only=True, allow_null=True)

    class Meta:
        model = Problem
        fields = (
            'id',
            'label',
            'code_value',
            'code_system',
            'clinical_status',
            'verification_status',
            'priority',
            'chronicity',
            'onset_date',
            'recorded_at',
        )


class ProblemStatusEventSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(
        source='changed_by.get_full_name', read_only=True, allow_null=True
    )

    class Meta:
        model = ProblemStatusEvent
        fields = (
            'id',
            'from_status',
            'to_status',
            'reason',
            'changed_by',
            'changed_by_name',
            'changed_at',
        )
        read_only_fields = fields


class ProblemDetailSerializer(serializers.ModelSerializer):
    """Full detail with nested code + status history."""

    code = ProblemCodeSearchSerializer(read_only=True)
    code_id = serializers.PrimaryKeyRelatedField(
        queryset=ProblemCode.objects.filter(is_active=True),
        source='code',
        write_only=True,
        required=False,
        allow_null=True,
    )
    status_events = ProblemStatusEventSerializer(many=True, read_only=True)
    recorded_by_name = serializers.CharField(
        source='recorded_by.get_full_name', read_only=True, allow_null=True
    )
    last_updated_by_name = serializers.CharField(
        source='last_updated_by.get_full_name', read_only=True, allow_null=True
    )
    is_coded = serializers.BooleanField(read_only=True)

    class Meta:
        model = Problem
        fields = (
            'id',
            'patient',
            'facility',
            'code',
            'code_id',
            'free_text_label',
            'is_coded',
            'clinical_status',
            'verification_status',
            'priority',
            'chronicity',
            'onset_date',
            'abatement_date',
            'last_assessed_at',
            'note',
            'recorded_by',
            'recorded_by_name',
            'recorded_at',
            'last_updated_by',
            'last_updated_by_name',
            'fhir_id',
            'fhir_synced',
            'created_at',
            'updated_at',
            'status_events',
        )
        read_only_fields = (
            'id',
            'facility',
            'recorded_by',
            'recorded_at',
            'last_updated_by',
            'fhir_id',
            'fhir_synced',
            'created_at',
            'updated_at',
            'status_events',
        )

    def validate(self, attrs):
        # Either coded (via code FK) or free-text label must be provided.
        is_create = self.instance is None
        code = attrs.get('code', getattr(self.instance, 'code', None))
        free_text = attrs.get('free_text_label', getattr(self.instance, 'free_text_label', ''))
        if is_create and code is None and not (free_text or '').strip():
            raise serializers.ValidationError(
                "Either a coded problem (code_id) or a free_text_label is required."
            )
        return attrs


class ProblemStatusChangeSerializer(serializers.Serializer):
    """Body for POST /problems/{id}/change-status/."""

    to_status = serializers.ChoiceField(choices=ClinicalStatus.choices)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    abatement_date = serializers.DateField(required=False, allow_null=True)


class ProblemLinkSerializer(serializers.ModelSerializer):
    linked_by_name = serializers.CharField(
        source='linked_by.get_full_name', read_only=True, allow_null=True
    )

    class Meta:
        model = ProblemLink
        fields = (
            'id',
            'problem',
            'note_entry',
            'prescription',
            'lab_order',
            'encounter',
            'linked_by',
            'linked_by_name',
            'linked_at',
        )
        read_only_fields = ('id', 'linked_by', 'linked_at')

    def validate(self, attrs):
        targets = [
            attrs.get('note_entry'),
            attrs.get('prescription'),
            attrs.get('lab_order'),
            attrs.get('encounter'),
        ]
        non_null = [t for t in targets if t is not None]
        if len(non_null) != 1:
            raise serializers.ValidationError(
                "Exactly one of note_entry, prescription, lab_order, or encounter must be provided."
            )
        return attrs
