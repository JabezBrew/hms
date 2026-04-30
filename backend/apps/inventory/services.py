"""
Inventory Services for HMS.

This module provides service classes for inventory operations including:
- Stock adjustments (atomic operations with location tracking)
- Stock transfers between locations
- Batch selection (FEFO - First Expiry First Out)
- Procurement workflow support
"""
import uuid
from decimal import Decimal
from typing import Optional, List, Dict, Tuple, Any, TYPE_CHECKING

from django.db import transaction
from django.db.models import F, Sum, Q
from django.utils import timezone
from django.core.exceptions import ValidationError

from django.db import models

from hms_backend.deployment import feature_enabled

from .models import (
    InventoryItem, StorageLocation, LocationStock,
    StockMovement, ExpiryTracker, Supplier
)

if TYPE_CHECKING:
    from .models import (
        PurchaseRequisition,
        PurchaseOrder,
        GoodsReceivedNote,
        StandingOrder,
        InternalRequisition,
        StockTransferRequest,
        ControlledSubstanceRegister,
        ControlledSubstanceEntry,
        ControlledSubstanceDiscrepancy,
    )


class InsufficientStockError(Exception):
    """Raised when there is not enough stock for an operation."""

    def __init__(self, item, location, requested, available):
        self.item = item
        self.location = location
        self.requested = requested
        self.available = available
        super().__init__(
            f"Insufficient stock for {item.name} at {location.name}: "
            f"requested {requested}, available {available}"
        )


class FeatureDisabledError(ValidationError):
    """Raised when inventory services are called while the module is disabled."""


def _resolve_facility(*objects):
    for obj in objects:
        if obj is None:
            continue
        facility = getattr(obj, 'facility', None)
        if facility is not None:
            return facility
        item = getattr(obj, 'item', None)
        facility = getattr(item, 'facility', None)
        if facility is not None:
            return facility
        register = getattr(obj, 'register', None)
        facility = getattr(register, 'facility', None)
        if facility is not None:
            return facility
    return None


def _ensure_inventory_enabled(facility=None, *objects) -> None:
    resolved_facility = facility or _resolve_facility(*objects)
    if not feature_enabled('inventory', facility=resolved_facility):
        raise FeatureDisabledError(
            "Inventory feature is not enabled for this deployment."
        )


def _inventory_enabled(facility=None, *objects) -> bool:
    try:
        _ensure_inventory_enabled(facility, *objects)
    except FeatureDisabledError:
        return False
    return True


class StockService:
    """
    Service for atomic stock operations.

    All stock modifications should go through this service to ensure:
    - Atomic updates (no race conditions)
    - Proper audit trails (StockMovement records)
    - LocationStock synchronization
    - Batch/expiry tracking
    """

    @staticmethod
    @transaction.atomic
    def adjust_stock(
        item: InventoryItem,
        location: StorageLocation,
        quantity_change: int,
        movement_type: str,
        user,
        *,
        reference_number: str = None,
        reference_type: str = None,
        reference_id: uuid.UUID = None,
        notes: str = None,
        batch_number: str = None,
        expiry_date=None,
        expiry_tracker: ExpiryTracker = None,
        unit_cost: Decimal = None,
        patient=None,
    ) -> Tuple[StockMovement, LocationStock]:
        """
        Atomically adjust stock at a specific location.

        Args:
            item: The inventory item
            location: The storage location
            quantity_change: Positive for increase, negative for decrease
            movement_type: Type of movement (e.g., 'purchase', 'dispense', 'adjustment')
            user: User performing the operation
            reference_number: External reference (e.g., PO number)
            reference_type: Type of reference document
            reference_id: UUID of related object
            notes: Additional notes
            batch_number: Batch/lot number
            expiry_date: Expiry date for new batches
            expiry_tracker: Existing batch being consumed
            unit_cost: Override unit cost (defaults to item.unit_cost)
            patient: Patient profile for dispense operations

        Returns:
            Tuple of (StockMovement, LocationStock)

        Raises:
            InsufficientStockError: If decreasing stock below zero
            ValidationError: If invalid parameters
        """
        _ensure_inventory_enabled(None, item, location)

        # Get or create LocationStock with row-level locking
        loc_stock, created = LocationStock.objects.select_for_update().get_or_create(
            item=item,
            location=location,
            defaults={'quantity': 0, 'reserved_quantity': 0}
        )

        previous_stock = loc_stock.quantity

        # Calculate new stock
        if quantity_change < 0:
            # Decreasing stock
            if loc_stock.available_quantity < abs(quantity_change):
                raise InsufficientStockError(
                    item=item,
                    location=location,
                    requested=abs(quantity_change),
                    available=loc_stock.available_quantity
                )
            loc_stock.quantity = loc_stock.quantity - abs(quantity_change)
        else:
            # Increasing stock
            loc_stock.quantity = loc_stock.quantity + quantity_change

        loc_stock.last_movement_at = timezone.now()
        loc_stock.save()

        # Create stock movement record
        cost = unit_cost if unit_cost is not None else item.unit_cost
        movement = StockMovement.objects.create(
            item=item,
            facility=item.facility,
            movement_type=movement_type,
            source_location=location if quantity_change < 0 else None,
            destination_location=location if quantity_change > 0 else None,
            quantity=abs(quantity_change),
            previous_stock=previous_stock,
            new_stock=loc_stock.quantity,
            reference_number=reference_number,
            reference_type=reference_type,
            reference_id=reference_id,
            notes=notes,
            batch_number=batch_number,
            expiry_date=expiry_date,
            expiry_tracker=expiry_tracker,
            unit_cost=cost,
            total_cost=cost * abs(quantity_change),
            patient=patient,
            created_by=user,
        )

        # Create expiry tracker for incoming stock with expiry date
        if quantity_change > 0 and expiry_date and batch_number:
            ExpiryTracker.objects.create(
                item=item,
                batch_number=batch_number,
                expiry_date=expiry_date,
                location=location,
                initial_quantity=quantity_change,
                remaining_quantity=quantity_change,
                movement=movement,
                created_by=user,
            )

        # Update expiry tracker if consuming from a batch
        if expiry_tracker and quantity_change < 0:
            expiry_tracker.remaining_quantity = max(
                0, expiry_tracker.remaining_quantity - abs(quantity_change)
            )
            if expiry_tracker.remaining_quantity == 0:
                expiry_tracker.status = 'consumed'
            expiry_tracker.updated_by = user
            expiry_tracker.save()

        return movement, loc_stock

    @staticmethod
    @transaction.atomic
    def transfer_stock(
        item: InventoryItem,
        from_location: StorageLocation,
        to_location: StorageLocation,
        quantity: int,
        user,
        *,
        reference_number: str = None,
        reference_id: uuid.UUID = None,
        notes: str = None,
        batch_number: str = None,
        expiry_tracker: ExpiryTracker = None,
    ) -> Tuple[StockMovement, StockMovement]:
        """
        Atomically transfer stock between two locations.

        Creates two movements: transfer_out from source, transfer_in to destination.

        Args:
            item: The inventory item
            from_location: Source location
            to_location: Destination location
            quantity: Amount to transfer
            user: User performing the operation
            reference_number: Transfer reference number
            reference_id: UUID of transfer request
            notes: Additional notes
            batch_number: Batch being transferred
            expiry_tracker: Specific batch to transfer from

        Returns:
            Tuple of (outbound_movement, inbound_movement)

        Raises:
            InsufficientStockError: If source doesn't have enough stock
            ValidationError: If from_location == to_location
        """
        _ensure_inventory_enabled(None, item, from_location, to_location)

        if from_location.id == to_location.id:
            raise ValidationError("Source and destination locations must be different")

        if quantity <= 0:
            raise ValidationError("Transfer quantity must be positive")

        # Get expiry date from tracker if provided
        expiry_date = expiry_tracker.expiry_date if expiry_tracker else None

        # Perform outbound adjustment
        out_movement, _ = StockService.adjust_stock(
            item=item,
            location=from_location,
            quantity_change=-quantity,
            movement_type='transfer_out',
            user=user,
            reference_number=reference_number,
            reference_type='Transfer',
            reference_id=reference_id,
            notes=notes,
            batch_number=batch_number,
            expiry_tracker=expiry_tracker,
        )

        # Perform inbound adjustment
        in_movement, _ = StockService.adjust_stock(
            item=item,
            location=to_location,
            quantity_change=quantity,
            movement_type='transfer_in',
            user=user,
            reference_number=reference_number,
            reference_type='Transfer',
            reference_id=reference_id,
            notes=notes,
            batch_number=batch_number,
            expiry_date=expiry_date,
        )

        return out_movement, in_movement

    @staticmethod
    def check_availability(
        item: InventoryItem,
        location: StorageLocation,
        quantity_needed: int,
    ) -> Dict[str, Any]:
        """
        Check stock availability at a location without modifying stock.

        Returns:
            Dict with:
                - available: bool
                - quantity_at_location: int
                - available_quantity: int (excluding reserved)
                - shortfall: int (0 if sufficient)
                - alternative_locations: List of locations with stock
        """
        if not _inventory_enabled(None, item, location):
            return {
                'available': False,
                'quantity_at_location': 0,
                'available_quantity': 0,
                'shortfall': quantity_needed,
                'alternative_locations': [],
            }

        try:
            loc_stock = LocationStock.objects.get(item=item, location=location)
            available_qty = loc_stock.available_quantity
        except LocationStock.DoesNotExist:
            available_qty = 0

        # Find alternative locations with stock
        alternatives = []
        if available_qty < quantity_needed:
            alt_stocks = LocationStock.objects.filter(
                item=item,
                quantity__gt=F('reserved_quantity'),
                location__is_active=True,
            ).exclude(
                location=location
            ).select_related('location').order_by('-quantity')[:5]

            for alt in alt_stocks:
                alternatives.append({
                    'location_id': str(alt.location.id),
                    'location_name': alt.location.name,
                    'available': alt.available_quantity,
                })

        return {
            'available': available_qty >= quantity_needed,
            'quantity_at_location': loc_stock.quantity if 'loc_stock' in dir() else 0,
            'available_quantity': available_qty,
            'shortfall': max(0, quantity_needed - available_qty),
            'alternative_locations': alternatives,
        }


class BatchSelectionService:
    """
    Service for selecting batches using FEFO (First Expiry First Out).

    When dispensing or consuming inventory, this service helps select
    the appropriate batch(es) to use, prioritizing items that expire soonest.
    """

    @staticmethod
    def select_batch_fefo(
        item: InventoryItem,
        location: StorageLocation,
        quantity_needed: int,
    ) -> List[Dict[str, Any]]:
        """
        Select batches using FEFO (First Expiry First Out).

        Prioritizes batches with earliest expiry dates that:
        - Are at the specified location
        - Have status 'active'
        - Have remaining quantity > 0
        - Are not already expired

        Args:
            item: The inventory item
            location: Storage location to select from
            quantity_needed: Total quantity needed

        Returns:
            List of dicts with:
                - batch: ExpiryTracker instance
                - quantity: Amount to take from this batch
        """
        if not _inventory_enabled(None, item, location):
            return []

        today = timezone.now().date()

        # Get active batches at this location, ordered by expiry date
        batches = ExpiryTracker.objects.filter(
            item=item,
            location=location,
            status='active',
            remaining_quantity__gt=0,
            expiry_date__gt=today,  # Not expired
        ).order_by('expiry_date')

        selections = []
        remaining_needed = quantity_needed

        for batch in batches:
            if remaining_needed <= 0:
                break

            take_qty = min(batch.remaining_quantity, remaining_needed)
            selections.append({
                'batch': batch,
                'batch_id': str(batch.id),
                'batch_number': batch.batch_number,
                'expiry_date': batch.expiry_date,
                'quantity': take_qty,
                'days_until_expiry': batch.days_until_expiry,
            })
            remaining_needed -= take_qty

        return selections

    @staticmethod
    def get_batch_recommendations(
        item: InventoryItem,
        location: StorageLocation,
        quantity_needed: int,
    ) -> Dict[str, Any]:
        """
        Get batch recommendations with warnings for expiring items.

        Returns recommendations along with warnings about:
        - Items expiring within 30 days
        - Items expiring within 7 days
        - Insufficient stock

        Args:
            item: The inventory item
            location: Storage location
            quantity_needed: Quantity needed

        Returns:
            Dict with:
                - selections: List of batch selections
                - total_available: Total quantity available
                - is_sufficient: Whether enough stock exists
                - warnings: List of warning messages
        """
        if not _inventory_enabled(None, item, location):
            return {
                'selections': [],
                'total_available': 0,
                'is_sufficient': False,
                'warnings': [
                    {
                        'level': 'error',
                        'message': 'Inventory feature is not enabled for this deployment.',
                    }
                ],
            }

        selections = BatchSelectionService.select_batch_fefo(
            item, location, quantity_needed
        )

        total_available = sum(s['quantity'] for s in selections)
        is_sufficient = total_available >= quantity_needed

        warnings = []

        # Check for expiring items
        for sel in selections:
            days = sel['days_until_expiry']
            if days <= 7:
                warnings.append({
                    'level': 'critical',
                    'message': f"Batch {sel['batch_number']} expires in {days} days",
                    'batch_id': sel['batch_id'],
                })
            elif days <= 30:
                warnings.append({
                    'level': 'warning',
                    'message': f"Batch {sel['batch_number']} expires in {days} days",
                    'batch_id': sel['batch_id'],
                })

        if not is_sufficient:
            shortfall = quantity_needed - total_available
            warnings.append({
                'level': 'error',
                'message': f"Insufficient stock: need {quantity_needed}, have {total_available} (short by {shortfall})",
            })

        return {
            'selections': selections,
            'total_available': total_available,
            'is_sufficient': is_sufficient,
            'warnings': warnings,
        }

    @staticmethod
    def get_expiring_batches(
        facility,
        days: int = 30,
        location: StorageLocation = None,
    ) -> List[ExpiryTracker]:
        """
        Get batches expiring within specified days.

        Args:
            facility: Facility to filter by
            days: Number of days to look ahead
            location: Optional location filter

        Returns:
            List of ExpiryTracker instances
        """
        if not _inventory_enabled(facility, location):
            return []

        today = timezone.now().date()
        expiry_threshold = today + timezone.timedelta(days=days)

        queryset = ExpiryTracker.objects.filter(
            item__facility=facility,
            status='active',
            remaining_quantity__gt=0,
            expiry_date__lte=expiry_threshold,
            expiry_date__gt=today,
        ).select_related('item', 'location').order_by('expiry_date')

        if location:
            queryset = queryset.filter(location=location)

        return list(queryset)


# =============================================================================
# Procurement Services (Phase 3: Procurement Workflow)
# =============================================================================


class ProcurementService:
    """
    Service for procurement workflow operations.

    Handles:
    - Requisition number generation
    - Auto-requisition creation from reorder alerts
    - Requisition to PO conversion
    - GRN acceptance and stock updates
    """

    @staticmethod
    def generate_requisition_number(facility) -> str:
        """
        Generate unique requisition number.
        Format: REQ-{FACILITY_CODE}-{YYYYMMDD}-{NNNN}
        """
        from .models import PurchaseRequisition

        today = timezone.now()
        date_str = today.strftime('%Y%m%d')
        prefix = f"REQ-{facility.code}-{date_str}-"

        # Get last number for today
        last_req = PurchaseRequisition.objects.filter(
            requisition_number__startswith=prefix
        ).order_by('-requisition_number').first()

        if last_req:
            last_num = int(last_req.requisition_number.split('-')[-1])
            next_num = last_num + 1
        else:
            next_num = 1

        return f"{prefix}{next_num:04d}"

    @staticmethod
    def generate_po_number(facility) -> str:
        """
        Generate unique purchase order number.
        Format: PO-{FACILITY_CODE}-{YYYYMMDD}-{NNNN}
        """
        from .models import PurchaseOrder

        today = timezone.now()
        date_str = today.strftime('%Y%m%d')
        prefix = f"PO-{facility.code}-{date_str}-"

        last_po = PurchaseOrder.objects.filter(
            po_number__startswith=prefix
        ).order_by('-po_number').first()

        if last_po:
            last_num = int(last_po.po_number.split('-')[-1])
            next_num = last_num + 1
        else:
            next_num = 1

        return f"{prefix}{next_num:04d}"

    @staticmethod
    def generate_grn_number(facility) -> str:
        """
        Generate unique GRN number.
        Format: GRN-{FACILITY_CODE}-{YYYYMMDD}-{NNNN}
        """
        from .models import GoodsReceivedNote

        today = timezone.now()
        date_str = today.strftime('%Y%m%d')
        prefix = f"GRN-{facility.code}-{date_str}-"

        last_grn = GoodsReceivedNote.objects.filter(
            grn_number__startswith=prefix
        ).order_by('-grn_number').first()

        if last_grn:
            last_num = int(last_grn.grn_number.split('-')[-1])
            next_num = last_num + 1
        else:
            next_num = 1

        return f"{prefix}{next_num:04d}"

    @staticmethod
    @transaction.atomic
    def create_auto_requisition(
        facility,
        items_below_reorder: List[InventoryItem],
        user,
        location: 'StorageLocation' = None,
    ) -> 'PurchaseRequisition':
        """
        Create an auto-generated requisition for items below reorder level.

        Args:
            facility: Facility context
            items_below_reorder: List of items needing reorder
            user: System user or designated auto-reorder user
            location: Optional location context

        Returns:
            Created PurchaseRequisition
        """
        _ensure_inventory_enabled(facility, location, *items_below_reorder)

        from .models import PurchaseRequisition, PurchaseRequisitionItem

        req = PurchaseRequisition.objects.create(
            facility=facility,
            requisition_number=ProcurementService.generate_requisition_number(facility),
            requested_by=user,
            requesting_location=location,
            priority='normal',
            status='draft',
            is_auto_generated=True,
            justification="Auto-generated requisition for items below reorder level",
        )

        for item in items_below_reorder:
            PurchaseRequisitionItem.objects.create(
                requisition=req,
                item=item,
                quantity_requested=item.reorder_quantity or item.reorder_level * 2,
                current_stock_at_request=item.total_stock,
                reorder_level=item.reorder_level,
                preferred_supplier=item.supplier,
            )

        return req

    @staticmethod
    @transaction.atomic
    def submit_requisition(requisition: 'PurchaseRequisition') -> 'PurchaseRequisition':
        """
        Submit a requisition for approval.
        """
        _ensure_inventory_enabled(None, requisition)

        if requisition.status != 'draft':
            raise ValidationError("Only draft requisitions can be submitted")

        requisition.status = 'pending_approval'
        requisition.save()
        return requisition

    @staticmethod
    @transaction.atomic
    def approve_requisition(
        requisition: 'PurchaseRequisition',
        approver,
    ) -> 'PurchaseRequisition':
        """
        Approve a requisition.
        """
        _ensure_inventory_enabled(None, requisition)

        if requisition.status != 'pending_approval':
            raise ValidationError("Only pending requisitions can be approved")

        requisition.status = 'approved'
        requisition.approved_by = approver
        requisition.approved_at = timezone.now()
        requisition.save()

        # Set approved quantities to requested if not already set
        for item in requisition.items.filter(quantity_approved__isnull=True):
            item.quantity_approved = item.quantity_requested
            item.save()

        return requisition

    @staticmethod
    @transaction.atomic
    def reject_requisition(
        requisition: 'PurchaseRequisition',
        rejector,
        reason: str,
    ) -> 'PurchaseRequisition':
        """
        Reject a requisition.
        """
        _ensure_inventory_enabled(None, requisition)

        if requisition.status != 'pending_approval':
            raise ValidationError("Only pending requisitions can be rejected")

        requisition.status = 'rejected'
        requisition.approved_by = rejector
        requisition.approved_at = timezone.now()
        requisition.rejection_reason = reason
        requisition.save()
        return requisition

    @staticmethod
    @transaction.atomic
    def convert_requisition_to_po(
        requisition: 'PurchaseRequisition',
        supplier: 'Supplier',
        delivery_location: 'StorageLocation',
        user,
        expected_delivery_date=None,
    ) -> 'PurchaseOrder':
        """
        Convert an approved requisition into a purchase order.

        Args:
            requisition: Approved PurchaseRequisition
            supplier: Supplier for the PO
            delivery_location: Location to receive goods
            user: User creating the PO
            expected_delivery_date: Optional expected delivery date

        Returns:
            Created PurchaseOrder
        """
        _ensure_inventory_enabled(None, requisition, supplier, delivery_location)

        from .models import PurchaseOrder, PurchaseOrderItem

        if requisition.status != 'approved':
            raise ValidationError("Only approved requisitions can be converted to PO")

        po = PurchaseOrder.objects.create(
            facility=requisition.facility,
            po_number=ProcurementService.generate_po_number(requisition.facility),
            requisition=requisition,
            supplier=supplier,
            delivery_location=delivery_location,
            expected_delivery_date=expected_delivery_date,
            status='draft',
            created_by=user,
        )

        subtotal = Decimal('0')
        for req_item in requisition.items.all():
            qty = req_item.quantity_approved or req_item.quantity_requested
            unit_price = req_item.item.unit_cost

            PurchaseOrderItem.objects.create(
                purchase_order=po,
                item=req_item.item,
                requisition_item=req_item,
                quantity_ordered=qty,
                unit_price=unit_price,
            )
            subtotal += qty * unit_price

        po.subtotal = subtotal
        po.total_amount = subtotal
        po.save()

        requisition.status = 'converted'
        requisition.save()

        return po

    @staticmethod
    @transaction.atomic
    def approve_po(po: 'PurchaseOrder', approver) -> 'PurchaseOrder':
        """
        Approve a purchase order.
        """
        _ensure_inventory_enabled(None, po)

        if po.status not in ('draft', 'pending_approval'):
            raise ValidationError("PO cannot be approved in current status")

        po.status = 'approved'
        po.approved_by = approver
        po.approved_at = timezone.now()
        po.save()
        return po

    @staticmethod
    @transaction.atomic
    def send_po(po: 'PurchaseOrder') -> 'PurchaseOrder':
        """
        Mark PO as sent to supplier.
        """
        _ensure_inventory_enabled(None, po)

        if po.status != 'approved':
            raise ValidationError("Only approved POs can be sent")

        po.status = 'sent'
        po.sent_at = timezone.now()
        po.save()
        return po

    @staticmethod
    @transaction.atomic
    def create_grn(
        po: 'PurchaseOrder',
        received_by,
        receiving_location: 'StorageLocation',
        supplier_delivery_note: str = None,
    ) -> 'GoodsReceivedNote':
        """
        Create a goods received note for a PO.
        """
        _ensure_inventory_enabled(None, po, receiving_location)

        from .models import GoodsReceivedNote, GoodsReceivedNoteItem

        if po.status not in ('sent', 'acknowledged', 'partially_received'):
            raise ValidationError(f"Cannot receive goods for PO in {po.status} status")

        grn = GoodsReceivedNote.objects.create(
            facility=po.facility,
            grn_number=ProcurementService.generate_grn_number(po.facility),
            purchase_order=po,
            received_by=received_by,
            receiving_location=receiving_location,
            supplier_delivery_note=supplier_delivery_note,
            status='draft',
        )

        # Pre-populate GRN items from PO items with pending quantities
        for po_item in po.items.filter(quantity_ordered__gt=models.F('quantity_received')):
            GoodsReceivedNoteItem.objects.create(
                grn=grn,
                po_item=po_item,
                item=po_item.item,
                quantity_received=0,
                storage_location=receiving_location,
            )

        return grn

    @staticmethod
    @transaction.atomic
    def accept_grn(
        grn: 'GoodsReceivedNote',
        user,
    ) -> 'GoodsReceivedNote':
        """
        Accept a GRN and update inventory.

        Creates ExpiryTracker records and updates LocationStock.
        Updates PO received quantities.

        Args:
            grn: GoodsReceivedNote to accept
            user: User performing the acceptance

        Returns:
            Updated GoodsReceivedNote
        """
        _ensure_inventory_enabled(None, grn)

        if grn.status not in ('draft', 'pending_inspection', 'inspected'):
            raise ValidationError(f"Cannot accept GRN in {grn.status} status")

        has_rejections = False

        for grn_item in grn.items.all():
            if grn_item.quantity_accepted > 0:
                # Create stock movement and update LocationStock
                storage_loc = grn_item.storage_location or grn.receiving_location

                movement, loc_stock = StockService.adjust_stock(
                    item=grn_item.item,
                    location=storage_loc,
                    quantity_change=grn_item.quantity_accepted,
                    movement_type='grn_receipt',
                    user=user,
                    reference_number=grn.grn_number,
                    reference_type='GRN',
                    reference_id=grn.id,
                    notes=f"GRN receipt from PO {grn.purchase_order.po_number}",
                    batch_number=grn_item.batch_number,
                    expiry_date=grn_item.expiry_date,
                )

                # Link expiry tracker if created
                if grn_item.expiry_date and grn_item.batch_number:
                    tracker = ExpiryTracker.objects.filter(
                        item=grn_item.item,
                        batch_number=grn_item.batch_number,
                        location=storage_loc,
                        movement=movement,
                    ).first()
                    if tracker:
                        grn_item.expiry_tracker = tracker
                        grn_item.save()

                # Update PO item received quantity
                grn_item.po_item.quantity_received += grn_item.quantity_accepted
                grn_item.po_item.save()

            if grn_item.quantity_rejected > 0:
                has_rejections = True

        # Update GRN status
        if has_rejections:
            grn.status = 'partially_accepted'
        else:
            grn.status = 'accepted'
        grn.save()

        # Update PO status
        po = grn.purchase_order
        total_ordered = sum(item.quantity_ordered for item in po.items.all())
        total_received = sum(item.quantity_received for item in po.items.all())

        if total_received >= total_ordered:
            po.status = 'fully_received'
        elif total_received > 0:
            po.status = 'partially_received'
        po.save()

        return grn

    @staticmethod
    def get_items_below_reorder(facility, location=None) -> List[InventoryItem]:
        """
        Get items that need reordering.

        Args:
            facility: Facility context
            location: Optional location filter

        Returns:
            List of InventoryItem instances below reorder level
        """
        if not _inventory_enabled(facility, location):
            return []

        if location:
            # Location-specific check
            low_stocks = LocationStock.objects.filter(
                location=location,
                item__is_active=True,
            ).select_related('item')

            items = []
            for ls in low_stocks:
                if ls.is_below_reorder:
                    items.append(ls.item)
            return items
        else:
            # Facility-wide check using total_stock
            from django.db.models import Sum

            items = InventoryItem.objects.filter(
                facility=facility,
                is_active=True,
            ).annotate(
                total_qty=Sum('location_stocks__quantity')
            ).filter(
                total_qty__lte=models.F('reorder_level')
            )
            return list(items)


# =============================================================================
# Internal Logistics Services (Phase 4)
# =============================================================================


class InternalLogisticsService:
    """
    Service for internal logistics operations.

    Handles:
    - Internal requisition number generation
    - Transfer request number generation
    - Internal requisition workflow
    - Stock transfer request workflow
    - Standing order generation
    """

    @staticmethod
    def generate_internal_requisition_number(facility) -> str:
        """
        Generate unique internal requisition number.
        Format: INT-{FACILITY_CODE}-{YYYYMMDD}-{NNNN}
        """
        from .models import InternalRequisition

        today = timezone.now()
        date_str = today.strftime('%Y%m%d')
        prefix = f"INT-{facility.code}-{date_str}-"

        last_req = InternalRequisition.objects.filter(
            requisition_number__startswith=prefix
        ).order_by('-requisition_number').first()

        if last_req:
            last_num = int(last_req.requisition_number.split('-')[-1])
            next_num = last_num + 1
        else:
            next_num = 1

        return f"{prefix}{next_num:04d}"

    @staticmethod
    def generate_transfer_number(facility) -> str:
        """
        Generate unique transfer request number.
        Format: TRF-{FACILITY_CODE}-{YYYYMMDD}-{NNNN}
        """
        from .models import StockTransferRequest

        today = timezone.now()
        date_str = today.strftime('%Y%m%d')
        prefix = f"TRF-{facility.code}-{date_str}-"

        last_transfer = StockTransferRequest.objects.filter(
            transfer_number__startswith=prefix
        ).order_by('-transfer_number').first()

        if last_transfer:
            last_num = int(last_transfer.transfer_number.split('-')[-1])
            next_num = last_num + 1
        else:
            next_num = 1

        return f"{prefix}{next_num:04d}"

    @staticmethod
    @transaction.atomic
    def create_internal_requisition(
        facility,
        requesting_location: 'StorageLocation',
        fulfilling_location: 'StorageLocation',
        user,
        items_data: List[Dict],
        *,
        date_required=None,
        priority: str = 'normal',
        justification: str = None,
        standing_order: 'StandingOrder' = None,
    ) -> 'InternalRequisition':
        """
        Create an internal requisition.

        Args:
            facility: Facility context
            requesting_location: Location requesting items
            fulfilling_location: Location to fulfill request
            user: User creating the requisition
            items_data: List of dicts with 'item_id' and 'quantity'
            date_required: Optional date needed by
            priority: Priority level
            justification: Reason for request
            standing_order: Optional standing order source

        Returns:
            Created InternalRequisition
        """
        _ensure_inventory_enabled(facility, requesting_location, fulfilling_location)

        from .models import InternalRequisition, InternalRequisitionItem

        req = InternalRequisition.objects.create(
            facility=facility,
            requisition_number=InternalLogisticsService.generate_internal_requisition_number(facility),
            requesting_location=requesting_location,
            fulfilling_location=fulfilling_location,
            requested_by=user,
            date_required=date_required,
            priority=priority,
            status='draft',
            justification=justification,
            standing_order=standing_order,
        )

        for item_data in items_data:
            item = InventoryItem.objects.get(id=item_data['item_id'])
            InternalRequisitionItem.objects.create(
                requisition=req,
                item=item,
                quantity_requested=item_data['quantity'],
                notes=item_data.get('notes'),
            )

        return req

    @staticmethod
    @transaction.atomic
    def submit_internal_requisition(requisition: 'InternalRequisition') -> 'InternalRequisition':
        """
        Submit an internal requisition for approval.
        """
        _ensure_inventory_enabled(None, requisition)

        if requisition.status != 'draft':
            raise ValidationError("Only draft requisitions can be submitted")

        requisition.status = 'pending_approval'
        requisition.save()
        return requisition

    @staticmethod
    @transaction.atomic
    def approve_internal_requisition(
        requisition: 'InternalRequisition',
        approver,
        approved_quantities: Dict[str, int] = None,
    ) -> 'InternalRequisition':
        """
        Approve an internal requisition.

        Args:
            requisition: InternalRequisition to approve
            approver: User approving
            approved_quantities: Optional dict of {item_id: approved_qty}
        """
        _ensure_inventory_enabled(None, requisition)

        if requisition.status != 'pending_approval':
            raise ValidationError("Only pending requisitions can be approved")

        requisition.status = 'approved'
        requisition.approved_by = approver
        requisition.approved_at = timezone.now()
        requisition.save()

        # Set approved quantities
        for item in requisition.items.all():
            if approved_quantities and str(item.item_id) in approved_quantities:
                item.quantity_approved = approved_quantities[str(item.item_id)]
            else:
                item.quantity_approved = item.quantity_requested
            item.save()

        return requisition

    @staticmethod
    @transaction.atomic
    def reject_internal_requisition(
        requisition: 'InternalRequisition',
        rejector,
        reason: str,
    ) -> 'InternalRequisition':
        """
        Reject an internal requisition.
        """
        _ensure_inventory_enabled(None, requisition)

        if requisition.status != 'pending_approval':
            raise ValidationError("Only pending requisitions can be rejected")

        requisition.status = 'rejected'
        requisition.approved_by = rejector
        requisition.approved_at = timezone.now()
        requisition.rejection_reason = reason
        requisition.save()
        return requisition

    @staticmethod
    @transaction.atomic
    def fulfill_internal_requisition(
        requisition: 'InternalRequisition',
        user,
        issue_data: List[Dict] = None,
    ) -> 'InternalRequisition':
        """
        Fulfill an internal requisition by issuing stock.

        Args:
            requisition: InternalRequisition to fulfill
            user: User fulfilling the requisition
            issue_data: Optional list of dicts with 'item_id', 'quantity', 'batch_id'
                       If not provided, uses approved quantities with FEFO

        Returns:
            Updated InternalRequisition
        """
        _ensure_inventory_enabled(None, requisition)

        if requisition.status not in ('approved', 'in_progress'):
            raise ValidationError("Only approved/in-progress requisitions can be fulfilled")

        requisition.status = 'in_progress'
        requisition.save()

        for req_item in requisition.items.all():
            qty_to_issue = req_item.quantity_approved or req_item.quantity_requested

            # Get issue quantity from data if provided
            if issue_data:
                item_issue = next(
                    (d for d in issue_data if str(d['item_id']) == str(req_item.item_id)),
                    None
                )
                if item_issue:
                    qty_to_issue = item_issue.get('quantity', qty_to_issue)

            # Skip if nothing to issue
            if qty_to_issue <= 0:
                continue

            # Select batch using FEFO
            batch_to_use = None
            if issue_data:
                item_issue = next(
                    (d for d in issue_data if str(d['item_id']) == str(req_item.item_id)),
                    None
                )
                if item_issue and item_issue.get('batch_id'):
                    batch_to_use = ExpiryTracker.objects.filter(
                        id=item_issue['batch_id']
                    ).first()

            if not batch_to_use:
                # Use FEFO to select batch
                selections = BatchSelectionService.select_batch_fefo(
                    item=req_item.item,
                    location=requisition.fulfilling_location,
                    quantity_needed=qty_to_issue,
                )
                if selections:
                    batch_to_use = selections[0]['batch']

            # Perform stock transfer
            try:
                StockService.transfer_stock(
                    item=req_item.item,
                    from_location=requisition.fulfilling_location,
                    to_location=requisition.requesting_location,
                    quantity=qty_to_issue,
                    user=user,
                    reference_number=requisition.requisition_number,
                    reference_id=requisition.id,
                    notes=f"Internal requisition fulfillment",
                    batch_number=batch_to_use.batch_number if batch_to_use else None,
                    expiry_tracker=batch_to_use,
                )

                req_item.quantity_issued = qty_to_issue
                req_item.batch_used = batch_to_use
                req_item.save()

            except InsufficientStockError:
                # Partial fulfillment - continue with what's available
                pass

        # Check if fully fulfilled
        if requisition.is_fully_fulfilled:
            requisition.status = 'fulfilled'
        else:
            requisition.status = 'partially_fulfilled'

        requisition.fulfilled_by = user
        requisition.fulfilled_at = timezone.now()
        requisition.save()

        return requisition

    # =========================================================================
    # Stock Transfer Request Operations
    # =========================================================================

    @staticmethod
    @transaction.atomic
    def create_transfer_request(
        facility,
        from_location: 'StorageLocation',
        to_location: 'StorageLocation',
        user,
        items_data: List[Dict],
        *,
        reason: str = None,
        requires_approval: bool = True,
    ) -> 'StockTransferRequest':
        """
        Create a stock transfer request.

        Args:
            facility: Facility context
            from_location: Source location
            to_location: Destination location
            user: User creating the request
            items_data: List of dicts with 'item_id', 'quantity', optional 'batch_id'
            reason: Reason for transfer
            requires_approval: Whether approval is needed

        Returns:
            Created StockTransferRequest
        """
        _ensure_inventory_enabled(facility, from_location, to_location)

        from .models import StockTransferRequest, StockTransferItem

        if from_location.id == to_location.id:
            raise ValidationError("Source and destination locations must be different")

        transfer = StockTransferRequest.objects.create(
            facility=facility,
            transfer_number=InternalLogisticsService.generate_transfer_number(facility),
            from_location=from_location,
            to_location=to_location,
            requested_by=user,
            status='pending' if requires_approval else 'approved',
            requires_approval=requires_approval,
            reason=reason,
        )

        if not requires_approval:
            transfer.approved_at = timezone.now()

        for item_data in items_data:
            item = InventoryItem.objects.get(id=item_data['item_id'])
            batch = None
            if item_data.get('batch_id'):
                batch = ExpiryTracker.objects.filter(id=item_data['batch_id']).first()

            StockTransferItem.objects.create(
                transfer=transfer,
                item=item,
                batch=batch,
                quantity_requested=item_data['quantity'],
                notes=item_data.get('notes'),
            )

        transfer.save()
        return transfer

    @staticmethod
    @transaction.atomic
    def approve_transfer_request(
        transfer: 'StockTransferRequest',
        approver,
    ) -> 'StockTransferRequest':
        """
        Approve a stock transfer request.
        """
        _ensure_inventory_enabled(None, transfer)

        if transfer.status != 'pending':
            raise ValidationError("Only pending transfers can be approved")

        transfer.status = 'approved'
        transfer.approved_by = approver
        transfer.approved_at = timezone.now()
        transfer.save()
        return transfer

    @staticmethod
    @transaction.atomic
    def dispatch_transfer(
        transfer: 'StockTransferRequest',
        user,
        dispatch_quantities: Dict[str, int] = None,
    ) -> 'StockTransferRequest':
        """
        Dispatch items for a transfer request.

        Args:
            transfer: StockTransferRequest to dispatch
            user: User dispatching
            dispatch_quantities: Optional dict of {item_id: dispatch_qty}

        Returns:
            Updated StockTransferRequest
        """
        _ensure_inventory_enabled(None, transfer)

        if transfer.status != 'approved':
            raise ValidationError("Only approved transfers can be dispatched")

        for transfer_item in transfer.items.all():
            qty_to_dispatch = transfer_item.quantity_requested
            if dispatch_quantities and str(transfer_item.item_id) in dispatch_quantities:
                qty_to_dispatch = dispatch_quantities[str(transfer_item.item_id)]

            if qty_to_dispatch <= 0:
                continue

            # Use specified batch or FEFO
            batch_to_use = transfer_item.batch
            if not batch_to_use:
                selections = BatchSelectionService.select_batch_fefo(
                    item=transfer_item.item,
                    location=transfer.from_location,
                    quantity_needed=qty_to_dispatch,
                )
                if selections:
                    batch_to_use = selections[0]['batch']

            # Create outbound movement
            out_movement, _ = StockService.adjust_stock(
                item=transfer_item.item,
                location=transfer.from_location,
                quantity_change=-qty_to_dispatch,
                movement_type='transfer_out',
                user=user,
                reference_number=transfer.transfer_number,
                reference_type='TransferRequest',
                reference_id=transfer.id,
                notes=f"Transfer to {transfer.to_location.name}",
                batch_number=batch_to_use.batch_number if batch_to_use else None,
                expiry_tracker=batch_to_use,
            )

            transfer_item.quantity_dispatched = qty_to_dispatch
            transfer_item.dispatch_movement = out_movement
            transfer_item.batch = batch_to_use
            transfer_item.save()

        transfer.status = 'in_transit'
        transfer.dispatched_at = timezone.now()
        transfer.dispatched_by = user
        transfer.save()

        return transfer

    @staticmethod
    @transaction.atomic
    def receive_transfer(
        transfer: 'StockTransferRequest',
        user,
        received_quantities: Dict[str, int] = None,
    ) -> 'StockTransferRequest':
        """
        Receive items from a transfer request.

        Args:
            transfer: StockTransferRequest to receive
            user: User receiving
            received_quantities: Optional dict of {item_id: received_qty}

        Returns:
            Updated StockTransferRequest
        """
        _ensure_inventory_enabled(None, transfer)

        if transfer.status != 'in_transit':
            raise ValidationError("Only in-transit transfers can be received")

        for transfer_item in transfer.items.filter(quantity_dispatched__gt=0):
            qty_to_receive = transfer_item.quantity_dispatched
            if received_quantities and str(transfer_item.item_id) in received_quantities:
                qty_to_receive = received_quantities[str(transfer_item.item_id)]

            if qty_to_receive <= 0:
                continue

            # Get expiry info from dispatch batch
            batch = transfer_item.batch
            expiry_date = batch.expiry_date if batch else None
            batch_number = batch.batch_number if batch else None

            # Create inbound movement
            in_movement, _ = StockService.adjust_stock(
                item=transfer_item.item,
                location=transfer.to_location,
                quantity_change=qty_to_receive,
                movement_type='transfer_in',
                user=user,
                reference_number=transfer.transfer_number,
                reference_type='TransferRequest',
                reference_id=transfer.id,
                notes=f"Transfer from {transfer.from_location.name}",
                batch_number=batch_number,
                expiry_date=expiry_date,
            )

            transfer_item.quantity_received = qty_to_receive
            transfer_item.receipt_movement = in_movement
            transfer_item.save()

        transfer.status = 'received'
        transfer.received_at = timezone.now()
        transfer.received_by = user
        transfer.save()

        return transfer

    @staticmethod
    @transaction.atomic
    def cancel_transfer_request(
        transfer: 'StockTransferRequest',
        reason: str = None,
    ) -> 'StockTransferRequest':
        """
        Cancel a transfer request.
        """
        _ensure_inventory_enabled(None, transfer)

        if transfer.status in ('received', 'cancelled'):
            raise ValidationError(f"Cannot cancel transfer in {transfer.status} status")

        if transfer.status == 'in_transit':
            raise ValidationError("Cannot cancel in-transit transfer. Receive first then adjust.")

        transfer.status = 'cancelled'
        if reason:
            transfer.notes = f"Cancelled: {reason}"
        transfer.save()
        return transfer

    # =========================================================================
    # Standing Order Operations
    # =========================================================================

    @staticmethod
    @transaction.atomic
    def generate_from_standing_order(
        standing_order: 'StandingOrder',
        user,
    ) -> 'InternalRequisition':
        """
        Generate an internal requisition from a standing order.

        Args:
            standing_order: StandingOrder to generate from
            user: User performing the generation

        Returns:
            Created InternalRequisition
        """
        _ensure_inventory_enabled(None, standing_order)

        from .models import StandingOrderItem

        if not standing_order.is_active:
            raise ValidationError("Cannot generate from inactive standing order")

        items_data = []
        for so_item in standing_order.items.all():
            items_data.append({
                'item_id': so_item.item_id,
                'quantity': so_item.quantity,
            })

        req = InternalLogisticsService.create_internal_requisition(
            facility=standing_order.facility,
            requesting_location=standing_order.requesting_location,
            fulfilling_location=standing_order.fulfilling_location,
            user=user,
            items_data=items_data,
            justification=f"Auto-generated from standing order: {standing_order.name}",
            standing_order=standing_order,
        )

        # Update standing order tracking
        standing_order.last_generated = timezone.now()
        standing_order.next_due = standing_order.calculate_next_due()
        standing_order.save()

        return req

    @staticmethod
    def get_due_standing_orders(facility) -> List['StandingOrder']:
        """
        Get standing orders that are due for generation.

        Args:
            facility: Facility context

        Returns:
            List of StandingOrder instances due for generation
        """
        if not _inventory_enabled(facility):
            return []

        from .models import StandingOrder

        today = timezone.now().date()

        return list(StandingOrder.objects.filter(
            facility=facility,
            is_active=True,
            next_due__lte=today,
        ).select_related(
            'requesting_location',
            'fulfilling_location',
        ).prefetch_related('items__item'))

    @staticmethod
    @transaction.atomic
    def process_due_standing_orders(facility, user) -> List['InternalRequisition']:
        """
        Process all due standing orders and generate requisitions.

        Args:
            facility: Facility context
            user: User for requisition creation

        Returns:
            List of created InternalRequisitions
        """
        if not _inventory_enabled(facility):
            return []

        due_orders = InternalLogisticsService.get_due_standing_orders(facility)
        requisitions = []

        for standing_order in due_orders:
            try:
                req = InternalLogisticsService.generate_from_standing_order(
                    standing_order, user
                )
                requisitions.append(req)
            except Exception:
                # Log error but continue with other orders
                pass

        return requisitions


# =============================================================================
# Controlled Substance Services (Phase 5)
# =============================================================================


class WitnessRequiredError(Exception):
    """Raised when witness is missing or same as performer."""

    def __init__(self, message="Controlled substance operations require a witness different from the performer"):
        self.message = message
        super().__init__(self.message)


class ControlledSubstanceService:
    """
    Service for controlled substance operations.

    All controlled substance transactions require:
    - A performer (the person doing the action)
    - A witness (must be different from performer)
    - Proper documentation
    """

    @staticmethod
    def get_or_create_register(
        facility,
        location: 'StorageLocation',
        item: 'InventoryItem',
        user=None,
    ) -> 'ControlledSubstanceRegister':
        """
        Get or create a controlled substance register for an item at a location.
        """
        _ensure_inventory_enabled(facility, location, item)

        from .models import ControlledSubstanceRegister

        if not item.is_controlled_substance:
            raise ValidationError(f"{item.name} is not a controlled substance")

        if not location.allows_controlled_substances:
            raise ValidationError(f"{location.name} is not authorized for controlled substances")

        register, created = ControlledSubstanceRegister.objects.get_or_create(
            location=location,
            item=item,
            defaults={
                'facility': facility,
                'running_balance': 0,
                'is_active': True,
                'created_by': user,
            }
        )

        return register

    @staticmethod
    def _get_next_entry_number(register: 'ControlledSubstanceRegister') -> int:
        """Get the next entry number for a register."""
        from django.db.models import Max

        max_entry = register.entries.aggregate(max_num=Max('entry_number'))
        return (max_entry['max_num'] or 0) + 1

    @staticmethod
    def _validate_witness(performer, witness):
        """Validate that witness is different from performer."""
        if performer.id == witness.id:
            raise WitnessRequiredError()

    @staticmethod
    @transaction.atomic
    def receive_controlled(
        facility,
        location: 'StorageLocation',
        item: 'InventoryItem',
        quantity: int,
        performer,
        witness,
        *,
        batch: 'ExpiryTracker' = None,
        reference_number: str = None,
        notes: str = None,
    ) -> 'ControlledSubstanceEntry':
        """
        Receive controlled substance into register.

        Args:
            facility: Facility context
            location: Storage location
            item: Controlled substance item
            quantity: Quantity received
            performer: User performing receipt
            witness: Witness (must be different from performer)
            batch: Optional batch tracker
            reference_number: GRN or other reference
            notes: Additional notes

        Returns:
            Created ControlledSubstanceEntry
        """
        _ensure_inventory_enabled(facility, location, item)

        from .models import ControlledSubstanceEntry

        ControlledSubstanceService._validate_witness(performer, witness)

        register = ControlledSubstanceService.get_or_create_register(
            facility, location, item, performer
        )

        balance_before = register.running_balance
        balance_after = balance_before + quantity

        # Create entry
        entry = ControlledSubstanceEntry.objects.create(
            register=register,
            entry_type='receipt',
            entry_number=ControlledSubstanceService._get_next_entry_number(register),
            quantity=quantity,
            balance_before=balance_before,
            balance_after=balance_after,
            batch=batch,
            performed_by=performer,
            witness=witness,
            notes=notes,
        )

        # Update register balance
        register.running_balance = balance_after
        register.last_entry_at = timezone.now()
        register.save()

        # Create stock movement
        movement, _ = StockService.adjust_stock(
            item=item,
            location=location,
            quantity_change=quantity,
            movement_type='grn_receipt',
            user=performer,
            reference_number=reference_number,
            reference_type='ControlledReceipt',
            reference_id=entry.id,
            notes=f"Controlled substance receipt - Entry #{entry.entry_number}",
            batch_number=batch.batch_number if batch else None,
            expiry_date=batch.expiry_date if batch else None,
        )

        entry.stock_movement = movement
        entry.save()

        return entry

    @staticmethod
    @transaction.atomic
    def dispense_controlled(
        facility,
        location: 'StorageLocation',
        item: 'InventoryItem',
        quantity: int,
        performer,
        witness,
        patient,
        *,
        prescription=None,
        batch: 'ExpiryTracker' = None,
        wastage_amount: float = None,
        wastage_reason: str = None,
        notes: str = None,
    ) -> 'ControlledSubstanceEntry':
        """
        Dispense controlled substance to patient.

        Args:
            facility: Facility context
            location: Storage location
            item: Controlled substance item
            quantity: Quantity to dispense
            performer: User performing dispense
            witness: Witness (must be different from performer)
            patient: Patient profile
            prescription: Optional prescription reference
            batch: Optional batch to dispense from (uses FEFO if not specified)
            wastage_amount: Amount wasted (e.g., partial vial)
            wastage_reason: Reason for wastage
            notes: Additional notes

        Returns:
            Created ControlledSubstanceEntry
        """
        _ensure_inventory_enabled(facility, location, item)

        from .models import ControlledSubstanceEntry

        ControlledSubstanceService._validate_witness(performer, witness)

        register = ControlledSubstanceService.get_or_create_register(
            facility, location, item, performer
        )

        if register.running_balance < quantity:
            raise InsufficientStockError(
                item=item,
                location=location,
                requested=quantity,
                available=register.running_balance
            )

        balance_before = register.running_balance
        balance_after = balance_before - quantity

        # Select batch if not provided
        if not batch:
            selections = BatchSelectionService.select_batch_fefo(
                item, location, quantity
            )
            if selections:
                batch = selections[0]['batch']

        # Create entry
        entry = ControlledSubstanceEntry.objects.create(
            register=register,
            entry_type='dispense',
            entry_number=ControlledSubstanceService._get_next_entry_number(register),
            quantity=quantity,
            balance_before=balance_before,
            balance_after=balance_after,
            batch=batch,
            patient=patient,
            prescription=prescription,
            performed_by=performer,
            witness=witness,
            wastage_amount=wastage_amount,
            wastage_reason=wastage_reason,
            notes=notes,
        )

        # Update register balance
        register.running_balance = balance_after
        register.last_entry_at = timezone.now()
        register.save()

        # Create stock movement
        movement, _ = StockService.adjust_stock(
            item=item,
            location=location,
            quantity_change=-quantity,
            movement_type='dispense',
            user=performer,
            reference_number=str(prescription.id) if prescription else None,
            reference_type='ControlledDispense',
            reference_id=entry.id,
            notes=f"Controlled dispense - Entry #{entry.entry_number}",
            batch_number=batch.batch_number if batch else None,
            expiry_tracker=batch,
            patient=patient,
        )

        entry.stock_movement = movement
        entry.save()

        return entry

    @staticmethod
    @transaction.atomic
    def record_wastage(
        facility,
        location: 'StorageLocation',
        item: 'InventoryItem',
        quantity: int,
        performer,
        witness,
        wastage_reason: str,
        *,
        batch: 'ExpiryTracker' = None,
        related_entry: 'ControlledSubstanceEntry' = None,
        notes: str = None,
    ) -> 'ControlledSubstanceEntry':
        """
        Record wastage of controlled substance.

        Args:
            facility: Facility context
            location: Storage location
            item: Controlled substance item
            quantity: Quantity wasted
            performer: User performing wastage
            witness: Witness (must be different from performer)
            wastage_reason: Mandatory reason for wastage
            batch: Optional batch
            related_entry: Related dispense entry (for partial dose waste)
            notes: Additional notes

        Returns:
            Created ControlledSubstanceEntry
        """
        _ensure_inventory_enabled(facility, location, item)

        from .models import ControlledSubstanceEntry

        if not wastage_reason:
            raise ValidationError("Wastage reason is required for controlled substances")

        ControlledSubstanceService._validate_witness(performer, witness)

        register = ControlledSubstanceService.get_or_create_register(
            facility, location, item, performer
        )

        if register.running_balance < quantity:
            raise InsufficientStockError(
                item=item,
                location=location,
                requested=quantity,
                available=register.running_balance
            )

        balance_before = register.running_balance
        balance_after = balance_before - quantity

        # Create entry
        entry = ControlledSubstanceEntry.objects.create(
            register=register,
            entry_type='wastage',
            entry_number=ControlledSubstanceService._get_next_entry_number(register),
            quantity=quantity,
            balance_before=balance_before,
            balance_after=balance_after,
            batch=batch,
            performed_by=performer,
            witness=witness,
            wastage_reason=wastage_reason,
            notes=notes,
        )

        # Update register balance
        register.running_balance = balance_after
        register.last_entry_at = timezone.now()
        register.save()

        # Create stock movement
        movement, _ = StockService.adjust_stock(
            item=item,
            location=location,
            quantity_change=-quantity,
            movement_type='wastage',
            user=performer,
            reference_type='ControlledWastage',
            reference_id=entry.id,
            notes=f"Controlled wastage - Entry #{entry.entry_number}: {wastage_reason}",
            batch_number=batch.batch_number if batch else None,
            expiry_tracker=batch,
        )

        entry.stock_movement = movement
        entry.save()

        return entry

    @staticmethod
    @transaction.atomic
    def perform_count(
        facility,
        location: 'StorageLocation',
        item: 'InventoryItem',
        actual_count: int,
        performer,
        witness,
        notes: str = None,
    ) -> Dict[str, Any]:
        """
        Perform physical count and reconcile with register.

        Args:
            facility: Facility context
            location: Storage location
            item: Controlled substance item
            actual_count: Physical count result
            performer: User performing count
            witness: Witness (must be different from performer)
            notes: Additional notes

        Returns:
            Dict with count results and any discrepancy
        """
        _ensure_inventory_enabled(facility, location, item)

        from .models import ControlledSubstanceDiscrepancy

        ControlledSubstanceService._validate_witness(performer, witness)

        register = ControlledSubstanceService.get_or_create_register(
            facility, location, item, performer
        )

        expected = register.running_balance
        discrepancy_value = actual_count - expected

        result = {
            'register_id': str(register.id),
            'expected_balance': expected,
            'actual_count': actual_count,
            'discrepancy': discrepancy_value,
            'is_valid': discrepancy_value == 0,
            'discrepancy_id': None,
        }

        # Update last audit timestamp
        register.last_audit_at = timezone.now()
        register.save()

        # Create discrepancy record if count doesn't match
        if discrepancy_value != 0:
            discrepancy = ControlledSubstanceDiscrepancy.objects.create(
                register=register,
                expected_balance=expected,
                actual_balance=actual_count,
                discrepancy=discrepancy_value,
                discovered_by=performer,
                investigation_notes=notes,
            )
            result['discrepancy_id'] = str(discrepancy.id)
            result['requires_escalation'] = discrepancy.requires_escalation

        return result

    @staticmethod
    def get_register_history(
        register: 'ControlledSubstanceRegister',
        start_date=None,
        end_date=None,
        entry_type: str = None,
        limit: int = 100,
    ) -> List['ControlledSubstanceEntry']:
        """
        Get entry history for a register.

        Args:
            register: The controlled substance register
            start_date: Optional start date filter
            end_date: Optional end date filter
            entry_type: Optional filter by entry type
            limit: Max entries to return

        Returns:
            List of ControlledSubstanceEntry instances
        """
        if not _inventory_enabled(None, register):
            return []

        queryset = register.entries.select_related(
            'performed_by', 'witness', 'patient', 'batch'
        ).order_by('-timestamp')

        if start_date:
            queryset = queryset.filter(timestamp__gte=start_date)
        if end_date:
            queryset = queryset.filter(timestamp__lte=end_date)
        if entry_type:
            queryset = queryset.filter(entry_type=entry_type)

        return list(queryset[:limit])

    @staticmethod
    def get_pending_discrepancies(
        facility,
        location: 'StorageLocation' = None,
    ) -> List['ControlledSubstanceDiscrepancy']:
        """
        Get unresolved discrepancies.

        Args:
            facility: Facility context
            location: Optional location filter

        Returns:
            List of ControlledSubstanceDiscrepancy instances
        """
        if not _inventory_enabled(facility, location):
            return []

        from .models import ControlledSubstanceDiscrepancy

        queryset = ControlledSubstanceDiscrepancy.objects.filter(
            register__facility=facility,
            status__in=['reported', 'investigating'],
        ).select_related(
            'register__item', 'register__location', 'discovered_by'
        ).order_by('-discovered_at')

        if location:
            queryset = queryset.filter(register__location=location)

        return list(queryset)

    @staticmethod
    @transaction.atomic
    def resolve_discrepancy(
        discrepancy: 'ControlledSubstanceDiscrepancy',
        resolver,
        resolution_notes: str,
        adjust_balance: bool = False,
    ) -> 'ControlledSubstanceDiscrepancy':
        """
        Resolve a discrepancy.

        Args:
            discrepancy: The discrepancy to resolve
            resolver: User resolving
            resolution_notes: Notes on resolution
            adjust_balance: Whether to adjust register balance to match count

        Returns:
            Updated ControlledSubstanceDiscrepancy
        """
        _ensure_inventory_enabled(None, discrepancy)

        if discrepancy.status == 'resolved':
            raise ValidationError("Discrepancy is already resolved")

        discrepancy.status = 'resolved'
        discrepancy.resolved_by = resolver
        discrepancy.resolved_at = timezone.now()
        discrepancy.resolution_notes = resolution_notes
        discrepancy.save()

        # Optionally adjust register balance
        if adjust_balance and discrepancy.discrepancy != 0:
            register = discrepancy.register
            register.running_balance = discrepancy.actual_balance
            register.save()

        return discrepancy
