from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
import logging

from .models import PatientAllergy, DrugSafetyAlert, DrugInteractionCache, AlertSeverity
from .serializers import (
    PatientAllergySerializer, PatientAllergyCreateSerializer,
    DrugSafetyAlertSerializer, DrugSafetyAlertOverrideSerializer,
    DrugSafetyCheckRequestSerializer, DrugSafetyCheckResponseSerializer,
    DrugSearchSerializer, DrugInteractionCacheSerializer
)
from .services.interaction_checker import InteractionChecker
from .services.allergy_checker import AllergyChecker
from .services.rxnorm_service import RxNormService
from ..users.permissions import IsAdminOrDoctor, IsAdminOrNurse, IsDoctorOnly
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import (
    FacilityScopedPermission,
    check_clinical_access,
    get_accessible_patients_for_clinician,
    get_user_facility,
)
from apps.users.models import PatientProfile

logger = logging.getLogger(__name__)


def _scope_clinical_queryset_for_user(queryset, *, user, patient_lookup):
    """Apply clinical-data authorization at the queryset level."""
    user_type = getattr(user, 'user_type', None)

    if user_type == 'admin':
        return queryset

    if user_type == 'patient':
        return queryset.filter(**{f'{patient_lookup}__user': user})

    if user_type in ['doctor', 'nurse']:
        if not getattr(settings, 'TEAM_ACCESS_STRICT', False):
            return queryset
        accessible_patients = get_accessible_patients_for_clinician(user, scope='clinical')
        return queryset.filter(**{f'{patient_lookup}__in': accessible_patients})

    return queryset.none()


class PatientAllergyViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient allergies.
    Supports CRUD operations with proper permission controls.
    """
    queryset = PatientAllergy.objects.all()
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return PatientAllergyCreateSerializer
        return PatientAllergySerializer

    def get_permissions(self):
        if self.action == 'verify':
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrDoctor]
        elif self.action in ['create', 'update', 'partial_update', 'destroy', 'deactivate']:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdminOrDoctor | IsAdminOrNurse]
        else:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        """Filter allergies by patient if patient_id is provided."""
        facility = get_user_facility(self.request)
        if not facility:
            return PatientAllergy.objects.none()
        queryset = PatientAllergy.objects.filter(facility=facility)
        queryset = _scope_clinical_queryset_for_user(
            queryset,
            user=self.request.user,
            patient_lookup='patient',
        )
        patient_id = self.request.query_params.get('patient')

        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return queryset.none()
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_clinical_access(self.request.user, patient)
            queryset = queryset.filter(patient_id=patient_id)

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset.select_related('patient__user', 'verified_by__staff__user', 'created_by').order_by('-severity', 'allergen_name')

    def get_object(self):
        allergy = super().get_object()
        check_clinical_access(self.request.user, allergy.patient)
        return allergy

    @transaction.atomic
    def perform_create(self, serializer):
        """Set created_by to current user."""
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_clinical_access(self.request.user, patient)
        serializer.save(created_by=self.request.user, facility=facility)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    def verify(self, request, pk=None):
        """Verify an allergy (doctors only)."""
        allergy = self.get_object()

        # Get practitioner profile
        try:
            practitioner = request.user.staff.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners can verify allergies'},
                status=status.HTTP_403_FORBIDDEN
            )

        allergy.verified_by = practitioner
        allergy.verified_at = timezone.now()
        allergy.save()

        serializer = self.get_serializer(allergy)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def deactivate(self, request, pk=None):
        """Deactivate an allergy."""
        allergy = self.get_object()
        allergy.is_active = False
        allergy.save()

        serializer = self.get_serializer(allergy)
        return Response(serializer.data)


class DrugSafetyAlertViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for drug safety alerts (read-only).
    Alerts are generated by the safety check service.
    """
    queryset = DrugSafetyAlert.objects.all()
    serializer_class = DrugSafetyAlertSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """Filter alerts by patient or prescription."""
        facility = get_user_facility(self.request)
        if not facility:
            return DrugSafetyAlert.objects.none()
        queryset = DrugSafetyAlert.objects.filter(patient__facility=facility)
        queryset = _scope_clinical_queryset_for_user(
            queryset,
            user=self.request.user,
            patient_lookup='patient',
        )

        patient_id = self.request.query_params.get('patient')
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient:
                return queryset.none()
            if patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_clinical_access(self.request.user, patient)
            queryset = queryset.filter(patient_id=patient_id)

        prescription_id = self.request.query_params.get('prescription')
        if prescription_id:
            queryset = queryset.filter(prescription_id=prescription_id)

        # Filter by overridden status
        is_overridden = self.request.query_params.get('is_overridden')
        if is_overridden is not None:
            queryset = queryset.filter(is_overridden=is_overridden.lower() == 'true')

        # Filter by severity
        severity = self.request.query_params.get('severity')
        if severity:
            queryset = queryset.filter(severity=severity)

        return queryset.select_related('patient__user', 'overridden_by__staff__user').order_by('-severity', '-created_at')

    def get_object(self):
        alert = super().get_object()
        check_clinical_access(self.request.user, alert.patient)
        return alert

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, IsAdminOrDoctor])
    @transaction.atomic
    def override(self, request, pk=None):
        """
        Override a drug safety alert with documented reason.
        Requires doctor permission and substantive justification.
        """
        alert = self.get_object()

        # Get practitioner profile
        try:
            practitioner = request.user.staff.practitioner_profile
        except AttributeError:
            return Response(
                {'error': 'Only practitioners can override alerts'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Validate override request
        override_serializer = DrugSafetyAlertOverrideSerializer(data=request.data)
        override_serializer.is_valid(raise_exception=True)

        # Check if alert requires override reason
        if alert.requires_override_reason() and not override_serializer.validated_data['override_reason']:
            return Response(
                {'error': 'Override reason is required for critical and high severity alerts'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Record override
        alert.is_overridden = True
        alert.override_reason = override_serializer.validated_data['override_reason']
        alert.overridden_by = practitioner
        alert.overridden_at = timezone.now()
        alert.save()

        # Log to audit trail
        logger.info(
            f"Drug safety alert {alert.id} overridden by {request.user.get_full_name()}. "
            f"Reason: {alert.override_reason}"
        )

        serializer = self.get_serializer(alert)
        return Response(serializer.data)


class DrugSafetyCheckView(viewsets.ViewSet):
    """
    API endpoint for performing drug safety checks.

    Permissions vary by action:
    - check: Doctors only (clinical prescribing function)
    - search_drugs, drug_forms, patient_allergies: All authenticated clinical staff
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    def get_permissions(self):
        """Return different permissions based on action."""
        if self.action == 'check':
            # Only doctors can perform safety checks (prescribing function)
            return [permissions.IsAuthenticated(), IsDoctorOnly()]
        # Other actions (search, forms, allergies) are read-only and available to all authenticated users
        return [permissions.IsAuthenticated()]

    @action(detail=False, methods=['post'])
    def check(self, request):
        """
        Perform comprehensive drug safety check.
        Returns alerts without saving to database.
        Only doctors can perform this action.
        """
        # Validate request
        check_serializer = DrugSafetyCheckRequestSerializer(data=request.data)
        check_serializer.is_valid(raise_exception=True)

        patient_id = check_serializer.validated_data['patient_id']
        medication_name = check_serializer.validated_data['medication_name']
        encounter_id = check_serializer.validated_data.get('encounter_id')

        patient = PatientProfile.objects.filter(id=patient_id).first()
        if not patient:
            raise PermissionDenied("Patient not found.")
        facility = get_user_facility(request)
        if facility and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_clinical_access(request.user, patient)

        # Perform safety check
        alerts = InteractionChecker.check_prescription_safety(
            patient_id=str(patient_id),
            medication_name=medication_name,
            encounter_id=str(encounter_id) if encounter_id else None
        )

        # Analyze alerts
        has_critical = any(alert.severity == AlertSeverity.CRITICAL for alert in alerts)
        highest_severity = alerts[0].severity if alerts else None

        # Serialize response
        response_data = {
            'has_alerts': len(alerts) > 0,
            'alert_count': len(alerts),
            'highest_severity': highest_severity,
            'has_critical_alerts': has_critical,
            'alerts': DrugSafetyAlertSerializer(alerts, many=True).data
        }

        response_serializer = DrugSafetyCheckResponseSerializer(data=response_data)
        response_serializer.is_valid(raise_exception=True)

        return Response(response_serializer.data)

    @action(detail=False, methods=['get'])
    def search_drugs(self, request):
        """
        Search for drugs using RxNorm API.
        """
        query = request.query_params.get('q', '')
        max_results = int(float(request.query_params.get('max_results', 10)))

        if not query or len(query) < 2:
            return Response({'results': []})

        # Search via RxNorm
        results = RxNormService.search_drugs(query, max_results)

        serializer = DrugSearchSerializer(results, many=True)
        return Response({'results': serializer.data})

    @action(detail=False, methods=['get'])
    def drug_forms(self, request):
        """
        Get available drug forms (strengths and dose forms) for a drug.
        """
        rxcui = request.query_params.get('rxcui')

        if not rxcui:
            return Response(
                {'error': 'rxcui is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get drug forms via RxNorm
        forms = RxNormService.get_drug_forms(rxcui)

        return Response({'forms': forms})

    @action(detail=False, methods=['get'])
    def patient_allergies(self, request):
        """
        Quick endpoint to get patient allergies for display.
        """
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response(
                {'error': 'patient_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        patient = PatientProfile.objects.filter(id=patient_id).first()
        if not patient:
            raise PermissionDenied("Patient not found.")
        facility = get_user_facility(request)
        if facility and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_clinical_access(request.user, patient)

        allergies = AllergyChecker.get_patient_active_allergies(patient_id)
        serializer = PatientAllergySerializer(allergies, many=True)

        return Response({
            'count': allergies.count(),
            'allergies': serializer.data
        })


class DrugInteractionCacheViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for viewing cached drug interactions (read-only).
    Primarily for admin/debugging purposes.
    """
    queryset = DrugInteractionCache.objects.all()
    serializer_class = DrugInteractionCacheSerializer
    permission_classes = [permissions.IsAuthenticated, permissions.IsAdminUser]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """Filter by drug RxCUIs."""
        queryset = DrugInteractionCache.objects.all()

        drug1 = self.request.query_params.get('drug1_rxcui')
        if drug1:
            queryset = queryset.filter(drug1_rxcui=drug1)

        drug2 = self.request.query_params.get('drug2_rxcui')
        if drug2:
            queryset = queryset.filter(drug2_rxcui=drug2)

        return queryset.order_by('-fetched_at')
