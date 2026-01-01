"""
DRF serializers for the organization app.

Follows the pattern of lightweight list serializers and full detail serializers.
"""
from rest_framework import serializers

from .models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
    UnitWardAllocation,
)

MIXED_DEFAULT_UNIT_TYPES = {'facility', 'department', 'division'}


# =============================================================================
# Configuration Serializers
# =============================================================================


class UnitTypeConfigListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for unit type lists."""

    class Meta:
        model = UnitTypeConfig
        fields = [
            'id', 'code', 'name', 'can_be_root', 'depth_level',
            'can_admit_patients', 'can_consult', 'can_have_wards',
            'icon', 'color', 'display_order', 'is_active'
        ]


class UnitTypeConfigSerializer(serializers.ModelSerializer):
    """Full serializer for unit type details."""
    allowed_parent_types = UnitTypeConfigListSerializer(many=True, read_only=True)
    allowed_parent_type_ids = serializers.PrimaryKeyRelatedField(
        queryset=UnitTypeConfig.objects.all(),
        many=True,
        write_only=True,
        required=False,
        source='allowed_parent_types'
    )

    class Meta:
        model = UnitTypeConfig
        fields = '__all__'


class LeadershipRoleConfigListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for leadership role lists."""

    class Meta:
        model = LeadershipRoleConfig
        fields = [
            'id', 'code', 'name', 'is_primary_leader', 'max_per_unit',
            'can_approve', 'can_manage_staff', 'can_view_all_data',
            'display_order', 'is_active'
        ]


class LeadershipRoleConfigSerializer(serializers.ModelSerializer):
    """Full serializer for leadership role details."""
    applicable_unit_types = UnitTypeConfigListSerializer(many=True, read_only=True)
    applicable_unit_type_ids = serializers.PrimaryKeyRelatedField(
        queryset=UnitTypeConfig.objects.all(),
        many=True,
        write_only=True,
        required=False,
        source='applicable_unit_types'
    )

    class Meta:
        model = LeadershipRoleConfig
        fields = '__all__'


class StaffAssignmentTypeConfigSerializer(serializers.ModelSerializer):
    """Serializer for staff assignment type configuration."""

    class Meta:
        model = StaffAssignmentTypeConfig
        fields = '__all__'


# =============================================================================
# Clinical Unit Serializers
# =============================================================================


class ClinicalUnitListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for unit lists - defers heavy fields."""
    unit_type_name = serializers.CharField(source='unit_type.name', read_only=True)
    unit_type_code = serializers.CharField(source='unit_type.code', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True, allow_null=True)

    class Meta:
        model = ClinicalUnit
        fields = [
            'id', 'code', 'name', 'short_name',
            'unit_type', 'unit_type_name', 'unit_type_code',
            'parent', 'parent_name',
            'path_cache', 'root_unit',
            'is_active', 'accepts_admissions', 'accepts_referrals',
            'staffing_mode'
        ]


class ClinicalUnitTreeSerializer(serializers.ModelSerializer):
    """Serializer for tree view with children."""
    unit_type_name = serializers.CharField(source='unit_type.name', read_only=True)
    unit_type_code = serializers.CharField(source='unit_type.code', read_only=True)
    unit_type_icon = serializers.CharField(source='unit_type.icon', read_only=True)
    unit_type_color = serializers.CharField(source='unit_type.color', read_only=True)
    children = serializers.SerializerMethodField()
    level = serializers.IntegerField(read_only=True)

    class Meta:
        model = ClinicalUnit
        fields = [
            'id', 'code', 'name', 'short_name',
            'unit_type', 'unit_type_name', 'unit_type_code',
            'unit_type_icon', 'unit_type_color',
            'is_active', 'level', 'children',
            'staffing_mode'
        ]

    def get_children(self, obj):
        """Recursively serialize children."""
        include_inactive = self.context.get('include_inactive', False)
        children = obj.get_children()
        if hasattr(children, 'filter'):
            if not include_inactive:
                children = children.filter(is_active=True)
        elif not include_inactive:
            children = [child for child in children if child.is_active]
        return ClinicalUnitTreeSerializer(children, many=True, context=self.context).data


class ClinicalUnitSerializer(serializers.ModelSerializer):
    """Full serializer for unit details including all fields."""
    unit_type_name = serializers.CharField(source='unit_type.name', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True, allow_null=True)
    full_path = serializers.CharField(read_only=True)
    facility_name = serializers.CharField(source='facility.name', read_only=True, allow_null=True)
    effective_timezone = serializers.SerializerMethodField()
    effective_currency = serializers.SerializerMethodField()

    class Meta:
        model = ClinicalUnit
        fields = '__all__'
        read_only_fields = ['id', 'path_cache', 'root_unit', 'created_at', 'updated_at']

    def get_effective_timezone(self, obj):
        return obj.get_effective_timezone()

    def get_effective_currency(self, obj):
        return obj.get_effective_currency()

    def validate(self, data):
        """Validate unit type and parent relationship."""
        unit_type = data.get('unit_type') or (self.instance.unit_type if self.instance else None)
        parent = data.get('parent', getattr(self.instance, 'parent', None))

        if not parent:
            # Root node validation
            if unit_type and not unit_type.can_be_root:
                raise serializers.ValidationError({
                    'parent': f'Units of type "{unit_type.name}" cannot be root nodes.'
                })
        else:
            # Validate parent type is allowed
            if unit_type and parent.unit_type not in unit_type.allowed_parent_types.all():
                allowed = ', '.join(unit_type.allowed_parent_types.values_list('name', flat=True))
                raise serializers.ValidationError({
                    'parent': f'Units of type "{unit_type.name}" can only be under: {allowed}'
                })

        return data


class ClinicalUnitCreateSerializer(ClinicalUnitSerializer):
    """Serializer for creating units with user tracking."""

    # Ensure is_active defaults to True on create (form-encoded POSTs may omit it)
    is_active = serializers.BooleanField(default=True)

    def validate(self, data):
        """Validate unit type, parent relationship, and code uniqueness."""
        data = super().validate(data)

        # Check code uniqueness within parent
        code = data.get('code')
        parent = data.get('parent')
        unit_type = data.get('unit_type') or (self.instance.unit_type if self.instance else None)

        if not self.instance and 'staffing_mode' not in self.initial_data:
            if unit_type and unit_type.code in MIXED_DEFAULT_UNIT_TYPES:
                data['staffing_mode'] = 'mixed'

        if code:
            # Check for existing units with same code under same parent
            existing_qs = ClinicalUnit.objects.filter(code=code, parent=parent)
            if self.instance:
                existing_qs = existing_qs.exclude(pk=self.instance.pk)
            if existing_qs.exists():
                raise serializers.ValidationError({
                    'code': f'A unit with code "{code}" already exists under this parent.'
                })

        return data

    def create(self, validated_data):
        request = self.context.get('request')
        if request and getattr(request, 'user', None) and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        request = self.context.get('request')
        if request and getattr(request, 'user', None) and request.user.is_authenticated:
            validated_data['updated_by'] = request.user
        return super().update(instance, validated_data)


# =============================================================================
# Unit Leadership Serializers
# =============================================================================


class UnitLeadershipListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for leadership lists."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True)
    user_name = serializers.SerializerMethodField()
    user_email = serializers.CharField(source='user.email', read_only=True)
    is_currently_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = UnitLeadership
        fields = [
            'id', 'unit', 'unit_name', 'role', 'role_name',
            'user', 'user_name', 'user_email',
            'effective_from', 'effective_until',
            'is_active', 'is_currently_effective'
        ]

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.email


class UnitLeadershipSerializer(serializers.ModelSerializer):
    """Full serializer for leadership details."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True)
    user_name = serializers.SerializerMethodField()
    is_currently_effective = serializers.BooleanField(read_only=True)

    # Ensure is_active defaults to True on create (form-encoded POSTs may omit it)
    is_active = serializers.BooleanField(default=True)

    class Meta:
        model = UnitLeadership
        fields = '__all__'
        read_only_fields = ['id', 'created_at']

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.email

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
        return super().create(validated_data)


# =============================================================================
# Staff Assignment Serializers
# =============================================================================


class StaffUnitAssignmentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for staff assignment lists."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    unit_type_name = serializers.CharField(source='unit.unit_type.name', read_only=True)
    staff_id = serializers.SerializerMethodField()
    practitioner_name = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    assignment_type_name = serializers.CharField(source='assignment_type.name', read_only=True)
    is_currently_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = StaffUnitAssignment
        fields = [
            'id', 'unit', 'unit_name', 'unit_type_name',
            'staff_id',
            'practitioner', 'practitioner_name', 'employee_id',
            'assignment_type', 'assignment_type_name',
            'is_primary', 'is_secondary', 'fte_percentage',
            'effective_from', 'effective_until',
            'is_active', 'is_currently_effective'
        ]

    def get_staff_id(self, obj):
        try:
            return str(obj.practitioner.staff_id)
        except Exception:
            return None

    def get_practitioner_name(self, obj):
        try:
            return obj.practitioner.staff.user.get_full_name() or obj.practitioner.staff.user.email
        except Exception:
            return str(obj.practitioner_id)

    def get_employee_id(self, obj):
        try:
            return obj.practitioner.staff.employee_id
        except Exception:
            return None


class StaffUnitAssignmentSerializer(serializers.ModelSerializer):
    """Full serializer for staff assignment details."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    practitioner_name = serializers.SerializerMethodField()
    assignment_type_name = serializers.CharField(source='assignment_type.name', read_only=True)
    is_currently_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = StaffUnitAssignment
        fields = '__all__'
        read_only_fields = ['id', 'assigned_at', 'updated_at']

    def get_practitioner_name(self, obj):
        try:
            return obj.practitioner.staff.user.get_full_name() or obj.practitioner.staff.user.email
        except Exception:
            return str(obj.practitioner_id)

    def validate(self, data):
        unit = data.get('unit') or (self.instance.unit if self.instance else None)
        if unit and unit.staffing_mode == 'ops_only':
            raise serializers.ValidationError({
                'unit': 'Operations units cannot have clinical staff assignments.'
            })
        return data

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['assigned_by'] = request.user
        return super().create(validated_data)


class UnitMemberAssignmentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for ops unit member lists."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    unit_type_name = serializers.CharField(source='unit.unit_type.name', read_only=True)
    staff_name = serializers.SerializerMethodField()
    staff_email = serializers.EmailField(source='staff.user.email', read_only=True)
    staff_employee_id = serializers.CharField(source='staff.employee_id', read_only=True)
    assignment_type_name = serializers.CharField(source='assignment_type.name', read_only=True)
    is_currently_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = UnitMemberAssignment
        fields = [
            'id', 'unit', 'unit_name', 'unit_type_name',
            'staff', 'staff_name', 'staff_email', 'staff_employee_id',
            'assignment_type', 'assignment_type_name',
            'is_primary', 'is_secondary', 'fte_percentage',
            'effective_from', 'effective_until',
            'is_active', 'is_currently_effective'
        ]

    def get_staff_name(self, obj):
        try:
            return obj.staff.user.get_full_name() or obj.staff.user.email
        except Exception:
            return str(obj.staff_id)


class UnitMemberAssignmentSerializer(serializers.ModelSerializer):
    """Full serializer for ops unit member assignments."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    staff_name = serializers.SerializerMethodField()
    assignment_type_name = serializers.CharField(source='assignment_type.name', read_only=True)
    is_currently_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = UnitMemberAssignment
        fields = '__all__'
        read_only_fields = ['id', 'assigned_at', 'updated_at']

    def get_staff_name(self, obj):
        try:
            return obj.staff.user.get_full_name() or obj.staff.user.email
        except Exception:
            return str(obj.staff_id)

    def validate(self, data):
        unit = data.get('unit') or (self.instance.unit if self.instance else None)
        staff = data.get('staff') or (self.instance.staff if self.instance else None)

        if unit and unit.staffing_mode == 'clinical_only':
            raise serializers.ValidationError({
                'unit': 'Clinical-only units cannot have non-clinical members.'
            })

        if staff and getattr(staff, 'practitioner_profile', None):
            raise serializers.ValidationError({
                'staff': 'Clinical practitioners must be assigned via clinical staff assignments.'
            })

        return data

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['assigned_by'] = request.user
        return super().create(validated_data)


# =============================================================================
# Cross Coverage Serializers
# =============================================================================


class CrossCoverageScheduleListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for coverage schedule lists."""
    covered_unit_name = serializers.CharField(source='covered_unit.name', read_only=True)
    covering_unit_name = serializers.CharField(source='covering_unit.name', read_only=True, allow_null=True)
    covering_practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = CrossCoverageSchedule
        fields = [
            'id', 'covered_unit', 'covered_unit_name',
            'covering_practitioner', 'covering_practitioner_name',
            'covering_unit', 'covering_unit_name',
            'coverage_type', 'start_datetime', 'end_datetime',
            'is_active'
        ]

    def get_covering_practitioner_name(self, obj):
        if not obj.covering_practitioner:
            return None
        try:
            return obj.covering_practitioner.staff.user.get_full_name() or obj.covering_practitioner.staff.user.email
        except Exception:
            return str(obj.covering_practitioner_id)


class CrossCoverageScheduleSerializer(serializers.ModelSerializer):
    """Full serializer for coverage schedule details."""
    covered_unit_name = serializers.CharField(source='covered_unit.name', read_only=True)
    covering_unit_name = serializers.CharField(source='covering_unit.name', read_only=True, allow_null=True)
    covering_practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = CrossCoverageSchedule
        fields = '__all__'
        read_only_fields = ['id', 'created_at']

    def get_covering_practitioner_name(self, obj):
        if not obj.covering_practitioner:
            return None
        try:
            return obj.covering_practitioner.staff.user.get_full_name() or obj.covering_practitioner.staff.user.email
        except Exception:
            return str(obj.covering_practitioner_id)

    def validate(self, data):
        """Validate that either practitioner or unit is set, not both."""
        covering_practitioner = data.get('covering_practitioner')
        covering_unit = data.get('covering_unit')

        if not covering_practitioner and not covering_unit:
            raise serializers.ValidationError(
                'Either covering_practitioner or covering_unit must be set.'
            )
        if covering_practitioner and covering_unit:
            raise serializers.ValidationError(
                'Only one of covering_practitioner or covering_unit can be set.'
            )

        return data

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
        return super().create(validated_data)


# =============================================================================
# Ward Allocation Serializers
# =============================================================================


class UnitWardAllocationListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for ward allocation lists."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    ward_name = serializers.CharField(source='ward.name', read_only=True)
    is_currently_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = UnitWardAllocation
        fields = [
            'id', 'unit', 'unit_name', 'ward', 'ward_name',
            'allocation_type', 'allocated_beds', 'min_beds', 'max_beds', 'priority',
            'effective_from', 'effective_until',
            'is_active', 'is_currently_effective'
        ]


class UnitWardAllocationSerializer(serializers.ModelSerializer):
    """Full serializer for ward allocation details."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    ward_name = serializers.CharField(source='ward.name', read_only=True)
    is_currently_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = UnitWardAllocation
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
        return super().create(validated_data)
