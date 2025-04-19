from django.db import transaction
from rest_framework import serializers

from .models import (
    AppointmentType, ScheduleTemplate, ScheduleTimeSlot,
    AppointmentFHIRMapping, RecurringAppointmentRule, ScheduleFHIRMapping
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


class NestedScheduleTimeSlotSerializer(serializers.ModelSerializer):
    """
    Serializer for time slots when nested within a schedule template.
    """
    class Meta:
        model = ScheduleTimeSlot
        fields = ['day_of_week', 'start_time', 'end_time']


class ScheduleTimeSlotSerializer(serializers.ModelSerializer):
    """
    Serializer for the ScheduleTimeSlot model.
    """
    day_name = serializers.SerializerMethodField()

    class Meta:
        model = ScheduleTimeSlot
        fields = ['id', 'template', 'day_of_week', 'day_name', 'start_time', 
                  'end_time', 'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def get_day_name(self, obj):
        return dict(ScheduleTimeSlot.DAY_CHOICES)[obj.day_of_week]


class ScheduleTemplateSerializer(serializers.ModelSerializer):
    """
    Serializer for the ScheduleTemplate model.
    """
    time_slots = ScheduleTimeSlotSerializer(many=True, read_only=True)
    practitioner_details = PractitionerProfileSerializer(source='practitioner', read_only=True)

    class Meta:
        model = ScheduleTemplate
        fields = ['id', 'name', 'practitioner', 'practitioner_details', 'is_active', 
                  'time_slots', 'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class ScheduleTemplateCreateUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating and updating ScheduleTemplate with nested time slots.
    """
    time_slots = NestedScheduleTimeSlotSerializer(many=True)

    class Meta:
        model = ScheduleTemplate
        fields = ['id', 'name', 'practitioner', 'is_active', 'time_slots']
        read_only_fields = ['id']

    def create(self, validated_data):
        time_slots_data = validated_data.pop('time_slots')
        template = ScheduleTemplate.objects.create(**validated_data)

        for time_slot_data in time_slots_data:
            ScheduleTimeSlot.objects.create(
                template=template,
                created_by=validated_data.get('created_by'),
                updated_by=validated_data.get('updated_by'),
                **time_slot_data
            )

        return template

    def update(self, instance, validated_data):
        time_slots_data = validated_data.pop('time_slots', None)

        # Update template fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if time_slots_data is not None:
            with transaction.atomic():
                # Delete existing time slots for this template
                instance.time_slots.all().delete()

                # Create new time slots with explicit template reference
                for time_slot_data in time_slots_data:
                    # Explicitly set the template to ensure no shared references
                    ScheduleTimeSlot.objects.create(
                        template=instance,  # Explicitly tie the time slot to this template
                        created_by=validated_data.get('updated_by'),
                        updated_by=validated_data.get('updated_by'),
                        **time_slot_data
                    )

        return instance


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
    template_name = serializers.SerializerMethodField()
    
    class Meta:
        model = ScheduleFHIRMapping
        fields = [
            'id', 'template', 'template_name', 'fhir_schedule_id', 
            'practitioner', 'practitioner_name', 'start_date', 'end_date', 
            'status', 'slots_count', 'created_at', 'created_by'
        ]
        read_only_fields = ['created_at', 'created_by']
    
    def get_practitioner_name(self, obj):
        if obj.practitioner and hasattr(obj.practitioner, 'user'):
            return f"{obj.practitioner.user.first_name} {obj.practitioner.user.last_name}"
        return "Unknown"
    
    def get_template_name(self, obj):
        if obj.template:
            return obj.template.name
        return "Unknown Template"