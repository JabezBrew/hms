from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
import datetime

from .models import (
    AppointmentType, ScheduleTemplate, ScheduleTimeSlot,
    AppointmentFHIRMapping, RecurringAppointmentRule
)
from .serializers import (
    AppointmentTypeSerializer, ScheduleTemplateSerializer,
    ScheduleTimeSlotSerializer, AppointmentFHIRMappingSerializer,
    RecurringAppointmentRuleSerializer, ScheduleTemplateCreateUpdateSerializer
)
from fhir_client.client import fhir_client
from fhir_client.utils import (
    create_reference, create_period, generate_fhir_id
)
from users.permissions import IsAdminOrOwner


class AppointmentTypeViewSet(viewsets.ModelViewSet):
    """
    API endpoint for appointment types.
    """
    queryset = AppointmentType.objects.all()
    serializer_class = AppointmentTypeSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class ScheduleTemplateViewSet(viewsets.ModelViewSet):
    """
    API endpoint for schedule templates.
    """
    queryset = ScheduleTemplate.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    
    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return ScheduleTemplateCreateUpdateSerializer
        return ScheduleTemplateSerializer
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
    
    @action(detail=True, methods=['post'])
    def generate_schedule(self, request, pk=None):
        """
        Generate FHIR Schedule and Slot resources for a date range.
        """
        template = self.get_object()
        
        # Get date range from request
        start_date = request.data.get('start_date')
        end_date = request.data.get('end_date')
        
        if not start_date or not end_date:
            return Response(
                {"error": "Both start_date and end_date are required."},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            start_date = datetime.datetime.strptime(start_date, '%Y-%m-%d').date()
            end_date = datetime.datetime.strptime(end_date, '%Y-%m-%d').date()
        except ValueError:
            return Response(
                {"error": "Invalid date format. Use YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if start_date > end_date:
            return Response(
                {"error": "start_date must be before end_date."},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create FHIR Schedule resource
        practitioner = template.practitioner
        
        schedule_data = {
            "resourceType": "Schedule",
            "id": generate_fhir_id(),
            "status": "active",
            "actor": [
                create_reference("Practitioner", practitioner.fhir_practitioner_id)
            ],
            "planningHorizon": create_period(
                start=start_date.isoformat(),
                end=end_date.isoformat()
            )
        }
        
        try:
            # Create the schedule in FHIR
            fhir_schedule = fhir_client.create_resource("Schedule", schedule_data)
            
            # Generate slots for each day in the range
            current_date = start_date
            slots_created = 0
            
            while current_date <= end_date:
                # Get day of week (0=Monday, 6=Sunday)
                day_of_week = current_date.weekday()
                
                # Find time slots for this day
                time_slots = template.time_slots.filter(day_of_week=day_of_week)
                
                for time_slot in time_slots:
                    # Create datetime objects for start and end times
                    start_datetime = datetime.datetime.combine(
                        current_date, 
                        time_slot.start_time
                    )
                    end_datetime = datetime.datetime.combine(
                        current_date, 
                        time_slot.end_time
                    )
                    
                    # Create FHIR Slot resource
                    slot_data = {
                        "resourceType": "Slot",
                        "id": generate_fhir_id(),
                        "schedule": create_reference("Schedule", fhir_schedule["id"]),
                        "status": "free",
                        "start": start_datetime.isoformat(),
                        "end": end_datetime.isoformat()
                    }
                    
                    fhir_client.create_resource("Slot", slot_data)
                    slots_created += 1
                
                # Move to next day
                current_date += datetime.timedelta(days=1)
            
            return Response({
                "message": f"Schedule generated successfully with {slots_created} slots.",
                "schedule_id": fhir_schedule["id"]
            })
            
        except Exception as e:
            return Response(
                {"error": f"Failed to generate schedule: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ScheduleTimeSlotViewSet(viewsets.ModelViewSet):
    """
    API endpoint for schedule time slots.
    """
    queryset = ScheduleTimeSlot.objects.all()
    serializer_class = ScheduleTimeSlotSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    
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
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class RecurringAppointmentRuleViewSet(viewsets.ModelViewSet):
    """
    API endpoint for recurring appointment rules.
    """
    queryset = RecurringAppointmentRule.objects.all()
    serializer_class = RecurringAppointmentRuleSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    
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
                    # Create FHIR Appointment resource
                    appointment_data = {
                        "resourceType": "Appointment",
                        "id": generate_fhir_id(),
                        "status": "proposed",
                        "appointmentType": {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/v2-0276",
                                    "code": "ROUTINE",
                                    "display": appointment_type.name
                                }
                            ]
                        },
                        "description": appointment_type.description,
                        "start": datetime.datetime.combine(
                            current_date, 
                            datetime.time(9, 0)  # Default to 9:00 AM
                        ).isoformat(),
                        "end": datetime.datetime.combine(
                            current_date, 
                            datetime.time(9, 0)
                        ).replace(
                            minute=appointment_type.duration_minutes
                        ).isoformat(),
                        "created": timezone.now().isoformat(),
                        "comment": f"Recurring appointment from rule: {rule.id}"
                    }
                    
                    fhir_client.create_resource("Appointment", appointment_data)
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
            return Response(
                {"error": f"Failed to generate recurring appointments: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )