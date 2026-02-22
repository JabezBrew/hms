import hashlib
import json

from django.utils import timezone
from rest_framework import serializers

from apps.ai import constants
from apps.ai.models import AIArtifact, AIFeedback, AIMessage, AISession
from apps.ai.services import policy
from apps.core.security import check_clinical_access, check_lab_access, get_user_facility
from apps.encounters.models import Encounter
from apps.users.models import PatientProfile


class AISessionCreateSerializer(serializers.Serializer):
    feature = serializers.ChoiceField(choices=[choice[0] for choice in constants.FEATURE_CHOICES])
    patient_id = serializers.UUIDField(required=False, allow_null=True)
    encounter_id = serializers.UUIDField(required=False, allow_null=True)
    request_context = serializers.JSONField(required=False, default=dict)

    def validate(self, attrs):
        request = self.context['request']
        user = request.user

        feature = attrs['feature']
        policy.ensure_feature_enabled(feature)

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
