from rest_framework import serializers

from .models import RecordExportJob


class RecordExportRequestSerializer(serializers.Serializer):
    patient_identity_id = serializers.UUIDField()
    consent_token = serializers.CharField()
    target_facility_code = serializers.CharField(max_length=20)


class RecordExportJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecordExportJob
        fields = [
            'id',
            'patient',
            'patient_identity_id',
            'target_facility_code',
            'status',
            'created_at',
            'updated_at',
            'expires_at',
        ]
        read_only_fields = fields
