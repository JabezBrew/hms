"""
Encounter views for the encounters app.

This module provides the Encounter API endpoints.
"""
import logging
import uuid as uuid_module
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import NotFound, PermissionDenied
from django.db import transaction
from django.db.models import Q, Count
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime, parse_date

from apps.discharge.services import submit_legacy_discharge
from .models import Encounter, OutpatientVisit, TriageQueue
from .serializers import (
    EncounterSerializer,
    EncounterListSerializer,
    EncounterCreateSerializer,
    EncounterUpdateSerializer,
    OutpatientVisitSerializer,
    TriageQueueSerializer,
    TriageQueueCreateSerializer,
)
from apps.core.pagination import StandardResultsSetPagination
from apps.core.features import feature_enabled as effective_feature_enabled
from apps.core.security import (
    FacilityScopedPermission,
    FeatureRequiredPermission,
    TriageQueuePermission,
    check_clinical_access,
    feature_disabled_payload,
    get_accessible_patients_for_clinician,
    get_user_facility,
    resolve_object_facility,
)
from apps.users.models import PatientProfile
from apps.organization.models import Clinic, ClinicalUnit
from apps.appointments.models import AppointmentType
from .services import VisitService, TriageService

logger = logging.getLogger(__name__)


ENCOUNTER_FEATURE_BY_TYPE = {
    'outpatient': 'outpatient_encounters',
    'emergency': 'emergency_encounters',
}


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

    list: GET /api/encounters/
    retrieve: GET /api/encounters/{id}/
    create: POST /api/encounters/
    update: PUT /api/encounters/{id}/
    partial_update: PATCH /api/encounters/{id}/
    destroy: DELETE /api/encounters/{id}/

    Query Parameters (for list):
        - patient_id: Filter by patient UUID
        - practitioner_id: Filter by practitioner UUID
        - date: Filter by encounter date (YYYY-MM-DD)
        - department_id: Filter by department UUID
        - clinic_id: Filter by clinic UUID
        - status: Filter by status (planned, in-progress, finished, cancelled)
        - encounter_type: Filter by type (inpatient, outpatient, emergency)
        - search: Search patient name, reason, or location
        - ordering: Order by start_time, created_at, or status (prefix with - for desc)
        - page: Page number (default: 1)
        - page_size: Items per page (default: 100, max: 1000)
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'reason', 'location']
    ordering_fields = ['start_time', 'created_at', 'status']
    ordering = ['-start_time']

    def _require_encounter_type_enabled(self, encounter_type):
        feature_key = ENCOUNTER_FEATURE_BY_TYPE.get(encounter_type)
        if feature_key and not effective_feature_enabled(feature_key, request=self.request):
            raise NotFound(feature_disabled_payload(feature_key))

    def _filter_enabled_encounter_types(self, queryset):
        disabled_types = [
            encounter_type
            for encounter_type, feature_key in ENCOUNTER_FEATURE_BY_TYPE.items()
            if not effective_feature_enabled(feature_key, request=self.request)
        ]
        if not disabled_types:
            return queryset
        return queryset.exclude(encounter_type__in=disabled_types)

    def _get_facility_timezone(self, facility):
        if facility and facility.timezone:
            try:
                return ZoneInfo(facility.timezone)
            except Exception:
                pass
        return timezone.get_current_timezone()

    def get_queryset(self):
        """
        Return encounters with optimized queries.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return Encounter.objects.none()

        queryset = Encounter.objects.select_related(
            'patient',
            'patient__user',
            'practitioner',
            'practitioner__staff',
            'practitioner__staff__user',
            'outpatient_visit',
            'admission',
            'clinic',
            'department',
            'appointment',
        ).filter(facility=facility)

        user = self.request.user
        if user.user_type == 'admin':
            pass
        elif user.user_type == 'patient':
            queryset = queryset.filter(patient__user=user)
        elif user.user_type in ['doctor', 'nurse']:
            if settings.TEAM_ACCESS_STRICT:
                accessible_patients = get_accessible_patients_for_clinician(user)
                queryset = queryset.filter(patient__in=accessible_patients)
        else:
            return Encounter.objects.none()

        # Filter by patient - supports UUID, MRN, or name search
        patient_id = self.request.query_params.get('patient_id')
        if patient_id:
            if is_valid_uuid(patient_id):
                patient = PatientProfile.objects.filter(id=patient_id).first()
                if not patient:
                    return queryset.none()
                if patient.facility_id != facility.id:
                    raise PermissionDenied("Patient does not belong to the active facility.")
                check_clinical_access(self.request.user, patient)
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
        date_value = self.request.query_params.get('date')
        if date_value:
            parsed_date = parse_date(date_value)
            if parsed_date:
                tz = self._get_facility_timezone(facility)
                start = timezone.make_aware(datetime.combine(parsed_date, time.min), tz)
                end = start + timedelta(days=1)
                queryset = queryset.filter(start_time__gte=start, start_time__lt=end)

        # Filter by department
        department_id = self.request.query_params.get('department_id')
        if department_id:
            queryset = queryset.filter(department_id=department_id)

        # Filter by clinic
        clinic_id = self.request.query_params.get('clinic_id')
        if clinic_id:
            queryset = queryset.filter(clinic_id=clinic_id)

        # Filter by status (planned, in-progress, finished, cancelled)
        encounter_status = self.request.query_params.get('status')
        if encounter_status:
            queryset = queryset.filter(status=encounter_status)

        # Filter by encounter_type (inpatient, outpatient, emergency)
        encounter_type = self.request.query_params.get('encounter_type')
        if encounter_type:
            self._require_encounter_type_enabled(encounter_type)
            queryset = queryset.filter(encounter_type=encounter_type)
        else:
            queryset = self._filter_enabled_encounter_types(queryset)

        return queryset

    def get_object(self):
        encounter = super().get_object()
        self._require_encounter_type_enabled(encounter.encounter_type)
        return encounter

    def create(self, request, *args, **kwargs):
        self._require_encounter_type_enabled(request.data.get('encounter_type') or 'outpatient')
        return super().create(request, *args, **kwargs)

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
        if self.request.user.user_type not in ['admin', 'doctor', 'nurse']:
            raise PermissionDenied("You do not have permission to create encounters.")

        patient_id = serializer.validated_data.get('patient_id')
        patient = None
        if patient_id:
            from apps.users.models import PatientProfile, PractitionerProfile
            patient = PatientProfile.objects.get(id=patient_id)
            facility = get_user_facility(self.request)
            if not facility or patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")

            if self.request.user.user_type in ['doctor', 'nurse'] and settings.TEAM_ACCESS_STRICT:
                try:
                    check_clinical_access(self.request.user, patient)
                except PermissionDenied:
                    practitioner = PractitionerProfile.objects.filter(
                        staff__user=self.request.user
                    ).first()
                    practitioner_id = serializer.validated_data.get('practitioner_id') or (
                        practitioner.id if practitioner else None
                    )
                    if not practitioner or not practitioner_id or practitioner.id != practitioner_id:
                        raise

        practitioner = None
        if not serializer.validated_data.get('practitioner_id'):
            from apps.users.models import PractitionerProfile
            practitioner = PractitionerProfile.objects.filter(
                staff__user=self.request.user
            ).first()

        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        clinic_id = serializer.validated_data.get('clinic_id')
        if clinic_id:
            clinic = Clinic.objects.get(id=clinic_id)
            if clinic.facility_id != facility.id:
                raise PermissionDenied("Clinic does not belong to the active facility.")

        department_id = serializer.validated_data.get('department_id')
        if department_id:
            department = ClinicalUnit.objects.get(id=department_id)
            department_facility = resolve_object_facility(department)
            if not department_facility or department_facility.id != facility.id:
                raise PermissionDenied("Department does not belong to the active facility.")

        appointment_id = serializer.validated_data.get('appointment_id')
        if appointment_id:
            from apps.appointments.models import Appointment
            appointment = Appointment.objects.get(id=appointment_id)
            if appointment.facility_id != facility.id:
                raise PermissionDenied("Appointment does not belong to the active facility.")
            if patient and appointment.patient_id != patient.id:
                raise PermissionDenied("Appointment does not belong to the patient.")

        encounter = serializer.save(
            created_by=self.request.user,
            practitioner=practitioner,
            facility=facility
        )
        # Queue FHIR sync task (async)
        self._queue_fhir_sync(encounter.id)

    def perform_update(self, serializer):
        """
        Set updated_by on update and trigger FHIR sync.
        """
        if self.request.user.user_type not in ['admin', 'doctor', 'nurse']:
            raise PermissionDenied("You do not have permission to update encounters.")

        encounter = self.get_object()
        check_clinical_access(self.request.user, encounter.patient)
        encounter = serializer.save(updated_by=self.request.user)
        # Queue FHIR sync task (async)
        self._queue_fhir_sync(encounter.id)

    def _queue_fhir_sync(self, encounter_id):
        """
        Queue a background task to sync the encounter to FHIR.
        """
        def enqueue():
            try:
                from .tasks import sync_encounter_to_fhir
                sync_encounter_to_fhir.delay(str(encounter_id))
            except Exception:
                # If Celery is not available, sync will happen later
                pass

        try:
            transaction.on_commit(enqueue)
        except Exception:
            enqueue()

    @action(detail=True, methods=['post'])
    def finish(self, request, pk=None):
        """
        Mark an encounter as finished.

        POST /api/encounters/{id}/finish/

        Optional body:
        {
            "end_time": "2024-01-01T12:00:00Z",
            "discharge_disposition": "home",
            "destination": "Patient's home"
        }
        """
        if request.user.user_type not in ['admin', 'doctor', 'nurse']:
            raise PermissionDenied("You do not have permission to finish encounters.")

        encounter = self.get_object()

        if encounter.status == 'finished':
            return Response(
                {"error": "Encounter is already finished"},
                status=status.HTTP_400_BAD_REQUEST
            )
        if encounter.status == 'cancelled':
            return Response(
                {"error": "Cannot finish a cancelled encounter"},
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

        POST /api/encounters/{id}/cancel/
        """
        if request.user.user_type not in ['admin', 'doctor', 'nurse']:
            raise PermissionDenied("You do not have permission to cancel encounters.")

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

        POST /api/encounters/{id}/discharge/

        Body:
        {
            "discharge_notes": "Patient recovered well",
            "discharge_disposition": "home",
            "destination": "Patient's home"
        }
        """
        if request.user.user_type not in ['admin', 'doctor', 'nurse']:
            raise PermissionDenied("You do not have permission to discharge encounters.")

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
                if encounter.admission:
                    discharge_notes = request.data.get('discharge_notes', '')
                    discharge_case = submit_legacy_discharge(
                        admission=encounter.admission,
                        actor=request.user,
                        discharge_notes=discharge_notes,
                    )
                    serializer = EncounterSerializer(encounter)
                    return Response({
                        'encounter': serializer.data,
                        'discharge_case_id': str(discharge_case.id),
                        'admission_status': encounter.admission.status,
                    })

                return Response(
                    {"error": "Inpatient encounter has no linked admission."},
                    status=status.HTTP_400_BAD_REQUEST
                )

        except Exception as e:
            logger.error(f"Failed to discharge patient: {str(e)}")
            return Response(
                {"error": "Failed to discharge patient. Please try again."},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get encounter statistics.

        GET /api/encounters/stats/
        """
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

        GET /api/encounters/for_patient/?patient_id={uuid}
        """
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response(
                {"error": "patient_id parameter is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        patient = PatientProfile.objects.filter(id=patient_id).first()
        if not patient:
            return Response(
                {"error": "Patient not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        facility = get_user_facility(request)
        if not facility or patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_clinical_access(request.user, patient)

        encounters = self.get_queryset().filter(patient_id=patient_id)
        serializer = EncounterListSerializer(encounters, many=True)
        return Response(serializer.data)


class OutpatientVisitViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for outpatient visit lifecycle actions."""
    queryset = OutpatientVisit.objects.all()
    serializer_class = OutpatientVisitSerializer
    required_feature = 'outpatient_encounters'
    permission_classes = [
        FeatureRequiredPermission,
        permissions.IsAuthenticated,
        FacilityScopedPermission,
    ]
    pagination_class = StandardResultsSetPagination
    lookup_field = 'encounter_id'
    lifecycle_update_user_types = {'admin', 'doctor', 'nurse', 'receptionist'}

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return OutpatientVisit.objects.none()

        queryset = OutpatientVisit.objects.select_related(
            'encounter',
            'encounter__patient',
            'encounter__patient__user',
            'encounter__practitioner',
            'encounter__practitioner__staff',
            'encounter__practitioner__staff__user',
            'appointment',
            'clinic',
        ).filter(encounter__facility=facility)

        user = self.request.user
        if user.user_type == 'admin':
            return queryset
        if user.user_type == 'patient':
            return queryset.filter(encounter__patient__user=user)
        if user.user_type in ['doctor', 'nurse'] and settings.TEAM_ACCESS_STRICT:
            accessible_patients = get_accessible_patients_for_clinician(user)
            return queryset.filter(encounter__patient__in=accessible_patients)

        return queryset

    def _get_visit(self):
        visit = self.get_object()
        check_clinical_access(self.request.user, visit.encounter.patient)
        return visit

    def _ensure_lifecycle_update_access(self):
        if self.request.user.user_type not in self.lifecycle_update_user_types:
            raise PermissionDenied("You do not have permission to update visit lifecycle state.")

    @action(detail=True, methods=['post'])
    def add_to_waiting(self, request, encounter_id=None):
        self._ensure_lifecycle_update_access()
        visit = self._get_visit()
        try:
            visit = VisitService.add_to_waiting(visit)
            return Response({"visit_status": visit.visit_status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def call(self, request, encounter_id=None):
        self._ensure_lifecycle_update_access()
        visit = self._get_visit()
        try:
            visit = VisitService.call_patient(visit)
            return Response({"visit_status": visit.visit_status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def start_consultation(self, request, encounter_id=None):
        self._ensure_lifecycle_update_access()
        visit = self._get_visit()
        try:
            visit = VisitService.start_consultation(visit)
            return Response({"visit_status": visit.visit_status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def hold(self, request, encounter_id=None):
        self._ensure_lifecycle_update_access()
        visit = self._get_visit()
        try:
            visit = VisitService.put_on_hold(visit)
            return Response({"visit_status": visit.visit_status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def end_consultation(self, request, encounter_id=None):
        self._ensure_lifecycle_update_access()
        visit = self._get_visit()
        try:
            visit = VisitService.end_consultation(visit)
            return Response({"visit_status": visit.visit_status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def checkout(self, request, encounter_id=None):
        self._ensure_lifecycle_update_access()
        visit = self._get_visit()
        force = bool(request.data.get('force', False))
        try:
            visit = VisitService.checkout(visit, checked_out_by=request.user, force=force)
            return Response({"visit_status": visit.visit_status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def no_show(self, request, encounter_id=None):
        self._ensure_lifecycle_update_access()
        visit = self._get_visit()
        try:
            visit = VisitService.mark_no_show(visit)
            return Response({"visit_status": visit.visit_status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def waiting_room(self, request):
        clinic_id = request.query_params.get('clinic')
        if not clinic_id:
            return Response({"error": "clinic parameter required"}, status=status.HTTP_400_BAD_REQUEST)

        clinic = Clinic.objects.filter(id=clinic_id).first()
        if not clinic:
            return Response({"error": "Clinic not found"}, status=status.HTTP_404_NOT_FOUND)

        facility = get_user_facility(request)
        if not facility or clinic.facility_id != facility.id:
            raise PermissionDenied("Clinic does not belong to the active facility.")

        visits = VisitService.get_waiting_room(clinic)
        data = [
            {
                "encounter_id": str(visit.encounter_id),
                "patient_id": str(visit.encounter.patient_id),
                "queue_number": visit.queue_number,
                "visit_status": visit.visit_status,
                "patient_name": visit.encounter.patient_name,
                "checked_in_at": visit.checked_in_at,
                "called_at": visit.called_at,
                "consultation_ended_at": visit.consultation_ended_at,
            }
            for visit in visits
        ]
        return Response(data)


class TriageQueueViewSet(viewsets.ModelViewSet):
    """ViewSet for triage queue management."""
    queryset = TriageQueue.objects.all()
    required_feature = 'emergency_encounters'
    permission_classes = [
        FeatureRequiredPermission,
        permissions.IsAuthenticated,
        FacilityScopedPermission,
        TriageQueuePermission,
    ]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return TriageQueue.objects.none()

        return TriageService.get_queue(
            facility,
            status=self.request.query_params.get('status'),
            priority=self.request.query_params.get('priority'),
        )

    def get_serializer_class(self):
        if self.action == 'create':
            return TriageQueueCreateSerializer
        return TriageQueueSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        facility = get_user_facility(request)
        patient = serializer.validated_data['patient']
        if not facility or patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")

        entry = TriageService.add_to_queue(
            patient=patient,
            facility=facility,
            chief_complaint=serializer.validated_data.get('chief_complaint', ''),
            priority=serializer.validated_data.get('priority', 'routine'),
            added_by=request.user,
        )

        output = TriageQueueSerializer(entry)
        headers = self.get_success_headers(output.data)
        return Response(output.data, status=status.HTTP_201_CREATED, headers=headers)

    @action(detail=True, methods=['post'])
    def triage(self, request, pk=None):
        entry = self.get_object()
        priority = request.data.get('priority', entry.priority)
        notes = request.data.get('notes', '')
        try:
            entry = TriageService.triage_patient(entry, priority, notes, triaged_by=request.user)
            return Response({"status": entry.status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        entry = self.get_object()
        clinic_id = request.data.get('clinic_id')
        appointment_type_id = request.data.get('appointment_type_id')
        start_time_raw = request.data.get('start_time')
        practitioner_id = request.data.get('practitioner_id')

        if not clinic_id or not appointment_type_id or not start_time_raw:
            return Response(
                {"error": "clinic_id, appointment_type_id, and start_time are required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        clinic = Clinic.objects.filter(id=clinic_id).first()
        if not clinic:
            return Response({"error": "Clinic not found"}, status=status.HTTP_404_NOT_FOUND)

        facility = get_user_facility(request)
        if not facility or clinic.facility_id != facility.id:
            raise PermissionDenied("Clinic does not belong to the active facility.")

        appointment_type = AppointmentType.objects.filter(id=appointment_type_id).first()
        if not appointment_type:
            return Response({"error": "Appointment type not found"}, status=status.HTTP_404_NOT_FOUND)

        start_time = parse_datetime(start_time_raw)
        if not start_time:
            return Response({"error": "Invalid start_time"}, status=status.HTTP_400_BAD_REQUEST)
        if timezone.is_naive(start_time):
            start_time = timezone.make_aware(start_time)

        practitioner = None
        if practitioner_id:
            from apps.users.models import PractitionerProfile
            practitioner = PractitionerProfile.objects.filter(
                Q(staff__primary_facility=facility) |
                Q(staff__primary_facility__isnull=True, staff__user__primary_facility=facility),
                id=practitioner_id,
            ).first()
            if not practitioner:
                return Response({"error": "Practitioner not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            appointment = TriageService.assign_to_clinic(
                entry,
                clinic,
                appointment_type,
                start_time,
                practitioner=practitioner,
                assigned_by=request.user,
            )
            return Response({
                "status": entry.status,
                "appointment_id": str(appointment.id),
            })
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        entry = self.get_object()
        try:
            entry = TriageService.cancel(entry)
            return Response({"status": entry.status})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
