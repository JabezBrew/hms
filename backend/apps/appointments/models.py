import uuid
from django.db import models
from django.contrib.auth import get_user_model
from ..users.models import PractitionerProfile

User = get_user_model()


class AppointmentType(models.Model):
    """
    Model for defining different types of appointments.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    duration_minutes = models.IntegerField(default=30)
    color = models.CharField(max_length=20, default="#1976D2")  # Default blue color
    is_active = models.BooleanField(default=True)
    
    # Appointment type categories
    CATEGORY_CHOICES = (
        ('in_person', 'In Person'),
        ('telemedicine', 'Telemedicine'),
        ('walk_in', 'Walk-In'),
        ('recurring', 'Recurring'),
    )
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='in_person')
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_appointment_types')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_appointment_types')
    
    def __str__(self):
        return self.name


class ScheduleTemplate(models.Model):
    """
    Template for generating practitioner schedules.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    practitioner = models.ForeignKey(PractitionerProfile, on_delete=models.CASCADE, related_name='schedule_templates')
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_schedule_templates')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_schedule_templates')
    
    def __str__(self):
        return f"{self.name} - {self.practitioner}"


class ScheduleTimeSlot(models.Model):
    """
    Time slots for schedule templates.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(ScheduleTemplate, on_delete=models.CASCADE, related_name='time_slots')
    
    # Day of week (0=Monday, 6=Sunday)
    DAY_CHOICES = (
        (0, 'Monday'),
        (1, 'Tuesday'),
        (2, 'Wednesday'),
        (3, 'Thursday'),
        (4, 'Friday'),
        (5, 'Saturday'),
        (6, 'Sunday'),
    )
    day_of_week = models.IntegerField(choices=DAY_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_schedule_time_slots')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_schedule_time_slots')
    
    class Meta:
        ordering = ['day_of_week', 'start_time']
    
    def __str__(self):
        day_name = dict(self.DAY_CHOICES)[self.day_of_week]
        return f"{day_name} {self.start_time.strftime('%H:%M')} - {self.end_time.strftime('%H:%M')}"


class AppointmentFHIRMapping(models.Model):
    """
    Mapping between local appointment data and FHIR resources.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    appointment_type = models.ForeignKey(AppointmentType, on_delete=models.CASCADE, related_name='fhir_mappings')
    
    # FHIR resource references
    fhir_appointment_id = models.CharField(max_length=100, blank=True, null=True)
    fhir_schedule_id = models.CharField(max_length=100, blank=True, null=True)
    fhir_slot_id = models.CharField(max_length=100, blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_appointment_mappings')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_appointment_mappings')
    
    def __str__(self):
        return f"Mapping for {self.appointment_type.name}"


class RecurringAppointmentRule(models.Model):
    """
    Rules for recurring appointments.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    appointment_type = models.ForeignKey(AppointmentType, on_delete=models.CASCADE, related_name='recurring_rules')
    
    # Recurrence pattern
    FREQUENCY_CHOICES = (
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
        ('monthly', 'Monthly'),
    )
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES)
    interval = models.IntegerField(default=1)  # Every X days/weeks/months
    start_date = models.DateField()
    end_date = models.DateField(blank=True, null=True)
    max_occurrences = models.IntegerField(blank=True, null=True)
    
    # For weekly recurrence
    monday = models.BooleanField(default=False)
    tuesday = models.BooleanField(default=False)
    wednesday = models.BooleanField(default=False)
    thursday = models.BooleanField(default=False)
    friday = models.BooleanField(default=False)
    saturday = models.BooleanField(default=False)
    sunday = models.BooleanField(default=False)
    
    # For monthly recurrence
    day_of_month = models.IntegerField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_recurring_rules')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_recurring_rules')
    
    def __str__(self):
        return f"{self.get_frequency_display()} recurring rule for {self.appointment_type.name}"