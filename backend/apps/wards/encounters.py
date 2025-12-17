"""
Encounter-related views for the wards app.

This module provides a local-first Encounter API that syncs to FHIR in the background.
This replaces the previous FHIR-first approach for better performance.
"""
import uuid as uuid_module

from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Encounter, Admission
from .serializers import (
    EncounterSerializer,
    EncounterListSerializer,
    EncounterCreateSerializer,
    EncounterUpdateSerializer,
)
from ..users.permissions import IsAdminOrOwner
from ..core.pagination import StandardResultsSetPagination


def is_valid_uuid(value):
    """Check if a string is a valid UUID."""
    if not value:
        return False
    try:
        uuid_module.UUID(str(value))
        return True
    except (ValueError, AttributeError):
        return False


class EncounterViewSet(viewsets.ModelViewSet):
    """
    API endpoint for Encounter resources.

    Uses local database for fast queries, with background sync to FHIR.

    list: GET /api/wards/encounters/
    retrieve: GET /api/wards/encounters/{id}/
    create: POST /api/wards/encounters/
    update: PUT /api/wards/encounters/{id}/
    partial_update: PATCH /api/wards/encounters/{id}/
    destroy: DELETE /api/wards/encounters/{id}/

    Query Parameters (for list):
        - patient_id: Filter by patient UUID
        - practitioner_id: Filter by practitioner UUID
        - date: Filter by encounter date (YYYY-MM-DD)
        - status: Filter by status (planned, in-progress, finished, cancelled)
        - encounter_type: Filter by type (inpatient, outpatient, emergency)
        - search: Search patient name, reason, or location
        - ordering: Order by start_time, created_at, or status (prefix with - for desc)
        - page: Page number (default: 1)
        - page_size: Items per page (default: 100, max: 1000)
    """
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'reason', 'location']
    ordering_fields = ['start_time', 'created_at', 'status']
    ordering = ['-start_time']

    def get_queryset(self):
        """
        Return encounters with optimized queries.
        """
        queryset = Encounter.objects.select_related(
            'patient',
            'patient__user',
            'practitioner',
            'practitioner__staff',
            'practitioner__staff__user',
            'admission',
        ).all()

        # Filter by patient - supports UUID, MRN, or name search
        patient_id = self.request.query_params.get('patient_id')
        if patient_id:
            if is_valid_uuid(patient_id):
                queryset = queryset.filter(patient_id=patient_id)
            else:
                # Search by MRN or patient name if not a valid UUID
                queryset = queryset.filter(
                    Q(patient__medical_record_number__icontains=patient_id) |
                    Q(patient__user__first_name__icontains=patient_id) |
                    Q(patient__user__last_name__icontains=patient_id)
                )

        # Filter by practitioner - supports UUID, employee ID, or name search
        practitioner_id = self.request.query_params.get('practitioner_id')
        if practitioner_id:
            if is_valid_uuid(practitioner_id):
                queryset = queryset.filter(practitioner_id=practitioner_id)
            else:
                # Search by employee ID or name if not a valid UUID
                queryset = queryset.filter(
                    Q(practitioner__staff__employee_id__icontains=practitioner_id) |
                    Q(practitioner__staff__user__first_name__icontains=practitioner_id) |
                    Q(practitioner__staff__user__last_name__icontains=practitioner_id)
                )

        # Filter by date (start_time date)
        date = self.request.query_params.get('date')
        if date:
            queryset = queryset.filter(start_time__date=date)

        # Filter by status (planned, in-progress, finished, cancelled)
        encounter_status = self.request.query_params.get('status')
        if encounter_status:
            queryset = queryset.filter(status=encounter_status)

        # Filter by encounter_type (inpatient, outpatient, emergency)
        encounter_type = self.request.query_params.get('encounter_type')
        if encounter_type:
            queryset = queryset.filter(encounter_type=encounter_type)

        return queryset

    def get_serializer_class(self):
        """
        Return appropriate serializer based on action.
        """
        if self.action == 'list':
            return EncounterListSerializer
        elif self.action == 'create':
            return EncounterCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return EncounterUpdateSerializer
        return EncounterSerializer

    def perform_create(self, serializer):
        """
        Set created_by on creation and trigger FHIR sync.
        """
        encounter = serializer.save(created_by=self.request.user)
        # Queue FHIR sync task (async)
        self._queue_fhir_sync(encounter.id)

    def perform_update(self, serializer):
        """
        Set updated_by on update and trigger FHIR sync.
        """
        encounter = serializer.save(updated_by=self.request.user)
        # Queue FHIR sync task (async)
        self._queue_fhir_sync(encounter.id)

    def _queue_fhir_sync(self, encounter_id):
        """
        Queue a background task to sync the encounter to FHIR.
        """
        try:
            from .tasks import sync_encounter_to_fhir
            sync_encounter_to_fhir.delay(str(encounter_id))
        except Exception:
            # If Celery is not available, sync will happen later
            pass

    @action(detail=True, methods=['post'])
    def finish(self, request, pk=None):
        """
        Mark an encounter as finished.

        POST /api/wards/encounters/{id}/finish/

        Optional body:
        {
            "end_time": "2024-01-01T12:00:00Z",
            "discharge_disposition": "home",
            "destination": "Patient's home"
        }
        """
        encounter = self.get_object()

        if encounter.status == 'finished':
            return Response(
                {"error": "Encounter is already finished"},
                status=status.HTTP_400_BAD_REQUEST
            )

        encounter.finish(
            end_time=request.data.get('end_time'),
            discharge_disposition=request.data.get('discharge_disposition'),
            destination=request.data.get('destination')
        )

        self._queue_fhir_sync(encounter.id)
        serializer = EncounterSerializer(encounter)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """
        Cancel an encounter.

        POST /api/wards/encounters/{id}/cancel/
        """
        encounter = self.get_object()

        if encounter.status in ['finished', 'cancelled']:
            return Response(
                {"error": f"Cannot cancel encounter with status '{encounter.status}'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        encounter.cancel()
        self._queue_fhir_sync(encounter.id)
        serializer = EncounterSerializer(encounter)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def discharge(self, request, pk=None):
        """
        Discharge a patient (for inpatient encounters).

        This will also discharge the associated admission and free the bed.

        POST /api/wards/encounters/{id}/discharge/

        Body:
        {
            "discharge_notes": "Patient recovered well",
            "discharge_disposition": "home",
            "destination": "Patient's home"
        }
        """
        encounter = self.get_object()

        if encounter.encounter_type != 'inpatient':
            return Response(
                {"error": "Only inpatient encounters can be discharged"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if encounter.status == 'finished':
            return Response(
                {"error": "Encounter is already finished"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            with transaction.atomic():
                # Discharge the admission if linked
                if encounter.admission:
                    discharge_notes = request.data.get('discharge_notes', '')
                    encounter.admission.discharge_patient(discharge_notes)

                # Finish the encounter
                encounter.finish(
                    discharge_disposition=request.data.get('discharge_disposition'),
                    destination=request.data.get('destination')
                )

                self._queue_fhir_sync(encounter.id)
                serializer = EncounterSerializer(encounter)
                return Response(serializer.data)

        except Exception as e:
            return Response(
                {"error": f"Failed to discharge patient: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get encounter statistics.

        GET /api/wards/encounters/stats/
        """
        from django.db.models import Count

        queryset = self.get_queryset()

        stats = {
            'total': queryset.count(),
            'by_status': dict(
                queryset.values('status').annotate(count=Count('id')).values_list('status', 'count')
            ),
            'by_type': dict(
                queryset.values('encounter_type').annotate(count=Count('id')).values_list('encounter_type', 'count')
            ),
            'pending_sync': queryset.filter(fhir_synced=False).count(),
        }

        return Response(stats)

    @action(detail=False, methods=['get'])
    def for_patient(self, request):
        """
        Get all encounters for a specific patient.

        GET /api/wards/encounters/for_patient/?patient_id={uuid}
        """
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response(
                {"error": "patient_id parameter is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        encounters = self.get_queryset().filter(patient_id=patient_id)
        serializer = EncounterListSerializer(encounters, many=True)
        return Response(serializer.data)
