from rest_framework import viewsets, permissions, status, filters
import time
import logging
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.shortcuts import get_object_or_404

from .models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from .serializers import (
    PatientFHIRMappingSerializer, PatientSearchSerializer,
    RecentPatientSerializer, PatientRegistrationValidationSerializer,
    PatientNoteSerializer, PatientRegistrationSerializer
)
from apps.users.models import PatientProfile
from apps.users.serializers import PatientProfileSerializer
from apps.users.permissions import IsAdminOrOwner, CanAccessPatient
from apps.fhir_client.client import fhir_client
from .tasks import sync_patient_with_fhir


class PatientFHIRMappingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient FHIR mappings.
    """
    queryset = PatientFHIRMapping.objects.select_related('patient_profile', 'patient_profile__user').all()
    serializer_class = PatientFHIRMappingSerializer
    permission_classes = [permissions.IsAuthenticated, CanAccessPatient]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def sync_with_fhir(self, request, pk=None):
        """
        Queue a background task to sync the local patient data with the FHIR resource.
        """
        mapping = self.get_object()

        # Queue the sync task
        task = sync_patient_with_fhir.delay(str(mapping.id))

        return Response({
            "message": "FHIR sync has been queued for background processing.",
            "task_id": task.id,
            "patient_id": str(mapping.patient_profile.id)
        }, status=status.HTTP_202_ACCEPTED)


class PatientSearchViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient searches.
    """
    queryset = PatientSearch.objects.all()
    serializer_class = PatientSearchSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """
        Filter searches to only show the current user's searches.
        """
        return PatientSearch.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class RecentPatientViewSet(viewsets.ModelViewSet):
    """
    API endpoint for recent patients.
    """
    queryset = RecentPatient.objects.all()
    serializer_class = RecentPatientSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """
        Filter recent patients to only show the current user's recent patients.
        """
        return RecentPatient.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['post'])
    def add_recent(self, request):
        """
        Add a patient to the user's recent patients list.
        """
        patient_profile_id = request.data.get('patient_profile')
        if not patient_profile_id:
            return Response(
                {"error": "patient_profile is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            patient_profile = PatientProfile.objects.get(id=patient_profile_id)

            # Check if already exists
            recent, created = RecentPatient.objects.get_or_create(
                user=request.user,
                patient_profile=patient_profile
            )

            # If it exists, update the access_date
            if not created:
                recent.save()  # This will update the auto_now field

            return Response({
                "message": "Patient added to recent list.",
                "recent_patient": RecentPatientSerializer(recent).data
            })

        except PatientProfile.DoesNotExist:
            return Response(
                {"error": "Patient profile not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {"error": f"Failed to add recent patient: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PatientRegistrationValidationViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient registration validation rules.
    """
    queryset = PatientRegistrationValidation.objects.all()
    serializer_class = PatientRegistrationValidationSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PatientNoteViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient notes.
    """
    queryset = PatientNote.objects.all()
    serializer_class = PatientNoteSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]

    def get_queryset(self):
        """
        Filter notes based on permissions.
        """
        if self.request.user.is_staff:
            return PatientNote.objects.all()

        # Regular users can only see their own notes and non-private notes
        return PatientNote.objects.filter(
            created_by=self.request.user
        ) | PatientNote.objects.filter(
            is_private=False
        )

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PatientViewSet(viewsets.ViewSet):
    """
    API endpoint for patient management.
    """
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['post'])
    def register(self, request):
        """
        Register a new patient.
        """
        serializer = PatientRegistrationSerializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            try:
                with transaction.atomic():
                    patient_profile = serializer.save()

                    # Log the search
                    PatientSearch.objects.create(
                        user=request.user,
                        search_query=f"Registration: {patient_profile.user.get_full_name()}"
                    )

                    # Add to recent patients
                    RecentPatient.objects.create(
                        user=request.user,
                        patient_profile=patient_profile
                    )

                    return Response(
                        PatientProfileSerializer(patient_profile).data,
                        status=status.HTTP_201_CREATED
                    )
            except Exception as e:
                return Response(
                    {"error": f"Failed to register patient: {str(e)}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def search(self, request):
        """
        Search for patients with advanced filters.
        """
        query = request.query_params.get('query', '')
        ward_id = request.query_params.get('ward', '')
        admission_date = request.query_params.get('admission_date', '')
        
        # Log the search
        search_desc = f"Query: {query}"
        if ward_id:
            search_desc += f", Ward: {ward_id}"
        if admission_date:
            search_desc += f", Date: {admission_date}"
            
        logger = logging.getLogger(__name__)
        start_time = time.time()
        
        PatientSearch.objects.create(
            user=request.user,
            search_query=search_desc
        )

        try:
            from django.db.models import Q
            from apps.wards.models import Admission

            # Base query for local patients with optimizations
            local_patients_qs = PatientProfile.objects.select_related('user').prefetch_related(
                'admissions', 
                'admissions__bed', 
                'admissions__bed__ward'
            ).all()
            
            # Filter by text query (Name, MRN, NHIS)
            if query:
                local_patients_qs = local_patients_qs.filter(
                    Q(user__first_name__icontains=query) |
                    Q(user__last_name__icontains=query) |
                    Q(medical_record_number__icontains=query) |
                    Q(nhis_id__icontains=query)
                )

            # Filter by Ward (via active Admission)
            if ward_id:
                local_patients_qs = local_patients_qs.filter(
                    admissions__bed__ward_id=ward_id,
                    admissions__status='admitted'
                ).distinct()

            # Filter by Admission Date
            if admission_date:
                # Filter patients who have an admission on this date
                local_patients_qs = local_patients_qs.filter(
                    admissions__admission_date__date=admission_date
                ).distinct()

            # Log query construction time
            query_build_time = time.time()
            logger.info(f"Search query built in {query_build_time - start_time:.4f}s")

            # Prepare results
            patients = []
            
            # Process local results
            for patient in local_patients_qs[:20]: # Limit to 20 local results
                # Optimization: Do NOT fetch FHIR resource synchronously for list view
                # This causes massive performance issues (N+1 HTTP requests)
                # The frontend primarily uses local_data for the list
                patients.append({
                    "fhir_resource": None, 
                    "local_data": PatientProfileSerializer(patient).data
                })
            
            # Log local processing time
            local_proc_time = time.time()
            logger.info(f"Local results processed in {local_proc_time - query_build_time:.4f}s. Count: {len(patients)}")

            # If only text query is provided and no specific filters, also search FHIR directly
            # (FHIR search usually doesn't support our specific ward/admission logic easily without custom params)
            if query and not ward_id and not admission_date and len(patients) < 10:
                search_params = {
                    "name": query,
                    "_sort": "family",
                    "_count": 10
                }
                
                identifier_search_params = {
                    "identifier": query,
                    "_sort": "family",
                    "_count": 10
                }

                # Try name search first
                fhir_results = fhir_client.search_resources("Patient", search_params)

                # If no results, try identifier search
                if "entry" not in fhir_results or len(fhir_results.get("entry", [])) == 0:
                    fhir_results = fhir_client.search_resources("Patient", identifier_search_params)

                if "entry" in fhir_results:
                    for entry in fhir_results["entry"]:
                        resource = entry.get("resource", {})
                        
                        # Check if we already have this patient in our local results
                        if any(p['fhir_resource'] and p['fhir_resource'].get('id') == resource.get('id') for p in patients):
                            continue

                        # Try to find the local mapping
                        try:
                            mapping = PatientFHIRMapping.objects.get(fhir_patient_id=resource.get("id"))
                            # Add to results if not already present (though logic above should catch it, mapping might exist without being in local_patients_qs if filters didn't match)
                            # But if filters didn't match local_patients_qs, we probably shouldn't show it if we are strict. 
                            # However, for pure text search fallback, we show it.
                            
                            patients.append({
                                "fhir_resource": resource,
                                "local_data": PatientProfileSerializer(mapping.patient_profile).data
                            })
                        except PatientFHIRMapping.DoesNotExist:
                            # Just include FHIR data
                            patients.append({
                                "fhir_resource": resource,
                                "local_data": None
                            })


            
            total_time = time.time()
            logger.info(f"Total search time: {total_time - start_time:.4f}s")
            
            return Response({
                "query": query,
                "total": len(patients),
                "patients": patients
            })

        except Exception as e:
            return Response(
                {"error": f"Failed to search patients: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['get'])
    def get_patient(self, request, pk=None):
        """
        Get a patient by ID.
        """
        try:
            patient_profile = get_object_or_404(PatientProfile, id=pk)

            # Add to recent patients
            RecentPatient.objects.get_or_create(
                user=request.user,
                patient_profile=patient_profile
            )

            # Get FHIR data if available
            fhir_data = None
            if patient_profile.fhir_patient_id:
                try:
                    fhir_data = fhir_client.get_resource("Patient", patient_profile.fhir_patient_id)
                except Exception as e:
                    # Just log the error but continue
                    print(f"Failed to get FHIR data: {str(e)}")

            return Response({
                "local_data": PatientProfileSerializer(patient_profile).data,
                "fhir_data": fhir_data
            })

        except Exception as e:
            return Response(
                {"error": f"Failed to get patient: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['put'])
    def update_patient(self, request, pk=None):
        """
        Update a patient by ID.
        """
        try:
            patient_profile = get_object_or_404(PatientProfile, id=pk)

            # Update local patient profile
            profile_serializer = PatientProfileSerializer(
                patient_profile, 
                data=request.data.get('local_data', {}),
                partial=True,
                context={'request': request}
            )

            if profile_serializer.is_valid():
                profile_serializer.save(updated_by=request.user)

                # Update FHIR resource if available
                if patient_profile.fhir_patient_id and request.data.get('fhir_data'):
                    try:
                        # Get current FHIR data to preserve fields not in the update
                        current_fhir_data = fhir_client.get_resource("Patient", patient_profile.fhir_patient_id)

                        # Update with new data
                        fhir_data = request.data.get('fhir_data')
                        fhir_data['id'] = patient_profile.fhir_patient_id

                        # Ensure resourceType is set
                        fhir_data['resourceType'] = 'Patient'

                        # Update the FHIR resource
                        updated_fhir = fhir_client.update_resource("Patient", patient_profile.fhir_patient_id, fhir_data)

                        # Update the mapping
                        mapping = PatientFHIRMapping.objects.get(patient_profile=patient_profile)
                        mapping.fhir_resource_version = updated_fhir.get("meta", {}).get("versionId")
                        mapping.is_synced = True
                        mapping.updated_by = request.user
                        mapping.save()

                        return Response({
                            "message": "Patient updated successfully",
                            "local_data": profile_serializer.data,
                            "fhir_data": updated_fhir
                        })
                    except Exception as e:
                        # If FHIR update fails, still return the local data
                        return Response({
                            "message": "Patient local data updated, but FHIR update failed",
                            "local_data": profile_serializer.data,
                            "error": f"FHIR update error: {str(e)}"
                        }, status=status.HTTP_207_MULTI_STATUS)

                # If no FHIR data to update or no FHIR ID
                return Response({
                    "message": "Patient local data updated successfully",
                    "local_data": profile_serializer.data
                })
            else:
                return Response(profile_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            return Response(
                {"error": f"Failed to update patient: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['delete'])
    def delete_patient(self, request, pk=None):
        """
        Delete a patient by ID.
        """
        try:
            patient_profile = get_object_or_404(PatientProfile, id=pk)

            # Store FHIR ID before deletion
            fhir_patient_id = patient_profile.fhir_patient_id

            with transaction.atomic():
                # Delete the mapping first
                try:
                    mapping = PatientFHIRMapping.objects.get(patient_profile=patient_profile)
                    mapping.delete()
                except PatientFHIRMapping.DoesNotExist:
                    pass

                # Delete the patient profile and associated user
                user = patient_profile.user
                patient_profile.delete()
                user.delete()

                # Delete the FHIR resource if available
                if fhir_patient_id:
                    try:
                        fhir_client.delete_resource("Patient", fhir_patient_id)
                    except Exception as e:
                        # If FHIR deletion fails, log the error but continue
                        print(f"Failed to delete FHIR resource: {str(e)}")
                        return Response({
                            "message": "Patient local data deleted, but FHIR deletion failed",
                            "error": f"FHIR deletion error: {str(e)}"
                        }, status=status.HTTP_207_MULTI_STATUS)

                return Response({
                    "message": "Patient deleted successfully"
                }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response(
                {"error": f"Failed to delete patient: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
