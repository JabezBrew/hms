from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db.models import Q
import logging

from .models import Referral, ReferralStatus
from .serializers import (
    ReferralSerializer, ReferralCreateSerializer,
    ReferralSubmitSerializer, ReferralAcceptSerializer,
    ReferralDeclineSerializer, ReferralScheduleSerializer,
    ReferralCompleteSerializer, ReferralResponseSerializer,
    ReferralSearchSerializer, ReferralListSerializer
)
from ..users.permissions import IsAdminOrDoctor
from ..workflows.engines import ConsultationEngine
from ..wards.models import Encounter

logger = logging.getLogger(__name__)


class StandardResultsSetPagination(PageNumberPagination):
    """Standard pagination for referrals endpoints."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class ReferralViewSet(viewsets.ModelViewSet):
    """
    API endpoint for referrals with workflow management.
    """
    queryset = Referral.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminOrDoctor]
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

    def get_queryset(self):
        """
        Filter referrals with optimized queries.
        """
        queryset = Referral.objects.select_related(
            'patient__user',
            'referring_provider__staff__user',
            'referred_to_provider__staff__user',
            'encounter'
        )

        # Filter by patient
        patient_id = self.request.query_params.get('patient')
        if patient_id:
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
        # If referring_provider not specified, use current user
        if not serializer.validated_data.get('referring_provider'):
            try:
                practitioner = self.request.user.staff_profile.practitioner_profile
                serializer.save(referring_provider=practitioner)
            except AttributeError:
                # Current user is not a practitioner - raise error
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Only practitioners can create referrals. Your account is not linked to a practitioner profile.")
        else:
            serializer.save()

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

        logger.info(
            f"Referral {referral.referral_number} scheduled with appointment "
            f"{referral.scheduled_appointment_id}"
        )

        serializer = self.get_serializer(referral)
        return Response(serializer.data)

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
                    practitioner=practitioner,
                    encounter_type='outpatient',
                    status='in-progress',
                    reason=f"Specialist consultation: {referral.reason[:200] if referral.reason else 'Referral consultation'}",
                )
                encounter_id = str(encounter.id)
                referral.consultation_encounter = encounter
                logger.info(f"Created outpatient encounter {encounter_id} for referral {referral.referral_number}")
            except Exception as e:
                logger.error(f"Failed to create encounter for referral {referral.referral_number}: {str(e)}")
                return Response(
                    {'error': f'Failed to create encounter: {str(e)}'},
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
                {'error': f'Failed to start consultation: {str(e)}'},
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

        # Get referrals sent to this practitioner or pending for their department
        queryset = self.get_queryset().filter(
            Q(referred_to_provider=practitioner) |
            Q(referred_to_provider__isnull=True, status=ReferralStatus.PENDING)
        ).exclude(
            status__in=[ReferralStatus.DRAFT, ReferralStatus.COMPLETED, ReferralStatus.DECLINED, ReferralStatus.CANCELLED]
        )

        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'count': queryset.count(),
            'referrals': serializer.data
        })

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
