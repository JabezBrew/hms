"""
Inventory Serializers for HMS.

Following the list/detail serializer pattern for API payload optimization.
"""
from rest_framework import serializers
from django.db.models import Sum, F
from .models import (
    InventoryCategory, Supplier, InventoryItem, StockMovement,
    ExpiryTracker, InventoryAudit, InventoryAuditItem,
    StorageLocation, LocationStock,
    # Phase 3: Procurement
    PurchaseRequisition, PurchaseRequisitionItem,
    PurchaseOrder, PurchaseOrderItem,
    GoodsReceivedNote, GoodsReceivedNoteItem,
    # Phase 4: Internal Logistics
    InternalRequisition, InternalRequisitionItem,
    StandingOrder, StandingOrderItem,
    StockTransferRequest, StockTransferItem,
    # Phase 5: Controlled Substances
    ControlledSubstanceRegister, ControlledSubstanceEntry,
    ControlledSubstanceDiscrepancy,
)
from ..users.serializers import UserSerializer
from ..core.security import get_user_facility


# =============================================================================
# Storage Location Serializers (Phase 1: Multi-Location)
# =============================================================================


class StorageLocationListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for storage location lists.
    """
    ward_name = serializers.CharField(source='ward.name', read_only=True, default=None)
    department_name = serializers.CharField(source='department.name', read_only=True, default=None)
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)

    class Meta:
        model = StorageLocation
        fields = [
            'id', 'code', 'name', 'location_type', 'building', 'floor',
            'ward_name', 'department_name', 'parent_name',
            'can_dispense_to_patients', 'allows_controlled_substances',
            'temperature_zone', 'is_active'
        ]


class StorageLocationSerializer(serializers.ModelSerializer):
    """
    Full serializer for storage location details.
    """
    ward_name = serializers.CharField(source='ward.name', read_only=True, default=None)
    department_name = serializers.CharField(source='department.name', read_only=True, default=None)
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)
    full_path = serializers.ReadOnlyField()

    class Meta:
        model = StorageLocation
        fields = [
            'id', 'facility', 'parent', 'parent_name', 'code', 'name',
            'location_type', 'building', 'floor', 'room',
            'ward', 'ward_name', 'department', 'department_name',
            'can_receive_external', 'can_dispense_to_patients',
            'allows_controlled_substances', 'temperature_zone',
            'is_active', 'full_path',
            'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = [
            'id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by'
        ]


# =============================================================================
# Location Stock Serializers
# =============================================================================


class LocationStockListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for location stock lists.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    location_code = serializers.CharField(source='location.code', read_only=True)
    available_quantity = serializers.ReadOnlyField()
    is_below_reorder = serializers.ReadOnlyField()

    class Meta:
        model = LocationStock
        fields = [
            'id', 'item', 'item_name', 'item_sku',
            'location', 'location_name', 'location_code',
            'quantity', 'reserved_quantity', 'available_quantity',
            'is_below_reorder', 'last_movement_at'
        ]


class LocationStockSerializer(serializers.ModelSerializer):
    """
    Full serializer for location stock details.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    item_unit = serializers.CharField(source='item.unit_of_measure', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    location_code = serializers.CharField(source='location.code', read_only=True)
    available_quantity = serializers.ReadOnlyField()
    effective_reorder_level = serializers.ReadOnlyField()
    is_below_reorder = serializers.ReadOnlyField()

    class Meta:
        model = LocationStock
        fields = [
            'id', 'item', 'item_name', 'item_sku', 'item_unit',
            'location', 'location_name', 'location_code',
            'quantity', 'reserved_quantity', 'available_quantity',
            'reorder_level', 'reorder_quantity', 'max_level',
            'effective_reorder_level', 'is_below_reorder',
            'last_counted_at', 'last_movement_at'
        ]
        read_only_fields = ['id', 'last_movement_at']


# =============================================================================
# Inventory Category Serializers
# =============================================================================


class InventoryCategoryListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for category lists.
    """
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)

    class Meta:
        model = InventoryCategory
        fields = ['id', 'name', 'parent', 'parent_name']


class InventoryCategorySerializer(serializers.ModelSerializer):
    """
    Full serializer for the InventoryCategory model.
    """
    parent_name = serializers.ReadOnlyField(source='parent.name')

    class Meta:
        model = InventoryCategory
        fields = ['id', 'facility', 'name', 'description', 'parent', 'parent_name',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']


# =============================================================================
# Supplier Serializers
# =============================================================================


class SupplierListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for supplier lists.
    """
    class Meta:
        model = Supplier
        fields = ['id', 'name', 'contact_person', 'phone', 'email', 'is_active']


class SupplierSerializer(serializers.ModelSerializer):
    """
    Full serializer for the Supplier model.
    """
    class Meta:
        model = Supplier
        fields = ['id', 'facility', 'name', 'contact_person', 'email', 'phone', 'address',
                  'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']


# =============================================================================
# Inventory Item Serializers
# =============================================================================


class InventoryItemListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for inventory item lists.
    Max 8 fields as per guidelines.
    """
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)
    total_stock = serializers.ReadOnlyField()
    is_low_stock = serializers.ReadOnlyField()

    class Meta:
        model = InventoryItem
        fields = [
            'id', 'name', 'sku', 'item_type', 'category_name',
            'total_stock', 'unit_of_measure', 'is_low_stock'
        ]


class InventoryItemSerializer(serializers.ModelSerializer):
    """
    Full serializer for the InventoryItem model.
    """
    category_name = serializers.ReadOnlyField(source='category.name')
    supplier_name = serializers.ReadOnlyField(source='supplier.name')
    stock_value = serializers.ReadOnlyField()
    is_low_stock = serializers.ReadOnlyField()
    total_stock = serializers.ReadOnlyField()
    total_available_stock = serializers.ReadOnlyField()
    billing_service_code = serializers.CharField(source='billing_service.code', read_only=True, default=None)
    billing_service_name = serializers.CharField(source='billing_service.name', read_only=True, default=None)

    class Meta:
        model = InventoryItem
        fields = [
            'id', 'name', 'description', 'category', 'category_name',
            'sku', 'barcode', 'item_type', 'inventory_class',
            'is_controlled_substance', 'controlled_schedule',
            'unit_of_measure', 'minimum_stock', 'reorder_level', 'reorder_quantity',
            'current_stock', 'total_stock', 'total_available_stock',
            'unit_cost', 'selling_price', 'billing_service', 'billing_service_code', 'billing_service_name',
            'supplier', 'supplier_name',
            'lead_time_days', 'is_active', 'fhir_medication_id',
            'stock_value', 'is_low_stock',
            'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = [
            'id', 'current_stock', 'total_stock', 'total_available_stock',
            'created_at', 'updated_at', 'created_by', 'updated_by'
        ]

    def validate_billing_service(self, value):
        if value is None:
            return value
        request = self.context.get('request')
        facility = get_user_facility(request) if request else None
        if facility and getattr(value, 'facility_id', None) != facility.id:
            raise serializers.ValidationError("billing_service must belong to the active facility.")
        return value


# =============================================================================
# Stock Movement Serializers
# =============================================================================


class StockMovementListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for stock movement lists.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    source_location_name = serializers.CharField(
        source='source_location.name', read_only=True, default=None
    )
    destination_location_name = serializers.CharField(
        source='destination_location.name', read_only=True, default=None
    )

    class Meta:
        model = StockMovement
        fields = [
            'id', 'item_name', 'movement_type', 'quantity',
            'source_location_name', 'destination_location_name',
            'reference_number', 'timestamp'
        ]


class StockMovementSerializer(serializers.ModelSerializer):
    """
    Full serializer for the StockMovement model.
    """
    item_name = serializers.ReadOnlyField(source='item.name')
    source_location_name = serializers.CharField(
        source='source_location.name', read_only=True, default=None
    )
    destination_location_name = serializers.CharField(
        source='destination_location.name', read_only=True, default=None
    )
    created_by_details = UserSerializer(source='created_by', read_only=True)
    patient_name = serializers.SerializerMethodField()

    class Meta:
        model = StockMovement
        fields = [
            'id', 'item', 'item_name', 'facility', 'movement_type',
            'source_location', 'source_location_name',
            'destination_location', 'destination_location_name',
            'quantity', 'previous_stock', 'new_stock',
            'reference_number', 'reference_type', 'reference_id', 'notes',
            'batch_number', 'expiry_date', 'expiry_tracker',
            'unit_cost', 'total_cost',
            'patient', 'patient_name',
            'timestamp', 'created_by', 'created_by_details'
        ]
        read_only_fields = [
            'id', 'previous_stock', 'new_stock', 'total_cost',
            'timestamp', 'created_by'
        ]

    def get_patient_name(self, obj):
        if obj.patient:
            return obj.patient.user.get_full_name()
        return None


# =============================================================================
# Expiry Tracker Serializers
# =============================================================================


class ExpiryTrackerListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for expiry tracker lists.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    location_name = serializers.CharField(
        source='location.name', read_only=True, default=None
    )
    days_until_expiry = serializers.ReadOnlyField()
    is_expired = serializers.ReadOnlyField()

    class Meta:
        model = ExpiryTracker
        fields = [
            'id', 'item_name', 'batch_number', 'expiry_date',
            'remaining_quantity', 'location_name',
            'days_until_expiry', 'is_expired', 'status'
        ]


class ExpiryTrackerSerializer(serializers.ModelSerializer):
    """
    Full serializer for the ExpiryTracker model.
    """
    item_name = serializers.ReadOnlyField(source='item.name')
    item_sku = serializers.ReadOnlyField(source='item.sku')
    location_name = serializers.CharField(
        source='location.name', read_only=True, default=None
    )
    location_code = serializers.CharField(
        source='location.code', read_only=True, default=None
    )
    is_expired = serializers.ReadOnlyField()
    days_until_expiry = serializers.ReadOnlyField()
    value_at_risk = serializers.ReadOnlyField()

    class Meta:
        model = ExpiryTracker
        fields = [
            'id', 'item', 'item_name', 'item_sku',
            'batch_number', 'expiry_date', 'manufacturing_date', 'manufacturer',
            'location', 'location_name', 'location_code',
            'initial_quantity', 'remaining_quantity', 'movement', 'status',
            'is_expired', 'days_until_expiry', 'value_at_risk',
            'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


# =============================================================================
# Inventory Audit Serializers
# =============================================================================


class InventoryAuditItemSerializer(serializers.ModelSerializer):
    """
    Serializer for the InventoryAuditItem model.
    """
    item_name = serializers.ReadOnlyField(source='item.name')

    class Meta:
        model = InventoryAuditItem
        fields = ['id', 'audit', 'item', 'item_name', 'expected_quantity',
                  'actual_quantity', 'discrepancy', 'notes',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'discrepancy', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InventoryAuditListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for audit lists.
    """
    items_count = serializers.SerializerMethodField()
    discrepancies_count = serializers.SerializerMethodField()

    class Meta:
        model = InventoryAudit
        fields = ['id', 'audit_date', 'status', 'items_count', 'discrepancies_count']

    def get_items_count(self, obj):
        return obj.items.count()

    def get_discrepancies_count(self, obj):
        return obj.items.exclude(discrepancy=0).count()


class InventoryAuditSerializer(serializers.ModelSerializer):
    """
    Full serializer for the InventoryAudit model.
    """
    items = InventoryAuditItemSerializer(many=True, read_only=True)
    created_by_details = UserSerializer(source='created_by', read_only=True)

    class Meta:
        model = InventoryAudit
        fields = ['id', 'audit_date', 'notes', 'status', 'items',
                  'created_at', 'updated_at', 'created_by', 'created_by_details', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InventoryAuditCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating a new InventoryAudit with items.
    """
    items = InventoryAuditItemSerializer(many=True)

    class Meta:
        model = InventoryAudit
        fields = ['id', 'audit_date', 'notes', 'status', 'items']
        read_only_fields = ['id']

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        audit = InventoryAudit.objects.create(**validated_data)

        for item_data in items_data:
            InventoryAuditItem.objects.create(
                audit=audit,
                created_by=validated_data.get('created_by'),
                updated_by=validated_data.get('updated_by'),
                **item_data
            )

        return audit

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)

        # Update audit fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if items_data is not None:
            # Delete existing items
            instance.items.all().delete()

            # Create new items
            for item_data in items_data:
                InventoryAuditItem.objects.create(
                    audit=instance,
                    created_by=validated_data.get('updated_by'),
                    updated_by=validated_data.get('updated_by'),
                    **item_data
                )

        return instance


# =============================================================================
# Transfer Serializers
# =============================================================================


class SimpleStockTransferSerializer(serializers.Serializer):
    """
    Simple serializer for stock transfer (inline transfer endpoint).
    Used by StockTransferViewSet for quick transfers without approval workflow.
    """
    item = serializers.UUIDField()
    from_location = serializers.UUIDField()
    to_location = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1)
    batch_id = serializers.UUIDField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        if data['from_location'] == data['to_location']:
            raise serializers.ValidationError(
                "Source and destination locations must be different"
            )
        return data


class StockAvailabilitySerializer(serializers.Serializer):
    """
    Serializer for stock availability check responses.
    """
    available = serializers.BooleanField()
    quantity_at_location = serializers.IntegerField()
    available_quantity = serializers.IntegerField()
    shortfall = serializers.IntegerField()
    alternative_locations = serializers.ListField(
        child=serializers.DictField()
    )


class BatchRecommendationSerializer(serializers.Serializer):
    """
    Serializer for batch recommendations.
    """
    batch_id = serializers.UUIDField()
    batch_number = serializers.CharField()
    expiry_date = serializers.DateField()
    quantity = serializers.IntegerField()
    days_until_expiry = serializers.IntegerField()


# =============================================================================
# Purchase Requisition Serializers (Phase 3: Procurement)
# =============================================================================


class PurchaseRequisitionItemSerializer(serializers.ModelSerializer):
    """
    Serializer for requisition line items.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    supplier_name = serializers.CharField(source='preferred_supplier.name', read_only=True, default=None)
    estimated_cost = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseRequisitionItem
        fields = [
            'id', 'item', 'item_name', 'item_sku',
            'quantity_requested', 'quantity_approved',
            'current_stock_at_request', 'reorder_level',
            'preferred_supplier', 'supplier_name',
            'estimated_cost', 'notes'
        ]
        read_only_fields = ['id']

    def get_estimated_cost(self, obj):
        qty = obj.quantity_approved or obj.quantity_requested
        return str(qty * obj.item.unit_cost)


class PurchaseRequisitionListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for requisition lists.
    """
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    requesting_location_name = serializers.CharField(
        source='requesting_location.name', read_only=True, default=None
    )
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseRequisition
        fields = [
            'id', 'requisition_number', 'status', 'priority',
            'requested_by_name', 'requesting_location_name',
            'date_required', 'items_count', 'is_auto_generated',
            'created_at'
        ]

    def get_items_count(self, obj):
        return obj.items.count()


class PurchaseRequisitionSerializer(serializers.ModelSerializer):
    """
    Full serializer for requisition details.
    """
    items = PurchaseRequisitionItemSerializer(many=True, read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    approved_by_name = serializers.CharField(
        source='approved_by.get_full_name', read_only=True, default=None
    )
    requesting_location_name = serializers.CharField(
        source='requesting_location.name', read_only=True, default=None
    )
    total_estimated_cost = serializers.ReadOnlyField()

    class Meta:
        model = PurchaseRequisition
        fields = [
            'id', 'facility', 'requisition_number',
            'requested_by', 'requested_by_name',
            'requesting_location', 'requesting_location_name',
            'requesting_department',
            'date_required', 'priority', 'status',
            'approved_by', 'approved_by_name', 'approved_at',
            'rejection_reason', 'justification', 'notes',
            'is_auto_generated', 'items', 'total_estimated_cost',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'requisition_number',
            'requested_by', 'approved_by', 'approved_at', 'created_at', 'updated_at'
        ]


class PurchaseRequisitionCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating requisitions with items.
    """
    items = PurchaseRequisitionItemSerializer(many=True)

    class Meta:
        model = PurchaseRequisition
        fields = [
            'requesting_location', 'requesting_department',
            'date_required', 'priority', 'justification', 'notes', 'items'
        ]

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        requisition = PurchaseRequisition.objects.create(**validated_data)

        for item_data in items_data:
            PurchaseRequisitionItem.objects.create(
                requisition=requisition,
                **item_data
            )

        return requisition


# =============================================================================
# Purchase Order Serializers
# =============================================================================


class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    """
    Serializer for PO line items.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    line_total = serializers.ReadOnlyField()
    quantity_pending = serializers.ReadOnlyField()

    class Meta:
        model = PurchaseOrderItem
        fields = [
            'id', 'item', 'item_name', 'item_sku',
            'requisition_item',
            'quantity_ordered', 'quantity_received', 'quantity_pending',
            'unit_price', 'discount_percent', 'tax_rate', 'line_total'
        ]
        read_only_fields = ['id', 'quantity_received']


class PurchaseOrderListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for PO lists.
    """
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            'id', 'po_number', 'supplier_name', 'status',
            'total_amount', 'currency', 'expected_delivery_date',
            'created_by_name', 'items_count', 'created_at'
        ]

    def get_items_count(self, obj):
        return obj.items.count()


class PurchaseOrderSerializer(serializers.ModelSerializer):
    """
    Full serializer for PO details.
    """
    items = PurchaseOrderItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    requisition_number = serializers.CharField(
        source='requisition.requisition_number', read_only=True, default=None
    )
    delivery_location_name = serializers.CharField(
        source='delivery_location.name', read_only=True
    )
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    approved_by_name = serializers.CharField(
        source='approved_by.get_full_name', read_only=True, default=None
    )

    class Meta:
        model = PurchaseOrder
        fields = [
            'id', 'facility', 'po_number', 'requisition', 'requisition_number',
            'supplier', 'supplier_name', 'supplier_quote_reference',
            'delivery_location', 'delivery_location_name', 'expected_delivery_date',
            'status', 'subtotal', 'tax_amount', 'discount_amount',
            'total_amount', 'currency', 'payment_terms',
            'created_by', 'created_by_name',
            'approved_by', 'approved_by_name', 'approved_at', 'sent_at',
            'notes', 'internal_notes', 'items',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'po_number', 'created_by',
            'approved_by', 'approved_at', 'sent_at',
            'created_at', 'updated_at'
        ]


class PurchaseOrderCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating POs with items.
    """
    items = PurchaseOrderItemSerializer(many=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            'requisition', 'supplier', 'supplier_quote_reference',
            'delivery_location', 'expected_delivery_date',
            'tax_amount', 'discount_amount', 'payment_terms',
            'notes', 'internal_notes', 'items'
        ]

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        po = PurchaseOrder.objects.create(**validated_data)

        subtotal = 0
        for item_data in items_data:
            poi = PurchaseOrderItem.objects.create(purchase_order=po, **item_data)
            subtotal += poi.line_total

        po.subtotal = subtotal
        po.total_amount = subtotal + po.tax_amount - po.discount_amount
        po.save()

        return po


# =============================================================================
# Goods Received Note Serializers
# =============================================================================


class GoodsReceivedNoteItemSerializer(serializers.ModelSerializer):
    """
    Serializer for GRN line items.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    storage_location_name = serializers.CharField(
        source='storage_location.name', read_only=True, default=None
    )

    class Meta:
        model = GoodsReceivedNoteItem
        fields = [
            'id', 'po_item', 'item', 'item_name', 'item_sku',
            'quantity_received', 'quantity_accepted', 'quantity_rejected',
            'rejection_reason', 'batch_number', 'expiry_date', 'manufacturing_date',
            'storage_location', 'storage_location_name', 'expiry_tracker'
        ]
        read_only_fields = ['id', 'expiry_tracker']


class GoodsReceivedNoteListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for GRN lists.
    """
    po_number = serializers.CharField(source='purchase_order.po_number', read_only=True)
    supplier_name = serializers.CharField(
        source='purchase_order.supplier.name', read_only=True
    )
    received_by_name = serializers.CharField(source='received_by.get_full_name', read_only=True)
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = GoodsReceivedNote
        fields = [
            'id', 'grn_number', 'po_number', 'supplier_name', 'status',
            'received_by_name', 'received_at', 'has_quality_issues', 'items_count'
        ]

    def get_items_count(self, obj):
        return obj.items.count()


class GoodsReceivedNoteSerializer(serializers.ModelSerializer):
    """
    Full serializer for GRN details.
    """
    items = GoodsReceivedNoteItemSerializer(many=True, read_only=True)
    po_number = serializers.CharField(source='purchase_order.po_number', read_only=True)
    supplier_name = serializers.CharField(
        source='purchase_order.supplier.name', read_only=True
    )
    received_by_name = serializers.CharField(source='received_by.get_full_name', read_only=True)
    inspected_by_name = serializers.CharField(
        source='inspected_by.get_full_name', read_only=True, default=None
    )
    receiving_location_name = serializers.CharField(
        source='receiving_location.name', read_only=True
    )

    class Meta:
        model = GoodsReceivedNote
        fields = [
            'id', 'facility', 'grn_number',
            'purchase_order', 'po_number', 'supplier_name',
            'received_at', 'received_by', 'received_by_name',
            'receiving_location', 'receiving_location_name',
            'supplier_delivery_note', 'supplier_invoice_number',
            'status', 'inspected_by', 'inspected_by_name', 'inspected_at',
            'inspection_notes', 'has_quality_issues', 'quality_issue_notes',
            'notes', 'items',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'grn_number', 'received_by',
            'inspected_by', 'inspected_at', 'created_at', 'updated_at'
        ]


class GoodsReceivedNoteCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating GRNs with items.
    """
    items = GoodsReceivedNoteItemSerializer(many=True)

    class Meta:
        model = GoodsReceivedNote
        fields = [
            'purchase_order', 'receiving_location',
            'supplier_delivery_note', 'supplier_invoice_number',
            'notes', 'items'
        ]

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        grn = GoodsReceivedNote.objects.create(**validated_data)

        for item_data in items_data:
            GoodsReceivedNoteItem.objects.create(grn=grn, **item_data)

        return grn


# =============================================================================
# Internal Requisition Serializers (Phase 4: Internal Logistics)
# =============================================================================


class InternalRequisitionItemSerializer(serializers.ModelSerializer):
    """
    Serializer for internal requisition line items.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    batch_number = serializers.CharField(source='batch_used.batch_number', read_only=True, default=None)
    quantity_pending = serializers.ReadOnlyField()

    class Meta:
        model = InternalRequisitionItem
        fields = [
            'id', 'item', 'item_name', 'item_sku',
            'quantity_requested', 'quantity_approved', 'quantity_issued',
            'quantity_pending', 'batch_used', 'batch_number', 'notes'
        ]
        read_only_fields = ['id', 'quantity_issued', 'batch_used']


class InternalRequisitionListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for internal requisition lists.
    """
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    requesting_location_name = serializers.CharField(
        source='requesting_location.name', read_only=True
    )
    fulfilling_location_name = serializers.CharField(
        source='fulfilling_location.name', read_only=True
    )
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = InternalRequisition
        fields = [
            'id', 'requisition_number', 'status', 'priority',
            'requested_by_name', 'requesting_location_name', 'fulfilling_location_name',
            'date_required', 'items_count', 'created_at'
        ]

    def get_items_count(self, obj):
        return obj.items.count()


class InternalRequisitionSerializer(serializers.ModelSerializer):
    """
    Full serializer for internal requisition details.
    """
    items = InternalRequisitionItemSerializer(many=True, read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    approved_by_name = serializers.CharField(
        source='approved_by.get_full_name', read_only=True, default=None
    )
    fulfilled_by_name = serializers.CharField(
        source='fulfilled_by.get_full_name', read_only=True, default=None
    )
    requesting_location_name = serializers.CharField(
        source='requesting_location.name', read_only=True
    )
    fulfilling_location_name = serializers.CharField(
        source='fulfilling_location.name', read_only=True
    )
    standing_order_name = serializers.CharField(
        source='standing_order.name', read_only=True, default=None
    )
    is_fully_fulfilled = serializers.ReadOnlyField()

    class Meta:
        model = InternalRequisition
        fields = [
            'id', 'facility', 'requisition_number',
            'requesting_location', 'requesting_location_name',
            'fulfilling_location', 'fulfilling_location_name',
            'requested_by', 'requested_by_name',
            'date_required', 'priority', 'status',
            'approved_by', 'approved_by_name', 'approved_at',
            'rejection_reason',
            'fulfilled_by', 'fulfilled_by_name', 'fulfilled_at',
            'standing_order', 'standing_order_name',
            'justification', 'notes', 'items', 'is_fully_fulfilled',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'requisition_number',
            'requested_by', 'approved_by', 'approved_at',
            'fulfilled_by', 'fulfilled_at', 'created_at', 'updated_at'
        ]


class InternalRequisitionCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating internal requisitions with items.
    """
    items = InternalRequisitionItemSerializer(many=True)

    class Meta:
        model = InternalRequisition
        fields = [
            'requesting_location', 'fulfilling_location',
            'date_required', 'priority', 'justification', 'notes', 'items'
        ]

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        requisition = InternalRequisition.objects.create(**validated_data)

        for item_data in items_data:
            InternalRequisitionItem.objects.create(
                requisition=requisition,
                **item_data
            )

        return requisition


# =============================================================================
# Standing Order Serializers
# =============================================================================


class StandingOrderItemSerializer(serializers.ModelSerializer):
    """
    Serializer for standing order line items.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)

    class Meta:
        model = StandingOrderItem
        fields = ['id', 'item', 'item_name', 'item_sku', 'quantity']
        read_only_fields = ['id']


class StandingOrderListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for standing order lists.
    """
    requesting_location_name = serializers.CharField(
        source='requesting_location.name', read_only=True
    )
    fulfilling_location_name = serializers.CharField(
        source='fulfilling_location.name', read_only=True
    )
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = StandingOrder
        fields = [
            'id', 'name', 'frequency', 'is_active',
            'requesting_location_name', 'fulfilling_location_name',
            'next_due', 'items_count'
        ]

    def get_items_count(self, obj):
        return obj.items.count()


class StandingOrderSerializer(serializers.ModelSerializer):
    """
    Full serializer for standing order details.
    """
    items = StandingOrderItemSerializer(many=True, read_only=True)
    requesting_location_name = serializers.CharField(
        source='requesting_location.name', read_only=True
    )
    fulfilling_location_name = serializers.CharField(
        source='fulfilling_location.name', read_only=True
    )
    created_by_name = serializers.CharField(
        source='created_by.get_full_name', read_only=True, default=None
    )

    class Meta:
        model = StandingOrder
        fields = [
            'id', 'facility', 'name',
            'requesting_location', 'requesting_location_name',
            'fulfilling_location', 'fulfilling_location_name',
            'frequency', 'day_of_week', 'day_of_month',
            'is_active', 'last_generated', 'next_due',
            'created_by', 'created_by_name', 'notes', 'items',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'last_generated', 'created_by',
            'created_at', 'updated_at'
        ]


class StandingOrderCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating standing orders with items.
    """
    items = StandingOrderItemSerializer(many=True)

    class Meta:
        model = StandingOrder
        fields = [
            'name', 'requesting_location', 'fulfilling_location',
            'frequency', 'day_of_week', 'day_of_month',
            'is_active', 'notes', 'items'
        ]

    def validate(self, data):
        frequency = data.get('frequency')
        if frequency == 'weekly' and data.get('day_of_week') is None:
            raise serializers.ValidationError(
                {'day_of_week': 'Day of week is required for weekly frequency'}
            )
        if frequency == 'monthly' and data.get('day_of_month') is None:
            raise serializers.ValidationError(
                {'day_of_month': 'Day of month is required for monthly frequency'}
            )
        return data

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        standing_order = StandingOrder.objects.create(**validated_data)

        # Calculate initial next_due
        standing_order.next_due = standing_order.calculate_next_due()
        standing_order.save()

        for item_data in items_data:
            StandingOrderItem.objects.create(
                standing_order=standing_order,
                **item_data
            )

        return standing_order


# =============================================================================
# Stock Transfer Request Serializers
# =============================================================================


class StockTransferItemSerializer(serializers.ModelSerializer):
    """
    Serializer for stock transfer line items.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    batch_number = serializers.CharField(source='batch.batch_number', read_only=True, default=None)
    quantity_pending_dispatch = serializers.ReadOnlyField()
    quantity_pending_receipt = serializers.ReadOnlyField()

    class Meta:
        model = StockTransferItem
        fields = [
            'id', 'item', 'item_name', 'item_sku',
            'batch', 'batch_number',
            'quantity_requested', 'quantity_dispatched', 'quantity_received',
            'quantity_pending_dispatch', 'quantity_pending_receipt',
            'dispatch_movement', 'receipt_movement', 'notes'
        ]
        read_only_fields = [
            'id', 'quantity_dispatched', 'quantity_received',
            'dispatch_movement', 'receipt_movement'
        ]


class StockTransferRequestListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for stock transfer request lists.
    """
    from_location_name = serializers.CharField(source='from_location.name', read_only=True)
    to_location_name = serializers.CharField(source='to_location.name', read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = StockTransferRequest
        fields = [
            'id', 'transfer_number', 'status',
            'from_location_name', 'to_location_name',
            'requested_by_name', 'items_count',
            'requires_approval', 'created_at'
        ]

    def get_items_count(self, obj):
        return obj.items.count()


class StockTransferRequestSerializer(serializers.ModelSerializer):
    """
    Full serializer for stock transfer request details.
    """
    items = StockTransferItemSerializer(many=True, read_only=True)
    from_location_name = serializers.CharField(source='from_location.name', read_only=True)
    to_location_name = serializers.CharField(source='to_location.name', read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    approved_by_name = serializers.CharField(
        source='approved_by.get_full_name', read_only=True, default=None
    )
    dispatched_by_name = serializers.CharField(
        source='dispatched_by.get_full_name', read_only=True, default=None
    )
    received_by_name = serializers.CharField(
        source='received_by.get_full_name', read_only=True, default=None
    )

    class Meta:
        model = StockTransferRequest
        fields = [
            'id', 'facility', 'transfer_number',
            'from_location', 'from_location_name',
            'to_location', 'to_location_name',
            'requested_by', 'requested_by_name', 'status',
            'requires_approval',
            'approved_by', 'approved_by_name', 'approved_at',
            'dispatched_at', 'dispatched_by', 'dispatched_by_name',
            'received_at', 'received_by', 'received_by_name',
            'reason', 'notes', 'items',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'transfer_number', 'requested_by',
            'approved_by', 'approved_at',
            'dispatched_at', 'dispatched_by',
            'received_at', 'received_by',
            'created_at', 'updated_at'
        ]


class StockTransferRequestCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating stock transfer requests with items.
    """
    items = StockTransferItemSerializer(many=True)

    class Meta:
        model = StockTransferRequest
        fields = [
            'from_location', 'to_location',
            'requires_approval', 'reason', 'notes', 'items'
        ]

    def validate(self, data):
        if data['from_location'] == data['to_location']:
            raise serializers.ValidationError(
                {'to_location': 'Source and destination locations must be different'}
            )
        return data

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        transfer = StockTransferRequest.objects.create(**validated_data)

        for item_data in items_data:
            StockTransferItem.objects.create(
                transfer=transfer,
                **item_data
            )

        return transfer


# =============================================================================
# Controlled Substance Serializers (Phase 5)
# =============================================================================


class ControlledSubstanceRegisterListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for controlled substance register lists.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    location_code = serializers.CharField(source='location.code', read_only=True)

    class Meta:
        model = ControlledSubstanceRegister
        fields = [
            'id', 'item', 'item_name', 'item_sku',
            'location', 'location_name', 'location_code',
            'running_balance', 'last_entry_at', 'last_audit_at', 'is_active'
        ]


class ControlledSubstanceRegisterSerializer(serializers.ModelSerializer):
    """
    Full serializer for controlled substance register details.
    """
    item_name = serializers.CharField(source='item.name', read_only=True)
    item_sku = serializers.CharField(source='item.sku', read_only=True)
    controlled_schedule = serializers.CharField(source='item.controlled_schedule', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    location_code = serializers.CharField(source='location.code', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True, default=None)

    class Meta:
        model = ControlledSubstanceRegister
        fields = [
            'id', 'facility', 'item', 'item_name', 'item_sku', 'controlled_schedule',
            'location', 'location_name', 'location_code',
            'running_balance', 'last_entry_at', 'last_audit_at', 'is_active',
            'created_at', 'updated_at', 'created_by', 'created_by_name'
        ]
        read_only_fields = [
            'id', 'facility', 'running_balance', 'last_entry_at', 'last_audit_at',
            'created_at', 'updated_at', 'created_by'
        ]


class ControlledSubstanceEntrySerializer(serializers.ModelSerializer):
    """
    Full serializer for controlled substance entry details.
    """
    item_name = serializers.CharField(source='register.item.name', read_only=True)
    location_name = serializers.CharField(source='register.location.name', read_only=True)
    batch_number = serializers.CharField(source='batch.batch_number', read_only=True, default=None)
    patient_name = serializers.SerializerMethodField()
    performed_by_name = serializers.CharField(source='performed_by.get_full_name', read_only=True)
    witness_name = serializers.CharField(source='witness.get_full_name', read_only=True)

    class Meta:
        model = ControlledSubstanceEntry
        fields = [
            'id', 'register', 'item_name', 'location_name',
            'entry_type', 'entry_number',
            'quantity', 'balance_before', 'balance_after',
            'batch', 'batch_number',
            'patient', 'patient_name', 'prescription',
            'performed_by', 'performed_by_name',
            'witness', 'witness_name',
            'wastage_reason', 'wastage_amount',
            'stock_movement', 'notes', 'timestamp'
        ]
        read_only_fields = [
            'id', 'entry_number', 'balance_before', 'balance_after',
            'stock_movement', 'timestamp'
        ]

    def get_patient_name(self, obj):
        if obj.patient:
            return obj.patient.user.get_full_name()
        return None


class ControlledSubstanceEntryListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for entry lists.
    """
    performed_by_name = serializers.CharField(source='performed_by.get_full_name', read_only=True)
    witness_name = serializers.CharField(source='witness.get_full_name', read_only=True)
    patient_name = serializers.SerializerMethodField()

    class Meta:
        model = ControlledSubstanceEntry
        fields = [
            'id', 'entry_type', 'entry_number',
            'quantity', 'balance_after',
            'performed_by_name', 'witness_name', 'patient_name',
            'timestamp'
        ]

    def get_patient_name(self, obj):
        if obj.patient:
            return obj.patient.user.get_full_name()
        return None


class ControlledSubstanceDispenseSerializer(serializers.Serializer):
    """
    Serializer for dispensing controlled substances.
    """
    location = serializers.UUIDField()
    item = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1)
    patient = serializers.UUIDField()
    prescription = serializers.UUIDField(required=False, allow_null=True)
    batch_id = serializers.UUIDField(required=False, allow_null=True)
    witness = serializers.UUIDField()
    wastage_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )
    wastage_reason = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class ControlledSubstanceWastageSerializer(serializers.Serializer):
    """
    Serializer for recording controlled substance wastage.
    """
    location = serializers.UUIDField()
    item = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1)
    wastage_reason = serializers.CharField(required=True)
    batch_id = serializers.UUIDField(required=False, allow_null=True)
    witness = serializers.UUIDField()
    notes = serializers.CharField(required=False, allow_blank=True)


class ControlledSubstanceCountSerializer(serializers.Serializer):
    """
    Serializer for performing physical count.
    """
    location = serializers.UUIDField()
    item = serializers.UUIDField()
    actual_count = serializers.IntegerField(min_value=0)
    witness = serializers.UUIDField()
    notes = serializers.CharField(required=False, allow_blank=True)


class ControlledSubstanceDiscrepancyListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for discrepancy lists.
    """
    item_name = serializers.CharField(source='register.item.name', read_only=True)
    location_name = serializers.CharField(source='register.location.name', read_only=True)
    discovered_by_name = serializers.CharField(source='discovered_by.get_full_name', read_only=True)
    is_shortage = serializers.ReadOnlyField()

    class Meta:
        model = ControlledSubstanceDiscrepancy
        fields = [
            'id', 'item_name', 'location_name', 'status',
            'expected_balance', 'actual_balance', 'discrepancy',
            'is_shortage', 'discovered_by_name', 'discovered_at'
        ]


class ControlledSubstanceDiscrepancySerializer(serializers.ModelSerializer):
    """
    Full serializer for discrepancy details.
    """
    item_name = serializers.CharField(source='register.item.name', read_only=True)
    item_sku = serializers.CharField(source='register.item.sku', read_only=True)
    location_name = serializers.CharField(source='register.location.name', read_only=True)
    discovered_by_name = serializers.CharField(source='discovered_by.get_full_name', read_only=True)
    resolved_by_name = serializers.CharField(
        source='resolved_by.get_full_name', read_only=True, default=None
    )
    is_shortage = serializers.ReadOnlyField()
    requires_escalation = serializers.ReadOnlyField()

    class Meta:
        model = ControlledSubstanceDiscrepancy
        fields = [
            'id', 'register', 'item_name', 'item_sku', 'location_name',
            'expected_balance', 'actual_balance', 'discrepancy',
            'is_shortage', 'requires_escalation',
            'discovered_by', 'discovered_by_name', 'discovered_at',
            'status', 'investigation_notes',
            'resolved_by', 'resolved_by_name', 'resolved_at', 'resolution_notes',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'register', 'expected_balance', 'actual_balance', 'discrepancy',
            'discovered_by', 'discovered_at', 'resolved_by', 'resolved_at',
            'created_at', 'updated_at'
        ]


# =============================================================================
# Analytics Request Serializers (Phase 6)
# =============================================================================


class ConsumptionAnalyticsRequestSerializer(serializers.Serializer):
    """
    Request serializer for consumption analytics.
    """
    start_date = serializers.DateTimeField(required=False)
    end_date = serializers.DateTimeField(required=False)
    item_id = serializers.UUIDField(required=False)
    location_id = serializers.UUIDField(required=False)
    category_id = serializers.UUIDField(required=False)
    group_by = serializers.ChoiceField(
        choices=['day', 'week', 'month'],
        default='day',
        required=False
    )


class ABCAnalysisRequestSerializer(serializers.Serializer):
    """
    Request serializer for ABC analysis.
    """
    analysis_period_days = serializers.IntegerField(
        min_value=30, max_value=730, default=365, required=False
    )


class SupplierPerformanceRequestSerializer(serializers.Serializer):
    """
    Request serializer for supplier performance.
    """
    start_date = serializers.DateTimeField(required=False)
    end_date = serializers.DateTimeField(required=False)
    supplier_id = serializers.UUIDField(required=False)


class ExpiryForecastRequestSerializer(serializers.Serializer):
    """
    Request serializer for expiry forecast.
    """
    days_ahead = serializers.IntegerField(
        min_value=7, max_value=365, default=90, required=False
    )
    location_id = serializers.UUIDField(required=False)
    category_id = serializers.UUIDField(required=False)


class StockValuationRequestSerializer(serializers.Serializer):
    """
    Request serializer for stock valuation.
    """
    location_id = serializers.UUIDField(required=False)
    category_id = serializers.UUIDField(required=False)


class ControlledSubstanceReportRequestSerializer(serializers.Serializer):
    """
    Request serializer for controlled substance report.
    """
    start_date = serializers.DateTimeField(required=False)
    end_date = serializers.DateTimeField(required=False)
    location_id = serializers.UUIDField(required=False)
    item_id = serializers.UUIDField(required=False)
