from django.db import transaction
from rest_framework import serializers

from .models import (
    AppointmentType, AppointmentFHIRMapping, RecurringAppointmentRule, 
    ScheduleFHIRMapping, RecurringSchedule
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
        if obj.practitioner and hasattr(obj.practitioner, 'user'):
            return f"{obj.practitioner.user.first_name} {obj.practitioner.user.last_name}"
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
            'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = ['created_at', 'updated_at', 'created_by', 'updated_by']

    def get_practitioner_name(self, obj):
        if obj.practitioner and hasattr(obj.practitioner, 'user'):
            return f"{obj.practitioner.user.first_name} {obj.practitioner.user.last_name}"
        return "Unknown"
