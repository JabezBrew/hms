from rest_framework import serializers
from .models import (
    InventoryCategory, Supplier, InventoryItem, StockMovement,
    ExpiryTracker, InventoryAudit, InventoryAuditItem
)
from ..users.serializers import UserSerializer


class InventoryCategorySerializer(serializers.ModelSerializer):
    """
    Serializer for the InventoryCategory model.
    """
    parent_name = serializers.ReadOnlyField(source='parent.name')
    
    class Meta:
        model = InventoryCategory
        fields = ['id', 'name', 'description', 'parent', 'parent_name',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class SupplierSerializer(serializers.ModelSerializer):
    """
    Serializer for the Supplier model.
    """
    class Meta:
        model = Supplier
        fields = ['id', 'name', 'contact_person', 'email', 'phone', 'address',
                  'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InventoryItemSerializer(serializers.ModelSerializer):
    """
    Serializer for the InventoryItem model.
    """
    category_name = serializers.ReadOnlyField(source='category.name')
    supplier_name = serializers.ReadOnlyField(source='supplier.name')
    stock_value = serializers.ReadOnlyField()
    is_low_stock = serializers.ReadOnlyField()
    
    class Meta:
        model = InventoryItem
        fields = ['id', 'name', 'description', 'category', 'category_name',
                  'sku', 'barcode', 'item_type', 'unit_of_measure',
                  'minimum_stock', 'reorder_level', 'current_stock',
                  'unit_cost', 'selling_price', 'supplier', 'supplier_name',
                  'is_active', 'fhir_medication_id', 'stock_value', 'is_low_stock',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class StockMovementSerializer(serializers.ModelSerializer):
    """
    Serializer for the StockMovement model.
    """
    item_name = serializers.ReadOnlyField(source='item.name')
    created_by_details = UserSerializer(source='created_by', read_only=True)
    
    class Meta:
        model = StockMovement
        fields = ['id', 'item', 'item_name', 'movement_type', 'quantity',
                  'previous_stock', 'new_stock', 'reference_number', 'notes',
                  'batch_number', 'expiry_date', 'unit_cost', 'total_cost',
                  'timestamp', 'created_by', 'created_by_details']
        read_only_fields = ['id', 'previous_stock', 'new_stock', 'total_cost', 'timestamp', 'created_by']


class ExpiryTrackerSerializer(serializers.ModelSerializer):
    """
    Serializer for the ExpiryTracker model.
    """
    item_name = serializers.ReadOnlyField(source='item.name')
    is_expired = serializers.ReadOnlyField()
    days_until_expiry = serializers.ReadOnlyField()
    is_expiring_soon = serializers.ReadOnlyField()
    
    class Meta:
        model = ExpiryTracker
        fields = ['id', 'item', 'item_name', 'batch_number', 'expiry_date',
                  'initial_quantity', 'remaining_quantity', 'movement', 'status',
                  'is_expired', 'days_until_expiry', 'is_expiring_soon',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


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


class InventoryAuditSerializer(serializers.ModelSerializer):
    """
    Serializer for the InventoryAudit model.
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