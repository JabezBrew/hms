from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db.models import Q
from django.utils.dateparse import parse_datetime
import logging

from .models import (
    Referral,
    ReferralStatus,
    ReferralNotification,
    ReferralNotificationEvent,
    ReferralSLAPolicy,
    ReferralSLAEvent,
    ClinicWaitlistEntry,
    ClinicWaitlistEntryStatus,
)
from .serializers import (
    ReferralSerializer, ReferralCreateSerializer,
    ReferralSubmitSerializer, ReferralAcceptSerializer,
    ReferralDeclineSerializer, ReferralScheduleSerializer,
    ReferralCompleteSerializer, ReferralResponseSerializer,
    ReferralSearchSerializer, ReferralListSerializer, ReferralNotificationSerializer,
    ReferralSLAPolicySerializer, ReferralSLAPolicyListSerializer,
    ReferralSLAEventListSerializer,
    ClinicWaitlistEntrySerializer, ClinicWaitlistEntryListSerializer,
)
from ..users.permissions import IsAdminOrDoctor
from ..workflows.engines import ConsultationEngine
from .notifications import create_referral_notifications
from .tasks import send_referral_status_update
from .services import ReferralSLAService, ClinicWaitlistService
from ..encounters.models import Encounter
from ..appointments.models import AppointmentType
from apps.organization.models import Clinic
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import (
    FacilityScopedPermission,
    check_clinical_access,
    get_accessible_patients_for_clinician,
    get_user_facility,
)
from apps.users.models import PatientProfile, PractitionerProfile
from apps.users.rbac import IsAdmin, IsDoctor, IsNurse, IsReceptionist
from rest_framework.exceptions import PermissionDenied

logger = logging.getLogger(__name__)

class ReferralViewSet(viewsets.ModelViewSet):
    """
    API endpoint for referrals with workflow management.
    """
    queryset = Referral.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrDoctor]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return ReferralCreateSerializer
        elif self.action == 'submit':
            return ReferralSubmitSerializer
        elif self.action == 'accept':
            return ReferralAcceptSerializer
        elif self.action == 'decline':
            return ReferralDeclineSerializer
        elif self.action == 'schedule':
            return ReferralScheduleSerializer
        elif self.action == 'complete':
            return ReferralCompleteSerializer
        elif self.action in ['inbox', 'sent']:
            return ReferralListSerializer
        return ReferralSerializer

    def _get_practitioner(self):
        return PractitionerProfile.objects.filter(staff__user=self.request.user).first()

    def _get_inbox_unassigned_filters(self, practitioner):
        if not practitioner:
            return Q(pk__in=[])

        match_filters = Q(pk__in=[])
        has_route_match = False
        department = getattr(practitioner.staff, 'department', '')
        if department:
            match_filters |= Q(referred_to_department__iexact=department)
            has_route_match = True
        specialization = getattr(practitioner, 'specialization', '')
        if specialization:
            match_filters |= Q(referred_to_specialty__iexact=specialization)
            has_route_match = True

        if not has_route_match:
            return Q(pk__in=[])

        return Q(
            referred_to_provider__isnull=True,
            status=ReferralStatus.PENDING,
        ) & match_filters

    def _get_inbox_queryset(self, practitioner):
        return self.get_queryset().filter(
            Q(referred_to_provider=practitioner) |
            self._get_inbox_unassigned_filters(practitioner)
        ).exclude(
            status__in=[
                ReferralStatus.DRAFT,
                ReferralStatus.COMPLETED,
                ReferralStatus.DECLINED,
                ReferralStatus.CANCELLED,
            ]
        )

    def get_queryset(self):
        """
        Filter referrals with optimized queries.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return Referral.objects.none()

        queryset = Referral.objects.select_related(
            'patient__user',
            'referring_provider__staff__user',
            'referred_to_provider__staff__user',
            'encounter'
        ).filter(facility=facility)
        user = self.request.user

        if getattr(user, 'user_type', None) != 'admin':
            practitioner = self._get_practitioner()
            access_filters = Q(pk__in=[])

            if not getattr(settings, 'TEAM_ACCESS_STRICT', False):
                access_filters = Q()
            else:
                accessible_patients = get_accessible_patients_for_clinician(user)
                access_filters |= Q(patient__in=accessible_patients)

            if practitioner:
                access_filters |= Q(referring_provider=practitioner)
                access_filters |= Q(referred_to_provider=practitioner)
                access_filters |= self._get_inbox_unassigned_filters(practitioner)

            queryset = queryset.filter(access_filters).distinct()

        # Filter by patient
        patient_id = self.request.query_params.get('patient')
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return queryset.none()
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_clinical_access(self.request.user, patient)
            queryset = queryset.filter(patient_id=patient_id)

        # Filter by referring provider
        referring_provider_id = self.request.query_params.get('referring_provider')
        if referring_provider_id:
            queryset = queryset.filter(referring_provider_id=referring_provider_id)

        # Filter by referred-to provider
        referred_to_provider_id = self.request.query_params.get('referred_to_provider')
        if referred_to_provider_id:
            queryset = queryset.filter(referred_to_provider_id=referred_to_provider_id)

        # Filter by department
        department = self.request.query_params.get('department')
        if department:
            queryset = queryset.filter(referred_to_department__icontains=department)

        # Filter by specialty
        specialty = self.request.query_params.get('specialty')
        if specialty:
            queryset = queryset.filter(referred_to_specialty__icontains=specialty)

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by urgency
        urgency = self.request.query_params.get('urgency')
        if urgency:
            queryset = queryset.filter(urgency=urgency)

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(submitted_at__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(submitted_at__lte=date_to)

        # Filter for pending only
        pending_only = self.request.query_params.get('pending_only')
        if pending_only and pending_only.lower() == 'true':
            queryset = queryset.filter(
                status__in=[ReferralStatus.PENDING, ReferralStatus.ACCEPTED, ReferralStatus.SCHEDULED]
            )

        # Filter for urgent only
        urgent_only = self.request.query_params.get('urgent_only')
        if urgent_only and urgent_only.lower() == 'true':
            queryset = queryset.filter(urgency__in=['urgent', 'emergency'])

        return queryset.order_by('-created_at')

    @transaction.atomic
    def perform_create(self, serializer):
        """Create referral with referring provider set to current user."""
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(self.request.user, patient)
        encounter = serializer.validated_data.get('encounter')
        if encounter and encounter.facility_id != facility.id:
            raise PermissionDenied("Encounter does not belong to the active facility.")

        # If referring_provider not specified, use current user
        if not serializer.validated_data.get('referring_provider'):
            try:
                practitioner = self.request.user.staff_profile.practitioner_profile
                serializer.save(referring_provider=practitioner, facility=facility)
            except AttributeError:
                # Current user is not a practitioner - raise error
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Only practitioners can create referrals. Your account is not linked to a practitioner profile.")
        else:
            serializer.save(facility=facility)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def submit(self, request, pk=None):
        """
        Submit referral (transition from draft to pending).
        Sets submitted_at timestamp.
        """
        referral = self.get_object()

        if referral.status != ReferralStatus.DRAFT:
            return Response(
                {'error': f'Cannot submit referral in {referral.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Update status
        referral.status = ReferralStatus.PENDING
        referral.submitted_at = timezone.now()
        referral.save()
        ReferralSLAService.evaluate_referral(referral)

        transaction.on_commit(
            lambda: create_referral_notifications(
                referral,
                ReferralNotificationEvent.SUBMITTED,
                actor=request.user
            )
        )

        logger.info(
            f"Referral {referral.referral_number} submitted by {request.user.get_full_name()} "
            f"to {referral.referred_to_department}"
        )

        serializer = self.get_serializer(referral)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def accept(self, request, pk=None):
        """
        Accept a referral (specialist accepts).
        """
        referral = self.get_object()

        if referral.status != ReferralStatus.PENDING:
            return Response(
                {'error': f'Cannot accept referral in {referral.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get practitioner profile
        try:
            practitioner = request.user.staff_profile.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners can accept referrals'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Validate acceptance data
        accept_serializer = ReferralAcceptSerializer(data=request.data)
        accept_serializer.is_valid(raise_exception=True)

        # Update referral
        referral.status = ReferralStatus.ACCEPTED
        referral.accepted_at = timezone.now()
        referral.referred_to_provider = practitioner

        # Add acceptance notes to specialist notes if provided
        acceptance_notes = accept_serializer.validated_data.get('acceptance_notes', '')
        if acceptance_notes:
            referral.specialist_notes = f"[Acceptance Notes]\n{acceptance_notes}\n\n{referral.specialist_notes}"

        referral.save()
        ReferralSLAService.evaluate_referral(referral)

        transaction.on_commit(
            lambda: create_referral_notifications(
                referral,
                ReferralNotificationEvent.ACCEPTED,
                actor=request.user
            )
        )

        logger.info(
            f"Referral {referral.referral_number} accepted by {request.user.get_full_name()}"
        )

        serializer = self.get_serializer(referral)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def decline(self, request, pk=None):
        """
        Decline a referral with reason.
        """
        referral = self.get_object()

        if referral.status not in [ReferralStatus.PENDING, ReferralStatus.ACCEPTED]:
            return Response(
                {'error': f'Cannot decline referral in {referral.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate decline request
        decline_serializer = ReferralDeclineSerializer(data=request.data)
        decline_serializer.is_valid(raise_exception=True)

        # Update referral
        referral.status = ReferralStatus.DECLINED
        referral.declined_at = timezone.now()
        referral.decline_reason = decline_serializer.validated_data['decline_reason']
        referral.save()

        transaction.on_commit(
            lambda: create_referral_notifications(
                referral,
                ReferralNotificationEvent.DECLINED,
                actor=request.user
            )
        )

        logger.info(
            f"Referral {referral.referral_number} declined by {request.user.get_full_name()}. "
            f"Reason: {referral.decline_reason}"
        )

        serializer = self.get_serializer(referral)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def schedule(self, request, pk=None):
        """
        Schedule an appointment for referral.
        """
        referral = self.get_object()

        if referral.status != ReferralStatus.ACCEPTED:
            return Response(
                {'error': f'Cannot schedule appointment for referral in {referral.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate schedule data
        schedule_serializer = ReferralScheduleSerializer(data=request.data)
        schedule_serializer.is_valid(raise_exception=True)

        # Update referral
        referral.status = ReferralStatus.SCHEDULED
        referral.scheduled_appointment_id = schedule_serializer.validated_data['scheduled_appointment_id']
        referral.save()
        ReferralSLAService.evaluate_referral(referral)

        transaction.on_commit(
            lambda: create_referral_notifications(
                referral,
                ReferralNotificationEvent.SCHEDULED,
                actor=request.user
            )
        )

        logger.info(
            f"Referral {referral.referral_number} scheduled with appointment "
            f"{referral.scheduled_appointment_id}"
        )

        serializer = self.get_serializer(referral)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='sla-state', permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    def sla_state(self, request, pk=None):
        referral = self.get_object()
        state = ReferralSLAService.compute_state(referral)
        return Response({
            'referral_id': str(referral.id),
            'status': referral.status,
            'sla_state': state,
        })

    @action(detail=True, methods=['post'], url_path='evaluate-sla', permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    def evaluate_sla(self, request, pk=None):
        referral = self.get_object()
        events = ReferralSLAService.evaluate_referral(referral)
        return Response({
            'referral_id': str(referral.id),
            'events_created': len(events),
            'event_types': [event.event_type for event in events],
        })

    @action(detail=False, methods=['get'], url_path='sla-dashboard', permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    def sla_dashboard(self, request):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        open_referrals = Referral.objects.filter(
            facility=facility,
            status__in=ReferralSLAService.OPEN_STATUSES,
        )
        totals = {'green': 0, 'amber': 0, 'red': 0, 'breached': 0}
        for referral in open_referrals.select_related('facility'):
            state = ReferralSLAService.compute_state(referral)
            risk = state['risk_band']
            if risk in totals:
                totals[risk] += 1
            if state['breached']:
                totals['breached'] += 1

        return Response({
            'facility': facility.code,
            'open_referrals': open_referrals.count(),
            'risk_summary': totals,
        })

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def complete(self, request, pk=None):
        """
        Complete a referral with specialist notes and recommendations.
        """
        referral = self.get_object()

        if referral.status not in [ReferralStatus.ACCEPTED, ReferralStatus.SCHEDULED]:
            return Response(
                {'error': f'Cannot complete referral in {referral.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get practitioner profile
        try:
            practitioner = request.user.staff_profile.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners can complete referrals'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Validate completion data
        complete_serializer = ReferralCompleteSerializer(data=request.data)
        complete_serializer.is_valid(raise_exception=True)

        # Update referral
        referral.status = ReferralStatus.COMPLETED
        referral.completed_at = timezone.now()
        referral.specialist_notes = complete_serializer.validated_data['specialist_notes']
        referral.recommendations = complete_serializer.validated_data.get('recommendations', '')
        referral.save()

        transaction.on_commit(
            lambda: create_referral_notifications(
                referral,
                ReferralNotificationEvent.COMPLETED,
                actor=request.user
            )
        )
        transaction.on_commit(
            lambda: send_referral_status_update.delay(
                referral.id,
                ReferralNotificationEvent.COMPLETED
            )
        )

        logger.info(
            f"Referral {referral.referral_number} completed by {request.user.get_full_name()}"
        )

        serializer = self.get_serializer(referral)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='start-consultation', permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def start_consultation(self, request, pk=None):
        """
        Start a consultation workflow from an accepted referral.
        Creates an encounter and starts the consultation workflow.
        """
        referral = self.get_object()

        # Validate status - must be accepted
        if referral.status != ReferralStatus.ACCEPTED:
            return Response(
                {'error': f'Can only start consultation for accepted referrals. Current status: {referral.get_status_display()}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get practitioner profile
        try:
            practitioner = request.user.staff_profile.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners can start consultations'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Determine encounter context based on referral type
        encounter_id = None

        if referral.referral_type == 'inpatient' and referral.encounter:
            # Inpatient: Use existing admission encounter
            encounter_id = str(referral.encounter_id)
            logger.info(f"Using existing inpatient encounter {encounter_id} for referral {referral.referral_number}")
        else:
            # OPD: Create new outpatient encounter
            try:
                encounter = Encounter.objects.create(
                    patient=referral.patient,
                    facility=referral.patient.facility,
                    practitioner=practitioner,
                    encounter_type='outpatient',
                    status='in-progress',
                    reason=f"Specialist consultation: {referral.reason[:200] if referral.reason else 'Referral consultation'}",
                )
                from apps.organization.services import TeamAssignmentService
                TeamAssignmentService.assign_initial_team(
                    encounter=encounter,
                    use_roster=True,
                    context='outpatient'
                )
                encounter_id = str(encounter.id)
                referral.consultation_encounter = encounter
                logger.info(f"Created outpatient encounter {encounter_id} for referral {referral.referral_number}")
            except Exception as e:
                logger.error(f"Failed to create encounter for referral {referral.referral_number}: {str(e)}")
                return Response(
                    {'error': 'Failed to create encounter. Please try again.'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        # Start consultation workflow via ConsultationEngine
        try:
            workflow_result = ConsultationEngine.start(
                user=request.user,
                patient_id=referral.patient_id,
                appointment_id=referral.scheduled_appointment_id,
                initial_data={
                    'referral_id': str(referral.id),
                    'referral_number': referral.referral_number,
                    'referral_reason': referral.reason,
                    'referral_clinical_summary': referral.clinical_summary,
                    'referral_questions': referral.questions_for_specialist,
                    'referral_urgency': referral.urgency,
                    'referral_referring_doctor': referral.referring_provider.staff.user.get_full_name() if referral.referring_provider else None,
                    'referral_referring_department': referral.referring_department,
                }
            )

            workflow = workflow_result['workflow']

            # Link referral to workflow
            referral.consultation_workflow = workflow
            referral.status = ReferralStatus.SCHEDULED
            referral.save()

            transaction.on_commit(
                lambda: create_referral_notifications(
                    referral,
                    ReferralNotificationEvent.SCHEDULED,
                    actor=request.user
                )
            )

            # Also link workflow back to referral
            workflow.source_referral = referral
            workflow.encounter_id = encounter_id
            workflow.save()

            logger.info(
                f"Started consultation workflow {workflow.id} for referral {referral.referral_number}"
            )

            return Response({
                'success': True,
                'workflow_id': str(workflow.id),
                'encounter_id': encounter_id,
                'referral_status': referral.status,
            })

        except Exception as e:
            logger.error(f"Failed to start consultation for referral {referral.referral_number}: {str(e)}")
            return Response(
                {'error': 'Failed to start consultation. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['patch'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def update_response(self, request, pk=None):
        """
        Update specialist notes and recommendations.
        """
        referral = self.get_object()

        if referral.status not in [ReferralStatus.ACCEPTED, ReferralStatus.SCHEDULED, ReferralStatus.COMPLETED]:
            return Response(
                {'error': f'Cannot update response for referral in {referral.get_status_display()} status'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get practitioner profile
        try:
            practitioner = request.user.staff_profile.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners can update referral responses'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Validate response data
        response_serializer = ReferralResponseSerializer(data=request.data)
        response_serializer.is_valid(raise_exception=True)

        # Update referral
        referral.specialist_notes = response_serializer.validated_data['specialist_notes']
        referral.recommendations = response_serializer.validated_data.get('recommendations', '')
        referral.save()

        logger.info(
            f"Referral {referral.referral_number} response updated by {request.user.get_full_name()}"
        )

        serializer = self.get_serializer(referral)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    def inbox(self, request):
        """
        Get referrals sent to current user's department/specialty.
        """
        # Get practitioner profile
        try:
            practitioner = request.user.staff_profile.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners have an inbox'},
                status=status.HTTP_403_FORBIDDEN
            )

        queryset = self._get_inbox_queryset(practitioner)
        total = queryset.count()

        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'count': total,
            'referrals': serializer.data
        })

    @action(detail=False, methods=['get'], url_path='inbox-count', permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    def inbox_count(self, request):
        """
        Get referral inbox count for the current user.
        """
        try:
            practitioner = request.user.staff_profile.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners have an inbox'},
                status=status.HTTP_403_FORBIDDEN
            )

        total = self._get_inbox_queryset(practitioner).count()
        return Response({'count': total})

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    def sent(self, request):
        """
        Get referrals sent by current user.
        """
        # Get practitioner profile
        try:
            practitioner = request.user.staff_profile.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners can view sent referrals'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Get referrals sent by this practitioner
        queryset = self.get_queryset().filter(referring_provider=practitioner)

        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'count': queryset.count(),
            'referrals': serializer.data
        })

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    def pending(self, request):
        """
        Get all pending referrals (admin view).
        """
        queryset = self.get_queryset().filter(
            status__in=[ReferralStatus.PENDING, ReferralStatus.ACCEPTED, ReferralStatus.SCHEDULED]
        )

        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'count': queryset.count(),
            'referrals': serializer.data
        })


class ReferralNotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    In-app notifications for referral workflow events.
    """
    serializer_class = ReferralNotificationSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ReferralNotification.objects.none()
        return ReferralNotification.objects.select_related('referral').filter(
            recipient=self.request.user,
            facility=facility
        )

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=['is_read', 'updated_at'])
        serializer = self.get_serializer(notification)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        queryset = self.get_queryset().filter(is_read=False)
        return Response({'count': queryset.count()})

    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        queryset = self.get_queryset().filter(is_read=False)
        updated = queryset.update(is_read=True)
        return Response({'updated': updated})


class ReferralSLAPolicyViewSet(viewsets.ModelViewSet):
    """Manage referral SLA policy definitions for a facility."""
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, (IsAdmin | IsDoctor)]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['urgency', 'is_active', 'referred_to_department']

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), FacilityScopedPermission(), IsAdmin()]
        return super().get_permissions()

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ReferralSLAPolicy.objects.none()
        queryset = ReferralSLAPolicy.objects.filter(facility=facility)
        if self.request.query_params.get('include_inactive') != 'true':
            queryset = queryset.filter(is_active=True)
        return queryset.order_by('referred_to_department', 'urgency')

    def get_serializer_class(self):
        if self.action == 'list':
            return ReferralSLAPolicyListSerializer
        return ReferralSLAPolicySerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class ReferralSLAEventViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only stream of referral SLA threshold and breach events."""
    serializer_class = ReferralSLAEventListSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, (IsAdmin | IsDoctor | IsNurse | IsReceptionist)]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['event_type', 'referral']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ReferralSLAEvent.objects.none()
        queryset = ReferralSLAEvent.objects.select_related('referral').filter(facility=facility)
        referral_id = self.request.query_params.get('referral')
        if referral_id:
            queryset = queryset.filter(referral_id=referral_id)
        return queryset


class ClinicWaitlistEntryViewSet(viewsets.ModelViewSet):
    """Clinic waitlist queue with ranking/offer/promotion actions."""
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, (IsAdmin | IsDoctor | IsNurse)]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['clinic', 'status', 'urgency', 'deadline_risk', 'vulnerability_flag']

    def get_permissions(self):
        if self.action in [
            'create',
            'update',
            'partial_update',
            'destroy',
            'offer_next',
            'expire_offers',
            'promote',
            'cancel',
        ]:
            permission_classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                (IsAdmin | IsDoctor),
            ]
            return [permission() for permission in permission_classes]
        return super().get_permissions()

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ClinicWaitlistEntry.objects.none()
        queryset = ClinicWaitlistEntry.objects.select_related(
            'clinic',
            'patient__user',
            'referral',
            'preferred_practitioner',
            'promoted_appointment',
        ).filter(facility=facility)
        if self.request.query_params.get('active_only') == 'true':
            queryset = queryset.filter(status__in=[ClinicWaitlistEntryStatus.WAITING, ClinicWaitlistEntryStatus.OFFERED])

        if getattr(self.request.user, 'user_type', None) != 'admin':
            accessible_patients = get_accessible_patients_for_clinician(self.request.user)
            queryset = queryset.filter(patient__in=accessible_patients)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return ClinicWaitlistEntryListSerializer
        return ClinicWaitlistEntrySerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        payload = serializer.validated_data
        check_clinical_access(self.request.user, payload['patient'])
        entry = ClinicWaitlistService.create_or_update_entry(
            facility=facility,
            clinic=payload['clinic'],
            patient=payload['patient'],
            requested_start_time=payload['requested_start_time'],
            requested_end_time=payload['requested_end_time'],
            urgency=payload.get('urgency'),
            referral=payload.get('referral'),
            preferred_practitioner=payload.get('preferred_practitioner'),
            vulnerability_flag=payload.get('vulnerability_flag', False),
            source=payload.get('source', ClinicWaitlistEntry.Source.MANUAL),
            notes=payload.get('notes', ''),
            actor=self.request.user,
        )
        serializer.instance = entry

    def perform_update(self, serializer):
        check_clinical_access(self.request.user, serializer.instance.patient)
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='offer-next')
    def offer_next(self, request):
        clinic_id = request.data.get('clinic_id')
        if not clinic_id:
            return Response({'error': 'clinic_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        clinic = get_object_or_404(Clinic, id=clinic_id, facility=facility)
        start_time = request.data.get('start_time')
        end_time = request.data.get('end_time')
        expires_minutes = int(request.data.get('expires_minutes', 30))
        parsed_start = parse_datetime(start_time) if start_time else None
        parsed_end = parse_datetime(end_time) if end_time else None

        entry = ClinicWaitlistService.offer_next(
            clinic=clinic,
            start_time=parsed_start,
            end_time=parsed_end,
            expires_minutes=expires_minutes,
            actor=request.user,
        )
        if not entry:
            return Response({'offered': None}, status=status.HTTP_200_OK)
        serializer = self.get_serializer(entry)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='expire-offers')
    def expire_offers(self, request):
        expired = ClinicWaitlistService.expire_offers()
        return Response({'expired': expired})

    @action(detail=True, methods=['post'])
    def promote(self, request, pk=None):
        entry = self.get_object()
        appointment_type_id = request.data.get('appointment_type_id')
        practitioner_id = request.data.get('practitioner_id')
        if not appointment_type_id:
            return Response({'error': 'appointment_type_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        appointment_type = AppointmentType.objects.filter(id=appointment_type_id).first()
        if not appointment_type:
            return Response({'error': 'appointment_type not found'}, status=status.HTTP_404_NOT_FOUND)
        practitioner = None
        if practitioner_id:
            practitioner = PractitionerProfile.objects.filter(id=practitioner_id).first()
            if not practitioner:
                return Response({'error': 'practitioner not found'}, status=status.HTTP_404_NOT_FOUND)

        try:
            appointment = ClinicWaitlistService.promote_entry(
                entry=entry,
                appointment_type=appointment_type,
                actor=request.user,
                practitioner=practitioner,
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(entry)
        return Response({
            'waitlist_entry': serializer.data,
            'appointment_id': str(appointment.id),
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        entry = self.get_object()
        if entry.status in [ClinicWaitlistEntryStatus.PROMOTED, ClinicWaitlistEntryStatus.CANCELLED]:
            return Response({'error': f'Cannot cancel entry in {entry.status} status'}, status=status.HTTP_400_BAD_REQUEST)

        entry.status = ClinicWaitlistEntryStatus.CANCELLED
        entry.updated_by = request.user
        entry.save(update_fields=['status', 'updated_by', 'updated_at'])
        serializer = self.get_serializer(entry)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        rows = list(ClinicWaitlistService.summarize_waiting(facility=facility))
        return Response({'rows': rows})
