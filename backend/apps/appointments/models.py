import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.contrib.postgres.fields import ArrayField
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

# In appointments/models.py (add this to your existing models)

class ScheduleFHIRMapping(models.Model):
    """
    Maps between generated FHIR Schedule resources and local data.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fhir_schedule_id = models.CharField(max_length=100)
    practitioner = models.ForeignKey('users.PractitionerProfile', on_delete=models.CASCADE)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, default='active')
    slots_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='created_schedule_mappings')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Schedule {self.fhir_schedule_id} for {self.practitioner}"


class RecurringSchedule(models.Model):
    """
    Model for defining recurring practitioner availability schedules.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    practitioner = models.ForeignKey(PractitionerProfile, on_delete=models.CASCADE, related_name='recurring_schedules')
    days_of_week = ArrayField(models.IntegerField(), help_text="List of days (0=Monday, 6=Sunday)")
    start_time = models.TimeField()
    end_time = models.TimeField()
    slot_duration = models.IntegerField(help_text="Duration in minutes")
    active_from = models.DateField()
    active_to = models.DateField(blank=True, null=True)
    is_active = models.BooleanField(default=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_recurring_schedules')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_recurring_schedules')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} - {self.practitioner}"
