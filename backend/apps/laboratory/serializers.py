from rest_framework import serializers
from django.utils import timezone
from .models import (
    LabTestCatalog, LabPanel, LabOrder, LabOrderTest,
    LabSpecimen, LabResult, LabOrderStatus, LabOrderPriority
)
from ..users.models import PractitionerProfile
from ..core.security import get_user_facility


class LabTestCatalogSerializer(serializers.ModelSerializer):
    """
    Serializer for lab test catalog with reference ranges.
    Includes facility customization tracking fields.
    """
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    can_reset = serializers.SerializerMethodField()

    class Meta:
        model = LabTestCatalog
        fields = [
            'id', 'facility', 'code', 'loinc_code', 'name', 'short_name',
            'category', 'category_display', 'description',
            'specimen_type', 'container_type', 'volume_required',
            'special_instructions', 'reference_ranges', 'unit',
            'tat_hours', 'price', 'is_active',
            'is_system_default', 'is_facility_modified', 'system_defaults',
            'can_reset', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'created_at', 'updated_at', 'category_display',
            'is_system_default', 'system_defaults', 'can_reset'
        ]

    def get_can_reset(self, obj):
        """Check if test can be reset to system defaults."""
        return obj.is_system_default and obj.is_facility_modified


class LabTestCatalogCreateSerializer(serializers.ModelSerializer):
    """
    Create serializer for custom facility tests.
    System tests are seeded via management command.
    """
    class Meta:
        model = LabTestCatalog
        fields = [
            'code', 'loinc_code', 'name', 'short_name', 'category',
            'description', 'specimen_type', 'container_type',
            'volume_required', 'special_instructions',
            'reference_ranges', 'unit', 'tat_hours', 'price', 'is_active'
        ]

    def validate_code(self, value):
        """Ensure test code is unique within the facility."""
        facility = None
        request = self.context.get('request')
        if request:
            facility = get_user_facility(request)
        if facility and LabTestCatalog.objects.filter(facility=facility, code=value.upper()).exists():
            raise serializers.ValidationError("Test with this code already exists in this facility.")
        return value.upper()

    def validate_reference_ranges(self, value):
        """Validate reference ranges JSON structure."""
        if not isinstance(value, dict):
            raise serializers.ValidationError("Reference ranges must be a dictionary.")
        return value

    def create(self, validated_data):
        """Create a custom facility test (not a system default)."""
        validated_data['is_system_default'] = False
        validated_data['is_facility_modified'] = False
        validated_data['system_defaults'] = {}
        return super().create(validated_data)


class LabTestFacilityCustomizeSerializer(serializers.Serializer):
    """
    Serializer for facility customization of lab tests.
    Allows updating price, reference_ranges, and tat_hours.
    """
    price = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        help_text="Facility-specific price"
    )
    reference_ranges = serializers.JSONField(
        required=False,
        help_text="Facility-specific reference ranges"
    )
    tat_hours = serializers.IntegerField(
        required=False,
        min_value=1,
        help_text="Facility-specific turnaround time in hours"
    )
    is_active = serializers.BooleanField(
        required=False,
        help_text="Enable or disable test for ordering"
    )

    def validate_reference_ranges(self, value):
        """Validate reference ranges JSON structure."""
        if value is not None and not isinstance(value, dict):
            raise serializers.ValidationError("Reference ranges must be a dictionary.")
        return value

    def validate(self, data):
        """Ensure at least one field is provided."""
        if not any(data.values()):
            raise serializers.ValidationError(
                "At least one customization field must be provided."
            )
        return data


class LabTestResetSerializer(serializers.Serializer):
    """
    Serializer for resetting a test to system defaults.
    """
    confirm = serializers.BooleanField(
        required=True,
        help_text="Confirm reset to system defaults"
    )

    def validate_confirm(self, value):
        if not value:
            raise serializers.ValidationError(
                "You must confirm the reset by setting confirm to true."
            )
        return value


class LabPanelSerializer(serializers.ModelSerializer):
    """
    Serializer for lab panels with nested test information.
    Includes facility customization tracking.
    """
    tests = LabTestCatalogSerializer(many=True, read_only=True)
    test_ids = serializers.PrimaryKeyRelatedField(
        queryset=LabTestCatalog.objects.all(),
        many=True,
        write_only=True,
        source='tests'
    )
    test_count = serializers.SerializerMethodField()
    can_reset = serializers.SerializerMethodField()

    class Meta:
        model = LabPanel
        fields = [
            'id', 'facility', 'code', 'name', 'description',
            'tests', 'test_ids', 'test_count',
            'price', 'is_active',
            'is_system_default', 'is_facility_modified', 'system_defaults', 'can_reset',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'created_at', 'updated_at', 'test_count',
            'is_system_default', 'system_defaults', 'can_reset'
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request:
            facility = get_user_facility(request)
            if facility and 'test_ids' in self.fields:
                self.fields['test_ids'].queryset = LabTestCatalog.objects.filter(facility=facility)

    def get_test_count(self, obj):
        """Return number of tests in panel."""
        return obj.tests.count()

    def get_can_reset(self, obj):
        """Check if panel can be reset to system defaults."""
        return obj.is_system_default and obj.is_facility_modified


class LabPanelFacilityCustomizeSerializer(serializers.Serializer):
    """
    Serializer for facility customization of lab panels.
    """
    price = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        help_text="Facility-specific panel price"
    )
    is_active = serializers.BooleanField(
        required=False,
        help_text="Enable or disable panel for ordering"
    )

    def validate(self, data):
        """Ensure at least one field is provided."""
        if not any(data.values()):
            raise serializers.ValidationError(
                "At least one customization field must be provided."
            )
        return data


class LabOrderTestSerializer(serializers.ModelSerializer):
    """
    Serializer for individual tests within an order.
    """
    test = LabTestCatalogSerializer(read_only=True)
    test_id = serializers.PrimaryKeyRelatedField(
        queryset=LabTestCatalog.objects.all(),
        write_only=True,
        source='test'
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request:
            facility = get_user_facility(request)
            if facility:
                self.fields['test_id'].queryset = LabTestCatalog.objects.filter(facility=facility)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = LabOrderTest
        fields = [
            'id', 'test', 'test_id', 'status', 'status_display', 'notes'
        ]
        read_only_fields = ['id', 'status_display']


class LabSpecimenSerializer(serializers.ModelSerializer):
    """
    Serializer for lab specimens.
    """
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    collected_by_name = serializers.SerializerMethodField()
    received_by_name = serializers.SerializerMethodField()
    order_number = serializers.CharField(source='order.order_number', read_only=True)

    class Meta:
        model = LabSpecimen
        fields = [
            'id', 'barcode', 'order', 'order_number',
            'specimen_type', 'container_type', 'volume_collected',
            'collected_by', 'collected_by_name', 'collection_site', 'collected_at',
            'status', 'status_display', 'is_rejected', 'rejection_reason',
            'received_by', 'received_by_name', 'received_at', 'storage_location',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'status_display',
            'collected_by_name', 'received_by_name', 'order_number'
        ]

    def get_collected_by_name(self, obj):
        """Get name of person who collected specimen."""
        if obj.collected_by:
            return obj.collected_by.user.get_full_name()
        return None

    def get_received_by_name(self, obj):
        """Get name of person who received specimen."""
        if obj.received_by:
            return obj.received_by.user.get_full_name()
        return None


class LabResultSerializer(serializers.ModelSerializer):
    """
    Serializer for lab results.
    """
    test_name = serializers.CharField(source='order_test.test.short_name', read_only=True)
    test_full_name = serializers.CharField(source='order_test.test.name', read_only=True)
    flag_display = serializers.CharField(source='get_flag_display', read_only=True)
    performed_by_name = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()
    order_number = serializers.CharField(source='order_test.order.order_number', read_only=True)
    patient_name = serializers.SerializerMethodField()

    class Meta:
        model = LabResult
        fields = [
            'id', 'order_test', 'specimen', 'order_number',
            'test_name', 'test_full_name', 'patient_name',
            'value', 'unit', 'reference_low', 'reference_high',
            'flag', 'flag_display', 'interpretation',
            'performed_by', 'performed_by_name', 'performed_at',
            'is_verified', 'verified_by', 'verified_by_name', 'verified_at',
            'fhir_id', 'fhir_synced',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'flag_display',
            'test_name', 'test_full_name', 'performed_by_name',
            'verified_by_name', 'order_number', 'patient_name'
        ]

    def get_performed_by_name(self, obj):
        """Get name of person who performed test."""
        if obj.performed_by:
            return obj.performed_by.user.get_full_name()
        return None

    def get_verified_by_name(self, obj):
        """Get name of person who verified result."""
        if obj.verified_by:
            return obj.verified_by.user.get_full_name()
        return None

    def get_patient_name(self, obj):
        """Get patient name."""
        return obj.order_test.order.patient.user.get_full_name()


class LabResultCreateSerializer(serializers.ModelSerializer):
    """
    Create serializer for lab results with validation.
    """
    class Meta:
        model = LabResult
        fields = [
            'order_test', 'specimen', 'value', 'unit',
            'reference_low', 'reference_high', 'flag',
            'interpretation', 'performed_at'
        ]

    def validate(self, data):
        """Validate result data."""
        # Ensure specimen belongs to order
        if data['specimen'].order != data['order_test'].order:
            raise serializers.ValidationError(
                "Specimen must belong to the same order as the test."
            )

        # Check if result already exists
        if LabResult.objects.filter(order_test=data['order_test']).exists():
            raise serializers.ValidationError(
                "Result already exists for this test."
            )

        return data


class LabResultVerifySerializer(serializers.Serializer):
    """
    Serializer for verifying lab results.
    """
    verification_notes = serializers.CharField(required=False, allow_blank=True)


class BulkLabResultItemSerializer(serializers.Serializer):
    """
    Serializer for individual result in bulk create.
    """
    order_test_id = serializers.UUIDField()
    value = serializers.CharField(max_length=100)
    unit = serializers.CharField(max_length=30, required=False, allow_blank=True)
    reference_low = serializers.DecimalField(
        max_digits=10, decimal_places=3, required=False, allow_null=True
    )
    reference_high = serializers.DecimalField(
        max_digits=10, decimal_places=3, required=False, allow_null=True
    )
    flag = serializers.ChoiceField(
        choices=LabResult.FLAG_CHOICES,
        default='normal'
    )
    interpretation = serializers.CharField(required=False, allow_blank=True)


class BulkLabResultCreateSerializer(serializers.Serializer):
    """
    Serializer for bulk creation of lab results.
    Allows recording multiple test results in a single request.
    """
    order_id = serializers.UUIDField()
    specimen_id = serializers.UUIDField()
    results = BulkLabResultItemSerializer(many=True)
    performed_at = serializers.DateTimeField(required=False)

    def validate_order_id(self, value):
        """Validate order exists and is in correct status."""
        from .models import LabOrder, LabOrderStatus
        try:
            order = LabOrder.objects.get(id=value)
        except LabOrder.DoesNotExist:
            raise serializers.ValidationError("Lab order not found.")

        if order.status not in [LabOrderStatus.RECEIVED, LabOrderStatus.PROCESSING]:
            raise serializers.ValidationError(
                f"Order must be in 'received' or 'processing' status to record results. "
                f"Current status: {order.get_status_display()}"
            )
        return value

    def validate_specimen_id(self, value):
        """Validate specimen exists."""
        from .models import LabSpecimen
        try:
            LabSpecimen.objects.get(id=value)
        except LabSpecimen.DoesNotExist:
            raise serializers.ValidationError("Specimen not found.")
        return value

    def validate(self, data):
        """Cross-field validation."""
        from .models import LabOrder, LabSpecimen, LabOrderTest, LabResult

        order = LabOrder.objects.get(id=data['order_id'])
        specimen = LabSpecimen.objects.get(id=data['specimen_id'])

        # Verify specimen belongs to the order
        if specimen.order_id != order.id:
            raise serializers.ValidationError({
                'specimen_id': "Specimen does not belong to this order."
            })

        # Validate each result item
        errors = []
        valid_order_test_ids = set(
            order.order_tests.values_list('id', flat=True)
        )
        existing_results = set(
            LabResult.objects.filter(
                order_test__order=order
            ).values_list('order_test_id', flat=True)
        )

        for idx, result_item in enumerate(data['results']):
            order_test_id = result_item['order_test_id']

            # Check if order_test belongs to this order
            if order_test_id not in valid_order_test_ids:
                errors.append({
                    'index': idx,
                    'order_test_id': "Test does not belong to this order."
                })
                continue

            # Check if result already exists
            if order_test_id in existing_results:
                errors.append({
                    'index': idx,
                    'order_test_id': "Result already exists for this test."
                })

        if errors:
            raise serializers.ValidationError({'results': errors})

        # Store validated objects for create
        data['_order'] = order
        data['_specimen'] = specimen

        return data


class LabOrderSerializer(serializers.ModelSerializer):
    """
    Serializer for lab orders with nested tests, panels, and specimens.
    """
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    patient_dob = serializers.DateField(source='patient.user.date_of_birth', read_only=True)
    patient_gender = serializers.CharField(source='patient.user.gender', read_only=True)
    patient_gender_display = serializers.CharField(source='patient.user.get_gender_display', read_only=True)
    ordering_provider_name = serializers.SerializerMethodField()
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    # Nested relationships
    order_tests = LabOrderTestSerializer(many=True, read_only=True)
    panels = LabPanelSerializer(many=True, read_only=True)
    specimens = LabSpecimenSerializer(many=True, read_only=True)

    # Result summary
    results_ready = serializers.SerializerMethodField()
    has_critical_results = serializers.SerializerMethodField()

    class Meta:
        model = LabOrder
        fields = [
            'id', 'order_number', 'patient', 'patient_name', 'patient_mrn', 'patient_dob',
            'patient_gender', 'patient_gender_display',
            'encounter', 'ordering_provider', 'ordering_provider_name',
            'order_tests', 'panels', 'specimens',
            'priority', 'priority_display', 'status', 'status_display',
            'clinical_notes', 'fasting_required',
            'ordered_at', 'collected_at', 'received_at', 'completed_at',
            'cancelled_at', 'cancellation_reason',
            'results_ready', 'has_critical_results',
            'fhir_id', 'fhir_synced',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'order_number', 'created_at', 'updated_at',
            'patient_name', 'patient_mrn', 'patient_dob', 'patient_gender', 'patient_gender_display',
            'ordering_provider_name',
            'priority_display', 'status_display', 'order_tests',
            'results_ready', 'has_critical_results'
        ]

    def get_ordering_provider_name(self, obj):
        """Get ordering provider full name."""
        return obj.ordering_provider.staff.user.get_full_name()

    def get_results_ready(self, obj):
        """Check if all results are ready and verified."""
        order_tests = obj.order_tests.all()
        if not order_tests:
            return False

        results = [ot.result for ot in order_tests if hasattr(ot, 'result')]
        if len(results) != order_tests.count():
            return False

        return all(r.is_verified for r in results)

    def get_has_critical_results(self, obj):
        """Check if any results are flagged as critical."""
        order_tests = obj.order_tests.all()
        for ot in order_tests:
            if hasattr(ot, 'result') and ot.result.is_critical():
                return True
        return False


class LabOrderCreateSerializer(serializers.ModelSerializer):
    """
    Create serializer for lab orders with validation.
    ordering_provider is optional - will be auto-set from current user in view's perform_create.
    """
    test_ids = serializers.PrimaryKeyRelatedField(
        queryset=LabTestCatalog.objects.filter(is_active=True),
        many=True,
        required=False,
        allow_empty=True
    )
    panel_ids = serializers.PrimaryKeyRelatedField(
        queryset=LabPanel.objects.filter(is_active=True),
        many=True,
        required=False,
        allow_empty=True
    )
    ordering_provider = serializers.PrimaryKeyRelatedField(
        queryset=PractitionerProfile.objects.all(),
        required=False,
        allow_null=True,
        help_text="Auto-set from current user if not provided"
    )

    class Meta:
        model = LabOrder
        fields = [
            'id', 'order_number',  # Include id and order_number in response
            'patient', 'encounter', 'ordering_provider',
            'test_ids', 'panel_ids',
            'priority', 'clinical_notes', 'fasting_required'
        ]
        read_only_fields = ['id', 'order_number']

    def validate(self, data):
        """Validate that at least one test or panel is selected."""
        test_ids = data.get('test_ids', [])
        panel_ids = data.get('panel_ids', [])

        if not test_ids and not panel_ids:
            raise serializers.ValidationError(
                "At least one test or panel must be selected."
            )

        return data

    def create(self, validated_data):
        """Create order and associate tests/panels."""
        test_ids = validated_data.pop('test_ids', [])
        panel_ids = validated_data.pop('panel_ids', [])

        # Create order
        order = LabOrder.objects.create(**validated_data)

        # Add panels
        if panel_ids:
            order.panels.set(panel_ids)
            # Add all tests from panels
            for panel in panel_ids:
                for test in panel.tests.all():
                    LabOrderTest.objects.get_or_create(
                        order=order,
                        test=test,
                        defaults={'status': LabOrderStatus.ORDERED, 'facility': order.facility}
                    )

        # Add individual tests
        if test_ids:
            for test in test_ids:
                LabOrderTest.objects.get_or_create(
                    order=order,
                    test=test,
                    defaults={'status': LabOrderStatus.ORDERED, 'facility': order.facility}
                )

        return order


class LabOrderSubmitSerializer(serializers.Serializer):
    """
    Serializer for submitting (ordering) a lab order.
    """
    pass  # No additional fields needed, just triggers status change


class LabOrderCancelSerializer(serializers.Serializer):
    """
    Serializer for cancelling a lab order.
    """
    cancellation_reason = serializers.CharField(
        required=True,
        min_length=10,
        help_text="Reason for cancelling order (minimum 10 characters)"
    )


class LabSpecimenCollectionSerializer(serializers.ModelSerializer):
    """
    Serializer for collecting a specimen.
    """
    class Meta:
        model = LabSpecimen
        fields = [
            'order', 'specimen_type', 'container_type',
            'volume_collected', 'collection_site', 'collected_at'
        ]


class LabSpecimenReceiptSerializer(serializers.Serializer):
    """
    Serializer for receiving a specimen in lab.
    """
    storage_location = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Storage location in lab"
    )
    is_rejected = serializers.BooleanField(
        default=False,
        help_text="Whether specimen is rejected"
    )
    rejection_reason = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Reason for rejection if applicable"
    )

    def validate(self, data):
        """Validate that rejection reason is provided if rejected."""
        if data.get('is_rejected') and not data.get('rejection_reason'):
            raise serializers.ValidationError(
                "Rejection reason is required when rejecting a specimen."
            )
        return data


class LabOrderSearchSerializer(serializers.Serializer):
    """
    Serializer for lab order search parameters.
    """
    patient_id = serializers.UUIDField(required=False)
    status = serializers.ChoiceField(
        choices=LabOrderStatus.choices,
        required=False
    )
    priority = serializers.ChoiceField(
        choices=LabOrderPriority.choices,
        required=False
    )
    date_from = serializers.DateTimeField(required=False)
    date_to = serializers.DateTimeField(required=False)
    has_critical_results = serializers.BooleanField(required=False)
    unverified_only = serializers.BooleanField(required=False)


# =============================================================================
# LIST SERIALIZERS - Lightweight serializers for list views
# These reduce payload sizes by 60-80% compared to full serializers
# =============================================================================

class LabTestCatalogListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for lab test catalog lists.
    Used by order forms and test selection dropdowns.
    Includes customization flags for admin views.

    Payload reduction: ~60% (includes key customization fields)
    """
    category_display = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model = LabTestCatalog
        fields = [
            'id', 'code', 'loinc_code', 'name', 'short_name',
            'category', 'category_display', 'specimen_type',
            'price', 'tat_hours', 'is_active',
            'is_system_default', 'is_facility_modified'
        ]


class LabPanelListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for lab panel lists.
    Returns test count instead of full nested test objects.
    Includes customization flags for admin views.

    Payload reduction: ~75% (includes customization fields)
    """
    test_count = serializers.SerializerMethodField()

    class Meta:
        model = LabPanel
        fields = [
            'id', 'code', 'name', 'description',
            'test_count', 'price', 'is_active',
            'is_system_default', 'is_facility_modified'
        ]

    def get_test_count(self, obj):
        return obj.tests.count()


class LabOrderListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for lab order lists.
    Removes nested order_tests, panels, specimens - uses counts instead.

    Supports expansion via context:
    - context={'expand_tests': True} includes full order_tests
    - context={'expand_specimens': True} includes full specimens

    Payload reduction: ~87% (~2KB vs ~15KB per item)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    patient_dob = serializers.DateField(source='patient.user.date_of_birth', read_only=True)
    patient_gender = serializers.CharField(source='patient.user.gender', read_only=True)
    patient_gender_display = serializers.CharField(source='patient.user.get_gender_display', read_only=True)
    ordering_provider_name = serializers.SerializerMethodField()
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    test_count = serializers.SerializerMethodField()
    has_critical_results = serializers.SerializerMethodField()

    # Optional expanded fields
    order_tests = serializers.SerializerMethodField()
    panels = serializers.SerializerMethodField()
    specimens = serializers.SerializerMethodField()

    class Meta:
        model = LabOrder
        fields = [
            'id', 'order_number', 'patient', 'patient_name', 'patient_mrn', 'patient_dob',
            'patient_gender', 'patient_gender_display',
            'ordering_provider_name', 'priority', 'priority_display',
            'status', 'status_display', 'test_count', 'has_critical_results',
            'fasting_required', 'ordered_at', 'created_at',
            'order_tests', 'panels', 'specimens', 'clinical_notes'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_ordering_provider_name(self, obj):
        if obj.ordering_provider and obj.ordering_provider.staff and obj.ordering_provider.staff.user:
            return obj.ordering_provider.staff.user.get_full_name()
        return None

    def get_test_count(self, obj):
        test_count = getattr(obj, 'test_count', None)
        if test_count is not None:
            return test_count
        return obj.order_tests.count()

    def get_has_critical_results(self, obj):
        has_critical_results = getattr(obj, 'has_critical_results', None)
        if has_critical_results is not None:
            return has_critical_results
        return obj.order_tests.filter(
            result__flag__in=['critical_low', 'critical_high']
        ).exists()

    def get_order_tests(self, obj):
        """Include order_tests if expand_tests is True in context."""
        if self.context.get('expand_tests', False):
            return LabOrderTestSerializer(obj.order_tests.all(), many=True).data
        return None

    def get_panels(self, obj):
        """Include panels if expand_tests is True in context."""
        if self.context.get('expand_tests', False):
            return LabPanelSerializer(obj.panels.all(), many=True).data
        return None

    def get_specimens(self, obj):
        """Include specimens if expand_specimens is True in context."""
        if self.context.get('expand_specimens', False):
            return LabSpecimenSerializer(obj.specimens.all(), many=True).data
        return None


class LabResultListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for lab result lists.
    Used for patient result history and dashboard views.
    """
    test_name = serializers.CharField(source='order_test.test.short_name', read_only=True)
    test_code = serializers.CharField(source='order_test.test.code', read_only=True)
    order_number = serializers.CharField(source='order_test.order.order_number', read_only=True)
    order_id = serializers.UUIDField(source='order_test.order.id', read_only=True)
    panel_name = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.SerializerMethodField()
    patient_id = serializers.SerializerMethodField()
    ordering_provider = serializers.SerializerMethodField()
    flag_display = serializers.CharField(source='get_flag_display', read_only=True)

    class Meta:
        model = LabResult
        fields = [
            'id', 'order_id', 'order_number', 'test_name', 'test_code',
            'panel_name', 'patient_name', 'patient_mrn', 'patient_id',
            'ordering_provider',
            'value', 'unit', 'reference_low', 'reference_high',
            'flag', 'flag_display', 'is_verified',
            'performed_at', 'verified_at'
        ]

    def get_panel_name(self, obj):
        """Get panel name(s) from the order's panels."""
        try:
            panels = obj.order_test.order.panels.all()
            if panels:
                # Return first panel name (most orders have one panel)
                return panels[0].name
            return None
        except AttributeError:
            return None

    def get_patient_name(self, obj):
        """Get patient full name from the order."""
        try:
            return obj.order_test.order.patient.user.get_full_name()
        except AttributeError:
            return None

    def get_patient_mrn(self, obj):
        """Get patient MRN from the order."""
        try:
            return obj.order_test.order.patient.medical_record_number
        except AttributeError:
            return None

    def get_patient_id(self, obj):
        """Get patient ID from the order."""
        try:
            return str(obj.order_test.order.patient.id)
        except AttributeError:
            return None

    def get_ordering_provider(self, obj):
        """Get ordering provider name from the order."""
        try:
            return obj.order_test.order.ordering_provider.get_full_name()
        except AttributeError:
            return None


class LabSpecimenListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for specimen lists.
    Used for specimen tracking and collection queues.

    Payload reduction: ~50% (10 fields vs 19 in full serializer)
    """
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    order_number = serializers.CharField(source='order.order_number', read_only=True)

    class Meta:
        model = LabSpecimen
        fields = [
            'id', 'barcode', 'order_number',
            'specimen_type', 'container_type',
            'status', 'status_display', 'is_rejected',
            'collected_at', 'received_at'
        ]
