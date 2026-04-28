"""
Minimal serializers for nested relationships.

Use these instead of full serializers when embedding related objects
to reduce API response payload sizes.

Example usage:
    from apps.core.serializers import MinimalPatientSerializer

    class MySerializer(serializers.ModelSerializer):
        patient = MinimalPatientSerializer(read_only=True)
"""
from rest_framework import serializers

from hms_backend.feature_manifest import FEATURE_MANIFEST

from .models import FeatureEntitlementOverride


class MinimalUserSerializer(serializers.Serializer):
    """
    Minimal user representation - use for any user reference.
    Returns ~100 bytes vs ~500+ bytes for full UserSerializer.
    """
    id = serializers.UUIDField(read_only=True)
    full_name = serializers.SerializerMethodField()
    email = serializers.EmailField(read_only=True)

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.email


class MinimalPatientSerializer(serializers.Serializer):
    """
    Minimal patient representation for lists and nested references.
    Returns ~150 bytes vs ~1KB+ for full PatientProfileSerializer.
    """
    id = serializers.UUIDField(read_only=True)
    name = serializers.SerializerMethodField()
    mrn = serializers.CharField(source='medical_record_number', read_only=True)

    def get_name(self, obj):
        if obj.user:
            return obj.user.get_full_name() or obj.user.email
        return 'Unknown'


class MinimalPractitionerSerializer(serializers.Serializer):
    """
    Minimal practitioner representation for lists and nested references.
    Returns ~150 bytes vs ~800+ bytes for full PractitionerProfileSerializer.
    """
    id = serializers.UUIDField(read_only=True)
    name = serializers.SerializerMethodField()
    specialization = serializers.CharField(read_only=True, allow_null=True)

    def get_name(self, obj):
        if obj.staff and obj.staff.user:
            return obj.staff.user.get_full_name()
        return 'Unknown'


class MinimalWardSerializer(serializers.Serializer):
    """
    Minimal ward representation.
    Returns ~100 bytes vs ~500+ bytes for full WardSerializer.
    """
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    ward_type = serializers.CharField(read_only=True)


class MinimalBedSerializer(serializers.Serializer):
    """
    Minimal bed representation with ward info flattened.
    Returns ~150 bytes vs ~600+ bytes for full BedSerializer.
    """
    id = serializers.UUIDField(read_only=True)
    bed_number = serializers.CharField(read_only=True)
    ward_name = serializers.CharField(source='ward.name', read_only=True)
    ward_id = serializers.UUIDField(source='ward.id', read_only=True)
    status = serializers.CharField(read_only=True)


class MinimalEncounterSerializer(serializers.Serializer):
    """
    Minimal encounter representation.
    Returns ~150 bytes vs ~500+ bytes for full EncounterSerializer.
    """
    id = serializers.UUIDField(read_only=True)
    encounter_type = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    start_time = serializers.DateTimeField(read_only=True)


class MinimalLabTestSerializer(serializers.Serializer):
    """
    Minimal lab test representation for order forms and lists.
    Returns ~150 bytes vs ~500+ bytes for full LabTestCatalogSerializer.
    """
    id = serializers.UUIDField(read_only=True)
    code = serializers.CharField(read_only=True)
    name = serializers.CharField(read_only=True)
    short_name = serializers.CharField(read_only=True)
    category = serializers.CharField(read_only=True)
    specimen_type = serializers.CharField(read_only=True)


class FacilityListSerializer(serializers.Serializer):
    """
    Lightweight serializer for facility lookups and selectors.
    """
    id = serializers.UUIDField(read_only=True)
    code = serializers.CharField(read_only=True)
    name = serializers.CharField(read_only=True)
    facility_type = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    provisioned_at = serializers.DateTimeField(read_only=True, allow_null=True)
    parent_facility_code = serializers.CharField(
        source='parent_facility.code',
        read_only=True,
        allow_null=True
    )


class FacilityFluidBalanceSettingsSerializer(serializers.Serializer):
    """
    Serializer for facility-level fluid balance alert threshold settings.
    Used by the settings API to expose and update alert thresholds.
    """
    # Alert thresholds (all in ml)
    min_daily_intake_target = serializers.IntegerField(min_value=0, max_value=10000)
    max_daily_output_threshold = serializers.IntegerField(min_value=0, max_value=20000)
    negative_balance_alert_threshold = serializers.IntegerField(min_value=-10000, max_value=0)
    positive_balance_alert_threshold = serializers.IntegerField(min_value=0, max_value=10000)

    # Enable/disable toggles
    enable_intake_alerts = serializers.BooleanField()
    enable_output_alerts = serializers.BooleanField()
    enable_balance_alerts = serializers.BooleanField()


class FeatureEntitlementOverrideSerializer(serializers.ModelSerializer):
    facility_code = serializers.CharField(source='facility.code', read_only=True)
    feature_label = serializers.SerializerMethodField()
    created_by_email = serializers.EmailField(source='created_by.email', read_only=True)
    updated_by_email = serializers.EmailField(source='updated_by.email', read_only=True)

    class Meta:
        model = FeatureEntitlementOverride
        fields = [
            'id',
            'scope',
            'facility',
            'facility_code',
            'feature_key',
            'feature_label',
            'is_enabled',
            'reason',
            'created_by_email',
            'updated_by_email',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'facility_code',
            'feature_label',
            'created_by_email',
            'updated_by_email',
            'created_at',
            'updated_at',
        ]

    def get_feature_label(self, obj):
        return FEATURE_MANIFEST.get(obj.feature_key, {}).get('label', obj.feature_key)

    def validate_feature_key(self, value):
        if value not in FEATURE_MANIFEST:
            raise serializers.ValidationError('Unknown feature key.')
        return value

    def validate(self, attrs):
        scope = attrs.get('scope', getattr(self.instance, 'scope', None))
        facility = attrs.get('facility', getattr(self.instance, 'facility', None))
        if scope == FeatureEntitlementOverride.SCOPE_GLOBAL and facility is not None:
            raise serializers.ValidationError({
                'facility': 'Global overrides cannot have a facility.',
            })
        if scope == FeatureEntitlementOverride.SCOPE_FACILITY and facility is None:
            raise serializers.ValidationError({
                'facility': 'Facility overrides require a facility.',
            })
        return attrs


class BreakGlassRequestSerializer(serializers.Serializer):
    """
    Request serializer for break-glass access.
    """
    reason = serializers.CharField(max_length=500)
    scope = serializers.ChoiceField(
        choices=[
            ('clinical', 'Clinical'),
            ('lab', 'Laboratory'),
            ('pharmacy', 'Pharmacy'),
            ('billing', 'Billing'),
            ('demographics', 'Demographics'),
        ],
        default='clinical'
    )


class BreakGlassEventSerializer(serializers.Serializer):
    """
    Response serializer for break-glass events.
    """
    id = serializers.UUIDField(read_only=True)
    patient = serializers.UUIDField(source='patient.id', read_only=True)
    scope = serializers.CharField(read_only=True)
    reason = serializers.CharField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    expires_at = serializers.DateTimeField(read_only=True)
    is_active = serializers.SerializerMethodField()

    def get_is_active(self, obj):
        from django.utils import timezone
        return obj.expires_at > timezone.now()

    # Read-only metadata
    updated_at = serializers.DateTimeField(read_only=True)
