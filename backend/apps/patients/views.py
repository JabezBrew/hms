from rest_framework import viewsets, permissions, status, filters
from rest_framework.exceptions import PermissionDenied
import time
import logging
import hashlib
from datetime import datetime, timedelta
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_date

from .models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from .serializers import (
    PatientFHIRMappingSerializer, PatientSearchSerializer,
    RecentPatientListSerializer, RecentPatientSerializer,
    PatientRegistrationValidationSerializer, PatientNoteSerializer,
    PatientRegistrationSerializer
)
from apps.users.models import PatientProfile
from apps.users.serializers import PatientProfileSerializer, PatientSearchListSerializer
from apps.users.permissions import IsAdminOrOwner, CanAccessPatient
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import (
    FacilityScopedPermission,
    check_demographics_access,
    get_access_flags,
    get_user_facility,
)
from apps.core.models import BreakGlassEvent
from apps.core.serializers import BreakGlassRequestSerializer, BreakGlassEventSerializer
from apps.core.cache_utils import facility_cache_key
from apps.audit.services import AuditService
from apps.audit.models import AuditAction, AuditCategory
from apps.fhir_client.client import fhir_client
from .tasks import sync_patient_with_fhir, log_patient_search

logger = logging.getLogger(__name__)


class PatientFHIRMappingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient FHIR mappings.
    """
    queryset = PatientFHIRMapping.objects.select_related('patient_profile', 'patient_profile__user').all()
    serializer_class = PatientFHIRMappingSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, CanAccessPatient]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PatientFHIRMapping.objects.none()
        return PatientFHIRMapping.objects.select_related(
            'patient_profile',
            'patient_profile__user'
        ).filter(patient_profile__facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient_profile = serializer.validated_data.get('patient_profile')
        if patient_profile and patient_profile.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
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
        task = sync_patient_with_fhir.delay(
            str(mapping.id),
            facility_code=request.facility_code
        )

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
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter searches to only show the current user's searches.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return PatientSearch.objects.none()
        return PatientSearch.objects.filter(user=self.request.user, facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(user=self.request.user, facility=facility)


class RecentPatientViewSet(viewsets.ModelViewSet):
    """
    API endpoint for recent patients.
    """
    queryset = RecentPatient.objects.all()
    serializer_class = RecentPatientSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter recent patients to only show the current user's recent patients.
        Limited to 10 most recent for performance.
        """
        from apps.wards.models import Admission

        limit = int(self.request.query_params.get('limit', 10))
        # Cap at 20 to prevent abuse
        limit = min(limit, 20)
        facility = get_user_facility(self.request)
        if not facility:
            return RecentPatient.objects.none()

        return RecentPatient.objects.filter(
            user=self.request.user,
            facility=facility
        ).select_related(
            'patient_profile',
            'patient_profile__user'
        ).prefetch_related(
            Prefetch(
                'patient_profile__admissions',
                queryset=Admission.objects.filter(
                    status__in=['admitted', 'waiting']
                ).select_related('bed', 'bed__ward').order_by('-admission_date'),
                to_attr='active_admissions_list'
            )
        )[:limit]

    def get_serializer_class(self):
        if self.action in ['list', 'add_recent']:
            return RecentPatientListSerializer
        return super().get_serializer_class()

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient_profile = serializer.validated_data.get('patient_profile')
        if patient_profile and patient_profile.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        serializer.save(user=self.request.user, facility=facility)

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
            from apps.wards.models import Admission

            patient_profile = PatientProfile.objects.get(id=patient_profile_id)
            facility = get_user_facility(request)
            if not facility or patient_profile.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")

            # SECURITY: Check if user has permission to access this patient
            check_demographics_access(request.user, patient_profile)

            # Check if already exists
            recent, created = RecentPatient.objects.get_or_create(
                user=request.user,
                patient_profile=patient_profile,
                defaults={'facility': facility}
            )
            if not created and recent.facility_id != facility.id:
                raise PermissionDenied("Recent patient entry does not match facility context.")

            # If it exists, update the access_date
            if not created:
                recent.save()  # This will update the auto_now field

            recent = RecentPatient.objects.filter(id=recent.id).select_related(
                'patient_profile',
                'patient_profile__user'
            ).prefetch_related(
                Prefetch(
                    'patient_profile__admissions',
                    queryset=Admission.objects.filter(
                        status__in=['admitted', 'waiting']
                    ).select_related('bed', 'bed__ward').order_by('-admission_date'),
                    to_attr='active_admissions_list'
                )
            ).first()

            return Response({
                "message": "Patient added to recent list.",
                "recent_patient": self.get_serializer(recent).data
            })

        except PatientProfile.DoesNotExist:
            return Response(
                {"error": "Patient profile not found."},
                status=status.HTTP_404_NOT_FOUND
            )
        except PermissionDenied:
            raise
        except Exception as e:
            logger.error(f"Failed to add recent patient: {str(e)}")
            return Response(
                {"error": "Failed to add recent patient."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PatientRegistrationValidationViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient registration validation rules.
    """
    queryset = PatientRegistrationValidation.objects.all()
    serializer_class = PatientRegistrationValidationSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination

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
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter notes based on permissions.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return PatientNote.objects.none()

        base_qs = PatientNote.objects.filter(facility=facility)
        if self.request.user.is_staff:
            return base_qs

        # Regular users can only see their own notes and non-private notes
        return base_qs.filter(created_by=self.request.user) | base_qs.filter(is_private=False)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient_profile = serializer.validated_data.get('patient_profile')
        if patient_profile and patient_profile.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient_profile:
            check_demographics_access(self.request.user, patient_profile)
        serializer.save(created_by=self.request.user, updated_by=self.request.user, facility=facility)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PatientViewSet(viewsets.ViewSet):
    """
    API endpoint for patient management.
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    @action(detail=False, methods=['post'])
    def register(self, request):
        """
        Register a new patient.
        Only admin and receptionist roles can register patients.
        """
        # Restrict patient registration to admin and receptionist only
        if request.user.user_type not in ['admin', 'receptionist']:
            raise PermissionDenied("Only admin and receptionist staff can register patients.")

        if not get_user_facility(request):
            raise PermissionDenied("Facility context is required.")

        serializer = PatientRegistrationSerializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            try:
                with transaction.atomic():
                    patient_profile = serializer.save()

                    # Log the search
                    PatientSearch.objects.create(
                        user=request.user,
                        facility=patient_profile.facility,
                        search_query=f"Registration: {patient_profile.user.get_full_name()}"
                    )

                    # Add to recent patients
                    RecentPatient.objects.create(
                        user=request.user,
                        patient_profile=patient_profile,
                        facility=patient_profile.facility
                    )

                    return Response(
                        PatientProfileSerializer(patient_profile).data,
                        status=status.HTTP_201_CREATED
                    )
            except Exception as e:
                logger.error(f"Failed to register patient: {str(e)}")
                return Response(
                    {"error": "Failed to register patient. Please try again."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def search(self, request):
        """
        Search for patients with advanced filters.
        Requires minimum 2 characters for text search when no other filters are provided.

        Performance optimizations:
        - Uses lightweight serializer (PatientSearchListSerializer)
        - Caches results for 30 seconds
        - Logs searches to PatientSearch history
        - FHIR calls are opt-in via include_fhir=true query param
        """
        query = request.query_params.get('query', '').strip()
        ward_id = request.query_params.get('ward', '')
        admission_date = request.query_params.get('admission_date', '')
        include_fhir = request.query_params.get('include_fhir', '').lower() == 'true'

        # Require minimum 2 characters for search query when no other filters
        has_other_filters = bool(ward_id or admission_date)
        if not has_other_filters and len(query) < 2:
            return Response(
                {
                    "error": "Search query must be at least 2 characters.",
                    "query": query,
                    "total": 0,
                    "results": []
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        logger = logging.getLogger(__name__)
        start_time = time.time()

        # Generate cache key based on search parameters
        cache_params = f"{query}:{ward_id}:{admission_date}"
        cache_key = facility_cache_key(
            f"patient_search_{hashlib.md5(cache_params.encode()).hexdigest()}"
        )

        # Try to get from cache first (skip cache if include_fhir is requested)
        if not include_fhir:
            cached_result = cache.get(cache_key)
            if cached_result is not None:
                logger.info("Search cache hit for user %s", request.user.id)
                # Log search for cache hits
                search_desc = f"Query: {query}" + (f", Ward: {ward_id}" if ward_id else "") + (f", Date: {admission_date}" if admission_date else "")
                facility = get_user_facility(request) or getattr(request.user, 'primary_facility', None)
                log_patient_search.delay(
                    str(request.user.id),
                    search_desc,
                    facility_code=facility.code if facility else None
                )
                return Response(cached_result)

        # Log search for auditing/history
        search_desc = f"Query: {query}"
        if ward_id:
            search_desc += f", Ward: {ward_id}"
        if admission_date:
            search_desc += f", Date: {admission_date}"
        facility = get_user_facility(request) or getattr(request.user, 'primary_facility', None)
        log_patient_search.delay(
            str(request.user.id),
            search_desc,
            facility_code=facility.code if facility else None
        )

        try:
            from django.db.models import Q
            from apps.wards.models import Admission
            facility = get_user_facility(request)
            if not facility:
                raise PermissionDenied("Facility context is required.")

            # OPTIMIZED: Base query with Prefetch for active admissions only
            local_patients_qs = PatientProfile.objects.select_related('user').prefetch_related(
                Prefetch(
                    'admissions',
                    queryset=Admission.objects.filter(
                        status__in=['admitted', 'waiting']
                    ).select_related('bed', 'bed__ward').order_by('-admission_date'),
                    to_attr='active_admissions_list'
                )
            ).filter(facility=facility)

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
                parsed_admission_date = parse_date(admission_date)
                if not parsed_admission_date:
                    return Response(
                        {"error": "Invalid admission_date format. Use YYYY-MM-DD."},
                        status=status.HTTP_400_BAD_REQUEST
                    )

                start_dt = timezone.make_aware(
                    datetime.combine(parsed_admission_date, datetime.min.time()),
                    timezone.get_current_timezone()
                )
                end_dt = start_dt + timedelta(days=1)
                local_patients_qs = local_patients_qs.filter(
                    admissions__admission_date__gte=start_dt,
                    admissions__admission_date__lt=end_dt
                ).distinct()

            # Limit to 20 results and serialize with lightweight serializer
            patients_list = list(local_patients_qs[:20])
            results = PatientSearchListSerializer(patients_list, many=True).data

            # Log timing
            local_proc_time = time.time()
            logger.info(f"Search completed in {local_proc_time - start_time:.4f}s. Count: {len(results)}")

            response_data = {
                "query": query,
                "total": len(results),
                "results": results
            }

            # Cache results for 30 seconds (skip caching for FHIR results)
            if not include_fhir:
                cache.set(cache_key, response_data, timeout=30)

            # Optional: Include FHIR results if explicitly requested and local results are sparse
            if include_fhir and query and not ward_id and not admission_date and len(results) < 10:
                fhir_results = self._search_fhir(query, results)
                if fhir_results:
                    response_data['fhir_results'] = fhir_results
                    response_data['total'] += len(fhir_results)

            return Response(response_data)

        except Exception as e:
            logger.error(f"Search error: {str(e)}")
            return Response(
                {"error": "Failed to search patients. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _search_fhir(self, query, existing_results):
        """
        Helper method to search FHIR for additional patients.
        Called only when include_fhir=true and local results are sparse.
        """
        try:
            existing_ids = {str(r.get('id')) for r in existing_results}
            fhir_patients = []

            search_params = {"name": query, "_sort": "family", "_count": 10}
            fhir_results = fhir_client.search_resources("Patient", search_params, timeout=2)

            if "entry" not in fhir_results or not fhir_results.get("entry"):
                # Try identifier search
                fhir_results = fhir_client.search_resources("Patient", {"identifier": query, "_count": 10}, timeout=2)

            if "entry" in fhir_results:
                for entry in fhir_results["entry"]:
                    resource = entry.get("resource", {})
                    fhir_id = resource.get('id')

                    # Check for local mapping
                    try:
                        mapping = PatientFHIRMapping.objects.get(fhir_patient_id=fhir_id)
                        if str(mapping.patient_profile_id) in existing_ids:
                            continue
                        fhir_patients.append({
                            "fhir_resource": resource,
                            "local_id": str(mapping.patient_profile_id)
                        })
                    except PatientFHIRMapping.DoesNotExist:
                        fhir_patients.append({
                            "fhir_resource": resource,
                            "local_id": None
                        })

            return fhir_patients
        except Exception as e:
            logging.getLogger(__name__).warning(f"FHIR search failed: {str(e)}")
            return []

    @action(detail=True, methods=['get'])
    def get_patient(self, request, pk=None):
        """
        Get a patient by ID.
        Returns full data for clinical access, demographics-only for non-clinical access.
        """
        patient_profile = get_object_or_404(PatientProfile, id=pk)

        # SECURITY: Check if user has permission to access this patient
        check_demographics_access(request.user, patient_profile)

        # Get access flags for frontend optimization
        access = get_access_flags(request.user, patient_profile)

        # Add to recent patients
        RecentPatient.objects.get_or_create(
            user=request.user,
            patient_profile=patient_profile,
            facility=patient_profile.facility
        )

        # SECURITY: If user only has demographics access (not clinical),
        # return limited data - no clinical info like allergies, blood group, FHIR
        if not access['clinical']:
            user = patient_profile.user
            return Response({
                "local_data": {
                    "id": str(patient_profile.id),
                    "user": str(user.id) if user else None,
                    "user_details": {
                        "id": str(user.id) if user else None,
                        "first_name": user.first_name if user else None,
                        "last_name": user.last_name if user else None,
                        "date_of_birth": user.date_of_birth.isoformat() if user and user.date_of_birth else None,
                        "gender": user.gender if user else None,
                    } if user else None,
                    "medical_record_number": patient_profile.medical_record_number,
                    # Exclude: blood_group, allergies, nhis_id, fhir_patient_id
                },
                "fhir_data": None,  # No FHIR data for demographics-only access
                "access": access
            })

        # Full access - return everything
        fhir_data = None
        if patient_profile.fhir_patient_id:
            try:
                fhir_data = fhir_client.get_resource("Patient", patient_profile.fhir_patient_id)
            except Exception:
                logger.warning(f"Failed to get FHIR data for patient {pk}")

        return Response({
            "local_data": PatientProfileSerializer(patient_profile).data,
            "fhir_data": fhir_data,
            "access": access
        })

    @action(detail=True, methods=['get'], url_path='demographics')
    def get_demographics(self, request, pk=None):
        """
        Get patient demographics only (no FHIR, no clinical data).
        Lightweight endpoint for administrative views.
        """
        patient_profile = get_object_or_404(PatientProfile, id=pk)

        # SECURITY: Check if user has permission to access this patient
        check_demographics_access(request.user, patient_profile)

        # Add to recent patients
        RecentPatient.objects.get_or_create(
            user=request.user,
            patient_profile=patient_profile,
            facility=patient_profile.facility
        )

        return Response(PatientProfileSerializer(patient_profile).data)

    @action(detail=True, methods=['post'], url_path='break-glass')
    def break_glass(self, request, pk=None):
        """
        Create a time-bound break-glass access event for clinical data.
        """
        patient_profile = get_object_or_404(PatientProfile, id=pk)
        serializer = BreakGlassRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        if request.user.user_type not in ['admin', 'doctor', 'nurse']:
            return Response(
                {"error": "Break-glass access is limited to clinical staff."},
                status=status.HTTP_403_FORBIDDEN
            )

        scope = serializer.validated_data.get('scope', 'clinical')
        if scope != 'clinical':
            return Response(
                {"error": "Only clinical break-glass access is supported."},
                status=status.HTTP_400_BAD_REQUEST
            )

        now = timezone.now()
        active_event = BreakGlassEvent.objects.filter(
            user=request.user,
            patient=patient_profile,
            scope=scope,
            expires_at__gt=now
        ).order_by('-expires_at').first()

        if active_event:
            return Response({
                "message": "Break-glass access already active.",
                "break_glass": BreakGlassEventSerializer(active_event).data
            })

        expires_at = now + timedelta(minutes=settings.BREAK_GLASS_TTL_MINUTES)
        event = BreakGlassEvent.objects.create(
            user=request.user,
            patient=patient_profile,
            scope=scope,
            reason=serializer.validated_data['reason'],
            expires_at=expires_at
        )

        AuditService.log(
            request=request,
            action=AuditAction.BREAK_GLASS,
            category=AuditCategory.CLINICAL,
            resource_type='PatientProfile',
            resource_id=patient_profile.id,
            resource_name=patient_profile.user.get_full_name(),
            description=f"Break-glass access granted for patient {patient_profile.medical_record_number}",
            changes={
                'scope': {'old': None, 'new': scope},
                'expires_at': {'old': None, 'new': expires_at.isoformat()},
                'reason': {'old': None, 'new': serializer.validated_data['reason']},
            }
        )

        return Response({
            "message": "Break-glass access granted.",
            "break_glass": BreakGlassEventSerializer(event).data
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['put'])
    def update_patient(self, request, pk=None):
        """
        Update a patient by ID.
        """
        try:
            patient_profile = get_object_or_404(PatientProfile, id=pk)

            # SECURITY: Check if user has permission to access this patient
            check_demographics_access(request.user, patient_profile)

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
                        logger.warning(f"FHIR update failed for patient {pk}")
                        return Response({
                            "message": "Patient local data updated, but FHIR update failed",
                            "local_data": profile_serializer.data,
                            "error": "FHIR synchronization error"
                        }, status=status.HTTP_207_MULTI_STATUS)

                # If no FHIR data to update or no FHIR ID
                return Response({
                    "message": "Patient local data updated successfully",
                    "local_data": profile_serializer.data
                })
            else:
                return Response(profile_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        except PermissionDenied:
            raise
        except Exception as e:
            logger.error(f"Failed to update patient {pk}: {str(e)}")
            return Response(
                {"error": "Failed to update patient."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['delete'])
    def delete_patient(self, request, pk=None):
        """
        Delete a patient by ID.
        """
        try:
            patient_profile = get_object_or_404(PatientProfile, id=pk)

            # SECURITY: Check if user has permission to access this patient
            check_demographics_access(request.user, patient_profile)

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
                        logger.warning(f"Failed to delete FHIR resource for patient {pk}")
                        return Response({
                            "message": "Patient local data deleted, but FHIR deletion failed",
                            "error": "FHIR synchronization error"
                        }, status=status.HTTP_207_MULTI_STATUS)

                return Response({
                    "message": "Patient deleted successfully"
                }, status=status.HTTP_200_OK)

        except PermissionDenied:
            raise
        except Exception as e:
            logger.error(f"Failed to delete patient {pk}: {str(e)}")
            return Response(
                {"error": "Failed to delete patient."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
