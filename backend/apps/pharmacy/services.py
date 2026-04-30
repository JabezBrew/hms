"""
Pharmacy services for medication dispensing workflow.

This module handles:
- Medication dispensing (releasing from pharmacy stock)
- Inventory integration (stock depletion on dispense)
- FEFO batch selection
- Supply request processing
- Drug interaction checking (future)
"""
from datetime import timedelta
from decimal import Decimal
from typing import Optional, Dict, Any, List, Tuple, TYPE_CHECKING

from django.utils import timezone
from django.db import transaction
from django.core.exceptions import ValidationError

from apps.inventory.services import (
    StockService, BatchSelectionService, InsufficientStockError
)
from django.db import models
from apps.inventory.models import (
    InventoryItem, StorageLocation, ExpiryTracker, LocationStock
)
from hms_backend.deployment import feature_enabled

if TYPE_CHECKING:
    from apps.nursing.models import MedicationAdministration


class DispensingError(Exception):
    """Raised when medication cannot be dispensed."""
    pass


def _pharmacy_enabled(facility=None) -> bool:
    return bool(feature_enabled('pharmacy', facility=facility))


def _inventory_enabled(facility=None) -> bool:
    return bool(feature_enabled('inventory', facility=facility))


def _query_feature_enabled(*, facility=None, patient_id=None) -> bool:
    if facility is None and patient_id:
        from apps.users.models import PatientProfile

        patient = PatientProfile.objects.select_related('facility').filter(id=patient_id).first()
        facility = getattr(patient, 'facility', None)
    if facility is None:
        return False
    return _pharmacy_enabled(facility)


def _facility_from_dispense_context(*objects):
    for obj in objects:
        if not obj:
            continue
        facility = getattr(obj, 'facility', None)
        if facility is not None:
            return facility
        patient = getattr(obj, 'patient', None)
        facility = getattr(patient, 'facility', None)
        if facility is not None:
            return facility
    return None


def check_stock_availability(
    inventory_item: InventoryItem,
    location: StorageLocation,
    quantity: int = 1,
) -> Dict[str, Any]:
    """
    Check stock availability before dispensing.

    Args:
        inventory_item: The inventory item to check
        location: Dispensing location (pharmacy)
        quantity: Quantity needed

    Returns:
        Dict with:
            - available: bool
            - available_quantity: int
            - shortfall: int
            - batch_recommendations: List of FEFO batch selections
            - alternative_locations: List of locations with stock
            - warnings: List of warning messages
    """
    facility = _facility_from_dispense_context(inventory_item, location)
    if not _pharmacy_enabled(facility) or not _inventory_enabled(facility):
        return {
            'available': False,
            'available_quantity': 0,
            'shortfall': quantity,
            'batch_recommendations': [],
            'alternative_locations': [],
            'warnings': [
                {
                    'level': 'error',
                    'message': 'Pharmacy stock checks are unavailable for this deployment.',
                }
            ],
        }

    # Check basic availability
    availability = StockService.check_availability(
        item=inventory_item,
        location=location,
        quantity_needed=quantity,
    )

    # Get FEFO batch recommendations
    batch_info = BatchSelectionService.get_batch_recommendations(
        item=inventory_item,
        location=location,
        quantity_needed=quantity,
    )

    return {
        'available': availability['available'],
        'available_quantity': availability['available_quantity'],
        'shortfall': availability['shortfall'],
        'batch_recommendations': batch_info['selections'],
        'alternative_locations': availability['alternative_locations'],
        'warnings': batch_info['warnings'],
    }


def dispense_medication(
    mar_entry,
    dispensed_by,
    *,
    inventory_item: InventoryItem = None,
    dispensing_location: StorageLocation = None,
    batch_override: ExpiryTracker = None,
    quantity: int = 1,
    skip_stock_deduction: bool = False,
) -> 'MedicationAdministration':
    """
    Mark a MAR entry as dispensed by pharmacy and optionally deduct from inventory.

    Args:
        mar_entry: MedicationAdministration instance
        dispensed_by: User (pharmacist) who dispensed
        inventory_item: Linked inventory item (optional for inventory integration)
        dispensing_location: Pharmacy location to dispense from
        batch_override: Specific batch to use (overrides FEFO selection)
        quantity: Quantity to dispense (default 1 dose)
        skip_stock_deduction: Skip inventory deduction (for manual tracking)

    Returns:
        Updated MedicationAdministration instance

    Raises:
        DispensingError: If stock is insufficient
        InsufficientStockError: If stock deduction fails
    """
    facility = _facility_from_dispense_context(
        mar_entry,
        inventory_item,
        dispensing_location,
    )
    if not _pharmacy_enabled(facility):
        raise DispensingError("Pharmacy feature is not enabled for this deployment.")
    if (
        inventory_item
        and dispensing_location
        and not skip_stock_deduction
        and not _inventory_enabled(facility)
    ):
        raise DispensingError("Inventory feature is not enabled for stock deduction.")

    with transaction.atomic():
        # Update dispensing status
        mar_entry.is_dispensed = True
        mar_entry.dispensed_at = timezone.now()
        mar_entry.dispensed_by = dispensed_by
        mar_entry.dispensing_location = dispensing_location

        # Link inventory item if provided
        if inventory_item:
            mar_entry.inventory_item = inventory_item

        # Perform stock deduction if inventory item and location provided
        if inventory_item and dispensing_location and not skip_stock_deduction:
            batch_to_use = batch_override

            # If no batch override, use FEFO selection
            if not batch_to_use:
                selections = BatchSelectionService.select_batch_fefo(
                    item=inventory_item,
                    location=dispensing_location,
                    quantity_needed=quantity,
                )
                if selections:
                    batch_to_use = selections[0]['batch']

            # Deduct stock
            try:
                StockService.adjust_stock(
                    item=inventory_item,
                    location=dispensing_location,
                    quantity_change=-quantity,
                    movement_type='dispense',
                    user=dispensed_by,
                    reference_type='MAR',
                    reference_id=mar_entry.id,
                    notes=f"Dispense for {mar_entry.patient.user.get_full_name() if mar_entry.patient else 'patient'}",
                    batch_number=batch_to_use.batch_number if batch_to_use else None,
                    expiry_tracker=batch_to_use,
                    patient=mar_entry.patient,
                )
            except InsufficientStockError as e:
                raise DispensingError(
                    f"Insufficient stock for {inventory_item.name} at "
                    f"{dispensing_location.name}: {e.available} available, "
                    f"{e.requested} needed"
                )

            # Record batch used
            if batch_to_use:
                mar_entry.batch_used = batch_to_use

        mar_entry.save()
        return mar_entry


def dispense_medication_batch(
    mar_entries: List,
    dispensed_by,
    dispensing_location: StorageLocation,
    *,
    auto_link_inventory: bool = True,
) -> Tuple[List, List[Dict]]:
    """
    Batch dispense multiple MAR entries at once.

    More efficient than individual dispenses for multiple doses.

    Args:
        mar_entries: List of MedicationAdministration instances
        dispensed_by: User who dispensed
        dispensing_location: Pharmacy location
        auto_link_inventory: Attempt to auto-link to inventory items by medication name

    Returns:
        Tuple of (successfully_dispensed, errors)
        - successfully_dispensed: List of dispensed MAR entries
        - errors: List of dicts with entry_id and error message
    """
    dispensed = []
    errors = []

    if not _pharmacy_enabled(getattr(dispensing_location, 'facility', None)):
        return dispensed, [
            {
                'entry_id': str(getattr(entry, 'id', '')),
                'medication': getattr(entry, 'medication_name', ''),
                'patient': 'Unknown',
                'error': 'Pharmacy feature is not enabled for this deployment.',
            }
            for entry in mar_entries
        ]

    for entry in mar_entries:
        try:
            # Try to find matching inventory item if auto-linking enabled
            inventory_item = entry.inventory_item
            if auto_link_inventory and not inventory_item:
                # Try to find by medication name
                inventory_item = InventoryItem.objects.filter(
                    facility=entry.facility,
                    name__iexact=entry.medication_name,
                    item_type='medication',
                    is_active=True,
                ).first()

            result = dispense_medication(
                mar_entry=entry,
                dispensed_by=dispensed_by,
                inventory_item=inventory_item,
                dispensing_location=dispensing_location,
            )
            dispensed.append(result)
        except (DispensingError, InsufficientStockError) as e:
            errors.append({
                'entry_id': str(entry.id),
                'medication': entry.medication_name,
                'patient': entry.patient.user.get_full_name() if entry.patient else 'Unknown',
                'error': str(e),
            })
        except Exception as e:
            errors.append({
                'entry_id': str(entry.id),
                'medication': entry.medication_name,
                'patient': entry.patient.user.get_full_name() if entry.patient else 'Unknown',
                'error': f"Unexpected error: {str(e)}",
            })

    return dispensed, errors


def get_pending_dispensing(patient_id=None, facility=None):
    """
    Get MAR entries awaiting dispensing.

    Args:
        patient_id: Optional filter by patient
        facility: Optional filter by facility

    Returns:
        QuerySet of MedicationAdministration entries
    """
    from apps.nursing.models import MedicationAdministration

    if not _query_feature_enabled(facility=facility, patient_id=patient_id):
        return MedicationAdministration.objects.none()

    # Show ALL undispensed scheduled medications
    # Pharmacy needs to see everything that hasn't been dispensed yet
    # Including overdue ones (they still need to be dispensed or addressed)
    queryset = MedicationAdministration.objects.filter(
        status='scheduled',
        is_dispensed=False,
    ).select_related(
        'patient', 'patient__user',
        'prescription',
        'prescribed_by', 'prescribed_by__staff', 'prescribed_by__staff__user',
        'inventory_item', 'inventory_item__category',
    )

    if facility is not None:
        queryset = queryset.filter(facility=facility)

    if patient_id:
        queryset = queryset.filter(patient_id=patient_id)

    return queryset.order_by('scheduled_time')


def get_pending_dispensing_with_stock(patient_id=None, facility=None, location=None):
    """
    Get MAR entries awaiting dispensing with stock availability info.

    Enhanced version that includes stock status for each item.

    Args:
        patient_id: Optional filter by patient
        facility: Optional filter by facility
        location: Dispensing location to check stock at

    Returns:
        List of dicts with MAR entry and stock info
    """
    entries = get_pending_dispensing(patient_id=patient_id, facility=facility)

    results = []
    for entry in entries:
        result = {
            'entry': entry,
            'stock_status': None,
            'inventory_linked': entry.inventory_item is not None,
        }

        # If inventory item is linked and location provided, check stock
        if entry.inventory_item and location:
            result['stock_status'] = check_stock_availability(
                inventory_item=entry.inventory_item,
                location=location,
                quantity=1,
            )

        results.append(result)

    return results


def get_dispensed_ready_for_admin(patient_id=None, facility=None):
    """
    Get MAR entries that are dispensed and ready for nurse administration.

    Args:
        patient_id: Optional filter by patient
        facility: Optional filter by facility

    Returns:
        QuerySet of MedicationAdministration entries
    """
    from apps.nursing.models import MedicationAdministration

    if not _query_feature_enabled(facility=facility, patient_id=patient_id):
        return MedicationAdministration.objects.none()

    queryset = MedicationAdministration.objects.filter(
        status='scheduled',
        is_dispensed=True,
        scheduled_time__lte=timezone.now() + timedelta(hours=2),  # Due within 2 hours
    ).select_related(
        'patient', 'prescription', 'prescribed_by',
        'inventory_item', 'batch_used', 'dispensing_location',
    )

    if facility is not None:
        queryset = queryset.filter(facility=facility)

    if patient_id:
        queryset = queryset.filter(patient_id=patient_id)

    return queryset.order_by('scheduled_time')


def dispense_supply_request(
    supply_request,
    quantity_dispensed,
    dispensed_by,
    *,
    dispensing_location: StorageLocation = None,
    batch_override: ExpiryTracker = None,
):
    """
    Mark a supply request as dispensed and update treatment entry counts.

    Integrates with inventory system if linked.

    Args:
        supply_request: SupplyRequest instance
        quantity_dispensed: Actual quantity dispensed
        dispensed_by: User (pharmacist) who dispensed
        dispensing_location: Location to dispense from
        batch_override: Specific batch to use

    Returns:
        Updated SupplyRequest instance
    """
    facility = _facility_from_dispense_context(
        supply_request,
        dispensing_location,
        getattr(supply_request, 'treatment_entry', None),
    )
    if not _pharmacy_enabled(facility):
        raise DispensingError("Pharmacy feature is not enabled for this deployment.")

    with transaction.atomic():
        entry = supply_request.treatment_entry
        inventory_item = entry.inventory_item

        # Deduct from inventory if linked
        if inventory_item and dispensing_location:
            if not _inventory_enabled(facility):
                raise DispensingError("Inventory feature is not enabled for stock deduction.")
            batch_to_use = batch_override
            if not batch_to_use:
                selections = BatchSelectionService.select_batch_fefo(
                    item=inventory_item,
                    location=dispensing_location,
                    quantity_needed=quantity_dispensed,
                )
                if selections:
                    batch_to_use = selections[0]['batch']

            try:
                StockService.adjust_stock(
                    item=inventory_item,
                    location=dispensing_location,
                    quantity_change=-quantity_dispensed,
                    movement_type='dispense',
                    user=dispensed_by,
                    reference_type='SupplyRequest',
                    reference_id=supply_request.id,
                    notes=f"Supply request for {entry.patient.user.get_full_name() if entry.patient else 'patient'}",
                    batch_number=batch_to_use.batch_number if batch_to_use else None,
                    expiry_tracker=batch_to_use,
                    patient=entry.patient,
                )
            except InsufficientStockError as e:
                raise DispensingError(
                    f"Insufficient stock for supply request: {e}"
                )

        # Update supply request
        supply_request.status = 'dispensed'
        supply_request.quantity_dispensed = quantity_dispensed
        supply_request.dispensed_by = dispensed_by
        supply_request.dispensed_at = timezone.now()
        supply_request.save()

        # Update treatment entry aggregate counts
        entry.total_doses_dispensed += quantity_dispensed
        entry.save()

        return supply_request


def reject_supply_request(supply_request, rejection_reason, rejected_by):
    """
    Reject a supply request.

    Args:
        supply_request: SupplyRequest instance
        rejection_reason: Reason for rejection
        rejected_by: User who rejected

    Returns:
        Updated SupplyRequest instance
    """
    facility = _facility_from_dispense_context(
        supply_request,
        getattr(supply_request, 'treatment_entry', None),
    )
    if not _pharmacy_enabled(facility):
        raise DispensingError("Pharmacy feature is not enabled for this deployment.")

    supply_request.status = 'rejected'
    supply_request.rejection_reason = rejection_reason
    supply_request.save()
    return supply_request


def get_pending_supply_requests(patient_id=None, admission_id=None, facility=None):
    """
    Get pending supply requests, optionally filtered.

    Args:
        patient_id: Optional filter by patient
        admission_id: Optional filter by admission
        facility: Optional filter by facility

    Returns:
        QuerySet of SupplyRequest entries
    """
    from apps.nursing.models import SupplyRequest

    if not _query_feature_enabled(facility=facility, patient_id=patient_id):
        return SupplyRequest.objects.none()

    queryset = SupplyRequest.objects.filter(
        status='pending'
    ).select_related(
        'treatment_entry',
        'treatment_entry__patient',
        'treatment_entry__patient__user',
        'treatment_entry__admission',
        'treatment_entry__inventory_item',
        'requested_by',
        'requested_by__staff',
        'requested_by__staff__user'
    ).order_by('-requested_at')

    if facility is not None:
        queryset = queryset.filter(facility=facility)

    if patient_id:
        queryset = queryset.filter(treatment_entry__patient_id=patient_id)

    if admission_id:
        queryset = queryset.filter(treatment_entry__admission_id=admission_id)

    return queryset


def link_medication_to_inventory(
    medication_name: str,
    facility,
) -> Optional[InventoryItem]:
    """
    Attempt to find a matching inventory item for a medication name.

    Uses fuzzy matching to find the best match.

    Args:
        medication_name: Name of the medication
        facility: Facility context

    Returns:
        InventoryItem if found, None otherwise
    """
    if not _pharmacy_enabled(facility) or not _inventory_enabled(facility):
        return None

    # Exact match first
    item = InventoryItem.objects.filter(
        facility=facility,
        name__iexact=medication_name,
        item_type='medication',
        is_active=True,
    ).first()

    if item:
        return item

    # Partial match (contains)
    item = InventoryItem.objects.filter(
        facility=facility,
        name__icontains=medication_name,
        item_type='medication',
        is_active=True,
    ).first()

    return item


def get_low_stock_medications(facility, location: StorageLocation = None):
    """
    Get medications that are below reorder level.

    Args:
        facility: Facility context
        location: Optional specific location

    Returns:
        List of inventory items below reorder level
    """
    if not _pharmacy_enabled(facility) or not _inventory_enabled(facility):
        return LocationStock.objects.none() if location else InventoryItem.objects.none()

    if location:
        # Location-specific low stock
        return LocationStock.objects.filter(
            location=location,
            item__item_type='medication',
            item__is_active=True,
        ).select_related(
            'item', 'item__category', 'location'
        ).annotate(
            effective_reorder=models.Case(
                models.When(reorder_level__isnull=False, then=models.F('reorder_level')),
                default=models.F('item__reorder_level'),
                output_field=models.IntegerField()
            )
        ).filter(
            quantity__lte=models.F('effective_reorder')
        )
    else:
        # Facility-wide low stock (using total_stock)
        from django.db.models import Sum, F

        return InventoryItem.objects.filter(
            facility=facility,
            item_type='medication',
            is_active=True,
        ).annotate(
            total_qty=Sum('location_stocks__quantity')
        ).filter(
            total_qty__lte=F('reorder_level')
        )
