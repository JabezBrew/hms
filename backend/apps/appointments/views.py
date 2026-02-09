from rest_framework import viewsets, permissions, status, serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from django.core.exceptions import ValidationError
import datetime
import logging

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import (
    Appointment,
    AppointmentType, AppointmentFHIRMapping, RecurringAppointmentRule,
    ScheduleFHIRMapping, RecurringSchedule, BlockedTime
)
from .serializers import (
    AppointmentTypeSerializer, AppointmentFHIRMappingSerializer,
    AppointmentListSerializer, AppointmentSerializer,
    RecurringAppointmentRuleSerializer, ScheduleFHIRMappingSerializer,
    RecurringScheduleSerializer, BlockedTimeSerializer
)
from .proxies import AppointmentProxy, SlotProxy, ScheduleProxy
from .services import (
    AvailabilityService,
    ConflictPreventionService,
    AppointmentTypeService,
    ClinicBookingService,
)
from ..fhir_client.client import fhir_client
from ..fhir_client.utils import (
    create_reference, create_period, generate_fhir_id
)
from ..users.permissions import IsAdminOrOwner, IsAdminOrReadOnly
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import (
    FacilityScopedPermission,
    check_demographics_access,
    get_user_facility,
)
from apps.users.models import PatientProfile, PractitionerProfile
from apps.organization.models import Clinic
from apps.encounters.models import Encounter
from ..users.rbac import IsAdmin, IsDoctor, IsNurse, IsReceptionist

logger = logging.getLogger(__name__)


def _flatten_error_messages(detail):
    messages = []
    if isinstance(detail, dict):
        for value in detail.values():
            messages.extend(_flatten_error_messages(value))
        return messages
    if isinstance(detail, (list, tuple)):
        for item in detail:
            messages.extend(_flatten_error_messages(item))
        return messages
    messages.append(str(detail))
    return messages


def _parse_optional_bool_param(raw_value, param_name):
    """Parse optional boolean query params and return None when omitted."""
    if raw_value is None:
        return None

    value = str(raw_value).strip().lower()
    if value in {'1', 'true', 'yes', 'on'}:
        return True
    if value in {'0', 'false', 'no', 'off'}:
        return False
    raise ValueError(
        f"Invalid value for '{param_name}'. Use true/false."
    )


class WalkInCheckInSerializer(serializers.Serializer):
    """
    Front-desk walk-in check-in to an active roster-backed clinic session.

    NOTE: This is intentionally appointment-backed because OutpatientVisit
    requires a local Appointment record.
    """

    patient = serializers.UUIDField()
    clinic = serializers.UUIDField()
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)
    appointment_type = serializers.UUIDField(required=False)


def _resolve_patient_profile(patient_id):
    if not patient_id:
        return None
    try:
        return PatientProfile.objects.get(id=patient_id)
    except (PatientProfile.DoesNotExist, ValueError, TypeError, ValidationError):
        return PatientProfile.objects.filter(fhir_patient_id=patient_id).first()


def _extract_patient_fhir_id(appointment):
    participant_data = appointment.get('participant', [])
    for participant in participant_data:
        actor = participant.get('actor', {})
        reference = actor.get('reference', '')
        if reference.startswith('Patient/'):
            return reference.split('/')[-1]
    return None


def _filter_appointments_by_facility(appointments, facility):
    if not facility:
        return []
    pairs = [(appt, _extract_patient_fhir_id(appt)) for appt in appointments]
    patient_ids = {pid for _, pid in pairs if pid}
    if not patient_ids:
        return []
    allowed_ids = set(
        PatientProfile.objects.filter(
            fhir_patient_id__in=patient_ids,
            facility=facility
        ).values_list('fhir_patient_id', flat=True)
    )
    return [appt for appt, pid in pairs if pid in allowed_ids]


def _filter_appointment_bundle(bundle, facility):
    if not bundle or 'entry' not in bundle:
        return bundle
    if not facility:
        return {"resourceType": "Bundle", "type": "searchset", "total": 0, "entry": []}
    entries = bundle.get('entry', [])
    resources = [entry.get('resource') for entry in entries if entry.get('resource')]
    filtered_resources = _filter_appointments_by_facility(resources, facility)
    allowed_ids = {
        _extract_patient_fhir_id(resource)
        for resource in filtered_resources
        if _extract_patient_fhir_id(resource)
    }
    filtered_entries = [
        entry for entry in entries
        if _extract_patient_fhir_id(entry.get('resource', {})) in allowed_ids
    ]
    bundle['entry'] = filtered_entries
    bundle['total'] = len(filtered_entries)
    return bundle


def _get_patient_for_appointment(appointment):
    patient_fhir_id = _extract_patient_fhir_id(appointment)
    if not patient_fhir_id:
        return None
    return PatientProfile.objects.filter(fhir_patient_id=patient_fhir_id).first()


def _ensure_appointment_facility_access(appointment, facility, user):
    if not facility:
        raise PermissionDenied("Facility context is required.")
    patient = _get_patient_for_appointment(appointment)
    if not patient:
        raise PermissionDenied("Appointment patient not found.")
    if patient.facility_id != facility.id:
        raise PermissionDenied("Patient does not belong to the active facility.")
    check_demographics_access(user, patient)


class LocalAppointmentViewSet(viewsets.ModelViewSet):
    """
    API endpoint for local appointment records.
    """
    queryset = Appointment.objects.all()
    permission_classes = [
        permissions.IsAuthenticated,
        FacilityScopedPermission,
        (IsAdmin | IsDoctor | IsNurse | IsReceptionist)
    ]
    pagination_class = StandardResultsSetPagination
    filterset_fields = ['patient', 'practitioner', 'clinic', 'status', 'appointment_type']
    search_fields = ['patient__user__first_name', 'patient__user__last_name']
    ordering_fields = ['start_time', 'created_at', 'status']
    ordering = ['start_time']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return Appointment.objects.none()

        queryset = Appointment.objects.select_related(
            'patient',
            'patient__user',
            'practitioner',
            'practitioner__staff',
            'practitioner__staff__user',
            'clinic',
            'appointment_type',
        ).filter(facility=facility)

        patient_id = self.request.query_params.get('patient')
        if patient_id:
            patient = PatientProfile.objects.filter(id=patient_id).first()
            if not patient or patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_demographics_access(self.request.user, patient)

        if self.request.user.user_type in ['doctor', 'nurse']:
            practitioner = PractitionerProfile.objects.filter(
                staff__user=self.request.user
            ).first()
            if practitioner:
                queryset = queryset.filter(practitioner=practitioner)
            else:
                return Appointment.objects.none()

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return AppointmentListSerializer
        return AppointmentSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        is_valid = serializer.is_valid()
        if not is_valid:
            auto_waitlist = str(request.data.get('auto_waitlist', '')).lower() in ('true', '1', 'yes')
            if auto_waitlist:
                waitlist_payload = self._maybe_create_waitlist_on_booking_failure(request, serializer.errors)
                if waitlist_payload:
                    return Response(waitlist_payload, status=status.HTTP_202_ACCEPTED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def _maybe_create_waitlist_on_booking_failure(self, request, errors):
        messages = [message.lower() for message in _flatten_error_messages(errors)]
        capacity_error = any(
            marker in message
            for message in messages
            for marker in (
                'capacity reached',
                'published roster clinic session',
                'no active practitioner capacity',
                'not available for this time',
            )
        )
        if not capacity_error:
            return None

        facility = get_user_facility(request)
        if not facility:
            return None

        clinic_id = request.data.get('clinic')
        patient_id = request.data.get('patient')
        start_time = parse_datetime(request.data.get('start_time') or '')
        end_time = parse_datetime(request.data.get('end_time') or '')
        if not all([clinic_id, patient_id, start_time, end_time]):
            return None

        clinic = Clinic.objects.filter(id=clinic_id, facility=facility, is_active=True).first()
        if not clinic or clinic.booking_mode != Clinic.BookingMode.CLINIC_POOL or not clinic.waitlist_enabled:
            return None

        patient = PatientProfile.objects.filter(id=patient_id, facility=facility).first()
        if not patient:
            return None
        check_demographics_access(request.user, patient)

        referral = None
        referral_id = request.data.get('referral_id')
        if referral_id:
            from apps.referrals.models import Referral
            referral = Referral.objects.filter(id=referral_id, facility=facility).first()

        preferred_practitioner = None
        practitioner_id = request.data.get('practitioner')
        if practitioner_id:
            preferred_practitioner = PractitionerProfile.objects.filter(id=practitioner_id).first()

        from apps.referrals.services import ClinicWaitlistService

        entry = ClinicWaitlistService.create_or_update_entry(
            facility=facility,
            clinic=clinic,
            patient=patient,
            requested_start_time=start_time,
            requested_end_time=end_time,
            urgency=request.data.get('urgency') or 'routine',
            referral=referral,
            preferred_practitioner=preferred_practitioner,
            vulnerability_flag=str(request.data.get('vulnerability_flag', '')).lower() in ('true', '1', 'yes'),
            source='booking',
            notes='Auto-created after booking capacity rejection.',
            actor=request.user,
        )

        return {
            'waitlisted': True,
            'waitlist_entry_id': str(entry.id),
            'clinic_id': str(clinic.id),
            'status': entry.status,
            'detail': 'Clinic session is full; patient has been placed on waitlist.',
        }

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        patient = serializer.validated_data.get('patient')
        if not patient or patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_demographics_access(self.request.user, patient)

        clinic = serializer.validated_data.get('clinic')
        if clinic and clinic.facility_id != facility.id:
            raise PermissionDenied("Clinic does not belong to the active facility.")

        practitioner = serializer.validated_data.get('practitioner')
        if self.request.user.user_type in ['doctor', 'nurse']:
            practitioner_profile = PractitionerProfile.objects.filter(
                staff__user=self.request.user
            ).first()
            if practitioner_profile and practitioner != practitioner_profile:
                raise PermissionDenied("Clinicians can only create appointments for themselves.")

        assignment_kwargs = {}
        if practitioner:
            assignment_kwargs.update({
                'assignment_status': Appointment.AssignmentStatus.ASSIGNED,
                'assignment_source': Appointment.AssignmentSource.BOOKING,
                'assigned_at': timezone.now(),
            })

        serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user,
            **assignment_kwargs,
        )

    def perform_update(self, serializer):
        appointment = self.get_object()
        facility = get_user_facility(self.request)
        if not facility or appointment.facility_id != facility.id:
            raise PermissionDenied("Facility context is required.")
        previous_status = appointment.status
        updated = serializer.save(updated_by=self.request.user)

        if (
            previous_status != 'cancelled'
            and updated.status == 'cancelled'
            and updated.clinic_id
            and updated.clinic.waitlist_enabled
        ):
            from apps.referrals.services import ClinicWaitlistService
            try:
                ClinicWaitlistService.promote_next_waiting(
                    clinic=updated.clinic,
                    appointment_type=updated.appointment_type,
                    start_time=updated.start_time,
                    end_time=updated.end_time,
                    actor=self.request.user,
                    practitioner=(updated.practitioner if updated.clinic.booking_mode == Clinic.BookingMode.PRACTITIONER_DIRECT else None),
                )
            except ValueError:
                logger.info(
                    "No promotable waitlist entry for clinic=%s slot=%s-%s",
                    updated.clinic_id,
                    updated.start_time,
                    updated.end_time,
                )

    @action(detail=True, methods=['post'])
    def start_visit(self, request, pk=None):
        appointment = self.get_object()
        if appointment.status in ['cancelled', 'fulfilled', 'noshow']:
            return Response(
                {"error": "Cannot start a visit for a terminal appointment."},
                status=status.HTTP_400_BAD_REQUEST
            )
        encounter = Encounter.objects.filter(appointment=appointment).first()
        if encounter:
            return Response({"encounter_id": str(encounter.id)}, status=status.HTTP_200_OK)

        # SECURITY: check-in is a front-desk operation; enforce demographics access,
        # not clinical access (receptionists must be allowed to check in).
        check_demographics_access(request.user, appointment.patient)

        with transaction.atomic():
            if (
                appointment.clinic
                and appointment.clinic.booking_mode == Clinic.BookingMode.CLINIC_POOL
                and not appointment.practitioner_id
            ):
                ClinicBookingService.assign_pool_practitioner_at_check_in(
                    appointment=appointment,
                    assigned_by=request.user,
                )

            encounter = Encounter.objects.create(
                patient=appointment.patient,
                facility=appointment.facility,
                practitioner=appointment.practitioner,
                clinic=appointment.clinic,
                department=appointment.clinic.department if appointment.clinic else None,
                appointment=appointment,
                encounter_type='outpatient',
                status='in-progress',
                start_time=timezone.now(),
                reason=appointment.reason,
                created_by=request.user,
                updated_by=request.user,
            )

            from apps.organization.services import TeamAssignmentService
            TeamAssignmentService.assign_initial_team(
                encounter=encounter,
                use_roster=True,
                context='outpatient'
            )

            from apps.encounters.services import VisitService
            visit = VisitService.create_visit(encounter, appointment, checked_in_by=request.user)
            # Front desk check-in should place the patient into the waiting room queue by default.
            VisitService.add_to_waiting(visit)

            appointment.status = 'arrived'
            appointment.updated_by = request.user
            appointment.save(update_fields=['status', 'updated_by', 'updated_at'])

        return Response({"encounter_id": str(encounter.id)}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='walk-in-check-in')
    def walk_in_check_in(self, request):
        """
        Front-desk "Arrived now" flow for existing patients.

        Creates a local walk-in Appointment aligned to the next available roster slot
        for a clinic-pool clinic, then checks the patient in (Encounter + OutpatientVisit)
        and places them into the waiting room queue.
        """
        serializer = WalkInCheckInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        patient = PatientProfile.objects.filter(
            id=serializer.validated_data['patient'],
            facility=facility,
        ).select_related('user').first()
        if not patient:
            return Response({"error": "Patient not found in active facility."}, status=status.HTTP_404_NOT_FOUND)
        check_demographics_access(request.user, patient)

        clinic = Clinic.objects.filter(
            id=serializer.validated_data['clinic'],
            facility=facility,
            is_active=True,
        ).select_related('department').first()
        if not clinic:
            return Response({"error": "Clinic not found in active facility."}, status=status.HTTP_404_NOT_FOUND)
        if not clinic.accepts_walk_ins:
            return Response({"error": "This clinic does not accept walk-ins."}, status=status.HTTP_400_BAD_REQUEST)
        if clinic.booking_mode != Clinic.BookingMode.CLINIC_POOL:
            return Response(
                {"error": "Arrived-now check-in is supported only for clinic-pool clinics."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        appointment_type_id = serializer.validated_data.get('appointment_type')
        if appointment_type_id:
            appointment_type = AppointmentType.objects.filter(id=appointment_type_id, is_active=True).first()
        else:
            appointment_type = AppointmentType.objects.filter(is_active=True, category='walk_in').first()
            if not appointment_type:
                appointment_type = AppointmentType.objects.filter(is_active=True).order_by('name').first()
        if not appointment_type:
            return Response(
                {"error": "No active appointment types configured."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tz = timezone.get_current_timezone()
        now = timezone.now()
        local_now = timezone.localtime(now, tz)
        date_str = local_now.date().isoformat()
        slot_payload = ClinicBookingService.get_clinic_roster_slots(
            clinic=clinic,
            start_date=date_str,
            end_date=date_str,
            facility=facility,
        )
        all_slots = slot_payload.get('all_slots') or []
        if not all_slots:
            return Response(
                {"error": "No published roster clinic session found for this clinic today."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Pick the earliest roster slot that is in-progress or upcoming and has remaining capacity.
        local_now_naive = local_now.replace(tzinfo=None)
        grouped = {}
        for slot in all_slots:
            start_str = slot.get('start')
            end_str = slot.get('end')
            if not start_str or not end_str:
                continue
            grouped.setdefault((start_str, end_str), []).append(slot)

        candidate_windows = []
        for (start_str, end_str), slots in grouped.items():
            try:
                window_start = datetime.datetime.fromisoformat(start_str)
                window_end = datetime.datetime.fromisoformat(end_str)
            except ValueError:
                continue
            if window_end <= local_now_naive:
                continue

            remaining = 0
            for slot in slots:
                if slot.get('status') != 'free':
                    continue
                cap = slot.get('capacity') or {}
                cap_remaining = cap.get('remaining')
                if cap_remaining is None:
                    cap_remaining = max(0, int(cap.get('max', 1)) - int(cap.get('booked', 0)))
                if cap_remaining > 0:
                    remaining += cap_remaining

            if remaining > 0:
                candidate_windows.append((window_start, window_end))

        if not candidate_windows:
            return Response(
                {"error": "No available roster slot remaining for this clinic today."},
                status=status.HTTP_409_CONFLICT,
            )

        candidate_windows.sort(key=lambda pair: pair[0])
        chosen_start_naive, chosen_end_naive = candidate_windows[0]
        start_time = timezone.make_aware(chosen_start_naive, tz)
        end_time = timezone.make_aware(chosen_end_naive, tz)

        # Prevent double-booking for the same patient.
        if not ConflictPreventionService.check_patient_availability(
            patient_id=str(patient.id),
            start_time=start_time,
            end_time=end_time,
        ):
            return Response(
                {"error": "Patient already has an appointment during this time."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = (serializer.validated_data.get('reason') or '').strip() or 'Walk-in visit'

        with transaction.atomic():
            appointment = Appointment.objects.create(
                facility=facility,
                patient=patient,
                practitioner=None,
                clinic=clinic,
                appointment_type=appointment_type,
                status='booked',
                source='walk_in',
                start_time=start_time,
                end_time=end_time,
                reason=reason,
                assignment_status=Appointment.AssignmentStatus.PENDING,
                created_by=request.user,
                updated_by=request.user,
            )

            ClinicBookingService.assign_pool_practitioner_at_check_in(
                appointment=appointment,
                assigned_by=request.user,
            )

            encounter = Encounter.objects.create(
                patient=appointment.patient,
                facility=appointment.facility,
                practitioner=appointment.practitioner,
                clinic=appointment.clinic,
                department=appointment.clinic.department if appointment.clinic else None,
                appointment=appointment,
                encounter_type='outpatient',
                status='in-progress',
                start_time=timezone.now(),
                reason=appointment.reason,
                created_by=request.user,
                updated_by=request.user,
            )

            from apps.organization.services import TeamAssignmentService
            TeamAssignmentService.assign_initial_team(
                encounter=encounter,
                use_roster=True,
                context='outpatient'
            )

            from apps.encounters.services import VisitService
            visit = VisitService.create_visit(encounter, appointment, checked_in_by=request.user)
            VisitService.add_to_waiting(visit)

            appointment.status = 'arrived'
            appointment.updated_by = request.user
            appointment.save(update_fields=['status', 'updated_by', 'updated_at'])

        return Response(
            {
                "appointment_id": str(appointment.id),
                "encounter_id": str(encounter.id),
                "clinic_id": str(clinic.id),
                "queue_number": visit.queue_number,
                "visit_status": visit.visit_status,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['get'])
    def available_slots(self, request):
        """
        Get available slots for scheduling using just-in-time computation.
        This computes slots on-demand from recurring schedules without pre-generation.
        """
        practitioner_id = request.query_params.get('practitioner_id')
        clinic_id = request.query_params.get('clinic_id')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        appointment_type_id = request.query_params.get('appointment_type_id')
        use_roster_raw = request.query_params.get('use_roster')

        if not all([start_date, end_date]) or (not practitioner_id and not clinic_id):
            return Response(
                {"error": "Missing required parameters: start_date, end_date, and practitioner_id or clinic_id"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            try:
                use_roster = _parse_optional_bool_param(use_roster_raw, 'use_roster')
            except ValueError as exc:
                return Response(
                    {"error": str(exc)},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            facility = get_user_facility(request)
            practitioners = []
            mode = None

            if clinic_id and not practitioner_id:
                clinic = Clinic.objects.filter(id=clinic_id, facility=facility, is_active=True).first()
                if not clinic:
                    return Response(
                        {"error": "Clinic not found in active facility."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                mode = clinic.booking_mode
                if clinic.booking_mode == Clinic.BookingMode.PRACTITIONER_DIRECT:
                    return Response(
                        {"error": "practitioner_id is required for practitioner-direct clinics."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                slot_payload = ClinicBookingService.get_clinic_roster_slots(
                    clinic=clinic,
                    start_date=start_date,
                    end_date=end_date,
                    facility=facility,
                )
                raw_slots = slot_payload.get('all_slots', [])
                practitioners = slot_payload.get('practitioners', [])
                # Pool clinics are returned as bucketed windows with capacity already computed.
                slots = list(raw_slots)
            else:
                slots = AvailabilityService.compute_available_slots(
                    practitioner_id=practitioner_id,
                    start_date=start_date,
                    end_date=end_date,
                    appointment_type_id=appointment_type_id,
                    facility=facility,
                    use_roster=use_roster,
                )

            status_filter = request.query_params.get('status')
            if status_filter is None and not clinic_id:
                # Preserve legacy behavior for practitioner-based queries.
                status_filter = 'free'
            if status_filter:
                slots = [slot for slot in slots if slot['status'] == status_filter]

            response_payload = {
                "total": len(slots),
                "slots": slots,
            }
            if practitioners:
                response_payload["practitioners"] = practitioners
            if mode:
                response_payload["clinic_mode"] = mode
            return Response(response_payload)

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class AppointmentTypeViewSet(viewsets.ModelViewSet):
    """
    API endpoint for appointment types.
    """
    queryset = AppointmentType.objects.all()
    serializer_class = AppointmentTypeSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]
    pagination_class = StandardResultsSetPagination

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)






class AppointmentFHIRMappingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for appointment FHIR mappings.
    """
    queryset = AppointmentFHIRMapping.objects.all()
    serializer_class = AppointmentFHIRMappingSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]
    pagination_class = StandardResultsSetPagination

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class AppointmentViewSet(viewsets.ViewSet):
    """
    API endpoint for FHIR Appointment resources.
    """
    permission_classes = [
        permissions.IsAuthenticated,
        FacilityScopedPermission,
        (IsAdmin | IsDoctor | IsNurse | IsReceptionist)  # Use the | operator instead of permissions.OR
    ]

    def list(self, request):
        """
        List appointments with optional filtering.
        If the user is a practitioner and no practitioner_id is provided,
        automatically filter by the user's practitioner profile.
        """
        patient_id = request.query_params.get('patient_id')
        practitioner_id = request.query_params.get('practitioner_id')
        date = request.query_params.get('date')
        status = request.query_params.get('status')

        # If user is a doctor or nurse and no practitioner_id is provided,
        # automatically filter by the user's practitioner profile
        # SECURITY: Doctors/nurses MUST only see their own appointments
        if not practitioner_id and request.user.user_type in ['doctor', 'nurse']:
            try:
                # Get the user's practitioner profile
                practitioner_profile = request.user.staff_profile.practitioner_profile
                if practitioner_profile and practitioner_profile.fhir_practitioner_id:
                    practitioner_id = practitioner_profile.fhir_practitioner_id
                else:
                    # No FHIR practitioner ID - return empty results for security
                    return Response({"resourceType": "Bundle", "type": "searchset", "total": 0, "entry": []})
            except (AttributeError, Exception) as e:
                # SECURITY: If we can't determine the practitioner, return empty results
                # Never expose other practitioners' appointments
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Error getting practitioner profile for user {request.user.id}: {str(e)}")
                return Response({"resourceType": "Bundle", "type": "searchset", "total": 0, "entry": []})

        if patient_id:
            patient = _resolve_patient_profile(patient_id)
            if not patient:
                return Response({"resourceType": "Bundle", "type": "searchset", "total": 0, "entry": []})
            facility = get_user_facility(request)
            if facility and patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_demographics_access(request.user, patient)

        appointments = AppointmentProxy.search(
            patient_id=patient_id,
            practitioner_id=practitioner_id,
            date=date,
            status=status
        )

        facility = get_user_facility(request)
        if isinstance(appointments, list):
            appointments = _filter_appointments_by_facility(appointments, facility)
        else:
            appointments = _filter_appointment_bundle(appointments, facility)

        return Response(appointments)

    def retrieve(self, request, pk=None):
        """
        Get a specific appointment by ID.
        """
        try:
            appointment = AppointmentProxy.get(pk)
            facility = get_user_facility(request)
            _ensure_appointment_facility_access(appointment, facility, request.user)
            return Response(appointment)
        except PermissionDenied as exc:
            return Response({"error": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND
            )

    def create(self, request):
        """
        Create a new appointment with conflict prevention.
        """
        try:
            # Extract required fields
            patient_id = request.data.get('patient_id')
            practitioner_id = request.data.get('practitioner_id')
            start_time = request.data.get('start_time')
            end_time = request.data.get('end_time')
            appointment_type_id = request.data.get('appointment_type_id')
            slot_id = request.data.get('slot_id')
            description = request.data.get('description')
            comment = request.data.get('comment')

            # If slot_id is provided but start_time or end_time is missing
            if slot_id and (not start_time or not end_time):
                try:
                    slot = SlotProxy.get(slot_id)
                    if not start_time:
                        start_time = slot.get('start')
                    if not end_time:
                        end_time = slot.get('end')
                except Exception as e:
                    return Response(
                        {"error": f"Could not retrieve slot details: {str(e)}"},
                        status=status.HTTP_400_BAD_REQUEST
                    )

            # Validate required fields
            if not all([patient_id, practitioner_id, start_time, end_time, appointment_type_id]):
                return Response(
                    {"error": "Missing required fields: patient_id, practitioner_id, start_time, end_time, appointment_type_id"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            patient = _resolve_patient_profile(patient_id)
            if not patient:
                return Response(
                    {"error": "Patient not found."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            facility = get_user_facility(request)
            if facility and patient.facility_id != facility.id:
                return Response(
                    {"error": "Patient does not belong to the active facility."},
                    status=status.HTTP_403_FORBIDDEN
                )

            check_demographics_access(request.user, patient)

            # Parse datetime strings
            try:
                start_time = datetime.datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                end_time = datetime.datetime.fromisoformat(end_time.replace('Z', '+00:00'))
            except ValueError:
                return Response(
                    {"error": "Invalid datetime format. Use ISO 8601 format (YYYY-MM-DDTHH:MM:SS)."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Book the appointment with conflict prevention
            success, result = ConflictPreventionService.book_appointment(
                patient_id=patient_id,
                practitioner_id=practitioner_id,
                start_time=start_time,
                end_time=end_time,
                appointment_type_id=appointment_type_id,
                slot_id=slot_id,
                description=description,
                comment=comment
            )

            if success:
                return Response(result, status=status.HTTP_201_CREATED)
            else:
                return Response(result, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def update(self, request, pk=None):
        """
        Update an existing appointment.
        """
        try:
            # Extract fields to update
            start_time = request.data.get('start_time')
            end_time = request.data.get('end_time')
            status_value = request.data.get('status')
            description = request.data.get('description')
            comment = request.data.get('comment')

            # Parse datetime strings if provided
            if start_time:
                start_time = datetime.datetime.fromisoformat(start_time.replace('Z', '+00:00'))
            if end_time:
                end_time = datetime.datetime.fromisoformat(end_time.replace('Z', '+00:00'))

            appointment = AppointmentProxy.get(pk)
            facility = get_user_facility(request)
            _ensure_appointment_facility_access(appointment, facility, request.user)

            # Update the appointment
            updated = AppointmentProxy.update(
                appointment_id=pk,
                start_time=start_time,
                end_time=end_time,
                status=status_value,
                description=description,
                comment=comment
            )

            return Response(updated)

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def destroy(self, request, pk=None):
        """
        Delete an appointment.
        """
        try:
            appointment = AppointmentProxy.get(pk)
            facility = get_user_facility(request)
            _ensure_appointment_facility_access(appointment, facility, request.user)
            AppointmentProxy.delete(pk)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except PermissionDenied as exc:
            return Response({"error": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['get'])
    def available_slots(self, request):
        """
        Get available slots for scheduling using just-in-time computation.
        This computes slots on-demand from recurring schedules without pre-generation.
        """
        practitioner_id = request.query_params.get('practitioner_id')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        appointment_type_id = request.query_params.get('appointment_type_id')

        if not all([practitioner_id, start_date, end_date]):
            return Response(
                {"error": "Missing required parameters: practitioner_id, start_date, end_date"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # Use new just-in-time computation method
            facility = get_user_facility(request)
            slots = AvailabilityService.compute_available_slots(
                practitioner_id=practitioner_id,
                start_date=start_date,
                end_date=end_date,
                appointment_type_id=appointment_type_id,
                facility=facility,
            )

            # Filter to only free slots by default, unless status param says otherwise
            status_filter = request.query_params.get('status', 'free')
            if status_filter:
                slots = [slot for slot in slots if slot['status'] == status_filter]

            return Response({
                "total": len(slots),
                "slots": slots
            })

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class SlotViewSet(viewsets.ViewSet):
    """
    API endpoint for FHIR Slot resources.
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    def list(self, request):
        """
        List slots with optional filtering.
        """
        schedule_id = request.query_params.get('schedule_id')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        status_value = request.query_params.get('status')

        slots = SlotProxy.search(
            schedule_id=schedule_id,
            start_date=start_date,
            end_date=end_date,
            status=status_value
        )

        return Response(slots)

    def retrieve(self, request, pk=None):
        """
        Get a specific slot by ID.
        """
        try:
            slot = SlotProxy.get(pk)
            return Response(slot)
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND
            )

    def update(self, request, pk=None):
        """
        Update a slot's status.
        """
        try:
            status_value = request.data.get('status')

            if not status_value:
                return Response(
                    {"error": "Missing required field: status"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            slot = SlotProxy.update(
                slot_id=pk,
                status=status_value
            )

            return Response(slot)

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ScheduleViewSet(viewsets.ViewSet):
    """
    API endpoint for FHIR Schedule resources.
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]

    def list(self, request):
        """
        List schedules with optional filtering.
        If the user is a practitioner and no practitioner_id is provided,
        automatically filter by the user's practitioner profile.
        """
        practitioner_id = request.query_params.get('practitioner_id')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        active = request.query_params.get('active')

        if active is not None:
            active = active.lower() == 'true'

        # If user is a doctor or nurse and no practitioner_id is provided,
        # automatically filter by the user's practitioner profile
        # SECURITY: Doctors/nurses MUST only see their own schedules
        if not practitioner_id and request.user.user_type in ['doctor', 'nurse']:
            try:
                # Get the user's practitioner profile
                practitioner_profile = request.user.staff_profile.practitioner_profile
                if practitioner_profile and practitioner_profile.fhir_practitioner_id:
                    practitioner_id = practitioner_profile.fhir_practitioner_id
                else:
                    # No FHIR practitioner ID - return empty results for security
                    return Response({"resourceType": "Bundle", "type": "searchset", "total": 0, "entry": []})
            except (AttributeError, Exception) as e:
                # SECURITY: If we can't determine the practitioner, return empty results
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Error getting practitioner profile for user {request.user.id}: {str(e)}")
                return Response({"resourceType": "Bundle", "type": "searchset", "total": 0, "entry": []})

        schedules = ScheduleProxy.search(
            practitioner_id=practitioner_id,
            start_date=start_date,
            end_date=end_date,
            active=active
        )

        return Response(schedules)

    def retrieve(self, request, pk=None):
        """
        Get a specific schedule by ID.
        """
        try:
            schedule = ScheduleProxy.get(pk)
            return Response(schedule)
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_404_NOT_FOUND
            )

    def create(self, request):
        """
        Create a new schedule.
        """
        try:
            practitioner_id = request.data.get('practitioner_id')
            start_date = request.data.get('start_date')
            end_date = request.data.get('end_date')
            service_type = request.data.get('service_type')

            if not all([practitioner_id, start_date, end_date]):
                return Response(
                    {"error": "Missing required fields: practitioner_id, start_date, end_date"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            schedule = ScheduleProxy.create(
                practitioner_id=practitioner_id,
                start_date=start_date,
                end_date=end_date,
                service_type=service_type
            )

            return Response(schedule, status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def update(self, request, pk=None):
        """
        Update a schedule.
        """
        try:
            start_date = request.data.get('start_date')
            end_date = request.data.get('end_date')
            active = request.data.get('active')

            if active is not None:
                active = active.lower() == 'true'

            schedule = ScheduleProxy.update(
                schedule_id=pk,
                start_date=start_date,
                end_date=end_date,
                active=active
            )

            return Response(schedule)

        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def destroy(self, request, pk=None):
        """
        Delete a schedule.
        """
        try:
            ScheduleProxy.delete(pk)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


# In appointments/views.py (add this to your existing views)

class ScheduleFHIRMappingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing schedule FHIR mappings.
    """
    queryset = ScheduleFHIRMapping.objects.all()
    serializer_class = ScheduleFHIRMappingSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter mappings by practitioner, template, or date range.
        """
        queryset = ScheduleFHIRMapping.objects.all()

        practitioner_id = self.request.query_params.get('practitioner_id')
        template_id = self.request.query_params.get('template_id')
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        status = self.request.query_params.get('status')

        if practitioner_id:
            queryset = queryset.filter(practitioner_id=practitioner_id)

        if template_id:
            queryset = queryset.filter(template_id=template_id)

        if start_date:
            queryset = queryset.filter(start_date__gte=start_date)

        if end_date:
            queryset = queryset.filter(end_date__lte=end_date)

        if status:
            queryset = queryset.filter(status=status)

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """
        Cancel a schedule and its associated slots.
        """
        mapping = self.get_object()

        try:
            # Update FHIR Schedule to inactive
            ScheduleProxy.update(
                schedule_id=mapping.fhir_schedule_id,
                active=False
            )

            # Find all slots for this schedule and cancel them
            slots_response = SlotProxy.search(schedule_id=mapping.fhir_schedule_id)

            if 'entry' in slots_response:
                for entry in slots_response['entry']:
                    slot = entry.get('resource', {})
                    if slot.get('status') == 'free':
                        SlotProxy.update(
                            slot_id=slot.get('id'),
                            status='busy-unavailable'
                        )

            # Update local mapping status
            mapping.status = "cancelled"
            mapping.save()

            return Response({
                "message": "Schedule cancelled successfully"
            })
        except Exception as e:
            logger.error(f"Failed to cancel schedule: {str(e)}")
            return Response(
                {"error": "Failed to cancel schedule. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class RecurringAppointmentRuleViewSet(viewsets.ModelViewSet):
    """
    API endpoint for recurring appointment rules.
    """
    queryset = RecurringAppointmentRule.objects.all()
    serializer_class = RecurringAppointmentRuleSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]
    pagination_class = StandardResultsSetPagination

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def generate_appointments(self, request, pk=None):
        """
        Generate recurring appointments based on the rule.
        """
        rule = self.get_object()

        # Get the appointment type
        appointment_type = rule.appointment_type

        # Get the start and end dates
        start_date = rule.start_date
        end_date = rule.end_date

        if not end_date and rule.max_occurrences:
            # Calculate end date based on max occurrences
            if rule.frequency == 'daily':
                end_date = start_date + datetime.timedelta(days=rule.interval * rule.max_occurrences)
            elif rule.frequency == 'weekly':
                end_date = start_date + datetime.timedelta(weeks=rule.interval * rule.max_occurrences)
            elif rule.frequency == 'monthly':
                # Approximate months as 30 days
                end_date = start_date + datetime.timedelta(days=30 * rule.interval * rule.max_occurrences)

        if not end_date:
            return Response(
                {"error": "Could not determine end date for recurring appointments."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            appointments_created = 0
            current_date = start_date

            while current_date <= end_date and (not rule.max_occurrences or appointments_created < rule.max_occurrences):
                create_appointment = False

                if rule.frequency == 'daily':
                    create_appointment = True
                elif rule.frequency == 'weekly':
                    # Check if this day of week is selected
                    weekday = current_date.weekday()
                    if (weekday == 0 and rule.monday) or \
                       (weekday == 1 and rule.tuesday) or \
                       (weekday == 2 and rule.wednesday) or \
                       (weekday == 3 and rule.thursday) or \
                       (weekday == 4 and rule.friday) or \
                       (weekday == 5 and rule.saturday) or \
                       (weekday == 6 and rule.sunday):
                        create_appointment = True
                elif rule.frequency == 'monthly' and current_date.day == rule.day_of_month:
                    create_appointment = True

                if create_appointment:
                    # Create start and end times
                    start_time = datetime.datetime.combine(
                        current_date, 
                        datetime.time(9, 0)  # Default to 9:00 AM
                    )
                    end_time = start_time + datetime.timedelta(minutes=appointment_type.duration_minutes)

                    # Use AppointmentProxy to create the appointment
                    AppointmentProxy.create(
                        start_time=start_time,
                        end_time=end_time,
                        patient_id="placeholder",  # This will need to be updated when booking
                        practitioner_id="placeholder",  # This will need to be updated when booking
                        appointment_type=appointment_type.name,
                        status="proposed",
                        description=appointment_type.description,
                        comment=f"Recurring appointment from rule: {rule.id}"
                    )
                    appointments_created += 1

                # Increment date based on frequency and interval
                if rule.frequency == 'daily':
                    current_date += datetime.timedelta(days=rule.interval)
                elif rule.frequency == 'weekly':
                    current_date += datetime.timedelta(days=1)
                    # If we've gone through a full week, skip ahead based on interval
                    if current_date.weekday() == 0 and rule.interval > 1:
                        current_date += datetime.timedelta(weeks=rule.interval - 1)
                elif rule.frequency == 'monthly':
                    # Move to the next month
                    if current_date.month == 12:
                        next_month = 1
                        next_year = current_date.year + 1
                    else:
                        next_month = current_date.month + 1
                        next_year = current_date.year

                    # Try to maintain the same day of month
                    try:
                        current_date = current_date.replace(year=next_year, month=next_month)
                    except ValueError:
                        # Handle case where the day doesn't exist in the next month
                        if next_month == 2:
                            current_date = current_date.replace(year=next_year, month=next_month, day=28)
                        else:
                            current_date = current_date.replace(year=next_year, month=next_month, day=30)

            return Response({
                "message": f"Successfully created {appointments_created} recurring appointments."
            })

        except Exception as e:
            logger.error(f"Failed to generate recurring appointments: {str(e)}")
            return Response(
                {"error": "Failed to generate recurring appointments. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class RecurringScheduleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing recurring schedules.
    """
    queryset = RecurringSchedule.objects.all()
    serializer_class = RecurringScheduleSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin | IsDoctor]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter schedules by practitioner and active status.
        Doctors/nurses automatically see only their own schedules.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return RecurringSchedule.objects.none()
        queryset = RecurringSchedule.objects.filter(facility=facility)
        practitioner_id = self.request.query_params.get('practitioner')
        is_active = self.request.query_params.get('is_active')

        # Auto-filter for doctors/nurses to only see their own schedules
        if not practitioner_id and self.request.user.user_type in ['doctor', 'nurse']:
            try:
                practitioner_profile = self.request.user.staff_profile.practitioner_profile
                if practitioner_profile:
                    practitioner_id = str(practitioner_profile.id)
            except (AttributeError, Exception):
                pass

        if practitioner_id:
            queryset = queryset.filter(practitioner_id=practitioner_id)

        if is_active is not None:
            active_bool = is_active.lower() == 'true'
            queryset = queryset.filter(is_active=active_bool)

        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            facility=facility,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def preview_slots(self, request):
        """
        Preview slots for a given schedule configuration.
        """
        try:
            start_time_str = request.data.get('start_time')
            end_time_str = request.data.get('end_time')
            slot_duration = int(request.data.get('slot_duration', 30))
            breaks = request.data.get('breaks', [])
            
            if not start_time_str or not end_time_str:
                return Response(
                    {"error": "start_time and end_time are required"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            start_time = datetime.datetime.strptime(start_time_str, '%H:%M').time()
            end_time = datetime.datetime.strptime(end_time_str, '%H:%M').time()
            
            # Generate preview slots
            slots = []
            current_time = start_time
            
            while current_time < end_time:
                # Calculate slot end time
                # We need a dummy date to do time arithmetic
                dummy_date = datetime.date.today()
                slot_end_datetime = datetime.datetime.combine(dummy_date, current_time) + datetime.timedelta(minutes=slot_duration)
                slot_end_time = slot_end_datetime.time()

                # Ensure slot doesn't go beyond the schedule end time
                if slot_end_time > end_time:
                    break

                # Check if slot overlaps with any break
                is_break_time = False
                for break_period in breaks:
                    break_start = datetime.datetime.strptime(break_period['start'], '%H:%M').time()
                    break_end = datetime.datetime.strptime(break_period['end'], '%H:%M').time()
                    
                    if current_time < break_end and slot_end_time > break_start:
                        is_break_time = True
                        if slot_end_time < break_end:
                            current_time = break_end
                        else:
                            if current_time >= break_start:
                                current_time = break_end
                        break
                
                if not is_break_time:
                    slots.append({
                        "start": current_time.strftime('%H:%M'),
                        "end": slot_end_time.strftime('%H:%M')
                    })
                    current_time = slot_end_time
            
            return Response({"slots": slots})

        except Exception as e:
            logger.error(f"Failed to preview slots: {str(e)}")
            return Response(
                {"error": "Failed to preview slots. Please try again."},
                status=status.HTTP_400_BAD_REQUEST
            )


class BatchGenerationViewSet(viewsets.ViewSet):
    """
    ViewSet for batch generation of slots.

    DEPRECATED: This endpoint is deprecated as of the new just-in-time slot computation.
    Slots are now computed on-demand when requested via the available_slots endpoint.
    This approach is more efficient and doesn't require pre-generation.

    This endpoint is kept for backwards compatibility but will be removed in a future version.
    """
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin | IsDoctor]

    @action(detail=False, methods=['post'])
    def generate_slots(self, request):
        """
        Generate slots for all practitioners with active recurring schedules.

        DEPRECATED: Use the just-in-time computation approach instead.
        """
        import warnings
        warnings.warn(
            "Batch slot generation is deprecated. Slots are now computed on-demand.",
            DeprecationWarning,
            stacklevel=2
        )
        try:
            days = request.data.get('days', 14)

            # Validate days parameter
            try:
                days = int(days)
                if days <= 0:
                    return Response(
                        {"error": "Days parameter must be a positive integer"},
                        status=status.HTTP_400_BAD_REQUEST
                    )
            except (ValueError, TypeError):
                return Response(
                    {"error": "Days parameter must be a valid integer"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Call the service to generate slots
            facility = get_user_facility(request)
            result = AvailabilityService.batch_generate_slots_for_next_n_days(
                days=days,
                user=request.user,
                facility=facility,
            )

            return Response(result)

        except Exception as e:
            logger.error(f"Failed to batch generate slots: {str(e)}")
            return Response(
                {"error": "Failed to batch generate slots. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class BlockedTimeViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing blocked times (one-off schedule exceptions).
    Blocked times override recurring schedules for specific dates/times.
    """
    queryset = BlockedTime.objects.all()
    serializer_class = BlockedTimeSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin | IsDoctor]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter blocked times by practitioner and date range.
        Doctors/nurses automatically see only their own blocked times.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return BlockedTime.objects.none()
        queryset = BlockedTime.objects.filter(facility=facility)

        practitioner_id = self.request.query_params.get('practitioner_id')
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        # Auto-filter for doctors/nurses to only see their own blocked times
        if not practitioner_id and self.request.user.user_type in ['doctor', 'nurse']:
            try:
                practitioner_profile = self.request.user.staff_profile.practitioner_profile
                if practitioner_profile:
                    practitioner_id = str(practitioner_profile.id)
            except (AttributeError, Exception):
                pass

        if practitioner_id:
            queryset = queryset.filter(practitioner_id=practitioner_id)

        if start_date:
            queryset = queryset.filter(date__gte=start_date)

        if end_date:
            queryset = queryset.filter(date__lte=end_date)

        return queryset.select_related('practitioner', 'practitioner__staff', 'practitioner__staff__user')

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            facility=facility,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def bulk_create(self, request):
        """
        Create multiple blocked times at once.
        Useful for blocking vacation periods or multiple days.

        Request body:
        {
            "practitioner_id": "uuid",
            "start_date": "2025-12-01",
            "end_date": "2025-12-15",
            "reason": "Vacation",
            "is_all_day": true
        }
        """
        try:
            practitioner_id = request.data.get('practitioner_id')
            start_date_str = request.data.get('start_date')
            end_date_str = request.data.get('end_date')
            reason = request.data.get('reason')
            is_all_day = request.data.get('is_all_day', True)
            start_time = request.data.get('start_time')
            end_time = request.data.get('end_time')

            if not all([practitioner_id, start_date_str, end_date_str, reason]):
                return Response(
                    {"error": "Missing required fields: practitioner_id, start_date, end_date, reason"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            start_date = datetime.datetime.strptime(start_date_str, '%Y-%m-%d').date()
            end_date = datetime.datetime.strptime(end_date_str, '%Y-%m-%d').date()
            facility = get_user_facility(request)
            if not facility:
                return Response(
                    {"error": "Facility context is required."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Create blocked time for each day in the range
            blocked_times = []
            current_date = start_date

            while current_date <= end_date:
                blocked_time = BlockedTime.objects.create(
                    practitioner_id=practitioner_id,
                    facility=facility,
                    date=current_date,
                    start_time=start_time if start_time else datetime.time(0, 0),
                    end_time=end_time if end_time else datetime.time(23, 59),
                    reason=reason,
                    is_all_day=is_all_day,
                    created_by=request.user,
                    updated_by=request.user
                )
                blocked_times.append(blocked_time)
                current_date += datetime.timedelta(days=1)

            serializer = self.get_serializer(blocked_times, many=True)

            return Response({
                "message": f"Created {len(blocked_times)} blocked time(s)",
                "blocked_times": serializer.data
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.error(f"Failed to create blocked times: {str(e)}")
            return Response(
                {"error": "Failed to create blocked times. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
