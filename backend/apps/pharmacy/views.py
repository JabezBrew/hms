"""
Pharmacy views for medication dispensing workflow.

This module provides endpoints for:
- Viewing pending medications to dispense
- Dispensing medications (single and bulk)
- Processing supply requests from wards
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import (
    FacilityScopedPermission,
    check_prescription_access,
    get_user_facility,
)
from apps.nursing.models import MedicationAdministration, SupplyRequest
from apps.audit.services import AuditService
from apps.audit.models import AuditCategory, AuditAction
from apps.users.models import PatientProfile
from apps.inventory.models import InventoryItem, StorageLocation, ExpiryTracker

from .permissions import IsPharmacistOrAdmin
from .serializers import MedicationDispensingListSerializer, SupplyRequestDispensingSerializer
from . import services
from .services import DispensingError


class DispensingViewSet(viewsets.ViewSet):
    """
    API endpoints for pharmacy medication dispensing.

    Provides:
    - GET /dispensing/pending/ - View pending medications to dispense
    - GET /dispensing/ready-for-admin/ - View dispensed medications ready for nursing
    - POST /dispensing/{id}/dispense/ - Dispense a single medication
    - POST /dispensing/bulk-dispense/ - Dispense multiple medications at once
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsPharmacistOrAdmin]
    pagination_class = StandardResultsSetPagination

    @action(detail=False, methods=['get'])
    def pending(self, request):
        """
        Get medications awaiting pharmacy dispensing.
        Pharmacists use this to see what needs to be dispensed.
        """
        patient_id = request.query_params.get('patient')
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return Response(
                    {'error': 'Patient not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_prescription_access(request.user, patient)
        medications = services.get_pending_dispensing(patient_id, facility=facility)
        serializer = MedicationDispensingListSerializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='ready-for-admin')
    def ready_for_admin(self, request):
        """
        Get medications that are dispensed and ready for nurse administration.
        """
        patient_id = request.query_params.get('patient')
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return Response(
                    {'error': 'Patient not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_prescription_access(request.user, patient)
        medications = services.get_dispensed_ready_for_admin(patient_id, facility=facility)
        serializer = MedicationDispensingListSerializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def dispense(self, request, pk=None):
        """
        Mark a medication as dispensed by pharmacy.

        Optional request body for inventory integration:
        - inventory_item_id: UUID of linked inventory item
        - location_id: UUID of dispensing location
        - batch_id: UUID of specific batch to use (overrides FEFO)
        - quantity: Number of units to dispense (default: 1)
        - skip_stock_deduction: If true, don't deduct from inventory
        """
        try:
            med_admin = MedicationAdministration.objects.get(id=pk)
        except MedicationAdministration.DoesNotExist:
            return Response(
                {'error': 'Medication not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        facility = get_user_facility(request)
        if facility and med_admin.facility_id != facility.id:
            raise PermissionDenied("Medication does not belong to the active facility.")

        if med_admin.is_dispensed:
            return Response(
                {'error': 'Medication already dispensed'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Optional inventory integration parameters
        inventory_item = None
        dispensing_location = None
        batch_override = None

        inventory_item_id = request.data.get('inventory_item_id')
        if inventory_item_id:
            try:
                inventory_item = InventoryItem.objects.get(id=inventory_item_id, facility=facility)
            except InventoryItem.DoesNotExist:
                return Response(
                    {'error': 'Inventory item not found'},
                    status=status.HTTP_404_NOT_FOUND
                )

        location_id = request.data.get('location_id')
        if location_id:
            try:
                dispensing_location = StorageLocation.objects.get(
                    id=location_id, facility=facility, can_dispense_to_patients=True
                )
            except StorageLocation.DoesNotExist:
                return Response(
                    {'error': 'Dispensing location not found or cannot dispense'},
                    status=status.HTTP_404_NOT_FOUND
                )

        batch_id = request.data.get('batch_id')
        if batch_id:
            try:
                batch_override = ExpiryTracker.objects.get(
                    id=batch_id, item=inventory_item, location=dispensing_location, status='active'
                )
            except ExpiryTracker.DoesNotExist:
                return Response(
                    {'error': 'Batch not found at specified location'},
                    status=status.HTTP_404_NOT_FOUND
                )

        quantity = int(request.data.get('quantity', 1))
        skip_stock = request.data.get('skip_stock_deduction', False)

        try:
            med_admin = services.dispense_medication(
                mar_entry=med_admin,
                dispensed_by=request.user,
                inventory_item=inventory_item,
                dispensing_location=dispensing_location,
                batch_override=batch_override,
                quantity=quantity,
                skip_stock_deduction=skip_stock,
            )
        except DispensingError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.UPDATE,
            category=AuditCategory.PRESCRIPTION,
            resource_type='MedicationAdministration',
            resource_id=med_admin.id,
            resource_name=f"{med_admin.medication_name}",
            description=f"Dispensed {med_admin.medication_name} for patient "
                        f"{med_admin.patient.user.get_full_name()}"
                        f"{' (inventory deducted)' if inventory_item and not skip_stock else ''}",
            changes={'is_dispensed': {'old': False, 'new': True}}
        )

        # Return updated data
        from apps.nursing.serializers import MedicationAdministrationSerializer
        return Response(MedicationAdministrationSerializer(med_admin).data)

    @action(detail=False, methods=['get'], url_path='pending-with-stock')
    def pending_with_stock(self, request):
        """
        Get medications awaiting dispensing with stock availability info.
        """
        patient_id = request.query_params.get('patient')
        location_id = request.query_params.get('location')
        facility = get_user_facility(request)

        if not facility:
            raise PermissionDenied("Facility context is required.")

        dispensing_location = None
        if location_id:
            try:
                dispensing_location = StorageLocation.objects.get(
                    id=location_id, facility=facility
                )
            except StorageLocation.DoesNotExist:
                return Response(
                    {'error': 'Location not found'},
                    status=status.HTTP_404_NOT_FOUND
                )

        results = services.get_pending_dispensing_with_stock(
            patient_id=patient_id,
            facility=facility,
            location=dispensing_location,
        )

        # Serialize results
        serialized = []
        for item in results:
            entry_data = MedicationDispensingListSerializer(item['entry']).data
            entry_data['inventory_linked'] = item['inventory_linked']
            entry_data['stock_status'] = item['stock_status']
            serialized.append(entry_data)

        return Response(serialized)

    @action(detail=False, methods=['get'], url_path='check-stock')
    def check_stock(self, request):
        """
        Check stock availability for a medication at a location.

        Query params:
        - item_id: Inventory item UUID
        - location_id: Location UUID
        - quantity: Quantity needed (default: 1)
        """
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        item_id = request.query_params.get('item_id')
        location_id = request.query_params.get('location_id')
        quantity = int(request.query_params.get('quantity', 1))

        if not item_id or not location_id:
            return Response(
                {'error': 'item_id and location_id are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            item = InventoryItem.objects.get(id=item_id, facility=facility)
            location = StorageLocation.objects.get(id=location_id, facility=facility)
        except (InventoryItem.DoesNotExist, StorageLocation.DoesNotExist):
            return Response(
                {'error': 'Item or location not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        result = services.check_stock_availability(
            inventory_item=item,
            location=location,
            quantity=quantity,
        )

        return Response(result)

    @action(detail=False, methods=['post'], url_path='bulk-dispense')
    def bulk_dispense(self, request):
        """
        Bulk dispense multiple medications.
        """
        medication_ids = request.data.get('medication_ids', [])
        if not medication_ids:
            return Response(
                {'error': 'medication_ids is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        dispensed = []
        errors = []

        facility = get_user_facility(request)
        for med_id in medication_ids:
            try:
                med_admin = MedicationAdministration.objects.get(id=med_id)
                if facility and med_admin.facility_id != facility.id:
                    errors.append({'id': str(med_id), 'error': 'Facility access denied'})
                    continue
                if not med_admin.is_dispensed:
                    services.dispense_medication(med_admin, request.user)
                    dispensed.append(str(med_id))
                else:
                    errors.append({'id': str(med_id), 'error': 'Already dispensed'})
            except MedicationAdministration.DoesNotExist:
                errors.append({'id': str(med_id), 'error': 'Not found'})

        # Audit log for bulk operation
        if dispensed:
            AuditService.log(
                request=request,
                action=AuditAction.UPDATE,
                category=AuditCategory.PRESCRIPTION,
                resource_type='MedicationAdministration',
                resource_id='bulk',
                resource_name='Bulk dispensing',
                description=f"Bulk dispensed {len(dispensed)} medications",
            )

        return Response({
            'dispensed': dispensed,
            'dispensed_count': len(dispensed),
            'errors': errors
        })


class SupplyRequestDispensingViewSet(viewsets.ViewSet):
    """
    API endpoints for pharmacy to process supply requests from wards.

    Provides:
    - GET /supply-requests/pending/ - View pending supply requests
    - POST /supply-requests/{id}/dispense/ - Dispense a supply request
    - POST /supply-requests/{id}/reject/ - Reject a supply request
    - POST /supply-requests/bulk-dispense/ - Bulk dispense supply requests
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsPharmacistOrAdmin]
    pagination_class = StandardResultsSetPagination

    @action(detail=False, methods=['get'])
    def pending(self, request):
        """
        Get all pending supply requests.
        Used by pharmacy to see what needs to be dispensed.
        """
        patient_id = request.query_params.get('patient_id')
        admission_id = request.query_params.get('admission_id')

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return Response(
                    {'error': 'Patient not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_prescription_access(request.user, patient)
        requests = services.get_pending_supply_requests(
            patient_id=patient_id,
            admission_id=admission_id,
            facility=facility,
        )

        serializer = SupplyRequestDispensingSerializer(requests, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def dispense(self, request, pk=None):
        """
        Dispense a supply request.

        Request body:
        - quantity_dispensed: Actual quantity dispensed (optional, defaults to quantity_requested)
        - location_id: UUID of dispensing location (for inventory deduction)
        - batch_id: UUID of specific batch to use (overrides FEFO)
        """
        try:
            supply_request = SupplyRequest.objects.get(id=pk)
        except SupplyRequest.DoesNotExist:
            return Response(
                {'error': 'Supply request not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        facility = get_user_facility(request)
        if facility and supply_request.facility_id != facility.id:
            raise PermissionDenied("Supply request does not belong to the active facility.")

        if supply_request.status != 'pending':
            return Response(
                {'error': 'Can only dispense pending requests'},
                status=status.HTTP_400_BAD_REQUEST
            )

        quantity_dispensed = request.data.get('quantity_dispensed')
        if quantity_dispensed is None:
            quantity_dispensed = supply_request.quantity_requested

        try:
            quantity_dispensed = int(quantity_dispensed)
            if quantity_dispensed <= 0:
                raise ValueError()
        except (ValueError, TypeError):
            return Response(
                {'error': 'Quantity dispensed must be a positive integer'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Optional inventory integration
        dispensing_location = None
        batch_override = None

        location_id = request.data.get('location_id')
        if location_id:
            try:
                dispensing_location = StorageLocation.objects.get(
                    id=location_id, facility=facility
                )
            except StorageLocation.DoesNotExist:
                return Response(
                    {'error': 'Dispensing location not found'},
                    status=status.HTTP_404_NOT_FOUND
                )

        batch_id = request.data.get('batch_id')
        if batch_id and dispensing_location:
            inventory_item = supply_request.treatment_entry.inventory_item
            if inventory_item:
                try:
                    batch_override = ExpiryTracker.objects.get(
                        id=batch_id, item=inventory_item,
                        location=dispensing_location, status='active'
                    )
                except ExpiryTracker.DoesNotExist:
                    return Response(
                        {'error': 'Batch not found at specified location'},
                        status=status.HTTP_404_NOT_FOUND
                    )

        try:
            supply_request = services.dispense_supply_request(
                supply_request=supply_request,
                quantity_dispensed=quantity_dispensed,
                dispensed_by=request.user,
                dispensing_location=dispensing_location,
                batch_override=batch_override,
            )
        except DispensingError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.UPDATE,
            category=AuditCategory.PHARMACY,
            resource_type='SupplyRequest',
            resource_id=supply_request.id,
            resource_name=supply_request.treatment_entry.medication_name,
            description=f"Dispensed {quantity_dispensed} doses of {supply_request.treatment_entry.medication_name}",
        )

        from apps.nursing.serializers import SupplyRequestSerializer
        return Response(SupplyRequestSerializer(supply_request).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """
        Reject a supply request.

        Request body:
        - reason: Reason for rejection (required)
        """
        try:
            supply_request = SupplyRequest.objects.get(id=pk)
        except SupplyRequest.DoesNotExist:
            return Response(
                {'error': 'Supply request not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        facility = get_user_facility(request)
        if facility and supply_request.facility_id != facility.id:
            raise PermissionDenied("Supply request does not belong to the active facility.")

        if supply_request.status != 'pending':
            return Response(
                {'error': 'Can only reject pending requests'},
                status=status.HTTP_400_BAD_REQUEST
            )

        reason = request.data.get('reason')
        if not reason:
            return Response(
                {'error': 'Reason for rejection is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        supply_request = services.reject_supply_request(
            supply_request=supply_request,
            rejection_reason=reason,
            rejected_by=request.user
        )

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.UPDATE,
            category=AuditCategory.PHARMACY,
            resource_type='SupplyRequest',
            resource_id=supply_request.id,
            resource_name=supply_request.treatment_entry.medication_name,
            description=f"Rejected supply request for {supply_request.treatment_entry.medication_name}: {reason}",
        )

        from apps.nursing.serializers import SupplyRequestSerializer
        return Response(SupplyRequestSerializer(supply_request).data)

    @action(detail=False, methods=['post'], url_path='bulk-dispense')
    def bulk_dispense(self, request):
        """
        Dispense multiple supply requests at once.

        Request body:
        - request_ids: List of supply request IDs
        """
        request_ids = request.data.get('request_ids', [])
        if not request_ids:
            return Response(
                {'error': 'request_ids is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        dispensed_count = 0
        errors = []

        facility = get_user_facility(request)
        for request_id in request_ids:
            try:
                supply_request = SupplyRequest.objects.get(id=request_id, status='pending')
                if facility and supply_request.facility_id != facility.id:
                    errors.append(f"Request {request_id} facility access denied")
                    continue
                services.dispense_supply_request(
                    supply_request=supply_request,
                    quantity_dispensed=supply_request.quantity_requested,
                    dispensed_by=request.user
                )
                dispensed_count += 1
            except SupplyRequest.DoesNotExist:
                errors.append(f"Request {request_id} not found or not pending")
            except Exception as e:
                errors.append(f"Error dispensing {request_id}: {str(e)}")

        # Audit log
        if dispensed_count > 0:
            AuditService.log(
                request=request,
                action=AuditAction.UPDATE,
                category=AuditCategory.PHARMACY,
                resource_type='SupplyRequest',
                resource_id='bulk',
                resource_name='Bulk dispensing',
                description=f"Bulk dispensed {dispensed_count} supply requests",
            )

        return Response({
            'dispensed_count': dispensed_count,
            'errors': errors
        })


from apps.core.features import bind_required_feature

bind_required_feature(globals(), 'pharmacy')
