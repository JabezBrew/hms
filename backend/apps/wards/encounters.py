"""
Encounter-related views and serializers for the wards app.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from rest_framework.pagination import PageNumberPagination

from ..users.permissions import IsAdminOrOwner
from ..users.models import PatientProfile, PractitionerProfile
from .proxies import EncounterProxy, CareTeamProxy, AccountProxy
from ..appointments.proxies import AppointmentProxy

from rest_framework import serializers


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 1000


class EncounterSerializer(serializers.Serializer):
    """
    Serializer for FHIR Encounter resources.
    """
    id = serializers.CharField(read_only=True)
    patient_id = serializers.CharField()
    practitioner_id = serializers.CharField(required=False, allow_null=True)
    encounter_type = serializers.ChoiceField(
        choices=['inpatient', 'outpatient', 'emergency'],
        default='outpatient'
    )
    status = serializers.ChoiceField(
        choices=['planned', 'in-progress', 'finished', 'cancelled'],
        default='planned'
    )
    reason = serializers.CharField(required=False, allow_null=True)
    service_type = serializers.CharField(required=False, allow_null=True)
    start_time = serializers.DateTimeField()
    end_time = serializers.DateTimeField(required=False, allow_null=True)
    location = serializers.CharField(required=False, allow_null=True)
    admission_source = serializers.CharField(required=False, allow_null=True)
    discharge_disposition = serializers.CharField(required=False, allow_null=True)
    destination = serializers.CharField(required=False, allow_null=True)
    careteam_id = serializers.CharField(required=False, allow_null=True)
    account_id = serializers.CharField(required=False, allow_null=True)
    appointment_id = serializers.CharField(required=False, allow_null=True)
    diagnosis_refs = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list
    )
    
    # Additional fields for UI display
    patient_name = serializers.CharField(read_only=True)
    practitioner_name = serializers.CharField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class EncounterViewSet(viewsets.ViewSet):
    """
    API endpoint for FHIR Encounter resources.
    """
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination

    def list(self, request):
        """
        List all encounters with optional filtering.
        """
        # Extract query parameters
        patient_id = request.query_params.get('patient_id')
        practitioner_id = request.query_params.get('practitioner_id')
        status = request.query_params.get('status')
        date = request.query_params.get('date')
        encounter_type = request.query_params.get('encounter_type')

        # Search for encounters
        encounters = EncounterProxy.search(
            patient_id=patient_id,
            practitioner_id=practitioner_id,
            status=status,
            date=date,
            encounter_type=encounter_type
        )

        # Process the results
        results = []
        if 'entry' in encounters:
            for entry in encounters['entry']:
                if 'resource' in entry and entry['resource']['resourceType'] == 'Encounter':
                    encounter = entry['resource']
                    
                    # Extract patient name if available
                    patient_name = "Unknown Patient"
                    if 'subject' in encounter and 'display' in encounter['subject']:
                        patient_name = encounter['subject']['display']
                    
                    # Extract practitioner name if available
                    practitioner_name = "Unknown Practitioner"
                    if 'participant' in encounter and len(encounter['participant']) > 0:
                        if 'individual' in encounter['participant'][0] and 'display' in encounter['participant'][0]['individual']:
                            practitioner_name = encounter['participant'][0]['individual']['display']
                    
                    # Extract encounter type
                    encounter_type = "unknown"
                    if 'class' in encounter and 'code' in encounter['class']:
                        code = encounter['class']['code']
                        if code == 'IMP':
                            encounter_type = 'inpatient'
                        elif code == 'AMB':
                            encounter_type = 'outpatient'
                        elif code == 'EMER':
                            encounter_type = 'emergency'
                    
                    # Extract start and end times
                    start_time = None
                    end_time = None
                    if 'period' in encounter:
                        if 'start' in encounter['period']:
                            start_time = encounter['period']['start']
                        if 'end' in encounter['period']:
                            end_time = encounter['period']['end']
                    
                    # Extract reason
                    reason = None
                    if 'reasonCode' in encounter and len(encounter['reasonCode']) > 0:
                        if 'text' in encounter['reasonCode'][0]:
                            reason = encounter['reasonCode'][0]['text']
                    
                    # Extract service type
                    service_type = None
                    if 'serviceType' in encounter and 'text' in encounter['serviceType']:
                        service_type = encounter['serviceType']['text']
                    
                    # Extract location
                    location = None
                    if 'location' in encounter and len(encounter['location']) > 0:
                        if 'location' in encounter['location'][0] and 'display' in encounter['location'][0]['location']:
                            location = encounter['location'][0]['location']['display']
                    
                    # Add to results
                    results.append({
                        'id': encounter['id'],
                        'patient_id': encounter['subject']['reference'].split('/')[1] if 'subject' in encounter and 'reference' in encounter['subject'] else None,
                        'patient_name': patient_name,
                        'practitioner_id': encounter['participant'][0]['individual']['reference'].split('/')[1] if 'participant' in encounter and len(encounter['participant']) > 0 and 'individual' in encounter['participant'][0] and 'reference' in encounter['participant'][0]['individual'] else None,
                        'practitioner_name': practitioner_name,
                        'encounter_type': encounter_type,
                        'status': encounter['status'],
                        'reason': reason,
                        'service_type': service_type,
                        'start_time': start_time,
                        'end_time': end_time,
                        'location': location,
                        'created_at': start_time,  # Using start_time as a proxy for created_at
                        'updated_at': encounter.get('meta', {}).get('lastUpdated')
                    })
        
        # Apply pagination if needed
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(results, request)
        
        if page is not None:
            return paginator.get_paginated_response(page)
        
        return Response(results)

    def retrieve(self, request, pk=None):
        """
        Get a single encounter by ID.
        """
        try:
            encounter = EncounterProxy.get(pk)
            
            # Extract patient name if available
            patient_name = "Unknown Patient"
            if 'subject' in encounter and 'display' in encounter['subject']:
                patient_name = encounter['subject']['display']
            
            # Extract practitioner name if available
            practitioner_name = "Unknown Practitioner"
            if 'participant' in encounter and len(encounter['participant']) > 0:
                if 'individual' in encounter['participant'][0] and 'display' in encounter['participant'][0]['individual']:
                    practitioner_name = encounter['participant'][0]['individual']['display']
            
            # Extract encounter type
            encounter_type = "unknown"
            if 'class' in encounter and 'code' in encounter['class']:
                code = encounter['class']['code']
                if code == 'IMP':
                    encounter_type = 'inpatient'
                elif code == 'AMB':
                    encounter_type = 'outpatient'
                elif code == 'EMER':
                    encounter_type = 'emergency'
            
            # Extract start and end times
            start_time = None
            end_time = None
            if 'period' in encounter:
                if 'start' in encounter['period']:
                    start_time = encounter['period']['start']
                if 'end' in encounter['period']:
                    end_time = encounter['period']['end']
            
            # Extract reason
            reason = None
            if 'reasonCode' in encounter and len(encounter['reasonCode']) > 0:
                if 'text' in encounter['reasonCode'][0]:
                    reason = encounter['reasonCode'][0]['text']
            
            # Extract service type
            service_type = None
            if 'serviceType' in encounter and 'text' in encounter['serviceType']:
                service_type = encounter['serviceType']['text']
            
            # Extract location
            location = None
            if 'location' in encounter and len(encounter['location']) > 0:
                if 'location' in encounter['location'][0] and 'display' in encounter['location'][0]['location']:
                    location = encounter['location'][0]['location']['display']
            
            # Extract admission source
            admission_source = None
            if 'hospitalization' in encounter and 'admitSource' in encounter['hospitalization']:
                if 'coding' in encounter['hospitalization']['admitSource'] and len(encounter['hospitalization']['admitSource']['coding']) > 0:
                    admission_source = encounter['hospitalization']['admitSource']['coding'][0].get('code')
            
            # Extract discharge disposition
            discharge_disposition = None
            if 'hospitalization' in encounter and 'dischargeDisposition' in encounter['hospitalization']:
                if 'coding' in encounter['hospitalization']['dischargeDisposition'] and len(encounter['hospitalization']['dischargeDisposition']['coding']) > 0:
                    discharge_disposition = encounter['hospitalization']['dischargeDisposition']['coding'][0].get('code')
            
            # Extract destination
            destination = None
            if 'hospitalization' in encounter and 'destination' in encounter['hospitalization']:
                destination = encounter['hospitalization']['destination'].get('display')
            
            # Extract careteam, account, appointment, and diagnosis references
            careteam_id = None
            if 'careTeam' in encounter and len(encounter['careTeam']) > 0:
                careteam_id = encounter['careTeam'][0]['reference'].split('/')[1]
            
            account_id = None
            if 'account' in encounter and len(encounter['account']) > 0:
                account_id = encounter['account'][0]['reference'].split('/')[1]
            
            appointment_id = None
            if 'basedOn' in encounter and len(encounter['basedOn']) > 0:
                appointment_id = encounter['basedOn'][0]['reference'].split('/')[1]
            
            diagnosis_refs = []
            if 'diagnosis' in encounter:
                for diagnosis in encounter['diagnosis']:
                    if 'condition' in diagnosis and 'reference' in diagnosis['condition']:
                        diagnosis_refs.append(diagnosis['condition']['reference'].split('/')[1])
            
            # Prepare the response
            result = {
                'id': encounter['id'],
                'patient_id': encounter['subject']['reference'].split('/')[1] if 'subject' in encounter and 'reference' in encounter['subject'] else None,
                'patient_name': patient_name,
                'practitioner_id': encounter['participant'][0]['individual']['reference'].split('/')[1] if 'participant' in encounter and len(encounter['participant']) > 0 and 'individual' in encounter['participant'][0] and 'reference' in encounter['participant'][0]['individual'] else None,
                'practitioner_name': practitioner_name,
                'encounter_type': encounter_type,
                'status': encounter['status'],
                'reason': reason,
                'service_type': service_type,
                'start_time': start_time,
                'end_time': end_time,
                'location': location,
                'admission_source': admission_source,
                'discharge_disposition': discharge_disposition,
                'destination': destination,
                'careteam_id': careteam_id,
                'account_id': account_id,
                'appointment_id': appointment_id,
                'diagnosis_refs': diagnosis_refs,
                'created_at': start_time,  # Using start_time as a proxy for created_at
                'updated_at': encounter.get('meta', {}).get('lastUpdated'),
                'fhir_resource': encounter  # Include the full FHIR resource for reference
            }
            
            return Response(result)
        
        except Exception as e:
            return Response(
                {"error": f"Failed to retrieve encounter: {str(e)}"},
                status=status.HTTP_404_NOT_FOUND
            )

    def create(self, request):
        """
        Create a new encounter.
        """
        serializer = EncounterSerializer(data=request.data)
        
        if serializer.is_valid():
            try:
                # Create the encounter using EncounterProxy
                encounter = EncounterProxy.create(
                    patient_id=serializer.validated_data['patient_id'],
                    practitioner_id=serializer.validated_data.get('practitioner_id'),
                    encounter_type=serializer.validated_data['encounter_type'],
                    status=serializer.validated_data['status'],
                    reason=serializer.validated_data.get('reason'),
                    service_type=serializer.validated_data.get('service_type'),
                    start_time=serializer.validated_data['start_time'],
                    location=serializer.validated_data.get('location'),
                    admission_source=serializer.validated_data.get('admission_source'),
                    careteam_id=serializer.validated_data.get('careteam_id'),
                    account_id=serializer.validated_data.get('account_id'),
                    appointment_id=serializer.validated_data.get('appointment_id'),
                    diagnosis_refs=serializer.validated_data.get('diagnosis_refs', [])
                )
                
                return Response(encounter, status=status.HTTP_201_CREATED)
            
            except Exception as e:
                return Response(
                    {"error": f"Failed to create encounter: {str(e)}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def update(self, request, pk=None):
        """
        Update an existing encounter.
        """
        try:
            # Get the existing encounter
            existing_encounter = EncounterProxy.get(pk)
            
            # Update the encounter
            updated_encounter = EncounterProxy.update(
                encounter_id=pk,
                status=request.data.get('status'),
                end_time=request.data.get('end_time'),
                discharge_disposition=request.data.get('discharge_disposition'),
                destination=request.data.get('destination')
            )
            
            return Response(updated_encounter)
        
        except Exception as e:
            return Response(
                {"error": f"Failed to update encounter: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

    def destroy(self, request, pk=None):
        """
        Delete an encounter.
        """
        try:
            EncounterProxy.delete(pk)
            return Response(status=status.HTTP_204_NO_CONTENT)
        
        except Exception as e:
            return Response(
                {"error": f"Failed to delete encounter: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=['post'])
    def discharge(self, request, pk=None):
        """
        Discharge a patient (for inpatient encounters).
        """
        try:
            # Get the existing encounter
            existing_encounter = EncounterProxy.get(pk)
            
            # Check if this is an inpatient encounter
            encounter_type = "unknown"
            if 'class' in existing_encounter and 'code' in existing_encounter['class']:
                code = existing_encounter['class']['code']
                if code == 'IMP':
                    encounter_type = 'inpatient'
            
            if encounter_type != 'inpatient':
                return Response(
                    {"error": "Only inpatient encounters can be discharged"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Update the encounter
            updated_encounter = EncounterProxy.update(
                encounter_id=pk,
                status="finished",
                end_time=timezone.now(),
                discharge_disposition=request.data.get('discharge_disposition'),
                destination=request.data.get('destination')
            )
            
            return Response(updated_encounter)
        
        except Exception as e:
            return Response(
                {"error": f"Failed to discharge patient: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """
        Cancel an encounter.
        """
        try:
            # Update the encounter
            updated_encounter = EncounterProxy.update(
                encounter_id=pk,
                status="cancelled",
                end_time=timezone.now()
            )
            
            return Response(updated_encounter)
        
        except Exception as e:
            return Response(
                {"error": f"Failed to cancel encounter: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )