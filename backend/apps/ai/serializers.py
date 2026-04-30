import hashlib
import json
import re

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.ai import constants
from apps.ai.models import AIArtifact, AIFeedback, AIMessage, AISession
from apps.ai.services import policy
from apps.clinical_notes.models import NoteTemplate, NoteTemplateRevision
from apps.core.security import check_clinical_access, check_lab_access, get_user_facility
from apps.encounters.models import Encounter
from apps.users.models import PatientProfile


TIME_WINDOW_PATTERN = re.compile(r'^\d{1,3}[hdw]$')


def validate_time_window(value: str) -> str:
    normalized = str(value or '').strip().lower()
    if not normalized:
        return '24h'
    if not TIME_WINDOW_PATTERN.match(normalized):
        raise serializers.ValidationError("time_window must match '<number><h|d|w>', for example '24h' or '7d'.")
    return normalized


class AISessionCreateSerializer(serializers.Serializer):
    feature = serializers.ChoiceField(choices=[choice[0] for choice in constants.FEATURE_CHOICES])
    patient_id = serializers.UUIDField(required=False, allow_null=True)
    encounter_id = serializers.UUIDField(required=False, allow_null=True)
    request_context = serializers.JSONField(required=False, default=dict)

    def validate(self, attrs):
        request = self.context['request']
        user = request.user

        feature = attrs['feature']
        policy.ensure_feature_enabled(feature, request=request)

        facility = get_user_facility(request)
        if not facility:
            raise serializers.ValidationError({'detail': 'Facility context is required.'})

        patient = None
        patient_id = attrs.get('patient_id')
        if patient_id:
            patient = PatientProfile.objects.select_related('facility').filter(id=patient_id).first()
            if not patient:
                raise serializers.ValidationError({'patient_id': 'Patient not found.'})
            if patient.facility_id != facility.id:
                raise serializers.ValidationError({'patient_id': 'Patient is outside the active facility.'})

        if feature in constants.FEATURE_REQUIRES_PATIENT and not patient:
            raise serializers.ValidationError({'patient_id': 'This AI feature requires a patient context.'})

        encounter = None
        encounter_id = attrs.get('encounter_id')
        if encounter_id:
            encounter = Encounter.objects.select_related('facility', 'patient').filter(id=encounter_id).first()
            if not encounter:
                raise serializers.ValidationError({'encounter_id': 'Encounter not found.'})
            if encounter.facility_id != facility.id:
                raise serializers.ValidationError({'encounter_id': 'Encounter is outside the active facility.'})
            if patient and encounter.patient_id != patient.id:
                raise serializers.ValidationError({'encounter_id': 'Encounter does not belong to the selected patient.'})
            if not patient:
                patient = encounter.patient

        access_scope = policy.get_access_scope_for_feature(feature)
        if patient and access_scope == 'clinical':
            check_clinical_access(user, patient)
        elif patient and access_scope == 'lab':
            check_lab_access(user, patient)

        request_context = attrs.get('request_context') or {}
        hash_payload = {
            'feature': feature,
            'patient_id': str(patient.id) if patient else None,
            'encounter_id': str(encounter.id) if encounter else None,
            'request_context': request_context,
        }
        attrs['request_context_hash'] = hashlib.sha256(
            json.dumps(hash_payload, sort_keys=True, default=str).encode('utf-8')
        ).hexdigest()

        attrs['facility'] = facility
        attrs['patient'] = patient
        attrs['encounter'] = encounter
        attrs['request_context'] = request_context
        return attrs

    def create(self, validated_data):
        request = self.context['request']
        return AISession.objects.create(
            facility=validated_data['facility'],
            user=request.user,
            patient=validated_data['patient'],
            encounter=validated_data['encounter'],
            feature=validated_data['feature'],
            status=AISession.STATUS_QUEUED,
            request_context_hash=validated_data['request_context_hash'],
            request_metadata={'request_context': validated_data['request_context']},
            started_at=timezone.now(),
        )


class AISessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AISession
        fields = [
            'id',
            'feature',
            'status',
            'facility',
            'user',
            'patient',
            'encounter',
            'request_context_hash',
            'started_at',
            'ended_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class AIMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIMessage
        fields = [
            'id',
            'session',
            'role',
            'content_redacted',
            'model_role',
            'model_name',
            'provider',
            'input_tokens',
            'output_tokens',
            'latency_ms',
            'estimated_cost_usd',
            'created_at',
        ]
        read_only_fields = fields


class AIArtifactSerializer(serializers.ModelSerializer):
    confidence_band = serializers.SerializerMethodField()

    class Meta:
        model = AIArtifact
        fields = [
            'id',
            'session',
            'artifact_type',
            'payload_json',
            'schema_version',
            'confidence_score',
            'confidence_band',
            'requires_human_review',
            'accepted_by',
            'accepted_at',
            'rejected_reason',
            'note_entry_id',
            'lab_result_id',
            'timeline_event_id',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_confidence_band(self, obj):
        if obj.confidence_score is None:
            return policy.confidence_band(None, feature=obj.session.feature)
        return policy.confidence_band(float(obj.confidence_score), feature=obj.session.feature)


class AIArtifactRejectSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


class AIFeedbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIFeedback
        fields = ['id', 'artifact', 'user', 'thumb', 'comment', 'created_at']
        read_only_fields = ['id', 'user', 'created_at']

    def validate_artifact(self, artifact):
        request = self.context['request']
        facility = get_user_facility(request)
        if not facility or artifact.session.facility_id != facility.id:
            raise serializers.ValidationError('Artifact is outside the active facility.')
        return artifact

    def create(self, validated_data):
        validated_data['user'] = self.context['request'].user
        return super().create(validated_data)


class AIObservabilitySummarySerializer(serializers.Serializer):
    window_hours = serializers.IntegerField()
    facility_code = serializers.CharField()
    sessions = serializers.DictField()
    features = serializers.ListField(child=serializers.DictField())
    tokens = serializers.DictField()
    cost = serializers.DictField()
    latency_ms = serializers.DictField()


class AIOmniParseRequestSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=1000)
    context = serializers.JSONField(required=False, default=dict)


class AIOmniExecutePreviewRequestSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    intent = serializers.JSONField(required=False)
    context = serializers.JSONField(required=False, default=dict)

    def validate(self, attrs):
        text = (attrs.get('text') or '').strip()
        intent = attrs.get('intent')
        if not text and not intent:
            raise serializers.ValidationError('Either text or intent is required.')
        return attrs


class AILabInterpretRequestSerializer(serializers.Serializer):
    result_id = serializers.UUIDField(required=False)
    order_id = serializers.UUIDField(required=False)
    audience = serializers.ChoiceField(choices=['clinician', 'patient'], default='clinician')

    def validate(self, attrs):
        has_result = bool(attrs.get('result_id'))
        has_order = bool(attrs.get('order_id'))
        if has_result == has_order:
            raise serializers.ValidationError('Exactly one of result_id or order_id is required.')
        return attrs


class AIChronicleSummarizeRequestSerializer(serializers.Serializer):
    time_window = serializers.CharField(required=False, default='24h')
    focus = serializers.ChoiceField(choices=['handoff', 'rounds', 'changes'], default='handoff')
    encounter_id = serializers.UUIDField(required=False, allow_null=True)

    def validate_time_window(self, value):
        return validate_time_window(value)


class AIChronicleAskRequestSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=2000)
    time_window = serializers.CharField(required=False, default='24h')
    encounter_id = serializers.UUIDField(required=False, allow_null=True)
    constraints = serializers.JSONField(required=False, default=dict)

    def validate_time_window(self, value):
        return validate_time_window(value)


class AIBaseNoteRequestSerializer(serializers.Serializer):
    patient_id = serializers.UUIDField()
    template_id = serializers.UUIDField()
    template_revision_id = serializers.UUIDField()
    encounter_id = serializers.UUIDField(required=False, allow_null=True)

    def _resolve_template_queryset(self, *, user, facility):
        queryset = NoteTemplate.objects.filter(facility_id=facility.id, is_active=True)
        if user.user_type == 'admin':
            return queryset

        user_department = getattr(getattr(user, 'staff', None), 'department', None)
        visibility_filters = (
            Q(visibility='public')
            | Q(created_by__isnull=True)
            | Q(visibility='private', created_by=user)
            | Q(visibility='role', created_by__user_type=user.user_type)
        )
        if user_department:
            visibility_filters |= Q(visibility='department', department=user_department)
        return queryset.filter(visibility_filters).distinct()

    def validate(self, attrs):
        request = self.context['request']
        user = request.user

        facility = get_user_facility(request)
        if not facility:
            raise serializers.ValidationError({'detail': 'Facility context is required.'})

        patient = (
            PatientProfile.objects.select_related('facility', 'user')
            .filter(id=attrs['patient_id'], facility_id=facility.id)
            .first()
        )
        if not patient:
            raise serializers.ValidationError({'patient_id': 'Patient not found.'})
        check_clinical_access(user, patient)

        template = self._resolve_template_queryset(user=user, facility=facility).filter(id=attrs['template_id']).first()
        if not template:
            raise serializers.ValidationError({'template_id': 'Template not found or not accessible.'})

        revision_queryset = NoteTemplateRevision.objects.select_related('template').filter(
            id=attrs['template_revision_id'],
            facility_id=facility.id,
        )
        if user.user_type != 'admin':
            revision_queryset = revision_queryset.filter(status='published')
        template_revision = revision_queryset.first()
        if not template_revision:
            raise serializers.ValidationError(
                {'template_revision_id': 'Template revision not found or not accessible.'}
            )
        if template_revision.template_id != template.id:
            raise serializers.ValidationError(
                {'template_revision_id': 'Template revision does not belong to the selected template.'}
            )

        encounter = None
        encounter_id = attrs.get('encounter_id')
        if encounter_id:
            encounter = (
                Encounter.objects.filter(id=encounter_id, facility_id=facility.id)
                .only('id', 'patient_id')
                .first()
            )
            if not encounter:
                raise serializers.ValidationError({'encounter_id': 'Encounter not found.'})
            if encounter.patient_id != patient.id:
                raise serializers.ValidationError(
                    {'encounter_id': 'Encounter does not belong to the selected patient.'}
                )

        attrs['facility'] = facility
        attrs['patient'] = patient
        attrs['template'] = template
        attrs['template_revision'] = template_revision
        attrs['encounter'] = encounter
        return attrs


class AINoteDraftRequestSerializer(AIBaseNoteRequestSerializer):
    prompt = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class AINoteLintRequestSerializer(AIBaseNoteRequestSerializer):
    note_data = serializers.JSONField(required=False, default=dict)
    draft = serializers.JSONField(required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        note_data = attrs.get('note_data') if isinstance(attrs.get('note_data'), dict) else None
        draft_payload = attrs.get('draft') if isinstance(attrs.get('draft'), dict) else None

        if note_data is None and draft_payload is None:
            raise serializers.ValidationError({'note_data': 'note_data (or draft) must be a JSON object.'})
        attrs['note_data'] = note_data if note_data is not None else draft_payload
        return attrs
