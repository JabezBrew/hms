from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q, Prefetch, Count, Case, When, Sum
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_page
from django.core.cache import cache
from django.conf import settings
from datetime import timedelta, datetime
import logging

from apps.core.metrics import inc_counter, measure_duration, observe_histogram, track_query_count
from ..core.pagination import StandardResultsSetPagination, SmallResultsSetPagination
from apps.core.cache_utils import facility_cache_key

from .models import (
    VitalSigns, NursingTask, NursingAlert, MedicationAdministration,
    ShiftHandoff, TreatmentSheetEntry, SupplyRequest, FluidBalance
)
from .serializers import (
    VitalSignsSerializer, VitalSignsCreateSerializer, VitalSignsListSerializer,
    NursingTaskSerializer, NursingTaskCreateSerializer, NursingTaskUpdateSerializer,
    NursingTaskListSerializer,
    NursingAlertSerializer, NursingAlertAcknowledgeSerializer, NursingAlertListSerializer,
    MedicationAdministrationSerializer, MedicationAdministrationCreateSerializer,
    MedicationAdministrationUpdateSerializer, MedicationAdministrationListSerializer,
    ShiftHandoffSerializer, ShiftHandoffListSerializer,
    PatientMonitoringSerializer, PatientMonitoringListSerializer,
    TreatmentSheetEntrySerializer, TreatmentSheetEntryListSerializer,
    TreatmentSheetEntryCreateSerializer,
    SupplyRequestSerializer, SupplyRequestListSerializer, SupplyRequestCreateSerializer,
    FluidBalanceSerializer, FluidBalanceListSerializer, FluidBalanceCreateSerializer,
    FluidBalanceSummarySerializer
)
from .permissions import IsNurseOrAdmin, IsNurseOrDoctor
from ..wards.models import Admission
from ..encounters.services import ensure_encounter_for_entry
from ..users.models import PatientProfile, PractitionerProfile
from ..audit.services import AuditService
from ..audit.models import AuditCategory, AuditAction
from ..core.security import (
    ACTIVE_ADMISSION_STATUSES,
    FacilityScopedPermission,
    check_clinical_access,
    get_user_facility,
    get_accessible_patients_for_clinician,
    scope_queryset_to_clinical_access,
)

logger = logging.getLogger(__name__)


def _scope_nursing_patient_queryset(request, queryset, *, patient_lookup='patient'):
    """Apply facility and clinical patient access scoping for nursing querysets."""
    facility = get_user_facility(request)
    if not facility:
        return queryset.none()

    queryset = queryset.filter(facility=facility)
    queryset = scope_queryset_to_clinical_access(
        queryset,
        request.user,
        patient_lookup=patient_lookup,
    )

    patient_id = request.query_params.get('patient') or request.query_params.get('patient_id')
    if patient_id:
        patient = PatientProfile.objects.filter(id=patient_id).first()
        if not patient:
            return queryset.none()
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_clinical_access(request.user, patient)
        queryset = queryset.filter(**{f'{patient_lookup}_id': patient_id})

    return queryset


def _get_request_practitioner(user):
    """Resolve the caller's practitioner profile through the staff relation."""
    return PractitionerProfile.objects.filter(staff__user=user).first()


class VitalSignsViewSet(viewsets.ModelViewSet):
    """
    API endpoint for vital signs management.
    """
    queryset = VitalSigns.objects.select_related('patient', 'patient__user', 'recorded_by').all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrDoctor]
    filterset_fields = ['patient', 'recorded_by', 'is_critical']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return VitalSignsCreateSerializer
        elif self.action == 'list':
            return VitalSignsListSerializer
        return VitalSignsSerializer

    def get_queryset(self):
        """Override to add date filtering."""
        queryset = _scope_nursing_patient_queryset(self.request, super().get_queryset())

        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if start_date:
            queryset = queryset.filter(recorded_at__gte=start_date)
        if end_date:
            queryset = queryset.filter(recorded_at__lte=end_date)

        return queryset

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """
        Create vital signs with auto-encounter linking.

        If no encounter is provided, automatically finds or creates an active encounter
        for the patient.
        """
        data = request.data.copy()

        # Get patient for auto-encounter logic
        patient_id = data.get('patient')
        if not patient_id:
            return Response(
                {"error": "Patient is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            patient = PatientProfile.objects.get(id=patient_id)
        except PatientProfile.DoesNotExist:
            return Response(
                {"error": "Patient not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        facility = get_user_facility(request)
        if not facility or patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_clinical_access(request.user, patient)

        # Get practitioner profile for auto-encounter
        practitioner = None
        try:
            practitioner = PractitionerProfile.objects.get(staff__user=request.user)
            # Set recorded_by if not provided
            if not data.get('recorded_by'):
                data['recorded_by'] = practitioner.id
        except PractitionerProfile.DoesNotExist:
            pass  # Non-practitioners can record vitals too

        # Auto-encounter: Find or create an active encounter
        encounter_id = data.get('encounter')
        try:
            encounter, encounter_created = ensure_encounter_for_entry(
                patient=patient,
                practitioner=practitioner,
                encounter_id=encounter_id,
                reason='Vital signs recording'
            )
            data['encounter'] = encounter.id
            if encounter_created:
                logger.info(f"Auto-created encounter {encounter.id} for vital signs")
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        vital_signs = serializer.save(facility=facility)

        # Audit log - vital signs recorded
        vitals_summary = []
        if vital_signs.temperature:
            vitals_summary.append(f"Temp: {vital_signs.temperature}°C")
        if vital_signs.blood_pressure:
            vitals_summary.append(f"BP: {vital_signs.blood_pressure}")
        if vital_signs.heart_rate:
            vitals_summary.append(f"HR: {vital_signs.heart_rate}")
        if vital_signs.oxygen_saturation:
            vitals_summary.append(f"SpO2: {vital_signs.oxygen_saturation}%")

        AuditService.log(
            request=request,
            action=AuditAction.VITALS_RECORD,
            category=AuditCategory.VITALS,
            resource_type='VitalSigns',
            resource_id=vital_signs.id,
            resource_name=f"Vitals for {patient.user.get_full_name()}",
            description=f"Recorded vital signs for {patient.user.get_full_name()}: {', '.join(vitals_summary)}" if vitals_summary else f"Recorded vital signs for {patient.user.get_full_name()}",
        )

        # Re-fetch with only the relations needed for the lightweight create payload.
        response_vital_signs = VitalSigns.objects.select_related(
            'patient__user',
            'recorded_by__staff__user',
        ).get(pk=vital_signs.pk)
        response_data = VitalSignsListSerializer(response_vital_signs).data
        response_data['encounter'] = str(response_vital_signs.encounter_id)
        response_data['recorded_by'] = (
            str(response_vital_signs.recorded_by_id) if response_vital_signs.recorded_by_id else None
        )
        response_data['notes'] = response_vital_signs.notes
        response_data['encounter_created'] = encounter_created

        return Response(response_data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def patient_trends(self, request):
        """
        Get vital signs trends for a specific patient.
        """
        patient_id = request.query_params.get('patient')
        if not patient_id:
            return Response(
                {"error": "patient parameter is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # SECURITY: Check if user has permission to access this patient
        check_clinical_access(request.user, patient_id)
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = PatientProfile.objects.get(id=patient_id)
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")

        days = int(request.query_params.get('days', 7))
        start_date = timezone.now() - timedelta(days=days)

        vitals = VitalSigns.objects.filter(
            patient=patient,
            recorded_at__gte=start_date
        ).order_by('recorded_at')

        serializer = VitalSignsSerializer(vitals, many=True)
        return Response(serializer.data)


class NursingTaskViewSet(viewsets.ModelViewSet):
    """
    API endpoint for nursing tasks management.
    """
    queryset = NursingTask.objects.select_related(
        'patient', 'patient__user', 'assigned_to', 'completed_by', 'created_by'
    ).all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrAdmin]
    filterset_fields = ['patient', 'assigned_to', 'status', 'priority', 'task_type']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return NursingTaskCreateSerializer
        elif self.action in ['update_status', 'complete']:
            return NursingTaskUpdateSerializer
        elif self.action == 'list':
            return NursingTaskListSerializer
        return NursingTaskSerializer

    def get_queryset(self):
        """Override to add date filtering and nurse-specific tasks."""
        queryset = _scope_nursing_patient_queryset(self.request, super().get_queryset())

        # Filter by scheduled date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if start_date:
            queryset = queryset.filter(scheduled_time__gte=start_date)
        if end_date:
            queryset = queryset.filter(scheduled_time__lte=end_date)

        # Filter for current user's tasks
        my_tasks = self.request.query_params.get('my_tasks')
        if my_tasks and my_tasks.lower() == 'true':
            practitioner = _get_request_practitioner(self.request.user)
            if practitioner:
                queryset = queryset.filter(assigned_to=practitioner)

        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(self.request.user, patient)
        serializer.save(created_by=self.request.user, facility=facility)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Mark task as completed."""
        task = self.get_object()

        if task.status == 'completed':
            return Response(
                {"error": "Task is already completed"},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = NursingTaskUpdateSerializer(
            task,
            data=request.data,
            partial=True
        )

        if serializer.is_valid():
            practitioner = getattr(request.user, 'practitioner_profile', None)
            serializer.save(
                status='completed',
                completed_by=practitioner,
                completed_time=timezone.now()
            )
            return Response(NursingTaskSerializer(task).data)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def today(self, request):
        """Get today's tasks."""
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)

        tasks = self.get_queryset().filter(
            scheduled_time__gte=today_start,
            scheduled_time__lt=today_end
        ).exclude(status='completed')

        serializer = self.get_serializer(tasks, many=True)
        return Response(serializer.data)


class NursingAlertViewSet(viewsets.ModelViewSet):
    """
    API endpoint for nursing alerts management.
    """
    queryset = NursingAlert.objects.select_related(
        'patient', 'patient__user', 'acknowledged_by', 'related_vital_signs'
    ).all()
    serializer_class = NursingAlertSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrAdmin]
    filterset_fields = ['patient', 'alert_type', 'severity', 'is_acknowledged']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return NursingAlertListSerializer
        return NursingAlertSerializer

    def get_queryset(self):
        """Override to show unacknowledged alerts by default."""
        queryset = _scope_nursing_patient_queryset(self.request, super().get_queryset())

        # Show only unacknowledged alerts by default
        show_all = self.request.query_params.get('show_all')
        if not show_all or show_all.lower() != 'true':
            queryset = queryset.filter(is_acknowledged=False)

        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(self.request.user, patient)
        serializer.save(facility=facility)

    @action(detail=True, methods=['post'])
    def acknowledge(self, request, pk=None):
        """Acknowledge an alert."""
        alert = self.get_object()

        if alert.is_acknowledged:
            return Response(
                {"error": "Alert is already acknowledged"},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = NursingAlertAcknowledgeSerializer(data=request.data)
        if serializer.is_valid():
            practitioner = getattr(request.user, 'practitioner_profile', None)
            alert.acknowledge(
                practitioner=practitioner,
                notes=serializer.validated_data.get('resolution_notes')
            )
            return Response(NursingAlertSerializer(alert).data)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def active(self, request):
        """Get all active (unacknowledged) alerts."""
        alerts = self.get_queryset().filter(is_acknowledged=False).order_by('-severity', '-created_at')
        serializer = self.get_serializer(alerts, many=True)
        return Response(serializer.data)


class MedicationAdministrationViewSet(viewsets.ModelViewSet):
    """
    API endpoint for medication administration management.

    Note: Dispensing actions (pending_dispensing, dispense, dispense_bulk)
    have been moved to apps.pharmacy.views.DispensingViewSet
    """
    queryset = MedicationAdministration.objects.select_related(
        'patient', 'patient__user', 'administered_by', 'prescribed_by', 'created_by'
    ).all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrDoctor]
    filterset_fields = ['patient', 'status', 'administered_by']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return MedicationAdministrationCreateSerializer
        elif self.action == 'administer':
            return MedicationAdministrationUpdateSerializer
        elif self.action == 'list':
            return MedicationAdministrationListSerializer
        return MedicationAdministrationSerializer

    def get_queryset(self):
        """Override to add date filtering."""
        queryset = _scope_nursing_patient_queryset(self.request, super().get_queryset())

        # Filter by scheduled date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if start_date:
            queryset = queryset.filter(scheduled_time__gte=start_date)
        if end_date:
            queryset = queryset.filter(scheduled_time__lte=end_date)

        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(self.request.user, patient)
        serializer.save(created_by=self.request.user, facility=facility)

    @action(detail=True, methods=['post'])
    def administer(self, request, pk=None):
        """Record medication administration."""
        med_admin = self.get_object()

        if med_admin.status == 'administered':
            return Response(
                {"error": "Medication already administered"},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = MedicationAdministrationUpdateSerializer(
            med_admin,
            data=request.data,
            partial=True
        )

        if serializer.is_valid():
            practitioner = getattr(request.user, 'practitioner_profile', None)
            serializer.save(
                administered_by=practitioner,
                administered_time=timezone.now()
            )
            return Response(MedicationAdministrationSerializer(med_admin).data)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def due_now(self, request):
        """Get medications due within the next hour."""
        now = timezone.now()
        one_hour_later = now + timedelta(hours=1)

        medications = self.get_queryset().filter(
            status='scheduled',
            scheduled_time__gte=now,
            scheduled_time__lte=one_hour_later
        ).order_by('scheduled_time')

        serializer = self.get_serializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def overdue(self, request):
        """Get overdue medications."""
        now = timezone.now()

        medications = self.get_queryset().filter(
            status='scheduled',
            scheduled_time__lt=now
        ).order_by('scheduled_time')

        serializer = self.get_serializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def ready_for_admin(self, request):
        """
        Get medications that are dispensed and ready for nurse administration.

        Note: Pharmacy dispensing endpoints have moved to /api/pharmacy/dispensing/
        """
        patient_id = request.query_params.get('patient')
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        from apps.pharmacy.services import get_dispensed_ready_for_admin
        medications = get_dispensed_ready_for_admin(patient_id)
        if patient_id:
            patient = PatientProfile.objects.get(id=patient_id)
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_clinical_access(request.user, patient)
            medications = medications.filter(patient=patient)
        else:
            medications = medications.filter(facility=facility)

        # Use list serializer
        serializer = MedicationAdministrationListSerializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def patient_mar(self, request):
        """
        Get full MAR (Medication Administration Record) for a patient.
        Shows all scheduled, administered, and missed medications.
        """
        patient_id = request.query_params.get('patient')
        if not patient_id:
            return Response(
                {'error': 'patient parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # SECURITY: Check if user has permission to access this patient
        check_clinical_access(request.user, patient_id)
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = PatientProfile.objects.get(id=patient_id)
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")

        # Get date range (default: today)
        date_str = request.query_params.get('date')
        if date_str:
            try:
                target_date = timezone.datetime.fromisoformat(date_str.replace('Z', '+00:00')).date()
            except ValueError:
                target_date = timezone.now().date()
        else:
            target_date = timezone.now().date()

        start_datetime = timezone.make_aware(
            timezone.datetime.combine(target_date, timezone.datetime.min.time())
        )
        end_datetime = timezone.make_aware(
            timezone.datetime.combine(target_date, timezone.datetime.max.time())
        )

        medications = self.get_queryset().filter(
            patient=patient,
            scheduled_time__gte=start_datetime,
            scheduled_time__lte=end_datetime
        ).order_by('scheduled_time')

        serializer = self.get_serializer(medications, many=True)

        # Use single aggregation query instead of multiple count() calls (N+1 fix)
        summary = medications.aggregate(
            total=Count('id'),
            scheduled=Count(Case(When(status='scheduled', then=1))),
            administered=Count(Case(When(status='administered', then=1))),
            missed=Count(Case(When(status='missed', then=1))),
            held=Count(Case(When(status='held', then=1))),
            refused=Count(Case(When(status='refused', then=1))),
        )

        return Response({
            'date': str(target_date),
            'patient_id': patient_id,
            'medications': serializer.data,
            'summary': summary
        })

    @action(detail=False, methods=['post'], url_path='create-and-administer')
    def create_and_administer(self, request):
        """
        Create a new MAR entry and immediately mark it as administered.
        Used when clicking on a dose slot that doesn't have a MAR entry yet.

        Required fields:
        - prescription_id: UUID of prescription (required - patient is derived from this)
        - scheduled_time: ISO datetime string

        Optional:
        - notes: administration notes
        """
        from apps.clinical_notes.models import Prescription

        prescription_id = request.data.get('prescription_id')
        scheduled_time_str = request.data.get('scheduled_time')

        if not prescription_id:
            return Response(
                {'error': 'prescription_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not scheduled_time_str:
            return Response(
                {'error': 'scheduled_time is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get prescription and patient from it
        try:
            prescription = Prescription.objects.select_related('patient', 'prescribed_by').get(id=prescription_id)
            patient = prescription.patient
            medication_name = prescription.medication_name
            dosage = prescription.dosage
            route = prescription.route
            frequency = prescription.frequency
            prescribed_by = prescription.prescribed_by
        except Prescription.DoesNotExist:
            return Response(
                {'error': 'Prescription not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        facility = get_user_facility(request)
        if not facility or patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")

        # Parse scheduled time
        try:
            scheduled_time = timezone.datetime.fromisoformat(scheduled_time_str.replace('Z', '+00:00'))
            if timezone.is_naive(scheduled_time):
                scheduled_time = timezone.make_aware(scheduled_time)
        except ValueError:
            return Response(
                {'error': 'Invalid scheduled_time format'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get practitioner profile
        practitioner = getattr(request.user, 'practitioner_profile', None)

        # Create and immediately administer
        med_admin = MedicationAdministration.objects.create(
            patient=patient,
            facility=facility,
            medication_name=medication_name,
            dosage=dosage,
            route=route,
            frequency=frequency,
            scheduled_time=scheduled_time,
            status='administered',
            administered_time=timezone.now(),
            administered_by=practitioner,
            prescribed_by=prescribed_by,
            prescription=prescription,
            created_by=request.user,
            administration_notes=request.data.get('notes', '')
        )

        return Response(MedicationAdministrationSerializer(med_admin).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='mar-grid')
    def mar_grid(self, request):
        """
        Get MAR grid data for a patient/admission over a date range.

        Dose-based approach:
        - Course completion based on total doses given vs required, not calendar days
        - No predefined time slots - records actual administration time
        - Each day shows dose indicators based on frequency (1 for daily, 3 for TID, etc.)

        Query params:
        - admission_id: UUID of admission (required)
        - start_date: Start date (default: today)
        - days: Number of days to show (default: 7)
        """
        from apps.wards.models import Admission
        from apps.encounters.models import Encounter
        from apps.clinical_notes.models import Prescription
        from datetime import datetime, time
        from collections import defaultdict

        admission_id = request.query_params.get('admission_id')
        if not admission_id:
            return Response(
                {'error': 'admission_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Find admission (try admission ID first, then encounter ID)
        admission = None
        try:
            admission = Admission.objects.select_related('patient', 'patient__user').get(id=admission_id)
        except Admission.DoesNotExist:
            try:
                encounter = Encounter.objects.select_related('admission', 'patient').get(id=admission_id)
                if encounter.admission:
                    admission = encounter.admission
                elif encounter.patient:
                    admission = Admission.objects.filter(
                        patient=encounter.patient,
                        status__in=ACTIVE_ADMISSION_STATUSES
                    ).select_related('patient', 'patient__user').first()
            except Encounter.DoesNotExist:
                pass

        if not admission:
            return Response(
                {'error': 'Admission not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if admission.facility_id != facility.id:
            raise PermissionDenied("Admission does not belong to the active facility.")

        # Parse date range
        start_date_str = request.query_params.get('start_date')
        days_to_show = int(request.query_params.get('days', 7))

        if start_date_str:
            try:
                start_date = datetime.fromisoformat(start_date_str.replace('Z', '+00:00')).date()
            except ValueError:
                start_date = timezone.now().date()
        else:
            start_date = timezone.now().date()

        end_date = start_date + timedelta(days=days_to_show - 1)

        # Get all encounters for this admission
        admission_encounters = Encounter.objects.filter(
            admission=admission
        ).values_list('id', flat=True)

        # Get active prescriptions for this admission
        prescriptions = Prescription.objects.filter(
            patient=admission.patient,
            encounter_id__in=admission_encounters,
            status='active'
        ).select_related('prescribed_by', 'prescribed_by__staff', 'prescribed_by__staff__user')

        # Get ALL MAR entries for this patient (not date-limited, for total dose counting)
        all_mar_entries = MedicationAdministration.objects.filter(
            patient=admission.patient,
        ).select_related('administered_by', 'administered_by__staff', 'administered_by__staff__user')

        # Group MAR entries by prescription_id -> date -> list of doses
        mar_by_prescription = defaultdict(lambda: defaultdict(list))
        mar_totals_by_prescription = defaultdict(int)

        for entry in all_mar_entries:
            if entry.prescription_id:
                rx_id = str(entry.prescription_id)
                entry_date = entry.administered_time.date() if entry.administered_time else entry.scheduled_time.date()

                # Count total administered doses
                if entry.status == 'administered':
                    mar_totals_by_prescription[rx_id] += 1

                # Group by date for the grid view
                administered_by_name = None
                if entry.administered_by and entry.administered_by.staff and entry.administered_by.staff.user:
                    u = entry.administered_by.staff.user
                    administered_by_name = f"{u.first_name} {u.last_name}".strip()

                mar_by_prescription[rx_id][str(entry_date)].append({
                    'id': str(entry.id),
                    'status': entry.status,
                    'administered_time': entry.administered_time.isoformat() if entry.administered_time else None,
                    'administered_by': administered_by_name,
                    'notes': entry.administration_notes or '',
                })

        # Build response
        medications_data = []
        today = timezone.now().date()

        for rx in prescriptions:
            prescriber_name = 'Unknown'
            if rx.prescribed_by and rx.prescribed_by.staff and rx.prescribed_by.staff.user:
                u = rx.prescribed_by.staff.user
                prescriber_name = f"Dr. {u.first_name} {u.last_name}".strip()

            # Calculate doses per day from frequency
            doses_per_day = self._get_doses_per_day(rx.frequency)

            # Calculate total doses required using duration_days from prescription
            duration_days = rx.duration_days or 0
            total_doses_required = doses_per_day * duration_days

            # Get total doses administered for this prescription
            rx_id = str(rx.id)
            total_doses_administered = mar_totals_by_prescription.get(rx_id, 0)

            # Course is complete when all required doses are given
            # (only if there's a defined total; ongoing prescriptions are never "complete")
            course_complete = total_doses_required > 0 and total_doses_administered >= total_doses_required

            # Build days data
            days_data = {}
            current_date = start_date

            while current_date <= end_date:
                date_str = str(current_date)

                # Get administered doses for this day
                day_mar_entries = mar_by_prescription.get(rx_id, {}).get(date_str, [])
                administered_doses = [e for e in day_mar_entries if e['status'] == 'administered']

                # Determine day status
                is_before_start = rx.start_date and current_date < rx.start_date
                is_after_course_complete = course_complete
                is_today = current_date == today
                is_past = current_date < today

                # Build dose slots for this day
                doses = []
                for dose_num in range(1, doses_per_day + 1):
                    # Check if this dose was administered
                    if dose_num <= len(administered_doses):
                        dose_entry = administered_doses[dose_num - 1]
                        doses.append({
                            'dose_number': dose_num,
                            'status': 'administered',
                            'id': dose_entry['id'],
                            'administered_time': dose_entry['administered_time'],
                            'administered_by': dose_entry['administered_by'],
                            'notes': dose_entry['notes'],
                        })
                    else:
                        # Dose not yet given
                        if is_before_start:
                            dose_status = 'not_started'
                        elif is_after_course_complete:
                            dose_status = 'completed'
                        elif is_past:
                            dose_status = 'missed'
                        elif is_today:
                            dose_status = 'due'
                        else:
                            dose_status = 'scheduled'

                        doses.append({
                            'dose_number': dose_num,
                            'status': dose_status,
                            'id': None,
                            'administered_time': None,
                            'administered_by': None,
                            'notes': '',
                        })

                days_data[date_str] = {
                    'doses': doses,
                    'doses_given': len(administered_doses),
                    'doses_required': doses_per_day,
                }
                current_date += timedelta(days=1)

            medications_data.append({
                'id': str(rx.id),
                'medication_name': rx.medication_name,
                'dosage': rx.dosage,
                'route': rx.route,
                'route_display': rx.get_route_display(),
                'frequency': rx.frequency,
                'frequency_display': rx.get_frequency_display(),
                'duration_days': rx.duration_days,
                'instructions': rx.instructions,
                'prescribed_by': prescriber_name,
                'start_date': rx.start_date.isoformat() if rx.start_date else None,
                'end_date': rx.end_date.isoformat() if rx.end_date else None,
                'doses_per_day': doses_per_day,
                'total_doses_required': total_doses_required,
                'total_doses_administered': total_doses_administered,
                'course_complete': course_complete,
                'days': days_data,
            })

        # Generate date headers
        date_headers = []
        current_date = start_date
        while current_date <= end_date:
            date_headers.append({
                'date': str(current_date),
                'day_name': current_date.strftime('%a'),
                'day_num': current_date.day,
                'month': current_date.strftime('%b'),
                'is_today': current_date == today,
            })
            current_date += timedelta(days=1)

        return Response({
            'admission_id': str(admission.id),
            'patient_name': f"{admission.patient.user.first_name} {admission.patient.user.last_name}",
            'patient_mrn': admission.patient.medical_record_number,
            'date_range': {
                'start': str(start_date),
                'end': str(end_date),
                'days': days_to_show,
            },
            'date_headers': date_headers,
            'medications': medications_data,
        })

    def _get_doses_per_day(self, frequency):
        """Calculate doses per day from frequency string."""
        if not frequency:
            return 1

        freq = frequency.lower()

        # Once daily variations
        if any(x in freq for x in ['qd', 'daily', 'once', 'qhs', 'qam', 'bedtime', 'morning']):
            return 1

        # Twice daily
        if any(x in freq for x in ['bid', 'twice', 'q12h', '2 times', '2x']):
            return 2

        # Three times daily
        if any(x in freq for x in ['tid', 'three', 'q8h', '3 times', '3x']):
            return 3

        # Four times daily
        if any(x in freq for x in ['qid', 'four', 'q6h', '4 times', '4x']):
            return 4

        # Every 4 hours (6 times daily)
        if 'q4h' in freq:
            return 6

        # PRN - as needed (count as 4 potential doses per day)
        if any(x in freq for x in ['prn', 'as needed']):
            return 4

        # Default to once daily
        return 1


class ShiftHandoffViewSet(viewsets.ModelViewSet):
    """
    API endpoint for shift handoff management.
    """
    queryset = ShiftHandoff.objects.select_related(
        'patient', 'patient__user', 'from_nurse', 'to_nurse', 'created_by'
    ).all()
    serializer_class = ShiftHandoffSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrAdmin]
    filterset_fields = ['patient', 'shift_date', 'shift_type', 'from_nurse', 'to_nurse']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return ShiftHandoffListSerializer
        return ShiftHandoffSerializer

    def get_queryset(self):
        return _scope_nursing_patient_queryset(self.request, super().get_queryset())

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(self.request.user, patient)
        serializer.save(created_by=self.request.user, facility=facility)

    @action(detail=False, methods=['get'])
    def today(self, request):
        """Get today's shift handoffs."""
        today = timezone.now().date()

        handoffs = self.get_queryset().filter(shift_date=today)
        serializer = self.get_serializer(handoffs, many=True)
        return Response(serializer.data)


class MonitoringPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 50


class PatientMonitoringViewSet(viewsets.ViewSet):
    """
    API endpoint for patient monitoring dashboard.
    Provides consolidated view of patient status, vitals, alerts, tasks, and medications.
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrAdmin]
    pagination_class = MonitoringPagination

    def list(self, request):
        """
        List endpoint - redirect to dashboard.
        This handles calls to /api/nursing/monitoring/ without the dashboard action.
        """
        return self.dashboard(request)

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        """
        Get consolidated patient monitoring data.
        Supports filtering by ward and admission status.
        Supports pagination with page and page_size query params.

        OPTIMIZED: Uses Prefetch to reduce queries from 81 to 5-6 for 20 patients.
        CACHED: Results cached for 60 seconds with stampede protection.
        
        STAMPEDE PROTECTION: Uses lock-based single-flight pattern to prevent
        cache stampedes. When cache expires, only ONE request runs the expensive
        query while others wait for the result.
        """
        try:
            # Get query parameters with error handling
            ward_id = request.query_params.get('ward')
            show_all = request.query_params.get('show_all', 'false').lower() == 'true'
            facility = get_user_facility(request)
            if not facility:
                raise PermissionDenied("Facility context is required.")

            try:
                page = max(int(request.query_params.get('page', 1)), 1)
                requested_page_size = int(request.query_params.get('page_size', 20))
            except (ValueError, TypeError):
                page = 1
                requested_page_size = 20

            page_size = max(1, min(requested_page_size, self.pagination_class.max_page_size))

            # Build cache key based on query params
            cache_key = facility_cache_key(
                f'nursing_dashboard_{ward_id or "all"}_u{request.user.id}_p{page}_ps{page_size}'
            )
            stale_cache_key = f'{cache_key}_stale'
            lock_key = f'{cache_key}_lock'
            
            # Try to get from cache first
            cached_result = cache.get(cache_key)
            if cached_result is not None:
                inc_counter(
                    'hms_dashboard_cache_events_total',
                    labels={'dashboard': 'nursing_monitoring', 'result': 'hit'},
                    description='Dashboard cache hits, misses, and stale serves.',
                )
                return Response(cached_result)
            
            # Cache miss - try to acquire lock for single-flight
            # Using cache.add() as a distributed lock (returns True if set, False if exists)
            stale_result = cache.get(stale_cache_key)
            lock_acquired = cache.add(lock_key, '1', timeout=30)  # 30s lock timeout
            
            # If we didn't get the lock, another request is building the cache.
            # Instead of blocking (which starves threads), we have two options:
            # 1. Check cache one more time (the other request might be done)
            # 2. If still no cache, proceed anyway (better than blocking)
            if not lock_acquired:
                # Quick retry - check if cache was populated while we waited
                cached_result = cache.get(cache_key)
                if cached_result is not None:
                    inc_counter(
                        'hms_dashboard_cache_events_total',
                        labels={'dashboard': 'nursing_monitoring', 'result': 'hit'},
                        description='Dashboard cache hits, misses, and stale serves.',
                    )
                    return Response(cached_result)
                if stale_result is not None:
                    inc_counter(
                        'hms_dashboard_cache_events_total',
                        labels={'dashboard': 'nursing_monitoring', 'result': 'stale'},
                        description='Dashboard cache hits, misses, and stale serves.',
                    )
                    return Response(stale_result)
                # Cold-cache fallback: recompute locally rather than blocking request threads.
            
            inc_counter(
                'hms_dashboard_cache_events_total',
                labels={'dashboard': 'nursing_monitoring', 'result': 'miss'},
                description='Dashboard cache hits, misses, and stale serves.',
            )

            try:
                with track_query_count() as query_counter:
                    with measure_duration(
                        'hms_dashboard_latency_seconds',
                        labels={'dashboard': 'nursing_monitoring'},
                        description='Dashboard compute latency in seconds.',
                    ):
                        # Calculate time boundaries for prefetch filters
                        now = timezone.now()
                        twenty_four_hours_ago = now - timedelta(hours=24)
                        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
                        today_end = today_start + timedelta(days=1)
                        two_hours_later = now + timedelta(hours=2)

                        admissions = Admission.objects.filter(
                            status__in=ACTIVE_ADMISSION_STATUSES,
                            facility=facility
                        ).select_related(
                            'patient__user',
                            'bed__ward',
                            'admitting_doctor__staff__user'
                        ).prefetch_related(
                            Prefetch(
                                'patient__vital_signs',
                                queryset=VitalSigns.objects.filter(
                                    recorded_at__gte=twenty_four_hours_ago
                                ).order_by('-recorded_at')[:5],
                                to_attr='recent_vitals_list'
                            ),
                            Prefetch(
                                'patient__nursing_alerts',
                                queryset=NursingAlert.objects.filter(
                                    is_acknowledged=False
                                ).order_by('-severity', '-created_at')[:5],
                                to_attr='active_alerts_list'
                            ),
                            Prefetch(
                                'patient__nursing_tasks',
                                queryset=NursingTask.objects.filter(
                                    status__in=['pending', 'overdue'],
                                    scheduled_time__gte=today_start,
                                    scheduled_time__lt=today_end
                                ).order_by('scheduled_time')[:10],
                                to_attr='pending_tasks_list'
                            ),
                            Prefetch(
                                'patient__medication_administrations',
                                queryset=MedicationAdministration.objects.filter(
                                    status='scheduled',
                                    scheduled_time__gte=now,
                                    scheduled_time__lte=two_hours_later
                                ).order_by('scheduled_time')[:10],
                                to_attr='medications_due_list'
                            ),
                        ).order_by('-admission_date')

                        if request.user.user_type == 'nurse' and getattr(settings, 'TEAM_ACCESS_STRICT', True):
                            accessible_patients = get_accessible_patients_for_clinician(request.user)
                            admissions = admissions.filter(patient__in=accessible_patients)

                        if ward_id:
                            admissions = admissions.filter(bed__ward_id=ward_id)

                        count_cache_key = facility_cache_key(
                            f'nursing_dashboard_count_{ward_id or "all"}_u{request.user.id}'
                        )
                        total_count = cache.get(count_cache_key)
                        if total_count is None:
                            total_count = admissions.count()
                            cache.set(count_cache_key, total_count, 120)

                        start = (page - 1) * page_size
                        end = start + page_size
                        admissions = list(admissions[start:end])

                        monitoring_data = []

                        for admission in admissions:
                            patient = admission.patient

                            recent_vitals = getattr(patient, 'recent_vitals_list', [])
                            latest_vitals = recent_vitals[0] if recent_vitals else None

                            active_alerts = getattr(patient, 'active_alerts_list', [])
                            pending_tasks = getattr(patient, 'pending_tasks_list', [])
                            medications_due = getattr(patient, 'medications_due_list', [])

                            monitoring_data.append({
                                'patient': patient,
                                'admission': admission,
                                'latest_vitals': latest_vitals,
                                'active_alerts': active_alerts,
                                'pending_tasks': pending_tasks,
                                'medications_due': medications_due
                            })

                        serializer = PatientMonitoringListSerializer(monitoring_data, many=True)

                        result = {
                            'count': total_count,
                            'page': page,
                            'page_size': page_size,
                            'total_pages': (total_count + page_size - 1) // page_size,
                            'results': serializer.data
                        }
                
                        cache.set(cache_key, result, 60)
                        cache.set(stale_cache_key, result, 300)
                observe_histogram(
                    'hms_dashboard_query_count',
                    query_counter.count,
                    labels={'dashboard': 'nursing_monitoring'},
                    description='SQL statements executed to build a dashboard response.',
                    buckets=(1, 2, 4, 8, 12, 16, 24, 32),
                )
                
                return Response(result)
            
            finally:
                # Release the lock if we acquired it
                if lock_acquired:
                    cache.delete(lock_key)

        except Exception:
            logger.exception("Error in patient monitoring dashboard")

            return Response({
                'error': 'Failed to fetch patient monitoring data',
                'count': 0,
                'page': 1,
                'page_size': 20,
                'total_pages': 0,
                'results': []
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'])
    def patient_detail(self, request):
        """
        Get detailed monitoring data for a specific patient.
        """
        patient_id = request.query_params.get('patient')
        if not patient_id:
            return Response(
                {"error": "patient parameter is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            patient = PatientProfile.objects.select_related('user').get(id=patient_id)
        except PatientProfile.DoesNotExist:
            return Response(
                {"error": "Patient not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        facility = get_user_facility(request)
        if not facility or patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_clinical_access(request.user, patient)

        # Get current admission
        admission = Admission.objects.filter(
            patient=patient,
            status__in=ACTIVE_ADMISSION_STATUSES
        ).select_related('bed', 'bed__ward').first()

        # Get recent vital signs (last 24 hours)
        recent_vitals = VitalSigns.objects.filter(
            patient=patient,
            recorded_at__gte=timezone.now() - timedelta(hours=24)
        ).order_by('-recorded_at')

        # Get all active alerts
        active_alerts = NursingAlert.objects.filter(
            patient=patient,
            is_acknowledged=False
        ).order_by('-severity', '-created_at')

        # Get today's tasks
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)
        today_tasks = NursingTask.objects.filter(
            patient=patient,
            scheduled_time__gte=today_start,
            scheduled_time__lt=today_end
        ).order_by('scheduled_time')

        # Get today's medications
        today_medications = MedicationAdministration.objects.filter(
            patient=patient,
            scheduled_time__gte=today_start,
            scheduled_time__lt=today_end
        ).order_by('scheduled_time')

        # Get recent shift handoffs
        recent_handoffs = ShiftHandoff.objects.filter(
            patient=patient
        ).order_by('-shift_date', '-created_at')[:3]

        data = {
            'patient': patient,
            'admission': admission,
            'recent_vitals': recent_vitals,
            'active_alerts': active_alerts,
            'today_tasks': today_tasks,
            'today_medications': today_medications,
            'recent_handoffs': recent_handoffs
        }

        # Serialize the data
        from ..users.serializers import PatientProfileSerializer
        from ..wards.serializers import AdmissionSerializer

        response_data = {
            'patient': PatientProfileSerializer(patient).data,
            'admission': AdmissionSerializer(admission).data if admission else None,
            'recent_vitals': VitalSignsSerializer(recent_vitals, many=True).data,
            'active_alerts': NursingAlertSerializer(active_alerts, many=True).data,
            'today_tasks': NursingTaskSerializer(today_tasks, many=True).data,
            'today_medications': MedicationAdministrationSerializer(today_medications, many=True).data,
            'recent_handoffs': ShiftHandoffSerializer(recent_handoffs, many=True).data
        }

        return Response(response_data)

    @action(detail=False, methods=['get'])
    def ward_nurses(self, request):
        """
        Get nurses who have worked on a specific ward.
        Returns nurses who have performed nursing activities (vital signs, tasks,
        medication administration) on patients in the specified ward within the
        last 7 days, indicating they are familiar with ward patients.
        """
        ward_id = request.query_params.get('ward')
        if not ward_id:
            return Response(
                {"error": "ward parameter is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get patients currently admitted to this ward
        ward_patients = PatientProfile.objects.filter(
            admissions__bed__ward_id=ward_id,
            admissions__status__in=ACTIVE_ADMISSION_STATUSES
        ).values_list('id', flat=True)

        # Find nurses who have recorded activities for these patients in last 7 days
        recent_cutoff = timezone.now() - timedelta(days=7)

        # Get nurses from vital signs
        vitals_nurses = VitalSigns.objects.filter(
            patient_id__in=ward_patients,
            recorded_at__gte=recent_cutoff
        ).values_list('recorded_by_id', flat=True).distinct()

        # Get nurses from completed tasks
        task_nurses = NursingTask.objects.filter(
            patient_id__in=ward_patients,
            completed_time__gte=recent_cutoff
        ).values_list('completed_by_id', flat=True).distinct()

        # Get nurses from medication administrations
        med_nurses = MedicationAdministration.objects.filter(
            patient_id__in=ward_patients,
            administered_time__gte=recent_cutoff
        ).values_list('administered_by_id', flat=True).distinct()

        # Combine all nurse IDs
        all_nurse_ids = set(vitals_nurses) | set(task_nurses) | set(med_nurses)
        all_nurse_ids.discard(None)  # Remove None if present

        # Get practitioner profiles for these nurses
        nurses = PractitionerProfile.objects.filter(
            id__in=all_nurse_ids
        ).select_related('staff', 'staff__user').order_by('staff__user__first_name')

        # Format response
        nurse_list = []
        for nurse in nurses:
            if nurse.staff and nurse.staff.user:
                nurse_list.append({
                    'id': str(nurse.id),
                    'full_name': nurse.staff.user.get_full_name(),
                    'name': nurse.staff.user.get_full_name(),  # Alias for compatibility
                    'role': nurse.staff.user.user_type,
                    'department': nurse.staff.department if nurse.staff else None,
                    'employee_id': nurse.staff.employee_id if nurse.staff else None,
                })

        return Response(nurse_list)


# ============================================================================
# Treatment Sheet ViewSets
# ============================================================================


class TreatmentSheetEntryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for Treatment Sheet Entry management.

    Supports CRUD operations plus custom actions for:
    - Requesting supply from pharmacy
    - Discontinuing medication orders
    - Checking supply status
    """
    queryset = TreatmentSheetEntry.objects.select_related(
        'patient', 'patient__user', 'ordered_by', 'ordered_by__staff',
        'ordered_by__staff__user', 'admission'
    ).prefetch_related('supply_requests', 'dose_administrations').all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrDoctor]
    filterset_fields = ['patient', 'admission', 'status', 'ordered_by']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'create':
            return TreatmentSheetEntryCreateSerializer
        elif self.action == 'list':
            return TreatmentSheetEntryListSerializer
        return TreatmentSheetEntrySerializer

    def get_queryset(self):
        """Override to add filtering."""
        facility = get_user_facility(self.request)
        if not facility:
            return TreatmentSheetEntry.objects.none()

        queryset = super().get_queryset().filter(facility=facility)

        patient_id = self.request.query_params.get('patient') or self.request.query_params.get('patient_id')
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return queryset.none()
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_clinical_access(self.request.user, patient)
            queryset = queryset.filter(patient_id=patient_id)

        # Filter by admission
        admission_id = self.request.query_params.get('admission_id')
        if admission_id:
            queryset = queryset.filter(admission_id=admission_id)

        # Filter by active status
        active_only = self.request.query_params.get('active_only')
        if active_only and active_only.lower() == 'true':
            queryset = queryset.filter(status='active')

        return queryset.order_by('-start_datetime')

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """
        Create treatment sheet entry and generate initial MAR entries.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(request.user, patient)

        # Use service to create entry with MAR generation
        from .services import create_treatment_entry_with_mar

        treatment_data = dict(serializer.validated_data)
        treatment_data['facility'] = facility
        entry = create_treatment_entry_with_mar(treatment_data, created_by=request.user)

        # Audit log
        AuditService.log_action(
            user=request.user,
            action=AuditAction.CREATE,
            category=AuditCategory.NURSING,
            resource_type='TreatmentSheetEntry',
            resource_id=str(entry.id),
            details=f"Created treatment entry for {entry.medication_name}"
        )

        # Return full serializer
        output_serializer = TreatmentSheetEntrySerializer(entry)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='by-admission')
    def by_admission(self, request):
        """
        Get all treatment sheet entries for a specific admission.
        Also includes active prescriptions from the admission's encounter that don't have treatment entries.

        Query params:
        - admission_id: UUID of the admission OR encounter ID (will lookup admission from encounter)
        """
        admission_id = request.query_params.get('admission_id')
        if not admission_id:
            return Response(
                {'error': 'admission_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        from apps.wards.models import Admission
        from apps.encounters.models import Encounter

        # Try to find admission directly first
        admission = None
        try:
            admission = Admission.objects.select_related('patient', 'patient__user', 'bed', 'bed__ward').get(id=admission_id)
        except Admission.DoesNotExist:
            # Maybe it's an encounter ID - try to find admission via encounter
            try:
                encounter = Encounter.objects.select_related('admission').get(id=admission_id)
                if encounter.admission:
                    admission = Admission.objects.select_related('patient', 'patient__user', 'bed', 'bed__ward').get(id=encounter.admission.id)
            except Encounter.DoesNotExist:
                pass

        if not admission:
            # Last resort: find active admission for patient via encounter's patient
            try:
                encounter = Encounter.objects.select_related('patient').get(id=admission_id)
                admission = Admission.objects.filter(
                    patient=encounter.patient,
                    status__in=ACTIVE_ADMISSION_STATUSES
                ).select_related('patient', 'patient__user', 'bed', 'bed__ward').first()
            except Encounter.DoesNotExist:
                pass

        if not admission:
            return Response(
                {'error': 'Admission not found. Please ensure patient is currently admitted.'},
                status=status.HTTP_404_NOT_FOUND
            )

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if admission.facility_id != facility.id:
            raise PermissionDenied("Admission does not belong to the active facility.")
        check_clinical_access(request.user, admission.patient)

        # Get treatment entries from the new system (use resolved admission ID)
        from .services import get_treatment_sheet_by_admission
        entries = get_treatment_sheet_by_admission(admission.id)

        # Also get active prescriptions from the admission's encounter(s) that aren't tracked as entries
        from apps.clinical_notes.models import Prescription

        # Get all encounters for this admission (Encounter already imported above)
        admission_encounters = Encounter.objects.filter(
            admission=admission
        ).values_list('id', flat=True)

        # Get active prescriptions from these encounters
        # Don't filter by end_date - show all prescriptions from this admission that are still 'active' status
        # Even if the course has ended, it's relevant for the treatment sheet during the admission
        active_prescriptions = Prescription.objects.filter(
            patient=admission.patient,
            encounter_id__in=admission_encounters,
            status='active'
        ).exclude(
            # Exclude prescriptions that already have treatment entries
            id__in=entries.values_list('prescription_id', flat=True)
        ).select_related(
            'prescribed_by', 'prescribed_by__staff', 'prescribed_by__staff__user'
        )

        # Combine both into serializer
        serializer = TreatmentSheetEntryListSerializer(entries, many=True)
        entries_data = serializer.data

        # Convert prescriptions to treatment entry format
        for rx in active_prescriptions:
            prescriber_name = 'Unknown'
            if rx.prescribed_by and rx.prescribed_by.staff and rx.prescribed_by.staff.user:
                user = rx.prescribed_by.staff.user
                prescriber_name = f"Dr. {user.first_name} {user.last_name}".strip()

            # Calculate basic dose counts from prescription duration
            total_doses = 0
            if rx.duration_days and rx.frequency:
                # Parse frequency to get doses per day
                freq = rx.frequency.lower()
                doses_per_day = 1
                if 'bid' in freq or 'q12h' in freq:
                    doses_per_day = 2
                elif 'tid' in freq or 'q8h' in freq:
                    doses_per_day = 3
                elif 'qid' in freq or 'q6h' in freq:
                    doses_per_day = 4

                total_doses = rx.duration_days * doses_per_day

            entries_data.append({
                'id': str(rx.id),
                'prescription_id': str(rx.id),
                'patient_name': f"{admission.patient.user.first_name} {admission.patient.user.last_name}",
                'patient_mrn': admission.patient.medical_record_number,
                'admission_ward': admission.bed.ward.name if admission.bed else None,
                'admission_bed': admission.bed.bed_number if admission.bed else None,
                'medication_name': rx.medication_name,
                'dosage': rx.dosage,
                'route': rx.route,
                'route_display': rx.get_route_display(),
                'frequency': rx.frequency,
                'frequency_display': rx.get_frequency_display(),
                'start_datetime': rx.start_date.isoformat() if rx.start_date else None,
                'duration_days': rx.duration_days,
                'status': rx.status,
                'ordered_by_name': prescriber_name,
                'total_doses_ordered': total_doses,
                'total_doses_dispensed': 0,  # No tracking for legacy prescriptions
                'total_doses_administered': 0,
                'days_of_supply_remaining': None,  # Can't calculate without tracking
                'is_legacy_prescription': True,  # Flag to indicate this is from Prescription, not TreatmentSheetEntry
            })

        return Response(entries_data)

    @action(detail=True, methods=['post'])
    def discontinue(self, request, pk=None):
        """
        Discontinue a treatment sheet entry.

        Request body:
        - reason: Reason for discontinuation (required)
        """
        entry = self.get_object()

        if entry.status == 'discontinued':
            return Response(
                {'error': 'Entry is already discontinued'},
                status=status.HTTP_400_BAD_REQUEST
            )

        reason = request.data.get('reason')
        if not reason:
            return Response(
                {'error': 'Reason for discontinuation is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get practitioner profile
        try:
            practitioner = PractitionerProfile.objects.get(staff__user=request.user)
        except PractitionerProfile.DoesNotExist:
            return Response(
                {'error': 'User does not have a practitioner profile'},
                status=status.HTTP_403_FORBIDDEN
            )

        entry.status = 'discontinued'
        entry.discontinued_at = timezone.now()
        entry.discontinued_by = practitioner
        entry.discontinuation_reason = reason
        entry.save()

        # Audit log
        AuditService.log_action(
            user=request.user,
            action=AuditAction.UPDATE,
            category=AuditCategory.NURSING,
            resource_type='TreatmentSheetEntry',
            resource_id=str(entry.id),
            details=f"Discontinued {entry.medication_name}: {reason}"
        )

        serializer = TreatmentSheetEntrySerializer(entry)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='request-supply')
    def request_supply(self, request, pk=None):
        """
        Create a supply request for this treatment entry.

        Request body:
        - quantity: Number of doses requested (required)
        - notes: Optional notes
        """
        entry = self.get_object()

        if entry.status != 'active':
            return Response(
                {'error': 'Can only request supply for active entries'},
                status=status.HTTP_400_BAD_REQUEST
            )

        quantity = request.data.get('quantity')
        if not quantity:
            return Response(
                {'error': 'Quantity is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            quantity = int(quantity)
            if quantity <= 0:
                raise ValueError()
        except (ValueError, TypeError):
            return Response(
                {'error': 'Quantity must be a positive integer'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get practitioner profile
        try:
            practitioner = PractitionerProfile.objects.get(staff__user=request.user)
        except PractitionerProfile.DoesNotExist:
            return Response(
                {'error': 'User does not have a practitioner profile'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Create supply request using service
        from .services import create_supply_request

        notes = request.data.get('notes', '')
        supply_request = create_supply_request(
            treatment_entry=entry,
            quantity=quantity,
            requested_by=practitioner,
            notes=notes
        )

        # Audit log
        AuditService.log_action(
            user=request.user,
            action=AuditAction.CREATE,
            category=AuditCategory.NURSING,
            resource_type='SupplyRequest',
            resource_id=str(supply_request.id),
            details=f"Requested {quantity} doses of {entry.medication_name}"
        )

        serializer = SupplyRequestSerializer(supply_request)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='supply-status')
    def supply_status(self, request, pk=None):
        """
        Get detailed supply status for this treatment entry.
        """
        entry = self.get_object()

        data = {
            'total_doses_ordered': entry.total_doses_ordered,
            'total_doses_dispensed': entry.total_doses_dispensed,
            'total_doses_administered': entry.total_doses_administered,
            'supply_remaining': entry.supply_remaining,
            'days_of_supply_remaining': entry.days_of_supply_remaining,
            'pending_supply_requests': entry.supply_requests.filter(status='pending').count(),
            'recent_supply_requests': SupplyRequestListSerializer(
                entry.supply_requests.all()[:5], many=True
            ).data
        }

        return Response(data)

    @action(detail=False, methods=['get'], url_path='low-supply')
    def low_supply(self, request):
        """
        Get treatment entries with low supply (< 2 days remaining).
        Useful for nursing dashboard alerts.
        """
        from django.db.models import F, ExpressionWrapper, FloatField

        # Get active entries with low supply
        entries = TreatmentSheetEntry.objects.filter(
            status='active'
        ).select_related(
            'patient', 'patient__user', 'admission', 'admission__bed', 'admission__bed__ward'
        )

        # Filter in Python since days_of_supply_remaining is a property
        low_supply_entries = [
            entry for entry in entries
            if entry.days_of_supply_remaining < 2
        ]

        serializer = TreatmentSheetEntryListSerializer(low_supply_entries, many=True)
        return Response(serializer.data)


class SupplyRequestViewSet(viewsets.ModelViewSet):
    """
    API endpoint for Supply Request management.

    Supports operations for:
    - Creating supply requests (nurses)
    - Viewing pending requests (pharmacy)
    - Dispensing supplies (pharmacy)
    - Rejecting requests (pharmacy)
    """
    queryset = SupplyRequest.objects.select_related(
        'treatment_entry', 'treatment_entry__patient', 'treatment_entry__patient__user',
        'treatment_entry__admission', 'treatment_entry__admission__bed',
        'treatment_entry__admission__bed__ward',
        'requested_by', 'requested_by__staff', 'requested_by__staff__user'
    ).all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrAdmin]
    filterset_fields = ['status', 'treatment_entry', 'requested_by']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'create':
            return SupplyRequestCreateSerializer
        elif self.action == 'list':
            return SupplyRequestListSerializer
        return SupplyRequestSerializer

    def get_queryset(self):
        """Override to add filtering."""
        facility = get_user_facility(self.request)
        if not facility:
            return SupplyRequest.objects.none()

        queryset = _scope_nursing_patient_queryset(
            self.request,
            super().get_queryset(),
            patient_lookup='treatment_entry__patient',
        )

        if getattr(self.request.user, 'user_type', None) == 'nurse':
            practitioner = _get_request_practitioner(self.request.user)
            if not practitioner:
                return queryset.none()
            queryset = queryset.filter(requested_by=practitioner)

        # Filter by patient
        patient_id = self.request.query_params.get('patient_id')
        if patient_id:
            queryset = queryset.filter(treatment_entry__patient_id=patient_id)

        # Filter by admission
        admission_id = self.request.query_params.get('admission_id')
        if admission_id:
            queryset = queryset.filter(treatment_entry__admission_id=admission_id)

        return queryset.order_by('-requested_at')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        treatment_entry = serializer.validated_data.get('treatment_entry')
        patient = getattr(treatment_entry, 'patient', None)
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(self.request.user, patient)
        serializer.save(
            requested_by=_get_request_practitioner(self.request.user),
            facility=facility
        )

    @action(detail=False, methods=['get'], url_path='pending-queue')
    def pending_queue(self, request):
        """
        Get all pending supply requests for the current user's requests.
        Nurses can view status of their supply requests.

        Note: Pharmacy dispensing actions have moved to /api/pharmacy/supply-requests/
        """
        from apps.pharmacy.services import get_pending_supply_requests

        patient_id = request.query_params.get('patient_id')
        admission_id = request.query_params.get('admission_id')

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return Response(
                    {"error": "Patient not found"},
                    status=status.HTTP_404_NOT_FOUND
                )
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_clinical_access(request.user, patient)
        requests = get_pending_supply_requests(
            patient_id=patient_id,
            admission_id=admission_id,
            facility=facility,
        )

        if getattr(request.user, 'user_type', None) == 'nurse':
            practitioner = _get_request_practitioner(request.user)
            if not practitioner:
                return Response([])
            requests = requests.filter(requested_by=practitioner)

        serializer = SupplyRequestListSerializer(requests, many=True)
        return Response(serializer.data)


class FluidBalanceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for fluid balance tracking.

    Endpoints:
    - GET /api/nursing/fluid-balance/ - List entries (filtered by patient)
    - POST /api/nursing/fluid-balance/ - Create entry
    - GET /api/nursing/fluid-balance/{id}/ - Retrieve entry
    - PUT/PATCH /api/nursing/fluid-balance/{id}/ - Update entry
    - DELETE /api/nursing/fluid-balance/{id}/ - Soft delete entry
    - GET /api/nursing/fluid-balance/patient_summary/ - Daily totals for patient
    - GET /api/nursing/fluid-balance/today_balance/ - Today's balance for patient

    All actions are fully audited for compliance.
    """
    queryset = FluidBalance.objects.select_related(
        'patient', 'patient__user', 'recorded_by', 'admission', 'created_by', 'modified_by'
    ).all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsNurseOrDoctor]
    filterset_fields = ['patient', 'admission', 'entry_type', 'category']
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return FluidBalanceCreateSerializer
        elif self.action == 'list':
            return FluidBalanceListSerializer
        elif self.action in ['patient_summary', 'today_balance']:
            return FluidBalanceSummarySerializer
        return FluidBalanceSerializer

    def get_queryset(self):
        """Override to add date filtering and exclude soft-deleted entries."""
        queryset = _scope_nursing_patient_queryset(self.request, super().get_queryset())

        # Exclude soft-deleted entries by default
        include_deleted = self.request.query_params.get('include_deleted', 'false').lower() == 'true'
        if not include_deleted:
            queryset = queryset.filter(is_deleted=False)

        # Filter by date
        date_str = self.request.query_params.get('date')
        if date_str:
            try:
                from datetime import datetime
                filter_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                start_dt = timezone.make_aware(
                    datetime.combine(filter_date, datetime.min.time()),
                    timezone.get_current_timezone()
                )
                end_dt = start_dt + timedelta(days=1)
                queryset = queryset.filter(recorded_at__gte=start_dt, recorded_at__lt=end_dt)
            except ValueError:
                pass  # Invalid date format, ignore filter

        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if start_date:
            queryset = queryset.filter(recorded_at__gte=start_date)
        if end_date:
            queryset = queryset.filter(recorded_at__lte=end_date)

        return queryset

    def perform_create(self, serializer):
        """Set recorded_by and created_by on creation, and log audit trail."""
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(self.request.user, patient)
        recorded_by = None
        try:
            recorded_by = PractitionerProfile.objects.get(staff__user=self.request.user)
        except PractitionerProfile.DoesNotExist:
            pass

        instance = serializer.save(
            recorded_by=recorded_by,
            created_by=self.request.user,
            facility=facility
        )

        # Audit logging
        action = (AuditAction.FLUID_INTAKE_RECORD
                  if instance.entry_type == 'intake'
                  else AuditAction.FLUID_OUTPUT_RECORD)
        AuditService.log_fluid_balance(self.request, instance, action)

    def perform_update(self, serializer):
        """Track modifications and log audit trail."""
        # Capture old values for audit
        instance = self.get_object()
        old_values = {
            'entry_type': instance.entry_type,
            'category': instance.category,
            'subcategory': instance.subcategory,
            'volume_ml': instance.volume_ml,
            'notes': instance.notes,
        }

        # Save with modified_by
        instance = serializer.save(modified_by=self.request.user)

        # Calculate changes
        new_values = {
            'entry_type': instance.entry_type,
            'category': instance.category,
            'subcategory': instance.subcategory,
            'volume_ml': instance.volume_ml,
            'notes': instance.notes,
        }
        changes = {
            k: {'old': old_values[k], 'new': new_values[k]}
            for k in old_values
            if old_values[k] != new_values[k]
        }

        # Audit logging
        AuditService.log_fluid_balance(
            self.request, instance, AuditAction.FLUID_BALANCE_UPDATE, changes=changes
        )

    def perform_destroy(self, instance):
        """Soft delete with audit trail instead of hard delete."""
        # Audit logging before soft delete
        AuditService.log_fluid_balance(
            self.request, instance, AuditAction.FLUID_BALANCE_DELETE
        )

        # Soft delete
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.deletion_reason = self.request.data.get('reason', 'No reason provided')
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'deletion_reason'])

    @action(detail=False, methods=['get'])
    def patient_summary(self, request):
        """
        Get daily fluid balance summary for a patient.

        Query params:
        - patient (required): Patient ID
        - date (optional): Date for summary (default: today)
        """
        patient_id = request.query_params.get('patient')
        if not patient_id:
            return Response(
                {'error': 'patient parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        # SECURITY: Check if user has permission to access this patient
        check_clinical_access(request.user, patient_id)
        patient = PatientProfile.objects.get(id=patient_id)
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")

        # Get date (default to today)
        date_str = request.query_params.get('date')
        if date_str:
            try:
                filter_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                return Response(
                    {'error': 'Invalid date format. Use YYYY-MM-DD'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            filter_date = timezone.now().date()

        start_dt = timezone.make_aware(
            datetime.combine(filter_date, datetime.min.time()),
            timezone.get_current_timezone()
        )
        end_dt = start_dt + timedelta(days=1)
        entries = FluidBalance.objects.filter(
            patient=patient,
            recorded_at__gte=start_dt,
            recorded_at__lt=end_dt,
            is_deleted=False
        )

        # Use database aggregation instead of Python sum (N+1 fix)
        # Single query with conditional aggregation for totals + breakdown
        totals = entries.aggregate(
            total_intake=Sum(Case(When(entry_type='intake', then='volume_ml'))),
            total_output=Sum(Case(When(entry_type='output', then='volume_ml'))),
        )
        total_intake = totals['total_intake'] or 0
        total_output = totals['total_output'] or 0
        balance = total_intake - total_output

        # Calculate breakdown by category
        intake_breakdown = dict(
            entries.filter(entry_type='intake').values('category').annotate(
                total=Sum('volume_ml')
            ).values_list('category', 'total')
        )
        output_breakdown = dict(
            entries.filter(entry_type='output').values('category').annotate(
                total=Sum('volume_ml')
            ).values_list('category', 'total')
        )

        return Response({
            'patient': patient_id,
            'date': filter_date,
            'total_intake': total_intake,
            'total_output': total_output,
            'balance': balance,
            'intake_breakdown': intake_breakdown,
            'output_breakdown': output_breakdown
        })

    @action(detail=False, methods=['get'])
    def today_balance(self, request):
        """
        Get today's fluid balance for a patient.
        Convenience endpoint that defaults to today's date.

        Query params:
        - patient (required): Patient ID
        """
        patient_id = request.query_params.get('patient')
        if not patient_id:
            return Response(
                {'error': 'patient parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        # SECURITY: Check if user has permission to access this patient
        check_clinical_access(request.user, patient_id)
        patient = PatientProfile.objects.get(id=patient_id)
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")

        today = timezone.now().date()

        # Calculate totals using database aggregation (N+1 fix)
        start_dt = timezone.make_aware(
            datetime.combine(today, datetime.min.time()),
            timezone.get_current_timezone()
        )
        end_dt = start_dt + timedelta(days=1)
        entries = FluidBalance.objects.filter(
            patient=patient,
            recorded_at__gte=start_dt,
            recorded_at__lt=end_dt,
            is_deleted=False
        )

        totals = entries.aggregate(
            total_intake=Sum(Case(When(entry_type='intake', then='volume_ml'))),
            total_output=Sum(Case(When(entry_type='output', then='volume_ml'))),
        )
        total_intake = totals['total_intake'] or 0
        total_output = totals['total_output'] or 0
        balance = total_intake - total_output

        return Response({
            'patient': patient_id,
            'date': today,
            'total_intake': total_intake,
            'total_output': total_output,
            'balance': balance
        })

    @action(detail=False, methods=['get'])
    def check_alerts(self, request):
        """
        Check if patient's fluid balance triggers any configured alerts.

        Query params:
        - patient (required): Patient ID
        - date (optional): Date to check (default: today)

        Returns:
        {
            alerts: [
                { type: 'low_intake', message: '...', severity: 'warning' },
                { type: 'high_output', message: '...', severity: 'warning' },
                { type: 'negative_balance', message: '...', severity: 'critical' },
            ],
            thresholds: { ... current facility thresholds ... },
            summary: { total_intake, total_output, balance }
        }
        """
        from apps.core.models import FacilityFluidBalanceSettings

        patient_id = request.query_params.get('patient')
        if not patient_id:
            return Response(
                {'error': 'patient parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # SECURITY: Check if user has permission to access this patient
        check_clinical_access(request.user, patient_id)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = PatientProfile.objects.get(id=patient_id)
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")

        # Get date (default to today)
        date_str = request.query_params.get('date')
        if date_str:
            try:
                filter_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                return Response(
                    {'error': 'Invalid date format. Use YYYY-MM-DD'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            filter_date = timezone.now().date()

        # Get facility settings
        settings = FacilityFluidBalanceSettings.get_settings()

        # Calculate totals using database aggregation (N+1 fix)
        start_dt = timezone.make_aware(
            datetime.combine(filter_date, datetime.min.time()),
            timezone.get_current_timezone()
        )
        end_dt = start_dt + timedelta(days=1)
        entries = FluidBalance.objects.filter(
            patient_id=patient_id,
            recorded_at__gte=start_dt,
            recorded_at__lt=end_dt,
            is_deleted=False
        )

        totals = entries.aggregate(
            total_intake=Sum(Case(When(entry_type='intake', then='volume_ml'))),
            total_output=Sum(Case(When(entry_type='output', then='volume_ml'))),
        )
        total_intake = totals['total_intake'] or 0
        total_output = totals['total_output'] or 0
        balance = total_intake - total_output

        # Check alerts based on thresholds
        alerts = []

        # Check low intake alert
        if settings.enable_intake_alerts and total_intake < settings.min_daily_intake_target:
            alerts.append({
                'type': 'low_intake',
                'message': f'Daily intake ({total_intake}ml) is below minimum target ({settings.min_daily_intake_target}ml)',
                'severity': 'warning',
                'value': total_intake,
                'threshold': settings.min_daily_intake_target
            })

        # Check high output alert
        if settings.enable_output_alerts and total_output > settings.max_daily_output_threshold:
            alerts.append({
                'type': 'high_output',
                'message': f'Daily output ({total_output}ml) exceeds maximum threshold ({settings.max_daily_output_threshold}ml)',
                'severity': 'warning',
                'value': total_output,
                'threshold': settings.max_daily_output_threshold
            })

        # Check balance alerts
        if settings.enable_balance_alerts:
            if balance < settings.negative_balance_alert_threshold:
                alerts.append({
                    'type': 'negative_balance',
                    'message': f'Fluid balance ({balance}ml) is critically low (threshold: {settings.negative_balance_alert_threshold}ml)',
                    'severity': 'critical',
                    'value': balance,
                    'threshold': settings.negative_balance_alert_threshold
                })
            elif balance > settings.positive_balance_alert_threshold:
                alerts.append({
                    'type': 'positive_balance',
                    'message': f'Fluid balance ({balance}ml) exceeds retention threshold ({settings.positive_balance_alert_threshold}ml)',
                    'severity': 'warning',
                    'value': balance,
                    'threshold': settings.positive_balance_alert_threshold
                })

        return Response({
            'patient': patient_id,
            'date': filter_date,
            'alerts': alerts,
            'thresholds': {
                'min_daily_intake_target': settings.min_daily_intake_target,
                'max_daily_output_threshold': settings.max_daily_output_threshold,
                'negative_balance_alert_threshold': settings.negative_balance_alert_threshold,
                'positive_balance_alert_threshold': settings.positive_balance_alert_threshold,
                'enable_intake_alerts': settings.enable_intake_alerts,
                'enable_output_alerts': settings.enable_output_alerts,
                'enable_balance_alerts': settings.enable_balance_alerts,
            },
            'summary': {
                'total_intake': total_intake,
                'total_output': total_output,
                'balance': balance
            }
        })
