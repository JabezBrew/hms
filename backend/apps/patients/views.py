from rest_framework import viewsets, permissions, status, filters
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
from apps.users.permissions import IsAdminOrOwner
from apps.fhir_client.client import fhir_client


class PatientFHIRMappingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient FHIR mappings.
    """
    queryset = PatientFHIRMapping.objects.all()
    serializer_class = PatientFHIRMappingSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def sync_with_fhir(self, request, pk=None):
        """
        Sync the local patient data with the FHIR resource.
        """
        mapping = self.get_object()

        try:
            # Get the FHIR resource
            fhir_patient = fhir_client.get_resource("Patient", mapping.fhir_patient_id)

            # Update the mapping with the latest version
            mapping.fhir_resource_version = fhir_patient.get("meta", {}).get("versionId")
            mapping.is_synced = True
            mapping.save()

            return Response({
                "message": "Successfully synced with FHIR resource.",
                "fhir_patient": fhir_patient
            })

        except Exception as e:
            mapping.is_synced = False
            mapping.save()

            return Response(
                {"error": f"Failed to sync with FHIR resource: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


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
        Search for patients in FHIR.
        """
        query = request.query_params.get('query', '')

        if not query:
            return Response(
                {"error": "Query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Log the search
        PatientSearch.objects.create(
            user=request.user,
            search_query=query
        )

        try:
            # First, try to search by MRN or NHIS ID in local database
            local_patients = []

            # Search by MRN
            mrn_patients = PatientProfile.objects.filter(medical_record_number__icontains=query)
            for patient in mrn_patients:
                local_patients.append({
                    "fhir_resource": fhir_client.get_resource("Patient", patient.fhir_patient_id) if patient.fhir_patient_id else None,
                    "local_data": PatientProfileSerializer(patient).data
                })

            # Search by NHIS ID
            nhis_patients = PatientProfile.objects.filter(nhis_id__icontains=query).exclude(id__in=mrn_patients.values_list('id', flat=True))
            for patient in nhis_patients:
                local_patients.append({
                    "fhir_resource": fhir_client.get_resource("Patient", patient.fhir_patient_id) if patient.fhir_patient_id else None,
                    "local_data": PatientProfileSerializer(patient).data
                })

            # If we found local patients, return them
            if local_patients:
                return Response({
                    "query": query,
                    "total": len(local_patients),
                    "patients": local_patients
                })

            # If no local patients found, search in FHIR
            search_params = {
                "name": query,
                "_sort": "family",
                "_count": 10
            }

            # Also search by identifier (MRN)
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

            # Process results
            patients = []

            if "entry" in fhir_results:
                for entry in fhir_results["entry"]:
                    resource = entry.get("resource", {})

                    # Try to find the local mapping
                    try:
                        mapping = PatientFHIRMapping.objects.get(fhir_patient_id=resource.get("id"))

                        # Add to recent patients
                        RecentPatient.objects.get_or_create(
                            user=request.user,
                            patient_profile=mapping.patient_profile
                        )

                        # Include local data
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

            return Response({
                "query": query,
                "total": fhir_results.get("total", 0),
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
