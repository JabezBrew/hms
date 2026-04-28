from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import check_clinical_access, get_accessible_patients_for_clinician, get_user_facility
from apps.mpi.models import PatientIdentity
from apps.users.models import PatientProfile
from apps.users.rbac import IsAdmin, IsDoctor

from .models import ConsentGrant, ConsentStatus, CrossFacilityReferral, ReferralStatus
from .serializers import (
    ConsentGrantListSerializer,
    ConsentGrantSerializer,
    ConsentGrantCreateSerializer,
    ConsentGrantRevokeSerializer,
    ConsentTokenIssueSerializer,
    CrossFacilityReferralListSerializer,
    CrossFacilityReferralSerializer,
    CrossFacilityReferralCreateSerializer,
)
from .services import create_referral, grant_consent, issue_access_token


def _require_facility_code(request):
    facility_code = getattr(request, 'facility_code', None)
    if not facility_code:
        raise ValidationError({'detail': 'Facility context is required.'})
    return facility_code


def _require_patient_access(request, patient_identity_id):
    facility = get_user_facility(request)
    if not facility:
        raise PermissionDenied('Facility context is required.')
    if request.user.user_type != 'admin' and getattr(settings, 'TEAM_ACCESS_STRICT', True):
        queryset = get_accessible_patients_for_clinician(request.user).filter(
            patient_identity_id=patient_identity_id,
            facility=facility
        )
    else:
        queryset = PatientProfile.objects.filter(
            patient_identity_id=patient_identity_id,
            facility=facility
        )
    patient = queryset.first()
    if not patient:
        raise PermissionDenied('Patient access not permitted.')
    check_clinical_access(request.user, patient)
    return patient


class ConsentGrantViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, (IsAdmin | IsDoctor)]
    pagination_class = StandardResultsSetPagination
    queryset = ConsentGrant.objects.select_related('patient_identity')
    filterset_fields = ['status', 'scope', 'source_facility_code', 'target_facility_code']

    def get_queryset(self):
        queryset = super().get_queryset()
        facility_code = getattr(self.request, 'facility_code', None)
        if facility_code:
            queryset = queryset.filter(
                Q(source_facility_code=facility_code) | Q(target_facility_code=facility_code)
            )

            direction = self.request.query_params.get('direction')
            if direction == 'incoming':
                queryset = queryset.filter(target_facility_code=facility_code)
            elif direction == 'outgoing':
                queryset = queryset.filter(source_facility_code=facility_code)
        return queryset.order_by('-created_at')

    def get_serializer_class(self):
        if self.action == 'list':
            return ConsentGrantListSerializer
        if self.action == 'create':
            return ConsentGrantCreateSerializer
        if self.action == 'revoke':
            return ConsentGrantRevokeSerializer
        return ConsentGrantSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        facility_code = _require_facility_code(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        patient_identity_id = serializer.validated_data['patient_identity_id']
        target_facility_code = serializer.validated_data['target_facility_code']

        if facility_code == target_facility_code:
            raise ValidationError({'target_facility_code': 'Target facility must differ from source.'})

        _require_patient_access(request, patient_identity_id)
        patient_identity = PatientIdentity.objects.filter(id=patient_identity_id).first()
        if not patient_identity:
            return Response({'detail': 'Patient identity not found.'}, status=status.HTTP_404_NOT_FOUND)

        consent = grant_consent(
            patient_identity=patient_identity,
            source_facility_code=facility_code,
            target_facility_code=target_facility_code,
            scope=serializer.validated_data.get('scope'),
            reason=serializer.validated_data.get('reason', ''),
            expires_at=serializer.validated_data.get('expires_at'),
            created_by_facility_code=facility_code,
            created_by_user_id=request.user.id,
        )

        response_serializer = ConsentGrantSerializer(consent)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def revoke(self, request, pk=None):
        consent = self.get_object()
        facility_code = _require_facility_code(request)
        if consent.source_facility_code != facility_code:
            raise PermissionDenied('Only the source facility can revoke consent.')
        if consent.status != ConsentStatus.ACTIVE:
            return Response(
                {'detail': 'Only active consents can be revoked.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        consent.status = ConsentStatus.REVOKED
        consent.revoked_at = timezone.now()
        consent.save(update_fields=['status', 'revoked_at', 'updated_at'])
        return Response(ConsentGrantSerializer(consent).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def issue_token(self, request, pk=None):
        consent = self.get_object()
        now = timezone.now()
        facility_code = _require_facility_code(request)
        if consent.source_facility_code != facility_code:
            raise PermissionDenied('Only the source facility can issue access tokens.')
        if consent.expires_at and consent.expires_at <= now:
            if consent.status == ConsentStatus.ACTIVE:
                consent.status = ConsentStatus.EXPIRED
                consent.save(update_fields=['status', 'updated_at'])
            return Response(
                {'detail': 'Consent has expired and cannot issue a token.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if consent.status != ConsentStatus.ACTIVE:
            return Response(
                {'detail': 'Consent must be active to issue a token.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = ConsentTokenIssueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_facility_code = serializer.validated_data['target_facility_code']

        if target_facility_code != consent.target_facility_code:
            return Response(
                {'detail': 'Token target does not match consent target.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            raw_token = issue_access_token(
                consent,
                target_facility_code=target_facility_code,
                ttl_seconds=serializer.validated_data.get('ttl_seconds', 3600),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {'consent_id': str(consent.id), 'token': raw_token},
            status=status.HTTP_201_CREATED
        )


class CrossFacilityReferralViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, (IsAdmin | IsDoctor)]
    pagination_class = StandardResultsSetPagination
    queryset = CrossFacilityReferral.objects.select_related('patient_identity')
    filterset_fields = ['status', 'source_facility_code', 'target_facility_code']

    def get_queryset(self):
        queryset = super().get_queryset()
        facility_code = getattr(self.request, 'facility_code', None)
        if facility_code:
            queryset = queryset.filter(
                Q(source_facility_code=facility_code) | Q(target_facility_code=facility_code)
            )
            direction = self.request.query_params.get('direction')
            if direction == 'incoming':
                queryset = queryset.filter(target_facility_code=facility_code)
            elif direction == 'outgoing':
                queryset = queryset.filter(source_facility_code=facility_code)
        return queryset.order_by('-created_at')

    def get_serializer_class(self):
        if self.action == 'list':
            return CrossFacilityReferralListSerializer
        if self.action == 'create':
            return CrossFacilityReferralCreateSerializer
        return CrossFacilityReferralSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        facility_code = _require_facility_code(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        patient_identity_id = serializer.validated_data['patient_identity_id']
        target_facility_code = serializer.validated_data['target_facility_code']

        if facility_code == target_facility_code:
            raise ValidationError({'target_facility_code': 'Target facility must differ from source.'})

        _require_patient_access(request, patient_identity_id)
        patient_identity = PatientIdentity.objects.filter(id=patient_identity_id).first()
        if not patient_identity:
            return Response({'detail': 'Patient identity not found.'}, status=status.HTTP_404_NOT_FOUND)

        referral = create_referral(
            patient_identity=patient_identity,
            source_facility_code=facility_code,
            target_facility_code=target_facility_code,
            reason_code=serializer.validated_data.get('reason_code', ''),
            created_by_facility_code=facility_code,
            created_by_user_id=request.user.id,
        )

        response_serializer = CrossFacilityReferralSerializer(referral)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def accept(self, request, pk=None):
        referral = self.get_object()
        facility_code = _require_facility_code(request)
        if referral.target_facility_code != facility_code:
            raise PermissionDenied('Only the target facility can accept this referral.')
        if referral.status != ReferralStatus.PENDING:
            return Response(
                {'detail': 'Referral is not pending.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        referral.status = ReferralStatus.ACCEPTED
        referral.responded_at = timezone.now()
        referral.save(update_fields=['status', 'responded_at', 'updated_at'])
        return Response(CrossFacilityReferralSerializer(referral).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def decline(self, request, pk=None):
        referral = self.get_object()
        facility_code = _require_facility_code(request)
        if referral.target_facility_code != facility_code:
            raise PermissionDenied('Only the target facility can decline this referral.')
        if referral.status != ReferralStatus.PENDING:
            return Response(
                {'detail': 'Referral is not pending.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        decline_reason = request.data.get('decline_reason', '') if request.data else ''
        referral.status = ReferralStatus.DECLINED
        referral.decline_reason = (decline_reason or '').strip()
        referral.responded_at = timezone.now()
        referral.save(update_fields=['status', 'decline_reason', 'responded_at', 'updated_at'])
        return Response(CrossFacilityReferralSerializer(referral).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def cancel(self, request, pk=None):
        referral = self.get_object()
        facility_code = _require_facility_code(request)
        if referral.source_facility_code != facility_code:
            raise PermissionDenied('Only the source facility can cancel this referral.')
        if referral.status != ReferralStatus.PENDING:
            return Response(
                {'detail': 'Only pending referrals can be cancelled.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        referral.status = ReferralStatus.CANCELLED
        referral.save(update_fields=['status', 'updated_at'])
        return Response(CrossFacilityReferralSerializer(referral).data, status=status.HTTP_200_OK)
