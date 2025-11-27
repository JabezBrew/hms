from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q, Prefetch
from django.db import transaction
from django.utils import timezone
from datetime import timedelta
import logging

from .models import VitalSigns, NursingTask, NursingAlert, MedicationAdministration, ShiftHandoff
from .serializers import (
    VitalSignsSerializer, VitalSignsCreateSerializer,
    NursingTaskSerializer, NursingTaskCreateSerializer, NursingTaskUpdateSerializer,
    NursingAlertSerializer, NursingAlertAcknowledgeSerializer,
    MedicationAdministrationSerializer, MedicationAdministrationCreateSerializer,
    MedicationAdministrationUpdateSerializer, MedicationDispensingListSerializer,
    ShiftHandoffSerializer,
    PatientMonitoringSerializer
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

            serializer = PatientMonitoringSerializer(monitoring_data, many=True)

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
