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
    Clinic,
    ClinicSchedule,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
    UnitWardAllocation,
    DepartmentDutyType,
    RotationRule,
    RosterEntry,
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
            'staffing_mode', 'unit_category'
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
            'staffing_mode', 'unit_category'
        ]

    def get_children(self, obj):
        """Recursively serialize children."""
        include_inactive = self.context.get('include_inactive', False)
        children = getattr(obj, '_cached_children', None)
        if children is None:
            children = list(obj.get_children())
        else:
            children = list(children)
        if not include_inactive:
            children = [child for child in children if child.is_active]
        return ClinicalUnitTreeSerializer(children, many=True, context=self.context).data


class ClinicalUnitSerializer(serializers.ModelSerializer):
    """Full serializer for unit details including all fields."""
    unit_type_name = serializers.CharField(source='unit_type.name', read_only=True)
    unit_type_code = serializers.CharField(source='unit_type.code', read_only=True)
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
            validated_data.setdefault('created_by', request.user)
            validated_data.setdefault('updated_by', request.user)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        request = self.context.get('request')
        if request and getattr(request, 'user', None) and request.user.is_authenticated:
            validated_data['updated_by'] = request.user
        return super().update(instance, validated_data)


class ClinicListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for clinic lists."""
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = Clinic
        fields = [
            'id', 'code', 'name', 'department', 'department_name',
            'operating_hours_start', 'operating_hours_end',
            'operates_24_hours', 'accepts_walk_ins',
            'booking_mode', 'assignment_timing',
            'waitlist_enabled', 'overbook_percent', 'overbook_hard_cap',
            'is_active'
        ]


class ClinicSerializer(serializers.ModelSerializer):
    """Full serializer for clinic details."""
    department_name = serializers.CharField(source='department.name', read_only=True)
    facility_name = serializers.CharField(source='facility.name', read_only=True)

    class Meta:
        model = Clinic
        fields = '__all__'
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def validate(self, data):
        booking_mode = data.get('booking_mode', getattr(self.instance, 'booking_mode', Clinic.BookingMode.PRACTITIONER_DIRECT))
        assignment_timing = data.get(
            'assignment_timing',
            getattr(self.instance, 'assignment_timing', Clinic.AssignmentTiming.BOOKING)
        )
        overbook_percent = data.get('overbook_percent', getattr(self.instance, 'overbook_percent', 0))
        soft_preassignment = data.get(
            'soft_preassignment_minutes',
            getattr(self.instance, 'soft_preassignment_minutes', 60)
        )

        if booking_mode == Clinic.BookingMode.CLINIC_POOL and assignment_timing != Clinic.AssignmentTiming.CHECK_IN:
            raise serializers.ValidationError({
                'assignment_timing': 'Clinic pool mode requires check-in assignment timing.'
            })

        if booking_mode == Clinic.BookingMode.PRACTITIONER_DIRECT and assignment_timing != Clinic.AssignmentTiming.BOOKING:
            raise serializers.ValidationError({
                'assignment_timing': 'Practitioner-direct mode requires booking-time assignment.'
            })

        if overbook_percent is not None and overbook_percent > 100:
            raise serializers.ValidationError({
                'overbook_percent': 'Overbook percent cannot exceed 100.'
            })

        if soft_preassignment and soft_preassignment > 720:
            raise serializers.ValidationError({
                'soft_preassignment_minutes': 'Soft preassignment cannot exceed 12 hours.'
            })

        return data


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
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    clinic_name = serializers.CharField(source='clinic.name', read_only=True, allow_null=True)

    class Meta:
        model = DepartmentDutyType
        fields = [
            'id', 'department', 'department_name', 'code', 'name',
            'category', 'category_display',
            'rotation_type', 'applicable_days', 'is_24_hour',
            'start_time', 'end_time',
            'slot_duration_minutes', 'max_patients_per_slot',
            'clinic', 'clinic_name',
            'display_order', 'is_active'
        ]


class DepartmentDutyTypeSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    clinic_name = serializers.CharField(source='clinic.name', read_only=True, allow_null=True)
    default_appointment_type_name = serializers.CharField(
        source='default_appointment_type.name', read_only=True, allow_null=True
    )

    class Meta:
        model = DepartmentDutyType
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, data):
        applicable_days = data.get('applicable_days')
        if applicable_days is not None:
            if not isinstance(applicable_days, (list, tuple)):
                raise serializers.ValidationError({'applicable_days': 'Days must be a list of integers 0-6.'})
            invalid_days = [day for day in applicable_days if day not in range(0, 7)]
            if invalid_days:
                raise serializers.ValidationError({'applicable_days': 'Days must be integers 0-6.'})

        is_24_hour = data.get('is_24_hour', getattr(self.instance, 'is_24_hour', False))
        start_time = data.get('start_time', getattr(self.instance, 'start_time', None))
        end_time = data.get('end_time', getattr(self.instance, 'end_time', None))
        if is_24_hour and (start_time or end_time):
            raise serializers.ValidationError({'start_time': '24-hour duties cannot define times.'})
        if not is_24_hour and (start_time is None or end_time is None):
            raise serializers.ValidationError({'start_time': 'Both start_time and end_time are required.'})
        if start_time and end_time and start_time == end_time:
            raise serializers.ValidationError({'start_time': 'start_time and end_time cannot match.'})

        department = data.get('department', getattr(self.instance, 'department', None))

        # Validate clinic-specific fields
        category = data.get('category', getattr(self.instance, 'category', 'ward'))
        slot_duration = data.get('slot_duration_minutes', getattr(self.instance, 'slot_duration_minutes', None))
        clinic = data.get('clinic', getattr(self.instance, 'clinic', None))

        if category == 'clinic':
            if clinic is None:
                raise serializers.ValidationError({'clinic': 'Clinic is required for clinic-type duties.'})
            if department and getattr(clinic, 'department_id', None) and clinic.department_id != department.id:
                raise serializers.ValidationError({'clinic': 'Clinic must belong to the selected department.'})

            # Facility safety check: prevent cross-facility linking.
            # Organization departments are scoped by root_unit.code matching the active facility code.
            root_unit = getattr(department, 'root_unit', None) if department else None
            clinic_facility_code = getattr(getattr(clinic, 'facility', None), 'code', None)
            root_unit_code = getattr(root_unit, 'code', None)
            if root_unit_code and clinic_facility_code and root_unit_code != clinic_facility_code:
                raise serializers.ValidationError({'clinic': 'Clinic does not belong to the same facility as the department.'})

            # slot_duration_minutes is required for clinic category
            if slot_duration is None:
                raise serializers.ValidationError({
                    'slot_duration_minutes': 'Slot duration is required for clinic-type duties.'
                })
            if slot_duration < 5:
                raise serializers.ValidationError({
                    'slot_duration_minutes': 'Slot duration must be at least 5 minutes.'
                })
            if slot_duration > 480:
                raise serializers.ValidationError({
                    'slot_duration_minutes': 'Slot duration cannot exceed 480 minutes (8 hours).'
                })
        else:
            if clinic is not None:
                raise serializers.ValidationError({'clinic': 'Clinic can only be set when category is clinic.'})

        # Validate breaks format
        breaks = data.get('breaks', getattr(self.instance, 'breaks', []))
        if breaks:
            if not isinstance(breaks, list):
                raise serializers.ValidationError({'breaks': 'Breaks must be a list.'})
            for i, break_period in enumerate(breaks):
                if not isinstance(break_period, dict):
                    raise serializers.ValidationError({
                        'breaks': f'Break {i+1} must be an object with start and end times.'
                    })
                if 'start' not in break_period or 'end' not in break_period:
                    raise serializers.ValidationError({
                        'breaks': f'Break {i+1} must have both start and end times.'
                    })
                # Validate time format (HH:MM)
                try:
                    from datetime import datetime
                    datetime.strptime(break_period['start'], '%H:%M')
                    datetime.strptime(break_period['end'], '%H:%M')
                except ValueError:
                    raise serializers.ValidationError({
                        'breaks': f'Break {i+1} times must be in HH:MM format.'
                    })

        # Validate max_patients_per_slot
        max_patients = data.get('max_patients_per_slot', getattr(self.instance, 'max_patients_per_slot', 1))
        if max_patients is not None and max_patients < 1:
            raise serializers.ValidationError({
                'max_patients_per_slot': 'Max patients per slot must be at least 1.'
            })

        return data


class RotationRuleListSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True)

    class Meta:
        model = RotationRule
        fields = [
            'id', 'department', 'department_name', 'duty_type', 'duty_type_name',
            'name', 'rule_type', 'applicable_days', 'is_active'
        ]


class RotationRuleSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True)

    class Meta:
        model = RotationRule
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, data):
        rule_type = data.get('rule_type', getattr(self.instance, 'rule_type', None))
        team_sequence = data.get('team_sequence', getattr(self.instance, 'team_sequence', []))
        day_assignments = data.get('day_assignments', getattr(self.instance, 'day_assignments', {}))
        exclusion_rule = data.get('exclusion_rule', getattr(self.instance, 'exclusion_rule', None))

        if rule_type in ('sequential', 'exclusion') and not team_sequence:
            raise serializers.ValidationError({'team_sequence': 'Team sequence is required for sequential rules.'})
        if rule_type == 'fixed_weekly' and not day_assignments:
            raise serializers.ValidationError({'day_assignments': 'Day assignments are required for fixed weekly rules.'})
        if rule_type == 'exclusion' and not exclusion_rule:
            raise serializers.ValidationError({'exclusion_rule': 'Exclusion rules require exclusion_rule.'})

        return data


class RosterEntryListSerializer(serializers.ModelSerializer):
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True)
    team_name = serializers.CharField(source='team.name', read_only=True, allow_null=True)
    is_24_hour = serializers.BooleanField(source='duty_type.is_24_hour', read_only=True)
    start_time = serializers.SerializerMethodField()
    end_time = serializers.SerializerMethodField()

    class Meta:
        model = RosterEntry
        fields = [
            'id', 'date', 'duty_type', 'duty_type_name',
            'team', 'team_name', 'start_time', 'end_time', 'is_24_hour',
            'status', 'source', 'is_override'
        ]

    def get_start_time(self, obj):
        if obj.duty_type and obj.duty_type.is_24_hour:
            return '08:00'
        return obj.start_time.strftime('%H:%M') if obj.start_time else None

    def get_end_time(self, obj):
        if obj.duty_type and obj.duty_type.is_24_hour:
            return '08:00'
        return obj.end_time.strftime('%H:%M') if obj.end_time else None


class RosterEntrySerializer(serializers.ModelSerializer):
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True)
    team_name = serializers.CharField(source='team.name', read_only=True, allow_null=True)

    class Meta:
        model = RosterEntry
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, data):
        team = data.get('team', getattr(self.instance, 'team', None))
        practitioner = data.get('practitioner', getattr(self.instance, 'practitioner', None))
        if team and practitioner:
            raise serializers.ValidationError('Assign either team or practitioner, not both.')
        if not team and not practitioner:
            raise serializers.ValidationError('Team assignment is required for roster entries.')

        duty_type = data.get('duty_type', getattr(self.instance, 'duty_type', None))
        start_time = data.get('start_time', getattr(self.instance, 'start_time', None))
        end_time = data.get('end_time', getattr(self.instance, 'end_time', None))
        if duty_type and duty_type.is_24_hour and (start_time or end_time):
            raise serializers.ValidationError({'start_time': '24-hour duties cannot define times.'})
        if duty_type and not duty_type.is_24_hour and ((start_time is None) ^ (end_time is None)):
            raise serializers.ValidationError({'start_time': 'Both start_time and end_time are required.'})
        if start_time and end_time and start_time == end_time:
            raise serializers.ValidationError({'start_time': 'start_time and end_time cannot match.'})

        return data


class RosterGenerateSerializer(serializers.Serializer):
    period = serializers.CharField(required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    source = serializers.ChoiceField(choices=['rules'], default='rules')

    def validate(self, data):
        period = data.get('period')
        date_from = data.get('date_from')
        date_to = data.get('date_to')
        if not period and not (date_from and date_to):
            raise serializers.ValidationError('Either period or date_from/date_to is required.')
        if date_from and date_to and date_to < date_from:
            raise serializers.ValidationError('date_to must be after date_from.')
        return data


class RosterBulkEntrySerializer(serializers.Serializer):
    date = serializers.DateField()
    duty_type = serializers.UUIDField()
    # Exactly one of team or practitioner must be provided.
    team = serializers.UUIDField(required=False, allow_null=True)
    practitioner = serializers.UUIDField(required=False, allow_null=True)
    start_time = serializers.TimeField(required=False, allow_null=True)
    end_time = serializers.TimeField(required=False, allow_null=True)
    source = serializers.ChoiceField(choices=['manual', 'imported', 'generated', 'override'], default='manual')
    status = serializers.ChoiceField(choices=['draft', 'published'], default='draft')

    def validate(self, data):
        team = data.get('team')
        practitioner = data.get('practitioner')
        if bool(team) == bool(practitioner):
            raise serializers.ValidationError(
                'Each bulk roster entry must include exactly one of team or practitioner.'
            )
        return data


class RosterBulkSerializer(serializers.Serializer):
    entries = RosterBulkEntrySerializer(many=True)


class RosterPublishSerializer(serializers.Serializer):
    date_from = serializers.DateField()
    date_to = serializers.DateField()

    def validate(self, data):
        if data['date_to'] < data['date_from']:
            raise serializers.ValidationError('date_to must be after date_from.')
        return data


class RosterOverrideSerializer(serializers.Serializer):
    replacement_team = serializers.UUIDField()
    reason = serializers.CharField(required=False, allow_blank=True, default='')


class RosterImportSerializer(serializers.Serializer):
    csv = serializers.CharField()


class OnDutyQuerySerializer(serializers.Serializer):
    at_datetime = serializers.DateTimeField(required=False)


# =============================================================================
# Roster Validation Rule Serializers
# =============================================================================


class RosterValidationRuleListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True, allow_null=True)
    rule_type_display = serializers.CharField(source='get_rule_type_display', read_only=True)
    severity_display = serializers.CharField(source='get_severity_display', read_only=True)

    class Meta:
        from .models import RosterValidationRule
        model = RosterValidationRule
        fields = [
            'id', 'name', 'description',
            'rule_type', 'rule_type_display',
            'duty_type', 'duty_type_name',
            'params',  # Include params for validation rules that need them (e.g., linked_duty_no_consecutive)
            'severity', 'severity_display',
            'is_active'
        ]


class RosterValidationRuleSerializer(serializers.ModelSerializer):
    """Full serializer for detail/create/update."""
    duty_type_name = serializers.CharField(source='duty_type.name', read_only=True, allow_null=True)
    rule_type_display = serializers.CharField(source='get_rule_type_display', read_only=True)

    class Meta:
        from .models import RosterValidationRule
        model = RosterValidationRule
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, data):
        from .models import VALIDATION_RULE_TEMPLATES

        rule_type = data.get('rule_type', getattr(self.instance, 'rule_type', None))
        params = data.get('params', getattr(self.instance, 'params', {}))

        # Validate rule_type exists in templates
        if rule_type and rule_type not in VALIDATION_RULE_TEMPLATES:
            raise serializers.ValidationError({
                'rule_type': f'Unknown rule type: {rule_type}'
            })

        # Validate params match expected schema
        if rule_type:
            template = VALIDATION_RULE_TEMPLATES.get(rule_type, {})
            expected_params = template.get('params', {})

            for param_name, param_schema in expected_params.items():
                value = params.get(param_name)
                param_type = param_schema.get('type')

                # Check required params have values (unless they have defaults)
                if value is None and 'default' not in param_schema:
                    # Use default if not provided
                    params[param_name] = param_schema.get('default')
                    continue

                # Type validation
                if value is not None:
                    if param_type == 'int' and not isinstance(value, int):
                        raise serializers.ValidationError({
                            'params': f'{param_name} must be an integer'
                        })
                    if param_type == 'day_pairs' and not isinstance(value, list):
                        raise serializers.ValidationError({
                            'params': f'{param_name} must be a list of day pairs'
                        })
                    if param_type == 'day_list' and not isinstance(value, list):
                        raise serializers.ValidationError({
                            'params': f'{param_name} must be a list of days'
                        })
                    if param_type == 'team_list' and not isinstance(value, list):
                        raise serializers.ValidationError({
                            'params': f'{param_name} must be a list of team IDs'
                        })

            data['params'] = params

        # Validate duty_type belongs to department
        duty_type = data.get('duty_type')
        department = data.get('department', getattr(self.instance, 'department', None))
        if duty_type and department and duty_type.department_id != department.id:
            raise serializers.ValidationError({
                'duty_type': 'Duty type must belong to the selected department.'
            })

        return data


class ValidationRuleTemplatesSerializer(serializers.Serializer):
    """Serializer for returning rule templates to frontend."""

    def to_representation(self, instance):
        from .models import VALIDATION_RULE_TEMPLATES
        return VALIDATION_RULE_TEMPLATES
