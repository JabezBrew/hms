from datetime import timedelta

from django.db import transaction
from django.db.models import Case, Count, IntegerField, Value, When
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.appointments.services import ClinicBookingService, ConflictPreventionService
from apps.referrals.models import (
    ClinicWaitlistEntry,
    ClinicWaitlistEntryStatus,
    ClinicWaitlistRisk,
    Referral,
    ReferralSLAEvent,
    ReferralSLAPolicy,
    ReferralSLAEventType,
    ReferralStatus,
    ReferralUrgency,
)


class ReferralSLAService:
    """Compute referral SLA state and emit threshold/breach events."""

    DEFAULT_TARGET_HOURS = {
        ReferralUrgency.EMERGENCY: 48,
        ReferralUrgency.URGENT: 72,
        ReferralUrgency.ROUTINE: 30 * 24,
    }
    DEFAULT_WARNING_THRESHOLDS = [50, 75, 90]
    OPEN_STATUSES = [ReferralStatus.PENDING, ReferralStatus.ACCEPTED, ReferralStatus.SCHEDULED]
    THRESHOLD_EVENT_MAP = {
        50: ReferralSLAEventType.THRESHOLD_50,
        75: ReferralSLAEventType.THRESHOLD_75,
        90: ReferralSLAEventType.THRESHOLD_90,
    }

    @classmethod
    def resolve_policy(cls, referral):
        base_qs = ReferralSLAPolicy.objects.filter(
            facility=referral.facility,
            urgency=referral.urgency,
            is_active=True,
        )
        department = (referral.referred_to_department or '').strip()
        if department:
            policy = base_qs.filter(referred_to_department=department).first()
            if policy:
                return policy
        return base_qs.filter(referred_to_department='').first()

    @classmethod
    def _start_at(cls, referral):
        # SLA clock starts at triage/acceptance point. Referral acceptance is used as triage equivalent.
        return referral.accepted_at or referral.submitted_at or referral.created_at

    @classmethod
    def compute_state(cls, referral, as_of=None):
        as_of = as_of or timezone.now()
        policy = cls.resolve_policy(referral)
        target_hours = policy.target_hours if policy else cls.DEFAULT_TARGET_HOURS.get(
            referral.urgency,
            cls.DEFAULT_TARGET_HOURS[ReferralUrgency.ROUTINE],
        )
        start_at = cls._start_at(referral)
        deadline_at = start_at + timedelta(hours=target_hours)
        elapsed_hours = max(0, (as_of - start_at).total_seconds() / 3600)
        consumed_percent = int((elapsed_hours / target_hours) * 100) if target_hours > 0 else 0
        remaining_hours = max(0, int((deadline_at - as_of).total_seconds() // 3600))
        remaining_percent = max(0, 100 - consumed_percent)
        breached = as_of >= deadline_at

        if breached:
            risk = ClinicWaitlistRisk.RED
        elif remaining_percent < 20:
            risk = ClinicWaitlistRisk.RED
        elif remaining_percent < 50:
            risk = ClinicWaitlistRisk.AMBER
        else:
            risk = ClinicWaitlistRisk.GREEN

        warning_thresholds = list(policy.warning_thresholds) if policy and policy.warning_thresholds else list(
            cls.DEFAULT_WARNING_THRESHOLDS
        )

        return {
            'policy_id': str(policy.id) if policy else None,
            'target_hours': target_hours,
            'warning_thresholds': warning_thresholds,
            'start_at': start_at,
            'deadline_at': deadline_at,
            'elapsed_hours': elapsed_hours,
            'consumed_percent': consumed_percent,
            'remaining_hours': remaining_hours,
            'remaining_percent': remaining_percent,
            'risk_band': risk,
            'breached': breached,
        }

    @classmethod
    def evaluate_referral(cls, referral, as_of=None):
        if referral.status not in cls.OPEN_STATUSES:
            return []

        state = cls.compute_state(referral, as_of=as_of)
        created_events = []
        thresholds = sorted(
            set(
                threshold
                for threshold in state['warning_thresholds']
                if isinstance(threshold, int) and threshold in cls.THRESHOLD_EVENT_MAP
            )
        )
        for threshold in thresholds:
            if state['consumed_percent'] >= threshold:
                event_type = cls.THRESHOLD_EVENT_MAP[threshold]
                event, created = ReferralSLAEvent.objects.get_or_create(
                    referral=referral,
                    event_type=event_type,
                    defaults={
                        'facility': referral.facility,
                        'consumed_percent': min(999, state['consumed_percent']),
                        'target_hours': state['target_hours'],
                        'remaining_hours': state['remaining_hours'],
                        'deadline_at': state['deadline_at'],
                    },
                )
                if created:
                    created_events.append(event)

        if state['breached']:
            event, created = ReferralSLAEvent.objects.get_or_create(
                referral=referral,
                event_type=ReferralSLAEventType.BREACH,
                defaults={
                    'facility': referral.facility,
                    'consumed_percent': min(999, state['consumed_percent']),
                    'target_hours': state['target_hours'],
                    'remaining_hours': 0,
                    'deadline_at': state['deadline_at'],
                },
            )
            if created:
                created_events.append(event)

        return created_events

    @classmethod
    def evaluate_open_referrals(cls, facility=None, limit=None):
        queryset = Referral.objects.filter(status__in=cls.OPEN_STATUSES)
        if facility:
            queryset = queryset.filter(facility=facility)
        queryset = queryset.select_related('facility')
        if limit:
            queryset = queryset.order_by('created_at')[:limit]

        created_events = 0
        processed = 0
        for referral in queryset.iterator():
            processed += 1
            created_events += len(cls.evaluate_referral(referral))
        return {'processed': processed, 'events_created': created_events}


class ClinicWaitlistService:
    """Waitlist ranking, offers, and promotion for clinic bookings."""

    ACTIVE_STATUSES = [ClinicWaitlistEntryStatus.WAITING, ClinicWaitlistEntryStatus.OFFERED]
    URGENCY_ORDER = {
        ReferralUrgency.EMERGENCY: 0,
        ReferralUrgency.URGENT: 1,
        ReferralUrgency.ROUTINE: 2,
    }
    RISK_ORDER = {
        ClinicWaitlistRisk.RED: 0,
        ClinicWaitlistRisk.AMBER: 1,
        ClinicWaitlistRisk.GREEN: 2,
        ClinicWaitlistRisk.NONE: 3,
    }

    @classmethod
    def _refresh_deadline_risk(cls, entry):
        if not entry.referral_id:
            return entry.deadline_risk
        state = ReferralSLAService.compute_state(entry.referral)
        return state['risk_band']

    @classmethod
    def create_or_update_entry(
        cls,
        *,
        facility,
        clinic,
        patient,
        requested_start_time,
        requested_end_time,
        urgency=ReferralUrgency.ROUTINE,
        referral=None,
        preferred_practitioner=None,
        vulnerability_flag=False,
        source=ClinicWaitlistEntry.Source.MANUAL,
        notes='',
        actor=None,
    ):
        if requested_start_time >= requested_end_time:
            raise ValueError('requested_end_time must be after requested_start_time.')
        if clinic.facility_id != facility.id:
            raise ValueError('Clinic must belong to active facility.')
        if patient.facility_id != facility.id:
            raise ValueError('Patient must belong to active facility.')
        if referral and referral.facility_id != facility.id:
            raise ValueError('Referral must belong to active facility.')

        entry_defaults = {
            'requested_start_time': requested_start_time,
            'requested_end_time': requested_end_time,
            'urgency': referral.urgency if referral else urgency,
            'referral': referral,
            'preferred_practitioner': preferred_practitioner,
            'vulnerability_flag': vulnerability_flag,
            'source': source,
            'notes': notes or '',
            'deadline_risk': ClinicWaitlistRisk.NONE,
            'updated_by': actor,
        }

        with transaction.atomic():
            entry = (
                ClinicWaitlistEntry.objects.select_for_update()
                .filter(
                    facility=facility,
                    clinic=clinic,
                    patient=patient,
                    status__in=[ClinicWaitlistEntryStatus.WAITING, ClinicWaitlistEntryStatus.OFFERED],
                )
                .order_by('wait_started_at')
                .first()
            )
            created = entry is None
            if created:
                entry = ClinicWaitlistEntry(
                    facility=facility,
                    clinic=clinic,
                    patient=patient,
                    created_by=actor,
                    **entry_defaults,
                )
            else:
                for field, value in entry_defaults.items():
                    setattr(entry, field, value)
                entry.status = ClinicWaitlistEntryStatus.WAITING
                entry.offer_sent_at = None
                entry.offer_expires_at = None

            if entry.referral_id:
                entry.deadline_risk = cls._refresh_deadline_risk(entry)

            update_fields = [
                'requested_start_time', 'requested_end_time',
                'urgency', 'referral', 'preferred_practitioner',
                'vulnerability_flag', 'source', 'notes',
                'deadline_risk', 'status', 'offer_sent_at',
                'offer_expires_at', 'updated_at',
            ]
            if actor:
                update_fields.append('updated_by')
            if created:
                entry.save()
            else:
                entry.save(update_fields=update_fields)

        return entry

    @classmethod
    def rank_queryset(cls, queryset):
        return (
            queryset.annotate(
                urgency_rank=Case(
                    *[
                        When(urgency=value, then=Value(rank))
                        for value, rank in cls.URGENCY_ORDER.items()
                    ],
                    default=Value(99),
                    output_field=IntegerField(),
                ),
                risk_rank=Case(
                    *[
                        When(deadline_risk=value, then=Value(rank))
                        for value, rank in cls.RISK_ORDER.items()
                    ],
                    default=Value(99),
                    output_field=IntegerField(),
                ),
                vulnerability_rank=Case(
                    When(vulnerability_flag=True, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                ),
            )
            .order_by('urgency_rank', 'risk_rank', 'vulnerability_rank', 'wait_started_at')
        )

    @classmethod
    def offer_next(cls, clinic, start_time=None, end_time=None, expires_minutes=30, actor=None):
        queryset = ClinicWaitlistEntry.objects.filter(
            clinic=clinic,
            status=ClinicWaitlistEntryStatus.WAITING,
        ).select_related('referral')
        if start_time and end_time:
            queryset = queryset.filter(
                requested_start_time__lt=end_time,
                requested_end_time__gt=start_time,
            )
        entry = cls.rank_queryset(queryset).first()
        if not entry:
            return None

        now = timezone.now()
        entry.status = ClinicWaitlistEntryStatus.OFFERED
        entry.offer_sent_at = now
        entry.offer_expires_at = now + timedelta(minutes=expires_minutes)
        if actor:
            entry.updated_by = actor
        update_fields = ['status', 'offer_sent_at', 'offer_expires_at', 'updated_at']
        if actor:
            update_fields.append('updated_by')
        entry.save(update_fields=update_fields)
        return entry

    @classmethod
    def expire_offers(cls, as_of=None):
        as_of = as_of or timezone.now()
        expired = ClinicWaitlistEntry.objects.filter(
            status=ClinicWaitlistEntryStatus.OFFERED,
            offer_expires_at__lt=as_of,
        )
        count = expired.update(
            status=ClinicWaitlistEntryStatus.EXPIRED,
            updated_at=as_of,
        )
        return count

    @classmethod
    def promote_entry(
        cls,
        *,
        entry,
        appointment_type,
        actor=None,
        practitioner=None,
    ):
        if entry.status not in cls.ACTIVE_STATUSES:
            raise ValueError('Only waiting/offered entries can be promoted.')

        clinic = entry.clinic
        if clinic.booking_mode == clinic.BookingMode.PRACTITIONER_DIRECT and not practitioner:
            practitioner = entry.preferred_practitioner
        if clinic.booking_mode == clinic.BookingMode.PRACTITIONER_DIRECT and not practitioner:
            raise ValueError('Practitioner is required for practitioner-direct clinics.')

        if clinic.booking_mode == clinic.BookingMode.CLINIC_POOL:
            valid, message = ClinicBookingService.validate_pool_booking(
                clinic=clinic,
                start_time=entry.requested_start_time,
                end_time=entry.requested_end_time,
                facility=entry.facility,
            )
            if not valid:
                raise ValueError(message)

        if practitioner and not ConflictPreventionService.check_practitioner_availability(
            practitioner_id=str(practitioner.id),
            start_time=entry.requested_start_time,
            end_time=entry.requested_end_time,
        ):
            raise ValueError('Practitioner is not available in the requested time window.')

        if not ConflictPreventionService.check_patient_availability(
            patient_id=str(entry.patient_id),
            start_time=entry.requested_start_time,
            end_time=entry.requested_end_time,
        ):
            raise ValueError('Patient already has an overlapping appointment.')

        assignment_fields = {}
        if practitioner:
            assignment_fields = {
                'assignment_status': Appointment.AssignmentStatus.ASSIGNED,
                'assignment_source': Appointment.AssignmentSource.BOOKING,
                'assigned_at': timezone.now(),
            }

        with transaction.atomic():
            appointment = Appointment.objects.create(
                facility=entry.facility,
                patient=entry.patient,
                practitioner=practitioner,
                clinic=clinic,
                appointment_type=appointment_type,
                status='booked',
                source='scheduled',
                start_time=entry.requested_start_time,
                end_time=entry.requested_end_time,
                reason=f"Promoted from waitlist ({entry.source})",
                notes=entry.notes or '',
                created_by=actor,
                updated_by=actor,
                **assignment_fields,
            )

            entry.status = ClinicWaitlistEntryStatus.PROMOTED
            entry.promoted_appointment = appointment
            entry.offer_expires_at = None
            entry.offer_sent_at = entry.offer_sent_at or timezone.now()
            if actor:
                entry.updated_by = actor
            update_fields = [
                'status', 'promoted_appointment',
                'offer_expires_at', 'offer_sent_at',
                'updated_at',
            ]
            if actor:
                update_fields.append('updated_by')
            entry.save(update_fields=update_fields)

        return appointment

    @classmethod
    def promote_next_waiting(cls, clinic, appointment_type, start_time, end_time, actor=None, practitioner=None):
        entry = cls.offer_next(
            clinic=clinic,
            start_time=start_time,
            end_time=end_time,
            expires_minutes=30,
            actor=actor,
        )
        if not entry:
            return None
        return cls.promote_entry(
            entry=entry,
            appointment_type=appointment_type,
            actor=actor,
            practitioner=practitioner,
        )

    @classmethod
    def summarize_waiting(cls, facility=None):
        queryset = ClinicWaitlistEntry.objects.filter(status=ClinicWaitlistEntryStatus.WAITING)
        if facility:
            queryset = queryset.filter(facility=facility)
        return queryset.values('urgency', 'deadline_risk').annotate(total=Count('id')).order_by('urgency', 'deadline_risk')
