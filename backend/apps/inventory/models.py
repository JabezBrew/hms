import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta

User = get_user_model()


class InventoryCategory(models.Model):
    """
    Model for categorizing inventory items.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='children')
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_categories')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_categories')
    
    class Meta:
        verbose_name_plural = "Inventory Categories"
        ordering = ['name']
    
    def __str__(self):
        return self.name


class Supplier(models.Model):
    """
    Model for suppliers of inventory items.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
    
    def __str__(self):
        return self.name


class InventoryItem(models.Model):
    """
    Model for inventory items.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    category = models.ForeignKey(InventoryCategory, on_delete=models.SET_NULL, null=True, related_name='items')
    sku = models.CharField(max_length=50, unique=True)
    barcode = models.CharField(max_length=50, blank=True, null=True)
    
    # Item type
    ITEM_TYPE_CHOICES = (
        ('medication', 'Medication'),
        ('supply', 'Medical Supply'),
        ('equipment', 'Equipment'),
        ('consumable', 'Consumable'),
        ('other', 'Other'),
    )
    item_type = models.CharField(max_length=20, choices=ITEM_TYPE_CHOICES)
    
    # Stock details
    unit_of_measure = models.CharField(max_length=50)
    minimum_stock = models.PositiveIntegerField(default=0)
    reorder_level = models.PositiveIntegerField(default=0)
    current_stock = models.PositiveIntegerField(default=0)
    
    # Pricing
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    
    # Supplier
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name='items')
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # FHIR reference for medications
    fhir_medication_id = models.CharField(max_length=100, blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_items')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_items')
    
    class Meta:
        ordering = ['name']
    
    def __str__(self):
        return f"{self.name} ({self.sku})"
    
    @property
    def stock_value(self):
        """
        Calculate the current stock value.
        """
        return self.current_stock * self.unit_cost
    
    @property
    def is_low_stock(self):
        """
        Check if the item is low on stock.
        """
        return self.current_stock <= self.reorder_level


class StockMovement(models.Model):
    """
    Model for tracking stock movements.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name='movements')
    
    # Movement type
    MOVEMENT_TYPE_CHOICES = (
        ('purchase', 'Purchase'),
        ('sale', 'Sale'),
        ('return', 'Return'),
        ('adjustment', 'Adjustment'),
        ('transfer', 'Transfer'),
        ('disposal', 'Disposal'),
    )
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_TYPE_CHOICES)
    
    # Quantity and stock levels
    quantity = models.PositiveIntegerField()
    previous_stock = models.PositiveIntegerField()
    new_stock = models.PositiveIntegerField()
    
    # Reference information
    reference_number = models.CharField(max_length=50, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    
    # Batch and expiry
    batch_number = models.CharField(max_length=50, blank=True, null=True)
    expiry_date = models.DateField(blank=True, null=True)
    
    # Cost
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2)
    total_cost = models.DecimalField(max_digits=10, decimal_places=2)
    
    # Audit fields
    timestamp = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='stock_movements')
    
    class Meta:
        ordering = ['-timestamp']
    
    def __str__(self):
        return f"{self.get_movement_type_display()} - {self.item.name} - {self.quantity} {self.item.unit_of_measure}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to update item stock and calculate total cost.
        """
        # Calculate total cost
        self.total_cost = self.quantity * self.unit_cost
        
        # If this is a new movement, update the item's stock
        if not self.pk:
            # Set previous stock
            self.previous_stock = self.item.current_stock
            
            # Update stock based on movement type
            if self.movement_type in ['purchase', 'return']:
                self.item.current_stock += self.quantity
            elif self.movement_type in ['sale', 'disposal']:
                self.item.current_stock -= self.quantity
            elif self.movement_type == 'adjustment':
                # For adjustments, the quantity can be positive or negative
                self.item.current_stock = self.new_stock
            
            # Set new stock
            self.new_stock = self.item.current_stock
            
            # Save the item
            self.item.save()
            
            # Create batch if expiry date is provided
            if self.expiry_date and self.movement_type in ['purchase', 'return']:
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
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name='expiry_trackers')
    batch_number = models.CharField(max_length=50)
    expiry_date = models.DateField()
    
    # Quantities
    initial_quantity = models.PositiveIntegerField()
    remaining_quantity = models.PositiveIntegerField()
    
    # Reference to the stock movement
    movement = models.ForeignKey(StockMovement, on_delete=models.CASCADE, related_name='expiry_trackers')
    
    # Status
    STATUS_CHOICES = (
        ('active', 'Active'),
        ('consumed', 'Consumed'),
        ('expired', 'Expired'),
        ('disposed', 'Disposed'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_expiry_trackers')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_expiry_trackers')
    
    class Meta:
        ordering = ['expiry_date']
    
    def __str__(self):
        return f"{self.item.name} - Batch {self.batch_number} - Expires {self.expiry_date}"
    
    @property
    def is_expired(self):
        """
        Check if the batch is expired.
        """
        return self.expiry_date <= timezone.now().date()
    
    @property
    def days_until_expiry(self):
        """
        Calculate the number of days until expiry.
        """
        if self.is_expired:
            return 0
        delta = self.expiry_date - timezone.now().date()
        return delta.days
    
    @property
    def is_expiring_soon(self, days=30):
        """
        Check if the batch is expiring soon.
        """
        return 0 < self.days_until_expiry <= days


class InventoryAudit(models.Model):
    """
    Model for inventory audits.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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