from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone

from .models import Ward, Bed, Admission, BedAllocationLog, WardTransfer
from .serializers import (
    WardSerializer, BedSerializer, AdmissionSerializer, 
    BedAllocationLogSerializer, WardTransferSerializer,
    AdmissionCreateSerializer, DischargeSerializer, TransferRequestSerializer
)
from ..users.permissions import IsAdminOrOwner
from ..fhir_client.client import fhir_client
from ..fhir_client.utils import create_reference, create_period, generate_fhir_id


class WardViewSet(viewsets.ModelViewSet):
    """
    API endpoint for wards.
    """
    queryset = Ward.objects.all()
    serializer_class = WardSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
    
    @action(detail=True, methods=['get'])
    def beds(self, request, pk=None):
        """
        Get all beds in a ward.
        """
        ward = self.get_object()
        beds = ward.beds.all()
        
        # Filter by status if provided
        status_filter = request.query_params.get('status', None)
        if status_filter:
            beds = beds.filter(status=status_filter)
        
        serializer = BedSerializer(beds, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def admissions(self, request, pk=None):
        """
        Get all admissions in a ward.
        """
        ward = self.get_object()
        
        # Get all beds in the ward
        beds = ward.beds.all()
        
        # Get all admissions for these beds
        admissions = Admission.objects.filter(bed__in=beds)
        
        # Filter by status if provided
        status_filter = request.query_params.get('status', None)
        if status_filter:
            admissions = admissions.filter(status=status_filter)
        
        serializer = AdmissionSerializer(admissions, many=True)
        return Response(serializer.data)


class BedViewSet(viewsets.ModelViewSet):
    """
    API endpoint for beds.
    """
    queryset = Bed.objects.all()
    serializer_class = BedSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filterset_fields = ['ward', 'status', 'bed_type']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        # Get the old status before saving
        if self.get_object():
            old_status = self.get_object().status
            new_status = serializer.validated_data.get('status', old_status)
            
            # Save the bed
            bed = serializer.save(updated_by=self.request.user)
            
            # If status changed, create a log entry
            if old_status != new_status:
                BedAllocationLog.objects.create(
                    bed=bed,
                    previous_status=old_status,
                    new_status=new_status,
                    created_by=self.request.user
                )
        else:
            serializer.save(updated_by=self.request.user)
    
    @action(detail=True, methods=['get'])
    def admissions(self, request, pk=None):
        """
        Get all admissions for a bed.
        """
        bed = self.get_object()
        admissions = bed.admissions.all()
        
        # Filter by status if provided
        status_filter = request.query_params.get('status', None)
        if status_filter:
            admissions = admissions.filter(status=status_filter)
        
        serializer = AdmissionSerializer(admissions, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def allocation_logs(self, request, pk=None):
        """
        Get all allocation logs for a bed.
        """
        bed = self.get_object()
        logs = bed.allocation_logs.all()
        serializer = BedAllocationLogSerializer(logs, many=True)
        return Response(serializer.data)


class AdmissionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for admissions.
    """
    queryset = Admission.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filterset_fields = ['patient', 'bed', 'status', 'admission_type', 'is_billed']
    
    def get_serializer_class(self):
        if self.action == 'create':
            return AdmissionCreateSerializer
        return AdmissionSerializer
    
    def perform_create(self, serializer):
        with transaction.atomic():
            # Create the admission
            admission = serializer.save(
                created_by=self.request.user, 
                updated_by=self.request.user,
                status='admitted'
            )
            
            # Create FHIR Encounter if fhir_encounter_id is not provided
            if not admission.fhir_encounter_id:
                try:
                    # Create FHIR Encounter
                    encounter_data = {
                        "resourceType": "Encounter",
                        "id": generate_fhir_id(),
                        "status": "in-progress",
                        "class": {
                            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                            "code": "IMP",
                            "display": "inpatient encounter"
                        },
                        "subject": create_reference(
                            "Patient", 
                            admission.patient.fhir_patient_id
                        ),
                        "period": create_period(
                            start=admission.admission_date.isoformat()
                        ),
                        "serviceType": {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/service-type",
                                    "code": "124",
                                    "display": "General Practice"
                                }
                            ],
                            "text": f"Admission to {admission.bed.ward.name}"
                        }
                    }
                    
                    # Add practitioner if available
                    if admission.admitting_doctor and admission.admitting_doctor.practitioner_profile.fhir_practitioner_id:
                        encounter_data["participant"] = [
                            {
                                "type": [
                                    {
                                        "coding": [
                                            {
                                                "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                                "code": "ATND",
                                                "display": "attender"
                                            }
                                        ]
                                    }
                                ],
                                "individual": create_reference(
                                    "Practitioner",
                                    admission.admitting_doctor.practitioner_profile.fhir_practitioner_id
                                )
                            }
                        ]
                    
                    # Create the encounter in FHIR
                    fhir_encounter = fhir_client.create_resource("Encounter", encounter_data)
                    
                    # Update the admission with the FHIR encounter ID
                    admission.fhir_encounter_id = fhir_encounter["id"]
                    admission.save()
                    
                except Exception as e:
                    # Log the error but continue (we don't want to roll back the admission)
                    print(f"Failed to create FHIR Encounter: {str(e)}")
            
            # Create a bed allocation log
            BedAllocationLog.objects.create(
                bed=admission.bed,
                previous_status='available',
                new_status='occupied',
                admission=admission,
                created_by=self.request.user
            )
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
    
    @action(detail=True, methods=['post'])
    def discharge(self, request, pk=None):
        """
        Discharge a patient.
        """
        admission = self.get_object()
        
        # Validate the discharge
        serializer = DischargeSerializer(
            data=request.data, 
            context={'admission': admission}
        )
        
        if serializer.is_valid():
            with transaction.atomic():
                # Discharge the patient
                discharge_notes = serializer.validated_data.get('discharge_notes', '')
                admission.discharge_patient(discharge_notes)
                
                # Update FHIR Encounter if available
                if admission.fhir_encounter_id:
                    try:
                        # Get the current encounter
                        encounter = fhir_client.get_resource("Encounter", admission.fhir_encounter_id)
                        
                        # Update the status and end date
                        encounter["status"] = "finished"
                        if "period" not in encounter:
                            encounter["period"] = {}
                        encounter["period"]["end"] = admission.actual_discharge_date.isoformat()
                        
                        # Update the encounter in FHIR
                        fhir_client.update_resource("Encounter", admission.fhir_encounter_id, encounter)
                        
                    except Exception as e:
                        # Log the error but continue
                        print(f"Failed to update FHIR Encounter: {str(e)}")
                
                # Create a bed allocation log
                BedAllocationLog.objects.create(
                    bed=admission.bed,
                    previous_status='occupied',
                    new_status='cleaning',
                    admission=admission,
                    notes=f"Patient discharged: {discharge_notes}",
                    created_by=request.user
                )
                
                return Response({
                    "message": "Patient discharged successfully.",
                    "admission": AdmissionSerializer(admission).data
                })
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class BedAllocationLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for bed allocation logs (read-only).
    """
    queryset = BedAllocationLog.objects.all()
    serializer_class = BedAllocationLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['bed', 'previous_status', 'new_status', 'created_by']


class WardTransferViewSet(viewsets.ModelViewSet):
    """
    API endpoint for ward transfers.
    """
    queryset = WardTransfer.objects.all()
    serializer_class = WardTransferSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filterset_fields = ['patient', 'from_admission', 'to_admission', 'created_by']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
    @action(detail=False, methods=['post'])
    def request_transfer(self, request):
        """
        Request a patient transfer between wards.
        """
        serializer = TransferRequestSerializer(data=request.data)
        
        if serializer.is_valid():
            with transaction.atomic():
                # Get validated data
                from_admission = serializer.validated_data['from_admission']
                to_bed = serializer.validated_data['to_bed']
                reason = serializer.validated_data['reason']
                
                # Create a new admission for the destination bed
                to_admission = Admission.objects.create(
                    patient=from_admission.patient,
                    bed=to_bed,
                    fhir_encounter_id=from_admission.fhir_encounter_id,  # Use the same encounter
                    admission_date=timezone.now(),
                    expected_discharge_date=from_admission.expected_discharge_date,
                    status='admitted',
                    admission_type=from_admission.admission_type,
                    admission_notes=f"Transferred from {from_admission.bed.ward.name}: {reason}",
                    daily_rate=to_bed.total_rate,
                    admitting_doctor=from_admission.admitting_doctor,
                    created_by=request.user,
                    updated_by=request.user
                )
                
                # Create the transfer record
                transfer = WardTransfer.objects.create(
                    patient=from_admission.patient,
                    from_admission=from_admission,
                    to_admission=to_admission,
                    reason=reason,
                    created_by=request.user
                )
                
                # Create bed allocation logs
                BedAllocationLog.objects.create(
                    bed=from_admission.bed,
                    previous_status='occupied',
                    new_status='cleaning',
                    admission=from_admission,
                    notes=f"Patient transferred to {to_bed.ward.name}",
                    created_by=request.user
                )
                
                BedAllocationLog.objects.create(
                    bed=to_bed,
                    previous_status='available',
                    new_status='occupied',
                    admission=to_admission,
                    notes=f"Patient transferred from {from_admission.bed.ward.name}",
                    created_by=request.user
                )
                
                return Response({
                    "message": "Patient transferred successfully.",
                    "transfer": WardTransferSerializer(transfer).data
                })
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)