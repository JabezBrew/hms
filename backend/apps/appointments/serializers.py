from django.db import transaction
from rest_framework import serializers

from .models import (
    AppointmentType, AppointmentFHIRMapping, RecurringAppointmentRule,
    ScheduleFHIRMapping, RecurringSchedule, BlockedTime
)
from ..users.serializers import PractitionerProfileSerializer


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




class AppointmentFHIRMappingSerializer(serializers.ModelSerializer):
    """
    Serializer for the AppointmentFHIRMapping model.
    """
    appointment_type_details = AppointmentTypeSerializer(source='appointment_type', read_only=True)

    class Meta:
        model = AppointmentFHIRMapping
        fields = ['id', 'appointment_type', 'appointment_type_details', 
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
    practitioner_name = serializers.SerializerMethodField()

    class Meta:
        model = RecurringSchedule
        fields = [
            'id', 'name', 'practitioner', 'practitioner_name', 'days_of_week',
            'start_time', 'end_time', 'slot_duration', 'active_from', 'active_to',
            'breaks', 'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = ['created_at', 'updated_at', 'created_by', 'updated_by']

    def get_practitioner_name(self, obj):
        if obj.practitioner and hasattr(obj.practitioner, 'staff') and hasattr(obj.practitioner.staff, 'user'):
            return f"{obj.practitioner.staff.user.first_name} {obj.practitioner.staff.user.last_name}"
        return "Unknown"


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
