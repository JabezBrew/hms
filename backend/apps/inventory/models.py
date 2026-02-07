import uuid
from decimal import Decimal
from django.db import models, transaction
from django.db.models import Sum, F, Q
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.core.validators import MinValueValidator
from datetime import timedelta

User = get_user_model()


# =============================================================================
# Storage Location Models (Phase 1: Multi-Location)
# =============================================================================


class StorageLocation(models.Model):
    """
    Hierarchical storage locations for inventory management.

    Supports various location types across the hospital:
    - Warehouse (central store)
    - Pharmacy (main dispensary)
    - Satellite pharmacy
    - Ward store
    - Department store
    - Operating theatre
    - Emergency
    - Laboratory
    """
    LOCATION_TYPE_CHOICES = (
        ('warehouse', 'Warehouse'),
        ('pharmacy', 'Pharmacy'),
        ('satellite', 'Satellite Pharmacy'),
        ('ward_store', 'Ward Store'),
        ('department_store', 'Department Store'),
        ('operating_theatre', 'Operating Theatre'),
        ('emergency', 'Emergency'),
        ('laboratory', 'Laboratory'),
    )

    TEMPERATURE_ZONE_CHOICES = (
        ('ambient', 'Ambient (15-25°C)'),
        ('cool', 'Cool (8-15°C)'),
        ('refrigerated', 'Refrigerated (2-8°C)'),
        ('frozen', 'Frozen (-20°C or below)'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='storage_locations',
        help_text="Facility that owns this storage location"
    )
    parent = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children',
        help_text="Parent location for hierarchical organization"
    )

    # Identification
    code = models.CharField(max_length=50, help_text="Unique code within facility")
    name = models.CharField(max_length=100)
    location_type = models.CharField(max_length=20, choices=LOCATION_TYPE_CHOICES)

    # Physical location
    building = models.CharField(max_length=100, blank=True)
    floor = models.CharField(max_length=20, blank=True)
    room = models.CharField(max_length=50, blank=True)

    # Optional links to organizational units
    ward = models.ForeignKey(
        'wards.Ward',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='storage_locations',
        help_text="Associated ward for ward stores"
    )
    department = models.ForeignKey(
        'core.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='storage_locations',
        help_text="Associated department"
    )

    # Capabilities
    can_receive_external = models.BooleanField(
        default=False,
        help_text="Can receive goods from external suppliers (GRN)"
    )
    can_dispense_to_patients = models.BooleanField(
        default=False,
        help_text="Can dispense directly to patients"
    )
    allows_controlled_substances = models.BooleanField(
        default=False,
        help_text="Authorized to store controlled substances"
    )

    # Storage conditions
    temperature_zone = models.CharField(
        max_length=20,
        choices=TEMPERATURE_ZONE_CHOICES,
        default='ambient'
    )

    # Status
    is_active = models.BooleanField(default=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='created_storage_locations'
    )
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='updated_storage_locations'
    )

    class Meta:
        ordering = ['facility', 'name']
        unique_together = ('facility', 'code')
        indexes = [
            models.Index(fields=['facility', 'location_type', 'is_active']),
            models.Index(fields=['facility', 'code']),
            models.Index(fields=['ward']),
            models.Index(fields=['department']),
        ]

    def __str__(self):
        return f"{self.name} ({self.code})"

    @property
    def full_path(self):
        """Get full hierarchical path."""
        if self.parent:
            return f"{self.parent.full_path} > {self.name}"
        return self.name


class LocationStock(models.Model):
    """
    Stock quantity per item per location.

    This is the source of truth for stock levels at each location.
    The InventoryItem.current_stock field is deprecated in favor of
    aggregating LocationStock records.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(
        'InventoryItem',
        on_delete=models.CASCADE,
        related_name='location_stocks'
    )
    location = models.ForeignKey(
        StorageLocation,
        on_delete=models.CASCADE,
        related_name='stock_items'
    )

    # Stock levels
    quantity = models.PositiveIntegerField(default=0)
    reserved_quantity = models.PositiveIntegerField(
        default=0,
        help_text="Quantity reserved for pending orders/transfers"
    )

    # Location-specific reorder settings (override item defaults)
    reorder_level = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Override item reorder level for this location"
    )
    reorder_quantity = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Override item reorder quantity for this location"
    )
    max_level = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Maximum stock level for this location"
    )

    # Tracking
    last_counted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last physical count date"
    )
    last_movement_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last stock movement date"
    )

    class Meta:
        unique_together = ('item', 'location')
        indexes = [
            models.Index(fields=['location', 'quantity']),
            models.Index(fields=['item', 'location']),
        ]

    def __str__(self):
        return f"{self.item.name} @ {self.location.name}: {self.quantity}"

    @property
    def available_quantity(self):
        """Quantity available for use (total - reserved)."""
        return max(0, self.quantity - self.reserved_quantity)

    @property
    def effective_reorder_level(self):
        """Get reorder level (location override or item default)."""
        return self.reorder_level if self.reorder_level is not None else self.item.reorder_level

    @property
    def is_below_reorder(self):
        """Check if stock is below reorder level."""
        return self.available_quantity <= self.effective_reorder_level


class InventoryCategory(models.Model):
    """
    Model for categorizing inventory items.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='inventory_categories',
        help_text="Facility that owns this inventory category"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='children')
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_categories')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_categories')
    
    class Meta:
        ordering = ['name']
        indexes = [
            models.Index(fields=['facility', 'name']),
        ]

    
    def __str__(self):
        return self.name


class Supplier(models.Model):
    """
    Model for suppliers of inventory items.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='suppliers',
        help_text="Facility that owns this supplier"
    )
    name = models.CharField(max_length=100)
    contact_person = models.CharField(max_length=100, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_suppliers')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_suppliers')

    class Meta:
        ordering = ['name']
        indexes = [
            models.Index(fields=['facility', 'name']),
        ]

    def __str__(self):
        return self.name


class InventoryItem(models.Model):
    """
    Model for inventory items.

    Multi-location stock tracking: Use location_stocks for per-location
    quantities. The current_stock field is deprecated but maintained
    for backward compatibility.
    """
    ITEM_TYPE_CHOICES = (
        ('medication', 'Medication'),
        ('supply', 'Medical Supply'),
        ('equipment', 'Equipment'),
        ('consumable', 'Consumable'),
        ('surgical', 'Surgical'),
        ('laboratory', 'Laboratory'),
        ('housekeeping', 'Housekeeping'),
        ('maintenance', 'Maintenance'),
        ('food', 'Food Service'),
        ('other', 'Other'),
    )

    INVENTORY_CLASS_CHOICES = (
        ('A', 'Class A - High Value'),
        ('B', 'Class B - Medium Value'),
        ('C', 'Class C - Low Value'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='inventory_items',
        help_text="Facility that owns this inventory item"
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    category = models.ForeignKey(
        InventoryCategory,
        on_delete=models.SET_NULL,
        null=True,
        related_name='items'
    )
    sku = models.CharField(max_length=50, help_text="Stock Keeping Unit - unique per facility")
    barcode = models.CharField(max_length=50, blank=True, null=True)

    # Item type and classification
    item_type = models.CharField(max_length=20, choices=ITEM_TYPE_CHOICES)
    inventory_class = models.CharField(
        max_length=1,
        choices=INVENTORY_CLASS_CHOICES,
        blank=True,
        null=True,
        help_text="ABC classification for inventory management"
    )
    is_controlled_substance = models.BooleanField(
        default=False,
        help_text="Requires special tracking and witness signatures"
    )
    controlled_schedule = models.CharField(
        max_length=10,
        blank=True,
        null=True,
        help_text="Drug schedule (e.g., Schedule II, III, IV)"
    )

    # Stock details
    unit_of_measure = models.CharField(max_length=50)
    minimum_stock = models.PositiveIntegerField(default=0)
    reorder_level = models.PositiveIntegerField(default=0)
    reorder_quantity = models.PositiveIntegerField(
        default=0,
        help_text="Default quantity to order when reordering"
    )
    # DEPRECATED: Use location_stocks for multi-location stock tracking
    current_stock = models.PositiveIntegerField(
        default=0,
        help_text="DEPRECATED: Use total_stock property instead"
    )

    # Pricing
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    billing_service = models.ForeignKey(
        'billing.Service',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='inventory_items',
        help_text="Optional link to a billable Service for automatic invoicing/claims."
    )

    # Supplier
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='items',
        help_text="Primary/preferred supplier"
    )

    # Additional suppliers for procurement
    alternative_suppliers = models.ManyToManyField(
        Supplier,
        blank=True,
        related_name='alternative_items',
        help_text="Alternative suppliers for this item"
    )

    # Lead time for procurement
    lead_time_days = models.PositiveIntegerField(
        default=7,
        help_text="Expected delivery time from order in days"
    )

    # Status
    is_active = models.BooleanField(default=True)

    # FHIR reference for medications
    fhir_medication_id = models.CharField(max_length=100, blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='created_items'
    )
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='updated_items'
    )

    class Meta:
        ordering = ['name']
        unique_together = ('facility', 'sku')
        indexes = [
            models.Index(fields=['facility', 'sku']),
            models.Index(fields=['facility', 'item_type', 'is_active']),
            models.Index(fields=['is_controlled_substance']),
            models.Index(fields=['category', 'is_active']),
        ]

    def __str__(self):
        return f"{self.name} ({self.sku})"

    @property
    def total_stock(self):
        """
        Calculate total stock across all locations.
        This is the preferred method over current_stock.
        """
        result = self.location_stocks.aggregate(total=Sum('quantity'))
        return result['total'] or 0

    @property
    def total_available_stock(self):
        """Total available stock (excluding reserved)."""
        result = self.location_stocks.aggregate(
            total=Sum(F('quantity') - F('reserved_quantity'))
        )
        return max(0, result['total'] or 0)

    @property
    def stock_value(self):
        """Calculate the current stock value."""
        return Decimal(str(self.total_stock)) * self.unit_cost

    @property
    def is_low_stock(self):
        """Check if the item is low on stock."""
        return self.total_stock <= self.reorder_level

    def get_stock_at_location(self, location):
        """Get stock quantity at a specific location."""
        try:
            loc_stock = self.location_stocks.get(location=location)
            return loc_stock.quantity
        except LocationStock.DoesNotExist:
            return 0

    def get_available_at_location(self, location):
        """Get available (non-reserved) quantity at a location."""
        try:
            loc_stock = self.location_stocks.get(location=location)
            return loc_stock.available_quantity
        except LocationStock.DoesNotExist:
            return 0


class StockMovement(models.Model):
    """
    Model for tracking stock movements.

    Enhanced for multi-location tracking with source/destination locations.
    Stock updates are now handled by the StockService for atomic operations.
    """
    MOVEMENT_TYPE_CHOICES = (
        ('purchase', 'Purchase'),
        ('sale', 'Sale'),
        ('dispense', 'Dispense'),
        ('return', 'Return'),
        ('adjustment', 'Adjustment'),
        ('transfer_out', 'Transfer Out'),
        ('transfer_in', 'Transfer In'),
        ('disposal', 'Disposal'),
        ('grn_receipt', 'GRN Receipt'),
        ('internal_issue', 'Internal Issue'),
        ('wastage', 'Wastage'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.CASCADE,
        related_name='movements'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='stock_movements',
        help_text="Facility context for this stock movement"
    )

    # Movement type
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_TYPE_CHOICES)

    # Location tracking (Phase 1: Multi-Location)
    source_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='outbound_movements',
        help_text="Location stock is moving FROM"
    )
    destination_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inbound_movements',
        help_text="Location stock is moving TO"
    )

    # Quantity and stock levels
    quantity = models.PositiveIntegerField()
    previous_stock = models.PositiveIntegerField(
        help_text="Stock level at source/destination before movement"
    )
    new_stock = models.PositiveIntegerField(
        help_text="Stock level at source/destination after movement"
    )

    # Reference information
    reference_number = models.CharField(max_length=50, blank=True, null=True)
    reference_type = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Type of reference (e.g., 'PO', 'GRN', 'Transfer', 'Prescription')"
    )
    reference_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="UUID of related object (PO, GRN, Transfer, etc.)"
    )
    notes = models.TextField(blank=True, null=True)

    # Batch and expiry
    batch_number = models.CharField(max_length=50, blank=True, null=True)
    expiry_date = models.DateField(blank=True, null=True)

    # Link to expiry tracker (batch consumed)
    expiry_tracker = models.ForeignKey(
        'ExpiryTracker',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='consumption_movements',
        help_text="Batch/expiry tracker this movement consumed from"
    )

    # Cost
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2)
    total_cost = models.DecimalField(max_digits=10, decimal_places=2)

    # Patient link (for dispense movements)
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='stock_movements',
        help_text="Patient for dispense movements"
    )

    # Audit fields
    timestamp = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='stock_movements'
    )

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['facility', '-timestamp']),
            models.Index(fields=['item', '-timestamp']),
            models.Index(fields=['source_location', '-timestamp']),
            models.Index(fields=['destination_location', '-timestamp']),
            models.Index(fields=['movement_type', '-timestamp']),
            models.Index(fields=['reference_type', 'reference_id']),
        ]

    def __str__(self):
        return f"{self.get_movement_type_display()} - {self.item.name} - {self.quantity} {self.item.unit_of_measure}"

    def save(self, *args, **kwargs):
        """
        Calculate total cost. Stock updates should be done via StockService.

        NOTE: For multi-location operations, use StockService.adjust_stock()
        or StockService.transfer_stock() which handle atomic updates.
        Legacy save behavior is preserved for backward compatibility.
        """
        # Calculate total cost
        self.total_cost = self.quantity * self.unit_cost

        # Legacy behavior: update item.current_stock if no location specified
        # This maintains backward compatibility during migration
        if not self.pk and not self.source_location and not self.destination_location:
            # Set previous stock
            self.previous_stock = self.item.current_stock

            # Update stock based on movement type
            if self.movement_type in ['purchase', 'return', 'grn_receipt', 'transfer_in']:
                self.item.current_stock += self.quantity
            elif self.movement_type in ['sale', 'dispense', 'disposal', 'transfer_out', 'internal_issue', 'wastage']:
                self.item.current_stock = max(0, self.item.current_stock - self.quantity)
            elif self.movement_type == 'adjustment':
                # For adjustments, the quantity can be positive or negative
                self.item.current_stock = self.new_stock

            # Set new stock
            self.new_stock = self.item.current_stock

            # Save the item
            self.item.save()

            # Create batch if expiry date is provided (legacy behavior)
            if self.expiry_date and self.movement_type in ['purchase', 'return', 'grn_receipt']:
                ExpiryTracker.objects.create(
                    item=self.item,
                    batch_number=self.batch_number,
                    expiry_date=self.expiry_date,
                    initial_quantity=self.quantity,
                    remaining_quantity=self.quantity,
                    movement=self,
                    created_by=self.created_by
                )

        super().save(*args, **kwargs)


class ExpiryTracker(models.Model):
    """
    Model for tracking expiry dates of inventory items.

    Enhanced to track location for multi-location stock management.
    Batches are location-specific - the same batch number can exist
    at multiple locations after transfers.
    """
    STATUS_CHOICES = (
        ('active', 'Active'),
        ('consumed', 'Consumed'),
        ('expired', 'Expired'),
        ('disposed', 'Disposed'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.CASCADE,
        related_name='expiry_trackers'
    )
    batch_number = models.CharField(max_length=50)
    expiry_date = models.DateField()

    # Location tracking (Phase 1: Multi-Location)
    location = models.ForeignKey(
        StorageLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='batch_trackers',
        help_text="Storage location for this batch"
    )

    # Quantities
    initial_quantity = models.PositiveIntegerField()
    remaining_quantity = models.PositiveIntegerField()

    # Reference to the stock movement that created this batch
    movement = models.ForeignKey(
        StockMovement,
        on_delete=models.CASCADE,
        related_name='created_batches'
    )

    # Manufacturing info (optional)
    manufacturing_date = models.DateField(null=True, blank=True)
    manufacturer = models.CharField(max_length=200, blank=True, null=True)

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='created_expiry_trackers'
    )
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='updated_expiry_trackers'
    )

    class Meta:
        ordering = ['expiry_date']
        indexes = [
            models.Index(fields=['item', 'status', 'expiry_date']),
            models.Index(fields=['location', 'status', 'expiry_date']),
            models.Index(fields=['batch_number']),
            models.Index(fields=['expiry_date', 'status']),
        ]

    def __str__(self):
        loc = f" @ {self.location.code}" if self.location else ""
        return f"{self.item.name} - Batch {self.batch_number}{loc} - Expires {self.expiry_date}"

    @property
    def is_expired(self):
        """Check if the batch is expired."""
        return self.expiry_date <= timezone.now().date()

    @property
    def days_until_expiry(self):
        """Calculate the number of days until expiry."""
        if self.is_expired:
            return 0
        delta = self.expiry_date - timezone.now().date()
        return delta.days

    def is_expiring_soon(self, days=30):
        """Check if the batch is expiring within specified days."""
        return 0 < self.days_until_expiry <= days

    @property
    def value_at_risk(self):
        """Calculate value of remaining stock if it expires."""
        return Decimal(str(self.remaining_quantity)) * self.item.unit_cost


class InventoryAudit(models.Model):
    """
    Model for inventory audits.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='inventory_audits',
        help_text="Facility context for this audit"
    )
    audit_date = models.DateField(default=timezone.now)
    notes = models.TextField(blank=True, null=True)
    
    # Status
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_audits')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_audits')
    
    class Meta:
        ordering = ['-audit_date']
        indexes = [
            models.Index(fields=['facility', '-audit_date']),
        ]
    
    def __str__(self):
        return f"Audit {self.audit_date} - {self.get_status_display()}"


class InventoryAuditItem(models.Model):
    """
    Model for individual items in an inventory audit.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    audit = models.ForeignKey(InventoryAudit, on_delete=models.CASCADE, related_name='items')
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name='audit_entries')
    
    # Stock counts
    expected_quantity = models.PositiveIntegerField()
    actual_quantity = models.PositiveIntegerField()
    
    # Discrepancy
    discrepancy = models.IntegerField(default=0)
    notes = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_audit_items')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_audit_items')
    
    class Meta:
        ordering = ['item__name']
    
    def __str__(self):
        return f"{self.item.name} - Expected: {self.expected_quantity}, Actual: {self.actual_quantity}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to calculate discrepancy.
        """
        self.discrepancy = self.actual_quantity - self.expected_quantity
        super().save(*args, **kwargs)


# =============================================================================
# Procurement Models (Phase 3: Procurement Workflow)
# =============================================================================


class PurchaseRequisition(models.Model):
    """
    Purchase requisition for inventory items.

    Workflow: draft → pending_approval → approved/rejected → converted → cancelled
    """
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('pending_approval', 'Pending Approval'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('converted', 'Converted to PO'),
        ('cancelled', 'Cancelled'),
    )

    PRIORITY_CHOICES = (
        ('low', 'Low'),
        ('normal', 'Normal'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='purchase_requisitions'
    )
    requisition_number = models.CharField(
        max_length=50,
        unique=True,
        help_text="Auto-generated: REQ-FACILITY-YYYYMMDD-NNNN"
    )

    # Requesting info
    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='created_requisitions'
    )
    requesting_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='requisitions',
        help_text="Location requesting the items"
    )
    requesting_department = models.ForeignKey(
        'core.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_requisitions'
    )

    # Timing and priority
    date_required = models.DateField(
        null=True,
        blank=True,
        help_text="Date by which items are needed"
    )
    priority = models.CharField(
        max_length=10,
        choices=PRIORITY_CHOICES,
        default='normal'
    )

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')

    # Approval
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_requisitions'
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, null=True)

    # Additional info
    justification = models.TextField(
        blank=True,
        null=True,
        help_text="Justification for this requisition"
    )
    notes = models.TextField(blank=True, null=True)
    is_auto_generated = models.BooleanField(
        default=False,
        help_text="True if generated by auto-reorder system"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at']),
            models.Index(fields=['requisition_number']),
            models.Index(fields=['requested_by', 'status']),
        ]

    def __str__(self):
        return f"{self.requisition_number} ({self.get_status_display()})"

    @property
    def total_estimated_cost(self):
        """Calculate total estimated cost of all items."""
        return sum(
            item.quantity_requested * item.item.unit_cost
            for item in self.items.all()
        )


class PurchaseRequisitionItem(models.Model):
    """
    Individual item line on a purchase requisition.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requisition = models.ForeignKey(
        PurchaseRequisition,
        on_delete=models.CASCADE,
        related_name='items'
    )
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.PROTECT,
        related_name='requisition_items'
    )

    # Quantities
    quantity_requested = models.PositiveIntegerField()
    quantity_approved = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="May differ from requested after approval review"
    )

    # Context at time of request
    current_stock_at_request = models.PositiveIntegerField(
        default=0,
        help_text="Stock level when requisition was created"
    )
    reorder_level = models.PositiveIntegerField(
        default=0,
        help_text="Reorder level at time of request"
    )

    # Supplier preference
    preferred_supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='requisition_items'
    )
    notes = models.TextField(blank=True, null=True)

    class Meta:
        unique_together = ('requisition', 'item')

    def __str__(self):
        return f"{self.item.name} x {self.quantity_requested}"


class PurchaseOrder(models.Model):
    """
    Purchase order to supplier.

    Workflow: draft → pending_approval → approved → sent → acknowledged →
              partially_received/fully_received → closed/cancelled
    """
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('pending_approval', 'Pending Approval'),
        ('approved', 'Approved'),
        ('sent', 'Sent to Supplier'),
        ('acknowledged', 'Acknowledged by Supplier'),
        ('partially_received', 'Partially Received'),
        ('fully_received', 'Fully Received'),
        ('cancelled', 'Cancelled'),
        ('closed', 'Closed'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='purchase_orders'
    )
    po_number = models.CharField(
        max_length=50,
        unique=True,
        help_text="Auto-generated: PO-FACILITY-YYYYMMDD-NNNN"
    )

    # Source requisition (optional)
    requisition = models.ForeignKey(
        PurchaseRequisition,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders'
    )

    # Supplier
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.PROTECT,
        related_name='purchase_orders'
    )
    supplier_quote_reference = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Supplier's quote/reference number"
    )

    # Delivery
    delivery_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='incoming_purchase_orders',
        help_text="Location to receive goods"
    )
    expected_delivery_date = models.DateField(null=True, blank=True)

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')

    # Financials
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default='KES')
    payment_terms = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="e.g., Net 30, COD"
    )

    # Workflow tracking
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='created_purchase_orders'
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_purchase_orders'
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    # Notes
    notes = models.TextField(blank=True, null=True)
    internal_notes = models.TextField(
        blank=True,
        null=True,
        help_text="Internal notes (not shared with supplier)"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at']),
            models.Index(fields=['po_number']),
            models.Index(fields=['supplier', 'status']),
        ]

    def __str__(self):
        return f"{self.po_number} - {self.supplier.name} ({self.get_status_display()})"

    def calculate_totals(self):
        """Recalculate order totals from line items."""
        self.subtotal = sum(item.line_total for item in self.items.all())
        self.total_amount = self.subtotal + self.tax_amount - self.discount_amount
        self.save()


class PurchaseOrderItem(models.Model):
    """
    Individual item line on a purchase order.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name='items'
    )
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.PROTECT,
        related_name='purchase_order_items'
    )

    # Link to source requisition item
    requisition_item = models.ForeignKey(
        PurchaseRequisitionItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_order_items'
    )

    # Quantities
    quantity_ordered = models.PositiveIntegerField()
    quantity_received = models.PositiveIntegerField(default=0)

    # Pricing
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    discount_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=0
    )
    tax_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text="Tax rate as percentage"
    )

    class Meta:
        unique_together = ('purchase_order', 'item')

    def __str__(self):
        return f"{self.item.name} x {self.quantity_ordered}"

    @property
    def line_total(self):
        """Calculate line total including discounts."""
        base = self.quantity_ordered * self.unit_price
        discount = base * (self.discount_percent / 100)
        return base - discount

    @property
    def quantity_pending(self):
        """Quantity still pending receipt."""
        return max(0, self.quantity_ordered - self.quantity_received)


class GoodsReceivedNote(models.Model):
    """
    Goods received note for incoming inventory.

    Created when goods are received against a purchase order.
    Workflow: draft → pending_inspection → inspected → accepted/partially_accepted/rejected
    """
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('pending_inspection', 'Pending Inspection'),
        ('inspected', 'Inspected'),
        ('accepted', 'Accepted'),
        ('partially_accepted', 'Partially Accepted'),
        ('rejected', 'Rejected'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='goods_received_notes'
    )
    grn_number = models.CharField(
        max_length=50,
        unique=True,
        help_text="Auto-generated: GRN-FACILITY-YYYYMMDD-NNNN"
    )

    # Source PO
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.PROTECT,
        related_name='goods_received_notes'
    )

    # Receipt details
    received_at = models.DateTimeField(default=timezone.now)
    received_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='received_grns'
    )
    receiving_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='goods_received_notes'
    )

    # Supplier reference
    supplier_delivery_note = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Supplier's delivery note number"
    )
    supplier_invoice_number = models.CharField(
        max_length=100,
        blank=True,
        null=True
    )

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')

    # Quality inspection
    inspected_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inspected_grns'
    )
    inspected_at = models.DateTimeField(null=True, blank=True)
    inspection_notes = models.TextField(blank=True, null=True)
    has_quality_issues = models.BooleanField(default=False)
    quality_issue_notes = models.TextField(blank=True, null=True)

    # Notes
    notes = models.TextField(blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-received_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-received_at']),
            models.Index(fields=['grn_number']),
            models.Index(fields=['purchase_order']),
        ]

    def __str__(self):
        return f"{self.grn_number} ({self.get_status_display()})"


class GoodsReceivedNoteItem(models.Model):
    """
    Individual item line on a GRN.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn = models.ForeignKey(
        GoodsReceivedNote,
        on_delete=models.CASCADE,
        related_name='items'
    )
    po_item = models.ForeignKey(
        PurchaseOrderItem,
        on_delete=models.PROTECT,
        related_name='grn_items'
    )
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.PROTECT,
        related_name='grn_items'
    )

    # Quantities
    quantity_received = models.PositiveIntegerField()
    quantity_accepted = models.PositiveIntegerField(default=0)
    quantity_rejected = models.PositiveIntegerField(default=0)
    rejection_reason = models.TextField(blank=True, null=True)

    # Batch/expiry info (entered during receipt)
    batch_number = models.CharField(max_length=50, blank=True, null=True)
    expiry_date = models.DateField(null=True, blank=True)
    manufacturing_date = models.DateField(null=True, blank=True)

    # Storage
    storage_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='grn_items',
        help_text="Final storage location for accepted goods"
    )

    # Link to expiry tracker (created after acceptance)
    expiry_tracker = models.ForeignKey(
        ExpiryTracker,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='source_grn_items'
    )

    class Meta:
        unique_together = ('grn', 'po_item')

    def __str__(self):
        return f"{self.item.name} - Received: {self.quantity_received}, Accepted: {self.quantity_accepted}"


# =============================================================================
# Internal Logistics Models (Phase 4)
# =============================================================================


class InternalRequisition(models.Model):
    """
    Internal requisition for inter-department stock requests.

    Workflow: draft → pending_approval → approved/rejected → in_progress → fulfilled/cancelled
    """
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('pending_approval', 'Pending Approval'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('in_progress', 'In Progress'),
        ('fulfilled', 'Fulfilled'),
        ('partially_fulfilled', 'Partially Fulfilled'),
        ('cancelled', 'Cancelled'),
    )

    PRIORITY_CHOICES = (
        ('low', 'Low'),
        ('normal', 'Normal'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='internal_requisitions'
    )
    requisition_number = models.CharField(
        max_length=50,
        unique=True,
        help_text="Auto-generated: INT-FACILITY-YYYYMMDD-NNNN"
    )

    # Locations
    requesting_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='outgoing_internal_requisitions',
        help_text="Location requesting items"
    )
    fulfilling_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='incoming_internal_requisitions',
        help_text="Location that will fulfill the request (usually main store)"
    )

    # Requester
    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='internal_requisitions'
    )

    # Timing and priority
    date_required = models.DateField(
        null=True,
        blank=True,
        help_text="Date by which items are needed"
    )
    priority = models.CharField(
        max_length=10,
        choices=PRIORITY_CHOICES,
        default='normal'
    )

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')

    # Approval
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_internal_requisitions'
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, null=True)

    # Fulfillment
    fulfilled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fulfilled_internal_requisitions'
    )
    fulfilled_at = models.DateTimeField(null=True, blank=True)

    # Standing order link
    standing_order = models.ForeignKey(
        'StandingOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='generated_requisitions',
        help_text="Standing order that generated this requisition"
    )

    # Notes
    justification = models.TextField(
        blank=True,
        null=True,
        help_text="Reason for request"
    )
    notes = models.TextField(blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at']),
            models.Index(fields=['requisition_number']),
            models.Index(fields=['requesting_location', 'status']),
            models.Index(fields=['fulfilling_location', 'status']),
            models.Index(fields=['requested_by', 'status']),
        ]

    def __str__(self):
        return f"{self.requisition_number} ({self.get_status_display()})"

    @property
    def total_items_requested(self):
        """Total number of items requested."""
        return self.items.count()

    @property
    def is_fully_fulfilled(self):
        """Check if all items are fully fulfilled."""
        return all(
            item.quantity_issued >= item.quantity_approved
            for item in self.items.all()
            if item.quantity_approved
        )


class InternalRequisitionItem(models.Model):
    """
    Individual item line on an internal requisition.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requisition = models.ForeignKey(
        InternalRequisition,
        on_delete=models.CASCADE,
        related_name='items'
    )
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.PROTECT,
        related_name='internal_requisition_items'
    )

    # Quantities
    quantity_requested = models.PositiveIntegerField()
    quantity_approved = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Quantity approved (may differ from requested)"
    )
    quantity_issued = models.PositiveIntegerField(
        default=0,
        help_text="Quantity actually issued"
    )

    # Batch tracking for issue
    batch_used = models.ForeignKey(
        ExpiryTracker,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='internal_requisition_issues',
        help_text="Batch used for fulfillment"
    )

    # Notes
    notes = models.TextField(blank=True, null=True)

    class Meta:
        unique_together = ('requisition', 'item')

    def __str__(self):
        return f"{self.item.name} x {self.quantity_requested}"

    @property
    def quantity_pending(self):
        """Quantity still pending issue."""
        approved = self.quantity_approved or self.quantity_requested
        return max(0, approved - self.quantity_issued)


class StandingOrder(models.Model):
    """
    Standing order for recurring internal requisitions.

    Automatically generates internal requisitions on schedule.
    """
    FREQUENCY_CHOICES = (
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
        ('biweekly', 'Bi-Weekly'),
        ('monthly', 'Monthly'),
    )

    DAY_OF_WEEK_CHOICES = (
        (0, 'Monday'),
        (1, 'Tuesday'),
        (2, 'Wednesday'),
        (3, 'Thursday'),
        (4, 'Friday'),
        (5, 'Saturday'),
        (6, 'Sunday'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='standing_orders'
    )
    name = models.CharField(max_length=100, help_text="Descriptive name for this standing order")

    # Locations
    requesting_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='standing_order_requests',
        help_text="Location that receives the items"
    )
    fulfilling_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='standing_order_fulfillments',
        help_text="Location that provides the items"
    )

    # Schedule
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES)
    day_of_week = models.IntegerField(
        choices=DAY_OF_WEEK_CHOICES,
        null=True,
        blank=True,
        help_text="For weekly frequency"
    )
    day_of_month = models.IntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
        help_text="For monthly frequency (1-31)"
    )

    # Status
    is_active = models.BooleanField(default=True)

    # Tracking
    last_generated = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the last requisition was generated"
    )
    next_due = models.DateField(
        null=True,
        blank=True,
        help_text="Next scheduled generation date"
    )

    # Created by
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_standing_orders'
    )

    # Notes
    notes = models.TextField(blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        indexes = [
            models.Index(fields=['facility', 'is_active']),
            models.Index(fields=['next_due', 'is_active']),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_frequency_display()})"

    def calculate_next_due(self, from_date=None):
        """Calculate the next due date based on frequency."""
        from_date = from_date or timezone.now().date()

        if self.frequency == 'daily':
            return from_date + timedelta(days=1)
        elif self.frequency == 'weekly':
            days_ahead = self.day_of_week - from_date.weekday()
            if days_ahead <= 0:
                days_ahead += 7
            return from_date + timedelta(days=days_ahead)
        elif self.frequency == 'biweekly':
            days_ahead = self.day_of_week - from_date.weekday()
            if days_ahead <= 0:
                days_ahead += 14
            else:
                days_ahead += 7
            return from_date + timedelta(days=days_ahead)
        elif self.frequency == 'monthly':
            # Try to set to day_of_month of next month
            next_month = from_date.month + 1
            year = from_date.year
            if next_month > 12:
                next_month = 1
                year += 1
            try:
                return from_date.replace(year=year, month=next_month, day=self.day_of_month or 1)
            except ValueError:
                # Handle months with fewer days
                import calendar
                last_day = calendar.monthrange(year, next_month)[1]
                return from_date.replace(year=year, month=next_month, day=min(self.day_of_month or 1, last_day))

        return from_date + timedelta(days=7)


class StandingOrderItem(models.Model):
    """
    Individual item in a standing order.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    standing_order = models.ForeignKey(
        StandingOrder,
        on_delete=models.CASCADE,
        related_name='items'
    )
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.PROTECT,
        related_name='standing_order_items'
    )
    quantity = models.PositiveIntegerField(help_text="Standard quantity to request")

    class Meta:
        unique_together = ('standing_order', 'item')

    def __str__(self):
        return f"{self.item.name} x {self.quantity}"


class StockTransferRequest(models.Model):
    """
    Request to transfer stock between locations.

    Workflow: pending → approved → in_transit → received/cancelled
    """
    STATUS_CHOICES = (
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('in_transit', 'In Transit'),
        ('received', 'Received'),
        ('cancelled', 'Cancelled'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='stock_transfer_requests'
    )
    transfer_number = models.CharField(
        max_length=50,
        unique=True,
        help_text="Auto-generated: TRF-FACILITY-YYYYMMDD-NNNN"
    )

    # Locations
    from_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='outgoing_transfer_requests',
        help_text="Source location"
    )
    to_location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='incoming_transfer_requests',
        help_text="Destination location"
    )

    # Requester
    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='transfer_requests_created'
    )

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    # Approval (if required)
    requires_approval = models.BooleanField(
        default=True,
        help_text="Does this transfer require approval?"
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_transfer_requests'
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    # Dispatch tracking
    dispatched_at = models.DateTimeField(null=True, blank=True)
    dispatched_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='dispatched_transfers'
    )

    # Receipt tracking
    received_at = models.DateTimeField(null=True, blank=True)
    received_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='received_transfers'
    )

    # Notes
    reason = models.TextField(
        blank=True,
        null=True,
        help_text="Reason for transfer"
    )
    notes = models.TextField(blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at']),
            models.Index(fields=['transfer_number']),
            models.Index(fields=['from_location', 'status']),
            models.Index(fields=['to_location', 'status']),
        ]

    def __str__(self):
        return f"{self.transfer_number} ({self.get_status_display()})"


class StockTransferItem(models.Model):
    """
    Individual item in a stock transfer request.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transfer = models.ForeignKey(
        StockTransferRequest,
        on_delete=models.CASCADE,
        related_name='items'
    )
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.PROTECT,
        related_name='transfer_items'
    )

    # Batch tracking (optional - for FEFO)
    batch = models.ForeignKey(
        ExpiryTracker,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transfer_items',
        help_text="Specific batch to transfer"
    )

    # Quantities
    quantity_requested = models.PositiveIntegerField()
    quantity_dispatched = models.PositiveIntegerField(
        default=0,
        help_text="Quantity actually dispatched"
    )
    quantity_received = models.PositiveIntegerField(
        default=0,
        help_text="Quantity received at destination"
    )

    # Movement references
    dispatch_movement = models.ForeignKey(
        StockMovement,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transfer_dispatch_items',
        help_text="Stock movement for dispatch (transfer_out)"
    )
    receipt_movement = models.ForeignKey(
        StockMovement,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transfer_receipt_items',
        help_text="Stock movement for receipt (transfer_in)"
    )

    # Notes
    notes = models.TextField(blank=True, null=True)

    class Meta:
        unique_together = ('transfer', 'item', 'batch')

    def __str__(self):
        batch_info = f" (Batch: {self.batch.batch_number})" if self.batch else ""
        return f"{self.item.name}{batch_info} x {self.quantity_requested}"

    @property
    def quantity_pending_dispatch(self):
        """Quantity still to be dispatched."""
        return max(0, self.quantity_requested - self.quantity_dispatched)

    @property
    def quantity_pending_receipt(self):
        """Quantity dispatched but not yet received."""
        return max(0, self.quantity_dispatched - self.quantity_received)


# =============================================================================
# Controlled Substance Models (Phase 5)
# =============================================================================


class ControlledSubstanceRegister(models.Model):
    """
    Register for tracking controlled substances at a location.

    Each controlled substance item has a register per location.
    The running_balance is the source of truth and must be validated
    against physical counts regularly.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='controlled_substance_registers'
    )
    location = models.ForeignKey(
        StorageLocation,
        on_delete=models.PROTECT,
        related_name='controlled_substance_registers',
        help_text="Storage location for this register"
    )
    item = models.ForeignKey(
        InventoryItem,
        on_delete=models.PROTECT,
        related_name='controlled_substance_registers',
        help_text="Controlled substance item"
    )

    # Balance
    running_balance = models.PositiveIntegerField(
        default=0,
        help_text="Current balance (source of truth)"
    )

    # Tracking
    last_entry_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp of last entry"
    )
    last_audit_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp of last physical count"
    )

    # Status
    is_active = models.BooleanField(default=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='created_controlled_registers'
    )

    class Meta:
        unique_together = ('location', 'item')
        ordering = ['location__name', 'item__name']
        indexes = [
            models.Index(fields=['facility', 'location']),
            models.Index(fields=['facility', 'item']),
            models.Index(fields=['location', 'item', 'is_active']),
        ]

    def __str__(self):
        return f"{self.item.name} @ {self.location.name} (Balance: {self.running_balance})"

    def validate_balance(self):
        """
        Validate running balance against sum of entries.
        Returns tuple of (is_valid, calculated_balance, discrepancy).
        """
        from django.db.models import Sum

        # Calculate balance from entries
        entries = self.entries.aggregate(
            additions=Sum('quantity', filter=Q(
                entry_type__in=['receipt', 'transfer_in', 'return', 'adjustment']
            )),
            deductions=Sum('quantity', filter=Q(
                entry_type__in=['dispense', 'wastage', 'transfer_out', 'disposal']
            ))
        )

        additions = entries['additions'] or 0
        deductions = entries['deductions'] or 0
        calculated = additions - deductions

        return (
            self.running_balance == calculated,
            calculated,
            self.running_balance - calculated
        )


class ControlledSubstanceEntry(models.Model):
    """
    Individual entry in a controlled substance register.

    Every controlled substance transaction requires:
    - The person performing the action
    - A witness (must be different from performer)
    - Patient/prescription info (for dispense)
    - Detailed wastage documentation if applicable
    """
    ENTRY_TYPE_CHOICES = (
        ('receipt', 'Receipt'),
        ('dispense', 'Dispense'),
        ('wastage', 'Wastage'),
        ('adjustment', 'Adjustment'),
        ('transfer_in', 'Transfer In'),
        ('transfer_out', 'Transfer Out'),
        ('return', 'Return'),
        ('disposal', 'Disposal'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    register = models.ForeignKey(
        ControlledSubstanceRegister,
        on_delete=models.CASCADE,
        related_name='entries'
    )

    # Entry identification
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    entry_number = models.PositiveIntegerField(
        help_text="Sequential number within register"
    )

    # Quantities
    quantity = models.PositiveIntegerField()
    balance_before = models.PositiveIntegerField()
    balance_after = models.PositiveIntegerField()

    # Batch tracking
    batch = models.ForeignKey(
        ExpiryTracker,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='controlled_substance_entries',
        help_text="Batch used/received"
    )

    # Patient and prescription (for dispense)
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='controlled_substance_entries',
        help_text="Patient for dispense operations"
    )
    prescription = models.ForeignKey(
        'clinical_notes.Prescription',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='controlled_substance_entries',
        help_text="Prescription for dispense operations"
    )

    # Mandatory witnesses - CRITICAL for audit trail
    performed_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='controlled_entries_performed',
        help_text="Person who performed the action"
    )
    witness = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='controlled_entries_witnessed',
        help_text="Witness (must be different from performer)"
    )

    # Wastage documentation
    wastage_reason = models.TextField(
        blank=True,
        null=True,
        help_text="Reason for wastage (if applicable)"
    )
    wastage_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Amount wasted (if partial dose)"
    )

    # Link to stock movement
    stock_movement = models.ForeignKey(
        StockMovement,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='controlled_substance_entries'
    )

    # Notes
    notes = models.TextField(blank=True, null=True)

    # Timestamp
    timestamp = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['-timestamp']
        unique_together = ('register', 'entry_number')
        indexes = [
            models.Index(fields=['register', '-timestamp']),
            models.Index(fields=['register', 'entry_number']),
            models.Index(fields=['performed_by', '-timestamp']),
            models.Index(fields=['witness', '-timestamp']),
            models.Index(fields=['patient', '-timestamp']),
            models.Index(fields=['entry_type', '-timestamp']),
        ]

    def __str__(self):
        return f"{self.register.item.name} #{self.entry_number} - {self.get_entry_type_display()} {self.quantity}"

    def clean(self):
        """Validate that witness is different from performer."""
        from django.core.exceptions import ValidationError
        if self.performed_by_id and self.witness_id:
            if self.performed_by_id == self.witness_id:
                raise ValidationError({
                    'witness': 'Witness must be different from the person performing the action.'
                })

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class ControlledSubstanceDiscrepancy(models.Model):
    """
    Discrepancy report for controlled substance count.

    Created when physical count doesn't match register balance.
    """
    STATUS_CHOICES = (
        ('reported', 'Reported'),
        ('investigating', 'Under Investigation'),
        ('resolved', 'Resolved'),
        ('escalated', 'Escalated'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    register = models.ForeignKey(
        ControlledSubstanceRegister,
        on_delete=models.CASCADE,
        related_name='discrepancies'
    )

    # Discrepancy details
    expected_balance = models.PositiveIntegerField()
    actual_balance = models.PositiveIntegerField()
    discrepancy = models.IntegerField(help_text="Positive = overage, Negative = shortage")

    # Discovery
    discovered_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='discovered_discrepancies'
    )
    discovered_at = models.DateTimeField(default=timezone.now)

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='reported')

    # Investigation
    investigation_notes = models.TextField(blank=True, null=True)

    # Resolution
    resolved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='resolved_discrepancies'
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_notes = models.TextField(blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-discovered_at']
        indexes = [
            models.Index(fields=['register', 'status']),
            models.Index(fields=['status', '-discovered_at']),
        ]

    def __str__(self):
        return f"Discrepancy {self.register.item.name} - {abs(self.discrepancy)} {'over' if self.discrepancy > 0 else 'short'}"

    @property
    def is_shortage(self):
        """Check if this is a shortage (more critical)."""
        return self.discrepancy < 0

    @property
    def requires_escalation(self):
        """Check if discrepancy requires escalation (>1 unit shortage)."""
        return self.discrepancy < -1
