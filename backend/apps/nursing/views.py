from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q, Prefetch
from django.db import transaction
from django.utils import timezone
from datetime import timedelta
import logging

from .models import (
    VitalSigns, NursingTask, NursingAlert, MedicationAdministration,
    ShiftHandoff, TreatmentSheetEntry, SupplyRequest
)
from .serializers import (
    VitalSignsSerializer, VitalSignsCreateSerializer, VitalSignsListSerializer,
    NursingTaskSerializer, NursingTaskCreateSerializer, NursingTaskUpdateSerializer,
    NursingTaskListSerializer,
    NursingAlertSerializer, NursingAlertAcknowledgeSerializer, NursingAlertListSerializer,
    MedicationAdministrationSerializer, MedicationAdministrationCreateSerializer,
    MedicationAdministrationUpdateSerializer, MedicationAdministrationListSerializer,
    MedicationDispensingListSerializer,
    ShiftHandoffSerializer, ShiftHandoffListSerializer,
    PatientMonitoringSerializer, PatientMonitoringListSerializer,
    TreatmentSheetEntrySerializer, TreatmentSheetEntryListSerializer,
    TreatmentSheetEntryCreateSerializer,
    SupplyRequestSerializer, SupplyRequestListSerializer, SupplyRequestCreateSerializer
)
from .permissions import IsNurseOrAdmin, IsNurseOrDoctor
from ..wards.models import Admission
from ..wards.services import ensure_encounter_for_entry
from ..users.models import PatientProfile, PractitionerProfile
from ..audit.services import AuditService
from ..audit.models import AuditCategory, AuditAction

logger = logging.getLogger(__name__)


class VitalSignsViewSet(viewsets.ModelViewSet):
    """
    API endpoint for vital signs management.
    """
    queryset = VitalSigns.objects.select_related('patient', 'patient__user', 'recorded_by').all()
    permission_classes = [permissions.IsAuthenticated, IsNurseOrDoctor]
    filterset_fields = ['patient', 'recorded_by', 'is_critical']

    def get_serializer_class(self):
        if self.action == 'create':
            return VitalSignsCreateSerializer
        elif self.action == 'list':
            return VitalSignsListSerializer
        return VitalSignsSerializer

    def get_queryset(self):
        """Override to add date filtering."""
        queryset = super().get_queryset()

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
        vital_signs = serializer.save()

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

        # Return full serializer data with encounter_created flag
        output_serializer = VitalSignsSerializer(vital_signs)
        response_data = output_serializer.data
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

        days = int(request.query_params.get('days', 7))
        start_date = timezone.now() - timedelta(days=days)

        vitals = VitalSigns.objects.filter(
            patient_id=patient_id,
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
    permission_classes = [permissions.IsAuthenticated, IsNurseOrAdmin]
    filterset_fields = ['patient', 'assigned_to', 'status', 'priority', 'task_type']

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
        queryset = super().get_queryset()

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
            if hasattr(self.request.user, 'practitioner_profile'):
                queryset = queryset.filter(assigned_to=self.request.user.practitioner_profile)

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

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
    permission_classes = [permissions.IsAuthenticated, IsNurseOrAdmin]
    filterset_fields = ['patient', 'alert_type', 'severity', 'is_acknowledged']

    def get_serializer_class(self):
        if self.action == 'list':
            return NursingAlertListSerializer
        return NursingAlertSerializer

    def get_queryset(self):
        """Override to show unacknowledged alerts by default."""
        queryset = super().get_queryset()

        # Show only unacknowledged alerts by default
        show_all = self.request.query_params.get('show_all')
        if not show_all or show_all.lower() != 'true':
            queryset = queryset.filter(is_acknowledged=False)

        return queryset

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
    """
    queryset = MedicationAdministration.objects.select_related(
        'patient', 'patient__user', 'administered_by', 'prescribed_by', 'created_by'
    ).all()
    permission_classes = [permissions.IsAuthenticated, IsNurseOrDoctor]
    filterset_fields = ['patient', 'status', 'administered_by']

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
        queryset = super().get_queryset()

        # Filter by scheduled date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if start_date:
            queryset = queryset.filter(scheduled_time__gte=start_date)
        if end_date:
            queryset = queryset.filter(scheduled_time__lte=end_date)

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

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
    def pending_dispensing(self, request):
        """
        Get medications awaiting pharmacy dispensing.
        Pharmacists use this to see what needs to be dispensed.
        Uses lightweight serializer to reduce payload size.
        """
        patient_id = request.query_params.get('patient')

        from .services import get_pending_dispensing
        medications = get_pending_dispensing(patient_id)

        # Use lightweight serializer for dispensing queue
        serializer = MedicationDispensingListSerializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def ready_for_admin(self, request):
        """
        Get medications that are dispensed and ready for nurse administration.
        Uses lightweight serializer to reduce payload size.
        """
        patient_id = request.query_params.get('patient')

        from .services import get_dispensed_ready_for_admin
        medications = get_dispensed_ready_for_admin(patient_id)

        # Use lightweight serializer
        serializer = MedicationDispensingListSerializer(medications, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def dispense(self, request, pk=None):
        """
        Mark a medication as dispensed by pharmacy.
        Only pharmacists can dispense medications.
        """
        if request.user.user_type not in ['pharmacist', 'admin']:
            return Response(
                {'error': 'Only pharmacists can dispense medications'},
                status=status.HTTP_403_FORBIDDEN
            )

        med_admin = self.get_object()

        if med_admin.is_dispensed:
            return Response(
                {'error': 'Medication already dispensed'},
                status=status.HTTP_400_BAD_REQUEST
            )

        from .services import dispense_medication
        med_admin = dispense_medication(med_admin, request.user)

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

        return Response(MedicationAdministrationSerializer(med_admin).data)

    @action(detail=False, methods=['post'])
    def dispense_bulk(self, request):
        """
        Bulk dispense multiple medications.
        Only pharmacists can dispense medications.
        """
        if request.user.user_type not in ['pharmacist', 'admin']:
            return Response(
                {'error': 'Only pharmacists can dispense medications'},
                status=status.HTTP_403_FORBIDDEN
            )

        medication_ids = request.data.get('medication_ids', [])
        if not medication_ids:
            return Response(
                {'error': 'medication_ids is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        from .services import dispense_medication

        dispensed = []
        errors = []

        for med_id in medication_ids:
            try:
                med_admin = MedicationAdministration.objects.get(id=med_id)
                if not med_admin.is_dispensed:
                    dispense_medication(med_admin, request.user)
                    dispensed.append(str(med_id))
                else:
                    errors.append({'id': str(med_id), 'error': 'Already dispensed'})
            except MedicationAdministration.DoesNotExist:
                errors.append({'id': str(med_id), 'error': 'Not found'})

        return Response({
            'dispensed': dispensed,
            'dispensed_count': len(dispensed),
            'errors': errors
        })

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
            patient_id=patient_id,
            scheduled_time__gte=start_datetime,
            scheduled_time__lte=end_datetime
        ).order_by('scheduled_time')

        serializer = self.get_serializer(medications, many=True)
        return Response({
            'date': str(target_date),
            'patient_id': patient_id,
            'medications': serializer.data,
            'summary': {
                'total': medications.count(),
                'scheduled': medications.filter(status='scheduled').count(),
                'administered': medications.filter(status='administered').count(),
                'missed': medications.filter(status='missed').count(),
                'held': medications.filter(status='held').count(),
                'refused': medications.filter(status='refused').count(),
            }
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
        from apps.wards.models import Admission, Encounter
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
                        status='admitted'
                    ).select_related('patient', 'patient__user').first()
            except Encounter.DoesNotExist:
                pass

        if not admission:
            return Response(
                {'error': 'Admission not found'},
                status=status.HTTP_404_NOT_FOUND
            )

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
    permission_classes = [permissions.IsAuthenticated, IsNurseOrAdmin]
    filterset_fields = ['patient', 'shift_date', 'shift_type', 'from_nurse', 'to_nurse']

    def get_serializer_class(self):
        if self.action == 'list':
            return ShiftHandoffListSerializer
        return ShiftHandoffSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

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
    max_page_size = 100


class PatientMonitoringViewSet(viewsets.ViewSet):
    """
    API endpoint for patient monitoring dashboard.
    Provides consolidated view of patient status, vitals, alerts, tasks, and medications.
    """
    permission_classes = [permissions.IsAuthenticated, IsNurseOrAdmin]
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
        """
        try:
            # Get query parameters with error handling
            ward_id = request.query_params.get('ward')
            show_all = request.query_params.get('show_all', 'false').lower() == 'true'

            try:
                page = int(request.query_params.get('page', 1))
                page_size = int(request.query_params.get('page_size', 20))
            except (ValueError, TypeError):
                page = 1
                page_size = 20

            # Get currently admitted patients with optimized query
            admissions = Admission.objects.filter(status='admitted').select_related(
                'patient__user',  # Use double underscore for nested relations
                'bed__ward',
                'admitting_doctor__staff__user'
            ).order_by('-admission_date')  # Most recent first

            # Filter by ward if specified
            if ward_id:
                admissions = admissions.filter(bed__ward_id=ward_id)

            # Get total count before pagination
            total_count = admissions.count()

            # Apply pagination
            start = (page - 1) * page_size
            end = start + page_size
            admissions = admissions[start:end]

            monitoring_data = []

            for admission in admissions:
                patient = admission.patient

                # Get latest vital signs (within last 24 hours)
                latest_vitals = VitalSigns.objects.filter(
                    patient=patient,
                    recorded_at__gte=timezone.now() - timedelta(hours=24)
                ).select_related('recorded_by').order_by('-recorded_at').first()

                # Get active alerts
                active_alerts = NursingAlert.objects.filter(
                    patient=patient,
                    is_acknowledged=False
                ).select_related('patient__user').order_by('-severity', '-created_at')[:5]

                # Get pending tasks for today
                today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
                today_end = today_start + timedelta(days=1)
                pending_tasks = NursingTask.objects.filter(
                    patient=patient,
                    status__in=['pending', 'overdue'],
                    scheduled_time__gte=today_start,
                    scheduled_time__lt=today_end
                ).order_by('scheduled_time')[:10]

                # Get medications due in next 2 hours
                now = timezone.now()
                two_hours_later = now + timedelta(hours=2)
                medications_due = MedicationAdministration.objects.filter(
                    patient=patient,
                    status='scheduled',
                    scheduled_time__gte=now,
                    scheduled_time__lte=two_hours_later
                ).order_by('scheduled_time')[:10]

                monitoring_data.append({
                    'patient': patient,
                    'admission': admission,
                    'latest_vitals': latest_vitals,
                    'active_alerts': active_alerts,
                    'pending_tasks': pending_tasks,
                    'medications_due': medications_due
                })

            # Use lightweight list serializer for dashboard (97% payload reduction)
            serializer = PatientMonitoringListSerializer(monitoring_data, many=True)

            # Return paginated response
            return Response({
                'count': total_count,
                'page': page,
                'page_size': page_size,
                'total_pages': (total_count + page_size - 1) // page_size,
                'results': serializer.data
            })

        except Exception as e:
            # Log the error and return a proper error response
            import traceback
            error_details = traceback.format_exc()
            print(f"Error in patient monitoring dashboard: {str(e)}")
            print(error_details)

            return Response({
                'error': 'Failed to fetch patient monitoring data',
                'detail': str(e),
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

        # Get current admission
        admission = Admission.objects.filter(
            patient=patient,
            status='admitted'
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
    permission_classes = [permissions.IsAuthenticated, IsNurseOrDoctor]
    filterset_fields = ['patient', 'admission', 'status', 'ordered_by']

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'create':
            return TreatmentSheetEntryCreateSerializer
        elif self.action == 'list':
            return TreatmentSheetEntryListSerializer
        return TreatmentSheetEntrySerializer

    def get_queryset(self):
        """Override to add filtering."""
        queryset = super().get_queryset()

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

        # Use service to create entry with MAR generation
        from .services import create_treatment_entry_with_mar

        treatment_data = serializer.validated_data
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

        from apps.wards.models import Admission, Encounter

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
                    status='admitted'
                ).select_related('patient', 'patient__user', 'bed', 'bed__ward').first()
            except Encounter.DoesNotExist:
                pass

        if not admission:
            return Response(
                {'error': 'Admission not found. Please ensure patient is currently admitted.'},
                status=status.HTTP_404_NOT_FOUND
            )

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
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['status', 'treatment_entry', 'requested_by']

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'create':
            return SupplyRequestCreateSerializer
        elif self.action == 'list':
            return SupplyRequestListSerializer
        return SupplyRequestSerializer

    def get_queryset(self):
        """Override to add filtering."""
        queryset = super().get_queryset()

        # Filter by patient
        patient_id = self.request.query_params.get('patient_id')
        if patient_id:
            queryset = queryset.filter(treatment_entry__patient_id=patient_id)

        # Filter by admission
        admission_id = self.request.query_params.get('admission_id')
        if admission_id:
            queryset = queryset.filter(treatment_entry__admission_id=admission_id)

        return queryset.order_by('-requested_at')

    @action(detail=False, methods=['get'], url_path='pending-queue')
    def pending_queue(self, request):
        """
        Get all pending supply requests.
        Used by pharmacy to see what needs to be dispensed.
        """
        from .services import get_pending_supply_requests

        patient_id = request.query_params.get('patient_id')
        admission_id = request.query_params.get('admission_id')

        requests = get_pending_supply_requests(
            patient_id=patient_id,
            admission_id=admission_id
        )

        serializer = SupplyRequestListSerializer(requests, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def dispense(self, request, pk=None):
        """
        Dispense a supply request (pharmacy action).

        Request body:
        - quantity_dispensed: Actual quantity dispensed (optional, defaults to quantity_requested)
        """
        supply_request = self.get_object()

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

        # Dispense using service
        from .services import dispense_supply_request

        supply_request = dispense_supply_request(
            supply_request=supply_request,
            quantity_dispensed=quantity_dispensed,
            dispensed_by=request.user
        )

        # Audit log
        AuditService.log_action(
            user=request.user,
            action=AuditAction.UPDATE,
            category=AuditCategory.PHARMACY,
            resource_type='SupplyRequest',
            resource_id=str(supply_request.id),
            details=f"Dispensed {quantity_dispensed} doses of {supply_request.treatment_entry.medication_name}"
        )

        serializer = SupplyRequestSerializer(supply_request)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """
        Reject a supply request (pharmacy action).

        Request body:
        - reason: Reason for rejection (required)
        """
        supply_request = self.get_object()

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

        # Reject using service
        from .services import reject_supply_request

        supply_request = reject_supply_request(
            supply_request=supply_request,
            rejection_reason=reason,
            rejected_by=request.user
        )

        # Audit log
        AuditService.log_action(
            user=request.user,
            action=AuditAction.UPDATE,
            category=AuditCategory.PHARMACY,
            resource_type='SupplyRequest',
            resource_id=str(supply_request.id),
            details=f"Rejected supply request for {supply_request.treatment_entry.medication_name}: {reason}"
        )

        serializer = SupplyRequestSerializer(supply_request)
        return Response(serializer.data)

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

                from .services import dispense_supply_request
                dispense_supply_request(
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
        AuditService.log_action(
            user=request.user,
            action=AuditAction.UPDATE,
            category=AuditCategory.PHARMACY,
            resource_type='SupplyRequest',
            resource_id='bulk',
            details=f"Bulk dispensed {dispensed_count} supply requests"
        )

        return Response({
            'dispensed_count': dispensed_count,
            'errors': errors
        })
