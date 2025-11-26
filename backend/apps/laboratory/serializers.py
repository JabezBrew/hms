from rest_framework import serializers
from django.utils import timezone
from .models import (
    LabTestCatalog, LabPanel, LabOrder, LabOrderTest,
    LabSpecimen, LabResult, LabOrderStatus, LabOrderPriority
)


class LabTestCatalogSerializer(serializers.ModelSerializer):
    """
    Serializer for lab test catalog with reference ranges.
    """
    category_display = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model = LabTestCatalog
        fields = [
            'id', 'code', 'loinc_code', 'name', 'short_name',
            'category', 'category_display', 'description',
            'specimen_type', 'container_type', 'volume_required',
            'special_instructions', 'reference_ranges', 'unit',
            'tat_hours', 'price', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'category_display']


class LabTestCatalogCreateSerializer(serializers.ModelSerializer):
    """
    Create serializer with validation for lab test catalog.
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
        """Ensure test code is unique."""
        if LabTestCatalog.objects.filter(code=value.upper()).exists():
            raise serializers.ValidationError("Test with this code already exists.")
        return value.upper()

    def validate_reference_ranges(self, value):
        """Validate reference ranges JSON structure."""
        if not isinstance(value, dict):
            raise serializers.ValidationError("Reference ranges must be a dictionary.")
        return value


class LabPanelSerializer(serializers.ModelSerializer):
    """
    Serializer for lab panels with nested test information.
    """
    tests = LabTestCatalogSerializer(many=True, read_only=True)
    test_ids = serializers.PrimaryKeyRelatedField(
        queryset=LabTestCatalog.objects.all(),
        many=True,
        write_only=True,
        source='tests'
    )
    test_count = serializers.SerializerMethodField()

    class Meta:
        model = LabPanel
        fields = [
            'id', 'code', 'name', 'description',
            'tests', 'test_ids', 'test_count',
            'price', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'test_count']

    def get_test_count(self, obj):
        """Return number of tests in panel."""
        return obj.tests.count()


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
            return obj.collected_by.staff.user.get_full_name()
        return None

    def get_received_by_name(self, obj):
        """Get name of person who received specimen."""
        if obj.received_by:
            return obj.received_by.staff.user.get_full_name()
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
            return obj.performed_by.staff.user.get_full_name()
        return None

    def get_verified_by_name(self, obj):
        """Get name of person who verified result."""
        if obj.verified_by:
            return obj.verified_by.staff.user.get_full_name()
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


class LabOrderSerializer(serializers.ModelSerializer):
    """
    Serializer for lab orders with nested tests, panels, and specimens.
    """
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
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
            'id', 'order_number', 'patient', 'patient_name', 'patient_mrn',
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
            'patient_name', 'patient_mrn', 'ordering_provider_name',
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

    class Meta:
        model = LabOrder
        fields = [
            'patient', 'encounter', 'ordering_provider',
            'test_ids', 'panel_ids',
            'priority', 'clinical_notes', 'fasting_required'
        ]

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
                        defaults={'status': LabOrderStatus.ORDERED}
                    )

        # Add individual tests
        if test_ids:
            for test in test_ids:
                LabOrderTest.objects.get_or_create(
                    order=order,
                    test=test,
                    defaults={'status': LabOrderStatus.ORDERED}
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
