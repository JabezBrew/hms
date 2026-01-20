"""
DRF serializers for the organization app.

Follows the pattern of lightweight list serializers and full detail serializers.
"""
from rest_framework import serializers

from .models import (
    DUTY_ROSTER_ROLE_CHOICES,
    DUTY_ROSTER_CONTEXT_CHOICES,
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    ClinicalUnit,
    Clinic,
    ClinicSchedule,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
    UnitWardAllocation,
    DepartmentDutyType,
    DepartmentStation,
    DepartmentRosterPlan,
    DepartmentRosterPattern,
    RosterPatternSlot,
    RosterOverride,
    TeamRosterPlan,
    TeamRosterEntry,
    ShiftDefinition,
    DutyRosterTemplate,
    DutyRoster,
    DUTY_ROSTER_ROLE_CHOICES,
    DUTY_ROSTER_CONTEXT_CHOICES,
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


class ClinicListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for clinic lists."""
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = Clinic
        fields = [
            'id', 'code', 'name', 'department', 'department_name',
            'operates_24_hours', 'accepts_walk_ins', 'is_active'
        ]


class ClinicSerializer(serializers.ModelSerializer):
    """Full serializer for clinic details."""
    department_name = serializers.CharField(source='department.name', read_only=True)
    facility_name = serializers.CharField(source='facility.name', read_only=True)

    class Meta:
        model = Clinic
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class ClinicScheduleListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for clinic schedule lists."""
    department_name = serializers.CharField(source='department.name', read_only=True)
    clinic_name = serializers.CharField(source='clinic.name', read_only=True)

    class Meta:
        model = ClinicSchedule
        fields = [
            'id', 'department', 'department_name',
            'clinic', 'clinic_name',
            'day_of_week', 'start_time', 'end_time',
            'is_active',
        ]


class ClinicScheduleSerializer(serializers.ModelSerializer):
    """Full serializer for clinic schedule details."""
    department_name = serializers.CharField(source='department.name', read_only=True)
    clinic_name = serializers.CharField(source='clinic.name', read_only=True)
    facility_name = serializers.CharField(source='facility.name', read_only=True)

    class Meta:
        model = ClinicSchedule
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, data):
        start_time = data.get('start_time') or (self.instance.start_time if self.instance else None)
        end_time = data.get('end_time') or (self.instance.end_time if self.instance else None)
        if start_time and end_time and start_time >= end_time:
            raise serializers.ValidationError({
                'end_time': 'End time must be after start time.'
            })

        department = data.get('department') or (self.instance.department if self.instance else None)
        clinic = data.get('clinic') or (self.instance.clinic if self.instance else None)
        if department and getattr(department.unit_type, 'code', None) != 'department':
            raise serializers.ValidationError({
                'department': 'Clinic schedules must reference a department unit.'
            })
        if department and clinic and clinic.department_id != department.id:
            raise serializers.ValidationError({
                'clinic': 'Clinic must belong to the selected department.'
            })

        return data


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


# =============================================================================
# Department Roster Serializers
# =============================================================================


class DepartmentDutyTypeListSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = DepartmentDutyType
        fields = [
            'id', 'department', 'department_name', 'code', 'name',
            'default_context', 'default_role', 'requires_time_range',
            'default_context_label', 'default_role_label',
            'display_order', 'is_active'
        ]


class DepartmentDutyTypeSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    default_role_label = serializers.CharField(read_only=True)
    default_context_label = serializers.CharField(read_only=True)

    class Meta:
        model = DepartmentDutyType
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'default_role_label', 'default_context_label']

    def create(self, validated_data):
        # Auto-populate labels from choices
        role = validated_data.get('default_role', 'admitting')
        context = validated_data.get('default_context', 'inpatient')
        role_labels = dict(DUTY_ROSTER_ROLE_CHOICES)
        context_labels = dict(DUTY_ROSTER_CONTEXT_CHOICES)
        validated_data['default_role_label'] = role_labels.get(role, role)
        validated_data['default_context_label'] = context_labels.get(context, context)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Auto-populate labels from choices if role/context changed
        role = validated_data.get('default_role', instance.default_role)
        context = validated_data.get('default_context', instance.default_context)
        role_labels = dict(DUTY_ROSTER_ROLE_CHOICES)
        context_labels = dict(DUTY_ROSTER_CONTEXT_CHOICES)
        validated_data['default_role_label'] = role_labels.get(role, role)
        validated_data['default_context_label'] = context_labels.get(context, context)
        return super().update(instance, validated_data)


class DepartmentStationListSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = DepartmentStation
        fields = ['id', 'department', 'department_name', 'code', 'name', 'display_order', 'is_active']


class DepartmentStationSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = DepartmentStation
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class DepartmentRosterPlanListSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = DepartmentRosterPlan
        fields = [
            'id', 'department', 'department_name', 'name', 'cycle_length_days',
            'effective_from', 'effective_until', 'status', 'version'
        ]


class DepartmentRosterPlanSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = DepartmentRosterPlan
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class DepartmentRosterPatternListSerializer(serializers.ModelSerializer):
    class Meta:
        model = DepartmentRosterPattern
        fields = ['id', 'plan', 'name', 'display_order', 'is_active']


class DepartmentRosterPatternSerializer(serializers.ModelSerializer):
    class Meta:
        model = DepartmentRosterPattern
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class RosterPatternSlotListSerializer(serializers.ModelSerializer):
    class Meta:
        model = RosterPatternSlot
        fields = [
            'id', 'pattern', 'day_offset',
            'duty_type', 'team', 'start_time', 'end_time', 'is_active'
        ]


class RosterPatternSlotSerializer(serializers.ModelSerializer):
    pattern = serializers.PrimaryKeyRelatedField(
        queryset=DepartmentRosterPattern.objects.all(),
        required=False,
        allow_null=True
    )
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True)
    team_name = serializers.CharField(source='team.name', read_only=True)

    def validate(self, attrs):
        plan = attrs.get('plan') or getattr(self.instance, 'plan', None)
        pattern = attrs.get('pattern') or getattr(self.instance, 'pattern', None)
        if plan and pattern and pattern.plan_id != plan.id:
            raise serializers.ValidationError("Pattern does not belong to the roster plan.")
        return attrs

    class Meta:
        model = RosterPatternSlot
        fields = '__all__'
        read_only_fields = ['id']


class RosterOverrideListSerializer(serializers.ModelSerializer):
    class Meta:
        model = RosterOverride
        fields = [
            'id', 'plan', 'date', 'duty_type',
            'team', 'start_time', 'end_time', 'reason'
        ]


class RosterOverrideSerializer(serializers.ModelSerializer):
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True)
    team_name = serializers.CharField(source='team.name', read_only=True)

    class Meta:
        model = RosterOverride
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class TeamRosterPlanListSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source='team.name', read_only=True)

    class Meta:
        model = TeamRosterPlan
        fields = [
            'id', 'team', 'team_name', 'name', 'effective_from',
            'effective_until', 'status', 'version'
        ]


class TeamRosterPlanSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source='team.name', read_only=True)

    class Meta:
        model = TeamRosterPlan
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class TeamRosterEntryListSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeamRosterEntry
        fields = [
            'id', 'team', 'date', 'duty_type',
            'station', 'practitioner', 'start_time', 'end_time'
        ]


class TeamRosterEntrySerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source='team.name', read_only=True)
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True)
    station_name = serializers.CharField(source='station.name', read_only=True)
    practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = TeamRosterEntry
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_practitioner_name(self, obj):
        try:
            return obj.practitioner.staff.user.get_full_name()
        except Exception:
            return str(obj.practitioner_id)


# =============================================================================
# Duty Roster Serializers
# =============================================================================


class ShiftDefinitionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for shift lists."""

    class Meta:
        model = ShiftDefinition
        fields = [
            'id', 'code', 'name', 'start_time', 'end_time',
            'crosses_midnight', 'display_order', 'is_active'
        ]


class ShiftDefinitionSerializer(serializers.ModelSerializer):
    """Full serializer for shift details."""

    class Meta:
        model = ShiftDefinition
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'crosses_midnight']

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
        return super().create(validated_data)


class DutyRosterTemplateListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for template lists."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    practitioner_name = serializers.SerializerMethodField()
    shift_name = serializers.CharField(source='shift.name', read_only=True, allow_null=True)
    day_name = serializers.SerializerMethodField()
    effective_start_time = serializers.TimeField(source='start_time', read_only=True)
    effective_end_time = serializers.TimeField(source='end_time', read_only=True)
    is_currently_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = DutyRosterTemplate
        fields = [
            'id', 'unit', 'unit_name', 'practitioner', 'practitioner_name',
            'day_of_week', 'day_name', 'shift', 'shift_name',
            'effective_start_time', 'effective_end_time',
            'role', 'context', 'seniority_level', 'is_primary',
            'effective_from', 'effective_until', 'is_active', 'is_currently_effective'
        ]

    def get_practitioner_name(self, obj):
        try:
            return obj.practitioner.staff.user.get_full_name()
        except Exception:
            return str(obj.practitioner_id)

    def get_day_name(self, obj):
        days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        return days[obj.day_of_week]


class DutyRosterTemplateSerializer(serializers.ModelSerializer):
    """Full serializer for template details and create/update."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    practitioner_name = serializers.SerializerMethodField()
    shift_name = serializers.CharField(source='shift.name', read_only=True, allow_null=True)

    class Meta:
        model = DutyRosterTemplate
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_practitioner_name(self, obj):
        try:
            return obj.practitioner.staff.user.get_full_name()
        except Exception:
            return str(obj.practitioner_id)

    def validate(self, data):
        instance = getattr(self, 'instance', None)
        shift = data.get('shift', getattr(instance, 'shift', None))
        custom_start = data.get('custom_start_time', getattr(instance, 'custom_start_time', None))
        custom_end = data.get('custom_end_time', getattr(instance, 'custom_end_time', None))

        if shift and (custom_start or custom_end):
            raise serializers.ValidationError(
                "Provide either a shift OR custom times, not both."
            )
        if not shift and not (custom_start and custom_end):
            raise serializers.ValidationError(
                "Either shift or both custom_start_time and custom_end_time are required."
            )

        return data

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['updated_by'] = request.user
        return super().update(instance, validated_data)


class DutyRosterListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for roster lists."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    practitioner_name = serializers.SerializerMethodField()
    shift_name = serializers.CharField(source='shift.name', read_only=True, allow_null=True)
    original_practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = DutyRoster
        fields = [
            'id', 'unit', 'unit_name', 'practitioner', 'practitioner_name',
            'date', 'shift', 'shift_name', 'start_time', 'end_time',
            'role', 'context', 'seniority_level', 'is_primary',
            'source', 'original_practitioner', 'original_practitioner_name',
            'is_active'
        ]

    def get_practitioner_name(self, obj):
        try:
            return obj.practitioner.staff.user.get_full_name()
        except Exception:
            return str(obj.practitioner_id)

    def get_original_practitioner_name(self, obj):
        if not obj.original_practitioner:
            return None
        try:
            return obj.original_practitioner.staff.user.get_full_name()
        except Exception:
            return str(obj.original_practitioner_id)


class DutyRosterSerializer(serializers.ModelSerializer):
    """Full serializer for roster details."""
    unit_name = serializers.CharField(source='unit.name', read_only=True)
    practitioner_name = serializers.SerializerMethodField()
    shift_name = serializers.CharField(source='shift.name', read_only=True, allow_null=True)
    original_practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = DutyRoster
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'source', 'template', 'original_practitioner']

    def get_practitioner_name(self, obj):
        try:
            return obj.practitioner.staff.user.get_full_name()
        except Exception:
            return str(obj.practitioner_id)

    def get_original_practitioner_name(self, obj):
        if not obj.original_practitioner:
            return None
        try:
            return obj.original_practitioner.staff.user.get_full_name()
        except Exception:
            return str(obj.original_practitioner_id)

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
        validated_data['source'] = 'manual'
        return super().create(validated_data)

    def update(self, instance, validated_data):
        request = self.context.get('request')
        if request and request.user:
            validated_data['updated_by'] = request.user
        return super().update(instance, validated_data)


class GenerateRosterSerializer(serializers.Serializer):
    """Serializer for roster generation request."""
    unit_id = serializers.UUIDField(required=False, help_text="Unit ID (optional, generates for all units if omitted)")
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    overwrite = serializers.BooleanField(default=False)

    def validate(self, data):
        if data['end_date'] < data['start_date']:
            raise serializers.ValidationError("end_date must be >= start_date")

        # Limit to 90 days to prevent accidental large generations
        delta = (data['end_date'] - data['start_date']).days
        if delta > 90:
            raise serializers.ValidationError("Maximum generation range is 90 days")

        return data


class SwapDutySerializer(serializers.Serializer):
    """Serializer for duty swap request."""
    replacement_practitioner_id = serializers.UUIDField()
    reason = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_replacement_practitioner_id(self, value):
        from apps.users.models import PractitionerProfile
        try:
            PractitionerProfile.objects.get(id=value)
        except PractitionerProfile.DoesNotExist:
            raise serializers.ValidationError("Practitioner not found")
        return value


class OnDutyQuerySerializer(serializers.Serializer):
    """Serializer for on-duty query parameters."""
    unit_id = serializers.UUIDField()
    at_datetime = serializers.DateTimeField(required=False)
    role = serializers.ChoiceField(
        choices=DUTY_ROSTER_ROLE_CHOICES,
        required=False
    )
    context = serializers.ChoiceField(
        choices=DUTY_ROSTER_CONTEXT_CHOICES,
        required=False
    )
    include_descendants = serializers.BooleanField(default=False)
    include_team_details = serializers.BooleanField(default=False)


class DepartmentRosterImportSerializer(serializers.Serializer):
    """Serializer for department roster CSV import."""
    csv = serializers.CharField()


class TeamRosterImportSerializer(serializers.Serializer):
    """Serializer for team roster CSV import."""
    csv = serializers.CharField()


class RosterImportApplySerializer(serializers.Serializer):
    """Serializer for applying a validated roster import."""
    rows = serializers.ListField()
    conflict_strategy = serializers.ChoiceField(
        choices=[('skip', 'Skip conflicts'), ('overwrite', 'Overwrite conflicts')],
        default='skip'
    )

    def validate_rows(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Rows must be a list.")
        return value
