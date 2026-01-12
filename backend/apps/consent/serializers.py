from rest_framework import serializers

from .models import (
    ConsentGrant,
    ConsentScope,
    ConsentStatus,
    ConsentAccessToken,
    CrossFacilityReferral,
    ReferralStatus,
)


class ConsentGrantListSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsentGrant
        fields = [
            'id',
            'patient_identity',
            'source_facility_code',
            'target_facility_code',
            'scope',
            'status',
            'expires_at',
            'created_at',
        ]


class ConsentGrantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsentGrant
        fields = [
            'id',
            'patient_identity',
            'source_facility_code',
            'target_facility_code',
            'scope',
            'status',
            'reason',
            'granted_at',
            'expires_at',
            'revoked_at',
            'created_by_facility_code',
            'created_by_user_id',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'status',
            'granted_at',
            'revoked_at',
            'created_by_facility_code',
            'created_by_user_id',
            'created_at',
            'updated_at',
        ]


class ConsentGrantCreateSerializer(serializers.ModelSerializer):
    patient_identity_id = serializers.UUIDField(write_only=True)
    target_facility_code = serializers.CharField(max_length=20)
    scope = serializers.ChoiceField(choices=ConsentScope.choices, default=ConsentScope.FULL_RECORD)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True)

    class Meta:
        model = ConsentGrant
        fields = [
            'patient_identity_id',
            'target_facility_code',
            'scope',
            'expires_at',
            'reason',
        ]

    def validate_target_facility_code(self, value):
        if not value.strip():
            raise serializers.ValidationError('Target facility code is required.')
        return value.strip().upper()


class ConsentGrantRevokeSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True)


class ConsentTokenIssueSerializer(serializers.Serializer):
    target_facility_code = serializers.CharField(max_length=20)
    ttl_seconds = serializers.IntegerField(min_value=60, max_value=24 * 3600, default=3600)

    def validate_target_facility_code(self, value):
        if not value.strip():
            raise serializers.ValidationError('Target facility code is required.')
        return value.strip().upper()


class ConsentAccessTokenSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsentAccessToken
        fields = [
            'id',
            'consent_grant',
            'target_facility_code',
            'expires_at',
            'last_used_at',
            'is_active',
            'created_at',
        ]
        read_only_fields = fields


class CrossFacilityReferralListSerializer(serializers.ModelSerializer):
    class Meta:
        model = CrossFacilityReferral
        fields = [
            'id',
            'patient_identity',
            'source_facility_code',
            'target_facility_code',
            'status',
            'reason_code',
            'created_at',
        ]


class CrossFacilityReferralSerializer(serializers.ModelSerializer):
    class Meta:
        model = CrossFacilityReferral
        fields = [
            'id',
            'patient_identity',
            'source_facility_code',
            'target_facility_code',
            'status',
            'reason_code',
            'created_by_facility_code',
            'created_by_user_id',
            'created_at',
            'updated_at',
            'responded_at',
            'decline_reason',
        ]
        read_only_fields = [
            'source_facility_code',
            'created_by_facility_code',
            'created_by_user_id',
            'created_at',
            'updated_at',
            'responded_at',
        ]


class CrossFacilityReferralCreateSerializer(serializers.ModelSerializer):
    patient_identity_id = serializers.UUIDField(write_only=True)
    target_facility_code = serializers.CharField(max_length=20)
    reason_code = serializers.CharField(max_length=100, required=False, allow_blank=True)

    class Meta:
        model = CrossFacilityReferral
        fields = [
            'patient_identity_id',
            'target_facility_code',
            'reason_code',
        ]

    def validate_target_facility_code(self, value):
        if not value.strip():
            raise serializers.ValidationError('Target facility code is required.')
        return value.strip().upper()


class CrossFacilityReferralRespondSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[ReferralStatus.ACCEPTED, ReferralStatus.DECLINED])
    decline_reason = serializers.CharField(max_length=200, required=False, allow_blank=True)
