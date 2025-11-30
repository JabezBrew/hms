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
