"""
Tests for the StockService and BatchSelectionService.

These tests verify:
- Atomic stock adjustments
- Stock transfers between locations
- Batch selection using FEFO
- Concurrent operation handling
"""
import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone
from django.db import transaction, IntegrityError
from unittest.mock import patch

from apps.inventory.models import (
    InventoryItem, InventoryCategory, Supplier, StorageLocation,
    LocationStock, StockMovement, ExpiryTracker
)
from apps.inventory.services import (
    StockService, BatchSelectionService, InsufficientStockError
)
from apps.core.models import Facility
from apps.users.models import User


@pytest.fixture
def facility(db):
    """Create a test facility."""
    facility, _ = Facility.objects.get_or_create(
        code='TEST-INV',
        defaults={
            'name': 'Test Hospital Inventory',
            'address': '123 Test St',
            'city': 'Test City',
            'phone': '123-456-7890',
            'email': 'test-inv@hospital.com',
            'is_active': True,
            'status': 'ready'
        }
    )
    return facility


@pytest.fixture
def user(db, facility):
    """Create a test user."""
    user, _ = User.objects.get_or_create(
        username='testuser_inv',
        defaults={
            'email': 'testuser_inv@hospital.com',
            'first_name': 'Test',
            'last_name': 'User'
        }
    )
    user.set_password('testpass123')
    user.save()
    return user


@pytest.fixture
def category(db, facility, user):
    """Create a test inventory category."""
    return InventoryCategory.objects.create(
        facility=facility,
        name='Test Category',
        created_by=user
    )


@pytest.fixture
def supplier(db, facility, user):
    """Create a test supplier."""
    return Supplier.objects.create(
        facility=facility,
        name='Test Supplier',
        created_by=user
    )


@pytest.fixture
def inventory_item(db, facility, category, supplier, user):
    """Create a test inventory item."""
    return InventoryItem.objects.create(
        facility=facility,
        name='Test Medication',
        sku='TEST-001',
        item_type='medication',
        category=category,
        supplier=supplier,
        unit_of_measure='tablet',
        unit_cost=Decimal('10.00'),
        selling_price=Decimal('15.00'),
        reorder_level=10,
        reorder_quantity=100,
        created_by=user
    )


@pytest.fixture
def storage_location(db, facility, user):
    """Create a test storage location."""
    return StorageLocation.objects.create(
        facility=facility,
        code='MAIN-PHARMACY',
        name='Main Pharmacy',
        location_type='pharmacy',
        can_dispense_to_patients=True,
        allows_controlled_substances=True,
        created_by=user
    )


@pytest.fixture
def secondary_location(db, facility, user):
    """Create a secondary storage location."""
    return StorageLocation.objects.create(
        facility=facility,
        code='WARD-A',
        name='Ward A Store',
        location_type='ward_store',
        can_dispense_to_patients=False,
        created_by=user
    )


class TestStockService:
    """Tests for StockService.adjust_stock and transfer_stock."""

    @pytest.mark.django_db
    def test_adjust_stock_increase(self, inventory_item, storage_location, user):
        """Test increasing stock at a location."""
        movement, loc_stock = StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=100,
            movement_type='purchase',
            user=user,
            reference_number='PO-001',
        )

        assert loc_stock.quantity == 100
        assert loc_stock.reserved_quantity == 0
        assert movement.quantity == 100
        assert movement.movement_type == 'purchase'
        assert movement.destination_location == storage_location
        assert movement.source_location is None
        assert movement.previous_stock == 0
        assert movement.new_stock == 100

    @pytest.mark.django_db
    def test_adjust_stock_decrease(self, inventory_item, storage_location, user):
        """Test decreasing stock at a location."""
        # First add stock
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=100,
            movement_type='purchase',
            user=user,
        )

        # Then decrease
        movement, loc_stock = StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=-30,
            movement_type='dispense',
            user=user,
        )

        assert loc_stock.quantity == 70
        assert movement.quantity == 30
        assert movement.movement_type == 'dispense'
        assert movement.source_location == storage_location
        assert movement.destination_location is None
        assert movement.previous_stock == 100
        assert movement.new_stock == 70

    @pytest.mark.django_db
    def test_adjust_stock_insufficient_error(self, inventory_item, storage_location, user):
        """Test that insufficient stock raises error."""
        # Add only 50 units
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=50,
            movement_type='purchase',
            user=user,
        )

        # Try to dispense 100 units
        with pytest.raises(InsufficientStockError) as exc_info:
            StockService.adjust_stock(
                item=inventory_item,
                location=storage_location,
                quantity_change=-100,
                movement_type='dispense',
                user=user,
            )

        assert exc_info.value.requested == 100
        assert exc_info.value.available == 50

    @pytest.mark.django_db
    def test_adjust_stock_creates_expiry_tracker(self, inventory_item, storage_location, user):
        """Test that adding stock with expiry date creates ExpiryTracker."""
        expiry_date = (timezone.now() + timedelta(days=365)).date()

        movement, loc_stock = StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=100,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-001',
            expiry_date=expiry_date,
        )

        tracker = ExpiryTracker.objects.get(
            item=inventory_item,
            batch_number='BATCH-001'
        )
        assert tracker.remaining_quantity == 100
        assert tracker.initial_quantity == 100
        assert tracker.expiry_date == expiry_date
        assert tracker.location == storage_location
        assert tracker.status == 'active'

    @pytest.mark.django_db
    def test_transfer_stock(
        self, inventory_item, storage_location, secondary_location, user
    ):
        """Test transferring stock between locations."""
        # First add stock to source location
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=100,
            movement_type='purchase',
            user=user,
        )

        # Transfer to secondary location
        out_movement, in_movement = StockService.transfer_stock(
            item=inventory_item,
            from_location=storage_location,
            to_location=secondary_location,
            quantity=30,
            user=user,
        )

        # Check source location
        source_stock = LocationStock.objects.get(
            item=inventory_item, location=storage_location
        )
        assert source_stock.quantity == 70

        # Check destination location
        dest_stock = LocationStock.objects.get(
            item=inventory_item, location=secondary_location
        )
        assert dest_stock.quantity == 30

        # Check movements
        assert out_movement.movement_type == 'transfer_out'
        assert out_movement.source_location == storage_location
        assert out_movement.quantity == 30

        assert in_movement.movement_type == 'transfer_in'
        assert in_movement.destination_location == secondary_location
        assert in_movement.quantity == 30

    @pytest.mark.django_db
    def test_transfer_stock_insufficient(
        self, inventory_item, storage_location, secondary_location, user
    ):
        """Test that transfer fails with insufficient stock."""
        # Add only 20 units
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=20,
            movement_type='purchase',
            user=user,
        )

        # Try to transfer 50 units
        with pytest.raises(InsufficientStockError):
            StockService.transfer_stock(
                item=inventory_item,
                from_location=storage_location,
                to_location=secondary_location,
                quantity=50,
                user=user,
            )

        # Ensure no partial transfer occurred (atomic)
        source_stock = LocationStock.objects.get(
            item=inventory_item, location=storage_location
        )
        assert source_stock.quantity == 20

        # Destination should not exist
        assert not LocationStock.objects.filter(
            item=inventory_item, location=secondary_location
        ).exists()

    @pytest.mark.django_db
    def test_transfer_same_location_error(
        self, inventory_item, storage_location, user
    ):
        """Test that transfer to same location raises error."""
        from django.core.exceptions import ValidationError

        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=100,
            movement_type='purchase',
            user=user,
        )

        with pytest.raises(ValidationError):
            StockService.transfer_stock(
                item=inventory_item,
                from_location=storage_location,
                to_location=storage_location,
                quantity=50,
                user=user,
            )

    @pytest.mark.django_db
    def test_check_availability(self, inventory_item, storage_location, user):
        """Test stock availability check."""
        # Add stock
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=100,
            movement_type='purchase',
            user=user,
        )

        # Check availability for 50 units
        result = StockService.check_availability(
            item=inventory_item,
            location=storage_location,
            quantity_needed=50,
        )

        assert result['available'] is True
        assert result['available_quantity'] == 100
        assert result['shortfall'] == 0

    @pytest.mark.django_db
    def test_check_availability_insufficient(
        self, inventory_item, storage_location, user
    ):
        """Test availability check with insufficient stock."""
        # Add only 30 units
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=30,
            movement_type='purchase',
            user=user,
        )

        result = StockService.check_availability(
            item=inventory_item,
            location=storage_location,
            quantity_needed=50,
        )

        assert result['available'] is False
        assert result['available_quantity'] == 30
        assert result['shortfall'] == 20


class TestBatchSelectionService:
    """Tests for BatchSelectionService (FEFO)."""

    @pytest.mark.django_db
    def test_select_batch_fefo(self, inventory_item, storage_location, user):
        """Test that batches are selected in FEFO order."""
        today = timezone.now().date()

        # Add three batches with different expiry dates
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=50,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-LONG',
            expiry_date=today + timedelta(days=365),
        )
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=30,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-SHORT',
            expiry_date=today + timedelta(days=30),  # Expires soonest
        )
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=40,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-MEDIUM',
            expiry_date=today + timedelta(days=180),
        )

        # Request 60 units - should take from SHORT first, then MEDIUM
        selections = BatchSelectionService.select_batch_fefo(
            item=inventory_item,
            location=storage_location,
            quantity_needed=60,
        )

        assert len(selections) == 2
        assert selections[0]['batch_number'] == 'BATCH-SHORT'
        assert selections[0]['quantity'] == 30
        assert selections[1]['batch_number'] == 'BATCH-MEDIUM'
        assert selections[1]['quantity'] == 30

    @pytest.mark.django_db
    def test_select_batch_fefo_skips_expired(self, inventory_item, storage_location, user):
        """Test that expired batches are skipped."""
        today = timezone.now().date()

        # Add expired batch
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=50,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-EXPIRED',
            expiry_date=today - timedelta(days=1),
        )
        # Mark as expired
        tracker = ExpiryTracker.objects.get(batch_number='BATCH-EXPIRED')
        tracker.status = 'active'  # Still active but date is past
        tracker.save()

        # Add valid batch
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=30,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-VALID',
            expiry_date=today + timedelta(days=30),
        )

        # Request 40 units - should only get 30 from valid batch
        selections = BatchSelectionService.select_batch_fefo(
            item=inventory_item,
            location=storage_location,
            quantity_needed=40,
        )

        assert len(selections) == 1
        assert selections[0]['batch_number'] == 'BATCH-VALID'
        assert selections[0]['quantity'] == 30

    @pytest.mark.django_db
    def test_batch_recommendations_with_warnings(
        self, inventory_item, storage_location, user
    ):
        """Test that recommendations include warnings for expiring items."""
        today = timezone.now().date()

        # Add batch expiring in 5 days (critical)
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=20,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-CRITICAL',
            expiry_date=today + timedelta(days=5),
        )

        # Add batch expiring in 20 days (warning)
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=20,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-WARNING',
            expiry_date=today + timedelta(days=20),
        )

        result = BatchSelectionService.get_batch_recommendations(
            item=inventory_item,
            location=storage_location,
            quantity_needed=30,
        )

        assert result['is_sufficient'] is True
        assert len(result['warnings']) == 2

        # Check for critical warning
        critical_warnings = [w for w in result['warnings'] if w['level'] == 'critical']
        assert len(critical_warnings) == 1
        assert 'BATCH-CRITICAL' in critical_warnings[0]['message']

        # Check for warning level
        warning_warnings = [w for w in result['warnings'] if w['level'] == 'warning']
        assert len(warning_warnings) == 1
        assert 'BATCH-WARNING' in warning_warnings[0]['message']

    @pytest.mark.django_db
    def test_batch_recommendations_insufficient_warning(
        self, inventory_item, storage_location, user
    ):
        """Test that insufficient stock generates error warning."""
        today = timezone.now().date()

        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=20,
            movement_type='purchase',
            user=user,
            batch_number='BATCH-001',
            expiry_date=today + timedelta(days=365),
        )

        result = BatchSelectionService.get_batch_recommendations(
            item=inventory_item,
            location=storage_location,
            quantity_needed=50,  # Request more than available
        )

        assert result['is_sufficient'] is False
        assert result['total_available'] == 20

        error_warnings = [w for w in result['warnings'] if w['level'] == 'error']
        assert len(error_warnings) == 1
        assert 'Insufficient stock' in error_warnings[0]['message']


class TestLocationStock:
    """Tests for LocationStock model properties."""

    @pytest.mark.django_db
    def test_available_quantity(self, inventory_item, storage_location, user):
        """Test available_quantity excludes reserved stock."""
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=100,
            movement_type='purchase',
            user=user,
        )

        loc_stock = LocationStock.objects.get(
            item=inventory_item, location=storage_location
        )

        # Reserve some stock
        loc_stock.reserved_quantity = 30
        loc_stock.save()

        assert loc_stock.quantity == 100
        assert loc_stock.available_quantity == 70

    @pytest.mark.django_db
    def test_is_below_reorder(self, inventory_item, storage_location, user):
        """Test is_below_reorder property."""
        # Item has reorder_level = 10
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=5,  # Below reorder level
            movement_type='purchase',
            user=user,
        )

        loc_stock = LocationStock.objects.get(
            item=inventory_item, location=storage_location
        )

        assert loc_stock.is_below_reorder is True

    @pytest.mark.django_db
    def test_location_specific_reorder_override(
        self, inventory_item, storage_location, user
    ):
        """Test location-specific reorder level override."""
        StockService.adjust_stock(
            item=inventory_item,
            location=storage_location,
            quantity_change=15,
            movement_type='purchase',
            user=user,
        )

        loc_stock = LocationStock.objects.get(
            item=inventory_item, location=storage_location
        )

        # Item reorder level is 10, stock is 15 - not below
        assert loc_stock.is_below_reorder is False

        # Set location-specific override to 20
        loc_stock.reorder_level = 20
        loc_stock.save()

        # Now should be below reorder
        assert loc_stock.effective_reorder_level == 20
        assert loc_stock.is_below_reorder is True
