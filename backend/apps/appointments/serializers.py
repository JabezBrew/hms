import uuid

from django.db import transaction
from django.db.models import Q
from rest_framework import serializers

from .models import (
    Appointment,
    AppointmentType, AppointmentFHIRMapping, RecurringAppointmentRule,
    ScheduleFHIRMapping, RecurringSchedule, BlockedTime
)
from ..users.serializers import PatientProfileSerializer, PractitionerProfileSerializer
from ..users.models import PractitionerProfile
from apps.core.security import get_user_facility
from apps.organization.models import Clinic


RECURRING_SLOT_DURATION_ERROR = 'Slot duration must be a positive integer.'


class AppointmentTypeSerializer(serializers.ModelSerializer):
    """
    Serializer for the AppointmentType model.
    """
    class Meta:
        model = AppointmentType
        fields = ['id', 'name', 'description', 'duration_minutes', 'color', 
                  'is_active', 'category', 'created_at', 'updated_at', 
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class AppointmentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for appointment lists."""
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    practitioner_name = serializers.CharField(source='practitioner.staff.user.get_full_name', read_only=True)
    clinic_name = serializers.CharField(source='clinic.name', read_only=True)
    appointment_type_name = serializers.CharField(source='appointment_type.name', read_only=True)

    class Meta:
        model = Appointment
        fields = [
            'id', 'patient', 'patient_name', 'practitioner', 'practitioner_name',
            'clinic', 'clinic_name', 'appointment_type', 'appointment_type_name', 'status',
            'start_time', 'end_time', 'source'
        ]


class AppointmentSerializer(serializers.ModelSerializer):
    """Serializer for appointment detail and create/update."""
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    practitioner_details = PractitionerProfileSerializer(source='practitioner', read_only=True)
    clinic_name = serializers.CharField(source='clinic.name', read_only=True)
    appointment_type_name = serializers.CharField(source='appointment_type.name', read_only=True)

    class Meta:
        model = Appointment
        fields = '__all__'
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def validate(self, data):
        instance = getattr(self, 'instance', None)
        start_time = data.get('start_time', getattr(instance, 'start_time', None))
        end_time = data.get('end_time', getattr(instance, 'end_time', None))
        practitioner = data.get('practitioner', getattr(instance, 'practitioner', None))
        patient = data.get('patient', getattr(instance, 'patient', None))
        clinic = data.get('clinic', getattr(instance, 'clinic', None))
        is_create = instance is None

        if start_time and end_time and start_time >= end_time:
            raise serializers.ValidationError({'end_time': 'End time must be after start time.'})

        if is_create and not clinic:
            raise serializers.ValidationError({'clinic': 'Clinic is required when booking an appointment.'})

        if clinic and clinic.booking_mode == Clinic.BookingMode.PRACTITIONER_DIRECT and not practitioner:
            raise serializers.ValidationError({
                'practitioner': 'Practitioner is required for practitioner-direct clinics.'
            })

        if practitioner and start_time and end_time:
            from .services import ConflictPreventionService, AvailabilityService
            request = self.context.get('request')
            facility = get_user_facility(request) if request else None
            exclude_id = str(instance.id) if instance else None
            if not AvailabilityService.is_slot_available(practitioner, start_time, end_time, facility=facility):
                raise serializers.ValidationError({'start_time': 'Practitioner is not available for that time.'})
            if not ConflictPreventionService.check_practitioner_availability(
                practitioner.id, start_time, end_time, exclude_appointment_id=exclude_id
            ):
                raise serializers.ValidationError({'practitioner': 'Practitioner already has an appointment during this time.'})

        if clinic and clinic.booking_mode == Clinic.BookingMode.CLINIC_POOL and start_time and end_time:
            from .services import ClinicBookingService
            request = self.context.get('request')
            facility = get_user_facility(request) if request else None
            exclude_id = str(instance.id) if instance else None
            should_validate_capacity = (
                is_create or
                any(
                    field in data
                    for field in ('start_time', 'end_time', 'clinic', 'practitioner')
                )
            )
            if should_validate_capacity:
                is_valid, error_message = ClinicBookingService.validate_pool_booking(
                    clinic=clinic,
                    start_time=start_time,
                    end_time=end_time,
                    facility=facility,
                    exclude_appointment_id=exclude_id,
                )
                if not is_valid:
                    raise serializers.ValidationError({'start_time': error_message})

        if patient and start_time and end_time:
            from .services import ConflictPreventionService
            exclude_id = str(instance.id) if instance else None
            if not ConflictPreventionService.check_patient_availability(
                patient.id, start_time, end_time, exclude_appointment_id=exclude_id
            ):
                raise serializers.ValidationError({'patient': 'Patient already has an appointment during this time.'})

        return data


class AppointmentFHIRMappingSerializer(serializers.ModelSerializer):
    """
    Serializer for the AppointmentFHIRMapping model.
    """
    appointment_type_details = AppointmentTypeSerializer(source='appointment_type', read_only=True)

    class Meta:
        model = AppointmentFHIRMapping
        fields = ['id', 'appointment', 'appointment_type', 'appointment_type_details', 
                  'fhir_appointment_id', 'fhir_schedule_id', 'fhir_slot_id', 
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class RecurringAppointmentRuleSerializer(serializers.ModelSerializer):
    """
    Serializer for the RecurringAppointmentRule model.
    """
    appointment_type_details = AppointmentTypeSerializer(source='appointment_type', read_only=True)

    class Meta:
        model = RecurringAppointmentRule
        fields = ['id', 'appointment_type', 'appointment_type_details', 'frequency', 
                  'interval', 'start_date', 'end_date', 'max_occurrences', 
                  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 
                  'saturday', 'sunday', 'day_of_month', 'created_at', 
                  'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def validate(self, data):
        """
        Validate that appropriate fields are set based on frequency.
        """
        frequency = data.get('frequency')

        if frequency == 'weekly':
            # At least one day of week must be selected for weekly recurrence
            weekdays = [
                data.get('monday', False),
                data.get('tuesday', False),
                data.get('wednesday', False),
                data.get('thursday', False),
                data.get('friday', False),
                data.get('saturday', False),
                data.get('sunday', False)
            ]

            if not any(weekdays):
                raise serializers.ValidationError(
                    "At least one day of the week must be selected for weekly recurrence."
                )

        elif frequency == 'monthly' and not data.get('day_of_month'):
            raise serializers.ValidationError(
                "Day of month is required for monthly recurrence."
            )

        # Either end_date or max_occurrences should be provided
        if not data.get('end_date') and not data.get('max_occurrences'):
            raise serializers.ValidationError(
                "Either end date or maximum occurrences must be specified."
            )

        return data

# In appointments/serializers.py (add this to your existing serializers)

class ScheduleFHIRMappingSerializer(serializers.ModelSerializer):
    practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = ScheduleFHIRMapping
        fields = [
            'id', 'fhir_schedule_id', 'practitioner', 'practitioner_name', 
            'start_date', 'end_date', 'status', 'slots_count', 'created_at', 'created_by'
        ]
        read_only_fields = ['created_at', 'created_by']

    def get_practitioner_name(self, obj):
        if obj.practitioner and hasattr(obj.practitioner, 'staff') and hasattr(obj.practitioner.staff, 'user'):
            return f"{obj.practitioner.staff.user.first_name} {obj.practitioner.staff.user.last_name}"
        return "Unknown"


class RecurringScheduleSerializer(serializers.ModelSerializer):
    """
    Serializer for the RecurringSchedule model.
    """
    slot_duration = serializers.IntegerField(
        min_value=1,
        error_messages={'min_value': RECURRING_SLOT_DURATION_ERROR}
    )
    practitioner_name = serializers.SerializerMethodField()
    practitioners = serializers.ListField(
        child=serializers.UUIDField(),
        write_only=True,
        required=False,
        allow_empty=False,
        help_text="Optional list of practitioners to clone this schedule to"
    )

    class Meta:
        model = RecurringSchedule
        fields = [
            'id', 'name', 'practitioner', 'practitioner_name', 'days_of_week',
            'start_time', 'end_time', 'slot_duration', 'active_from', 'active_to',
            'breaks', 'is_active', 'template_key', 'template_name', 'practitioners',
            'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = ['template_key', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def get_practitioner_name(self, obj):
        if obj.practitioner and hasattr(obj.practitioner, 'staff') and hasattr(obj.practitioner.staff, 'user'):
            return f"{obj.practitioner.staff.user.first_name} {obj.practitioner.staff.user.last_name}"
        return "Unknown"

    @staticmethod
    def _times_overlap(start1, end1, start2, end2):
        return start1 < end2 and end1 > start2

    @staticmethod
    def _date_range_overlap_filter(start_date, end_date):
        overlap_filter = Q(active_to__isnull=True) | Q(active_to__gte=start_date)
        if end_date:
            overlap_filter &= Q(active_from__lte=end_date)
        return overlap_filter

    def _validate_overlapping_recurring_schedules(
        self,
        practitioner,
        days_of_week,
        start_time,
        end_time,
        active_from,
        active_to,
    ):
        conflicting = RecurringSchedule.objects.filter(
            practitioner=practitioner,
            is_active=True,
            days_of_week__overlap=days_of_week,
            start_time__lt=end_time,
            end_time__gt=start_time,
        ).filter(self._date_range_overlap_filter(active_from, active_to))

        if self.instance:
            conflicting = conflicting.exclude(id=self.instance.id)

        if conflicting.exists():
            raise serializers.ValidationError({
                'start_time': (
                    'This schedule overlaps with another active recurring schedule '
                    f'for {practitioner.staff.user.get_full_name()}.'
                )
            })

    def _validate_overlapping_roster_entries(
        self,
        practitioner,
        days_of_week,
        start_time,
        end_time,
        active_from,
        active_to,
        facility,
    ):
        from apps.organization.models import RosterEntry, StaffUnitAssignment

        assignment_qs = StaffUnitAssignment.objects.filter(
            practitioner=practitioner,
            is_active=True,
        ).filter(
            Q(effective_until__isnull=True) | Q(effective_until__gte=active_from)
        )
        if active_to:
            assignment_qs = assignment_qs.filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=active_to)
            )
        team_ids = list(assignment_qs.values_list('unit_id', flat=True))

        roster_qs = RosterEntry.objects.filter(
            status='published',
            duty_type__category='clinic',
            date__gte=active_from,
        ).filter(
            Q(practitioner=practitioner) | Q(team_id__in=team_ids)
        ).select_related('duty_type', 'duty_type__clinic')

        if active_to:
            roster_qs = roster_qs.filter(date__lte=active_to)
        if facility:
            roster_qs = roster_qs.filter(
                Q(duty_type__clinic__facility=facility) | Q(duty_type__clinic__isnull=True)
            )

        for entry in roster_qs:
            if entry.date.weekday() not in days_of_week:
                continue

            duty_type = entry.duty_type
            if duty_type.is_24_hour:
                raise serializers.ValidationError({
                    'start_time': (
                        'This schedule clashes with a published 24-hour clinic roster '
                        f'entry on {entry.date.isoformat()}.'
                    )
                })

            entry_start = entry.start_time or duty_type.start_time
            entry_end = entry.end_time or duty_type.end_time
            if not entry_start or not entry_end:
                continue

            if not self._times_overlap(start_time, end_time, entry_start, entry_end):
                continue

            clinic_name = duty_type.clinic.name if duty_type.clinic else duty_type.name
            raise serializers.ValidationError({
                'start_time': (
                    'This schedule clashes with a published clinic roster entry on '
                    f'{entry.date.isoformat()} ({clinic_name} {entry_start.strftime("%H:%M")}-'
                    f'{entry_end.strftime("%H:%M")}).'
                )
            })

    def validate(self, attrs):
        request = self.context.get('request')
        is_create = self.instance is None

        start_time = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end_time = attrs.get('end_time', getattr(self.instance, 'end_time', None))
        if start_time and end_time and end_time <= start_time:
            raise serializers.ValidationError("end_time must be after start_time.")

        active_from = attrs.get('active_from', getattr(self.instance, 'active_from', None))
        active_to = attrs.get('active_to', getattr(self.instance, 'active_to', None))
        if active_to and active_from and active_to < active_from:
            raise serializers.ValidationError("active_to cannot be before active_from.")

        slot_duration = attrs.get('slot_duration', getattr(self.instance, 'slot_duration', None))
        if slot_duration is not None and slot_duration <= 0:
            raise serializers.ValidationError({'slot_duration': RECURRING_SLOT_DURATION_ERROR})

        facility = get_user_facility(request) if request else None

        if not is_create and 'practitioners' in attrs:
            raise serializers.ValidationError({
                'practitioners': 'Bulk practitioner assignment is only supported on create.'
            })

        if is_create:
            requested_ids = []
            if attrs.get('practitioner'):
                requested_ids.append(str(attrs['practitioner'].id))
            if attrs.get('practitioners'):
                requested_ids.extend([str(practitioner_id) for practitioner_id in attrs['practitioners']])

            unique_ids = list(dict.fromkeys(requested_ids))
            if not unique_ids:
                raise serializers.ValidationError({
                    'practitioner': 'Provide practitioner or practitioners.'
                })

            practitioner_qs = PractitionerProfile.objects.filter(id__in=unique_ids)
            if facility:
                practitioner_qs = practitioner_qs.filter(
                    Q(staff__primary_facility=facility) |
                    Q(staff__primary_facility__isnull=True, staff__user__primary_facility=facility)
                )
            practitioner_map = {str(prac.id): prac for prac in practitioner_qs.select_related('staff__user')}

            missing_ids = [practitioner_id for practitioner_id in unique_ids if practitioner_id not in practitioner_map]
            if missing_ids:
                raise serializers.ValidationError({
                    'practitioners': 'One or more practitioners are invalid for the active facility.'
                })

            if request and request.user.user_type in ['doctor', 'nurse']:
                practitioner_profile = getattr(getattr(request.user, 'staff_profile', None), 'practitioner_profile', None)
                own_practitioner_id = str(practitioner_profile.id) if practitioner_profile else None
                if not own_practitioner_id:
                    raise serializers.ValidationError({
                        'practitioner': 'Your account is not linked to a practitioner profile.'
                    })
                if any(practitioner_id != own_practitioner_id for practitioner_id in unique_ids):
                    raise serializers.ValidationError({
                        'practitioners': 'You can only create recurring schedules for yourself.'
                    })

            practitioners_to_validate = [practitioner_map[practitioner_id] for practitioner_id in unique_ids]
            self._resolved_practitioners = practitioners_to_validate
        else:
            practitioner = attrs.get('practitioner', getattr(self.instance, 'practitioner', None))
            if not practitioner:
                raise serializers.ValidationError({
                    'practitioner': 'Practitioner is required.'
                })
            practitioners_to_validate = [practitioner]

        is_active = attrs.get('is_active', getattr(self.instance, 'is_active', True))
        if is_active:
            days_of_week = attrs.get('days_of_week', getattr(self.instance, 'days_of_week', [])) or []
            active_from = attrs.get('active_from', getattr(self.instance, 'active_from', None))
            active_to = attrs.get('active_to', getattr(self.instance, 'active_to', None))
            start_time = attrs.get('start_time', getattr(self.instance, 'start_time', None))
            end_time = attrs.get('end_time', getattr(self.instance, 'end_time', None))

            for practitioner in practitioners_to_validate:
                self._validate_overlapping_recurring_schedules(
                    practitioner=practitioner,
                    days_of_week=days_of_week,
                    start_time=start_time,
                    end_time=end_time,
                    active_from=active_from,
                    active_to=active_to,
                )
                self._validate_overlapping_roster_entries(
                    practitioner=practitioner,
                    days_of_week=days_of_week,
                    start_time=start_time,
                    end_time=end_time,
                    active_from=active_from,
                    active_to=active_to,
                    facility=facility,
                )

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop('practitioners', None)
        validated_data.pop('practitioner', None)

        resolved_practitioners = getattr(self, '_resolved_practitioners', None)
        if not resolved_practitioners:
            raise serializers.ValidationError({
                'practitioner': 'Unable to resolve practitioners for schedule creation.'
            })

        shared_template_name = validated_data.pop('template_name', None)
        apply_as_shared_template = len(resolved_practitioners) > 1
        if apply_as_shared_template and not shared_template_name:
            shared_template_name = validated_data.get('name')

        template_key = uuid.uuid4() if apply_as_shared_template else None
        created_schedules = []

        for practitioner in resolved_practitioners:
            schedule = RecurringSchedule.objects.create(
                practitioner=practitioner,
                template_key=template_key,
                template_name=shared_template_name,
                **validated_data,
            )
            created_schedules.append(schedule)

        self.created_schedules = created_schedules
        self.created_count = len(created_schedules)
        self.created_template_key = str(template_key) if template_key else None
        return created_schedules[0]


class RecurringScheduleSlotPreviewSerializer(serializers.Serializer):
    """
    Validates recurring schedule slot preview inputs before loop-based generation.
    """
    start_time = serializers.TimeField(input_formats=['%H:%M', '%H:%M:%S'])
    end_time = serializers.TimeField(input_formats=['%H:%M', '%H:%M:%S'])
    slot_duration = serializers.IntegerField(
        min_value=1,
        default=30,
        error_messages={'min_value': RECURRING_SLOT_DURATION_ERROR}
    )
    breaks = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
    )

    def validate(self, attrs):
        if attrs['end_time'] <= attrs['start_time']:
            raise serializers.ValidationError({'end_time': 'end_time must be after start_time.'})
        return attrs


class BlockedTimeSerializer(serializers.ModelSerializer):
    """
    Serializer for the BlockedTime model.
    Used for one-off schedule exceptions (vacations, emergencies, etc.).
    """
    practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = BlockedTime
        fields = [
            'id', 'practitioner', 'practitioner_name', 'date', 'start_time',
            'end_time', 'reason', 'is_all_day', 'created_at', 'updated_at',
            'created_by', 'updated_by'
        ]
        read_only_fields = ['created_at', 'updated_at', 'created_by', 'updated_by']

    def get_practitioner_name(self, obj):
        if obj.practitioner and hasattr(obj.practitioner, 'staff') and hasattr(obj.practitioner.staff, 'user'):
            return f"{obj.practitioner.staff.user.first_name} {obj.practitioner.staff.user.last_name}"
        return "Unknown"

    def validate(self, data):
        """
        Validate blocked time fields.
        """
        # For partial updates, get existing instance values as defaults
        instance = getattr(self, 'instance', None)
        is_all_day = data.get('is_all_day', getattr(instance, 'is_all_day', False) if instance else False)
        start_time = data.get('start_time', getattr(instance, 'start_time', None) if instance else None)
        end_time = data.get('end_time', getattr(instance, 'end_time', None) if instance else None)

        # If not all day, ensure start_time and end_time are provided
        if not is_all_day:
            if not start_time or not end_time:
                raise serializers.ValidationError(
                    "start_time and end_time are required when is_all_day is False"
                )

            # Ensure end_time is after start_time
            if start_time >= end_time:
                raise serializers.ValidationError(
                    "end_time must be after start_time"
                )

        return data
