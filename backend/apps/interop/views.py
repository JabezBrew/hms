import json

from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.conf import settings
from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.consent.services import validate_access_token
from apps.core.security import check_clinical_access, get_accessible_patients_for_clinician, get_user_facility
from apps.users.models import PatientProfile
from apps.users.rbac import IsAdmin, IsDoctor
from .crypto import decrypt_payload
from .models import RecordExportJob, RecordExportStatus
from .serializers import RecordExportRequestSerializer, RecordExportJobSerializer
from .services import create_export_job


class RecordExportViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, (IsAdmin | IsDoctor)]

    def create(self, request):
        serializer = RecordExportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        patient_identity_id = serializer.validated_data['patient_identity_id']
        target_facility_code = serializer.validated_data['target_facility_code']
        consent_token = serializer.validated_data['consent_token']

        source_facility_code = request.facility_code
        requesting_facility_code = request.headers.get('X-Requesting-Facility-Code') or target_facility_code
        if requesting_facility_code != target_facility_code:
            return Response(
                {'detail': 'Requesting facility mismatch.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        consent = validate_access_token(
            consent_token,
            patient_identity_id=patient_identity_id,
            source_facility_code=source_facility_code,
            target_facility_code=requesting_facility_code,
        )
        if not consent:
            return Response(
                {'detail': 'Consent token invalid or expired.'},
                status=status.HTTP_403_FORBIDDEN
            )

        facility = get_user_facility(request)
        if not facility:
            return Response(
                {'detail': 'Facility context is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        patient_queryset = PatientProfile.objects.all()
        if request.user.user_type != 'admin' and getattr(settings, 'TEAM_ACCESS_STRICT', True):
            patient_queryset = get_accessible_patients_for_clinician(request.user)
        patient_queryset = patient_queryset.filter(facility=facility)
        patient = get_object_or_404(
            patient_queryset,
            patient_identity_id=patient_identity_id
        )
        check_clinical_access(request.user, patient)

        job = create_export_job(
            patient=patient,
            target_facility_code=requesting_facility_code,
            consent_grant_id=consent.id,
            requested_by_user_id=getattr(request.user, 'id', None),
            requested_by_facility_code=source_facility_code or '',
        )

        return Response(RecordExportJobSerializer(job).data, status=status.HTTP_202_ACCEPTED)

    def retrieve(self, request, pk=None):
        job = get_object_or_404(RecordExportJob, pk=pk)
        consent_token = request.headers.get('X-Consent-Token') or request.query_params.get('consent_token')
        if not consent_token:
            return Response({'detail': 'Consent token required.'}, status=status.HTTP_400_BAD_REQUEST)

        source_facility_code = request.facility_code
        requesting_facility_code = request.headers.get('X-Requesting-Facility-Code') or job.target_facility_code
        if requesting_facility_code != job.target_facility_code:
            return Response(
                {'detail': 'Requesting facility mismatch.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        consent = validate_access_token(
            consent_token,
            patient_identity_id=job.patient_identity_id,
            source_facility_code=source_facility_code,
            target_facility_code=requesting_facility_code,
        )
        if not consent:
            return Response(
                {'detail': 'Consent token invalid or expired.'},
                status=status.HTTP_403_FORBIDDEN
            )

        if job.expires_at and job.expires_at <= timezone.now():
            return Response(
                {'detail': 'Export has expired.'},
                status=status.HTTP_410_GONE
            )

        if job.status != RecordExportStatus.READY:
            return Response(RecordExportJobSerializer(job).data, status=status.HTTP_200_OK)

        payload_bytes = decrypt_payload(job.payload_encrypted)
        payload = json.loads(payload_bytes.decode('utf-8'))

        job.status = RecordExportStatus.DELIVERED
        job.save(update_fields=['status', 'updated_at'])

        return Response(
            {'bundle': payload, 'checksum': job.payload_checksum},
            status=status.HTTP_200_OK
        )
