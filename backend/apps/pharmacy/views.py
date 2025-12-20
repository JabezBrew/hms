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

from apps.core.pagination import StandardResultsSetPagination
from apps.nursing.models import MedicationAdministration, SupplyRequest
from apps.audit.services import AuditService
from apps.audit.models import AuditCategory, AuditAction

from .permissions import IsPharmacistOrAdmin
from .serializers import MedicationDispensingListSerializer, SupplyRequestDispensingSerializer
from . import services


class DispensingViewSet(viewsets.ViewSet):
    """
    API endpoints for pharmacy medication dispensing.

    Provides:
    - GET /dispensing/pending/ - View pending medications to dispense
    - GET /dispensing/ready-for-admin/ - View dispensed medications ready for nursing
    - POST /dispensing/{id}/dispense/ - Dispense a single medication
    - POST /dispensing/bulk-dispense/ - Dispense multiple medications at once
    """
    permission_classes = [permissions.IsAuthenticated, IsPharmacistOrAdmin]
    pagination_class = StandardResultsSetPagination

    @action(detail=False, methods=['get'])
    def pending(self, request):
        """
        Get medications awaiting pharmacy dispensing.
        Pharmacists use this to see what needs to be dispensed.
        """
        patient_id = request.query_params.get('patient')
        medications = services.get_pending_dispensing(patient_id)
        serializer = MedicationDispensingListSerializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='ready-for-admin')
    def ready_for_admin(self, request):
        """
        Get medications that are dispensed and ready for nurse administration.
        """
        patient_id = request.query_params.get('patient')
        medications = services.get_dispensed_ready_for_admin(patient_id)
        serializer = MedicationDispensingListSerializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def dispense(self, request, pk=None):
        """
        Mark a medication as dispensed by pharmacy.
        """
        try:
            med_admin = MedicationAdministration.objects.get(id=pk)
        except MedicationAdministration.DoesNotExist:
            return Response(
                {'error': 'Medication not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        if med_admin.is_dispensed:
            return Response(
                {'error': 'Medication already dispensed'},
                status=status.HTTP_400_BAD_REQUEST
            )

        med_admin = services.dispense_medication(med_admin, request.user)

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.UPDATE,
            category=AuditCategory.PRESCRIPTION,
            resource_type='MedicationAdministration',
            resource_id=med_admin.id,
            resource_name=f"{med_admin.medication_name}",
            description=f"Dispensed {med_admin.medication_name} for patient "
                        f"{med_admin.patient.user.get_full_name()}",
            changes={'is_dispensed': {'old': False, 'new': True}}
        )

        # Return updated data
        from apps.nursing.serializers import MedicationAdministrationSerializer
        return Response(MedicationAdministrationSerializer(med_admin).data)

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

        for med_id in medication_ids:
            try:
                med_admin = MedicationAdministration.objects.get(id=med_id)
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
    permission_classes = [permissions.IsAuthenticated, IsPharmacistOrAdmin]
    pagination_class = StandardResultsSetPagination

    @action(detail=False, methods=['get'])
    def pending(self, request):
        """
        Get all pending supply requests.
        Used by pharmacy to see what needs to be dispensed.
        """
        patient_id = request.query_params.get('patient_id')
        admission_id = request.query_params.get('admission_id')

        requests = services.get_pending_supply_requests(
            patient_id=patient_id,
            admission_id=admission_id
        )

        serializer = SupplyRequestDispensingSerializer(requests, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def dispense(self, request, pk=None):
        """
        Dispense a supply request.

        Request body:
        - quantity_dispensed: Actual quantity dispensed (optional, defaults to quantity_requested)
        """
        try:
            supply_request = SupplyRequest.objects.get(id=pk)
        except SupplyRequest.DoesNotExist:
            return Response(
                {'error': 'Supply request not found'},
                status=status.HTTP_404_NOT_FOUND
            )

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

        supply_request = services.dispense_supply_request(
            supply_request=supply_request,
            quantity_dispensed=quantity_dispensed,
            dispensed_by=request.user
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

        for request_id in request_ids:
            try:
                supply_request = SupplyRequest.objects.get(id=request_id, status='pending')
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
