import uuid
import uuid

from django.db import models
from django.contrib.auth import get_user_model
from django.contrib.postgres.fields import ArrayField
from ..users.models import PractitionerProfile, PatientProfile
from ..organization.models import Clinic

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


class Appointment(models.Model):
    """Local appointment record (source of truth)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='appointments'
    )
    patient = models.ForeignKey(
        PatientProfile,
        on_delete=models.CASCADE,
        related_name='appointments'
    )
    practitioner = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='appointments'
    )
    clinic = models.ForeignKey(
        Clinic,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='appointments'
    )
    appointment_type = models.ForeignKey(
        AppointmentType,
        on_delete=models.PROTECT,
        related_name='appointments'
    )

    STATUS_CHOICES = (
        ('proposed', 'Proposed'),
        ('pending', 'Pending'),
        ('booked', 'Booked'),
        ('arrived', 'Arrived'),
        ('fulfilled', 'Fulfilled'),
        ('cancelled', 'Cancelled'),
        ('noshow', 'No Show'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='booked')

    SOURCE_CHOICES = (
        ('scheduled', 'Scheduled'),
        ('walk_in', 'Walk-In'),
    )
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='scheduled')

    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    reason = models.TextField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    slot_reference = models.CharField(max_length=100, blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_appointments')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_appointments')

    class Meta:
        ordering = ['start_time']
        indexes = [
            models.Index(fields=['facility', 'status']),
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['practitioner', 'status']),
            models.Index(fields=['clinic', 'status']),
            models.Index(fields=['start_time']),
        ]

    def __str__(self):
        return f"{self.patient} @ {self.start_time.strftime('%Y-%m-%d %H:%M')}"


class AppointmentFHIRMapping(models.Model):
    """
    Mapping between local appointment data and FHIR resources.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    appointment = models.OneToOneField(
        Appointment,
        on_delete=models.CASCADE,
        related_name='fhir_mapping',
        null=True,
        blank=True
    )
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

    DEPRECATION NOTE: This model is being deprecated in favor of roster-based availability
    via RosterEntry + DepartmentDutyType with category='clinic'. During the migration period,
    both systems will be supported, with roster taking precedence.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        null=False,
        blank=False,
        related_name='recurring_schedules',
        help_text="Facility where this schedule applies"
    )
    name = models.CharField(max_length=100)
    practitioner = models.ForeignKey(PractitionerProfile, on_delete=models.CASCADE, related_name='recurring_schedules')
    days_of_week = ArrayField(models.IntegerField(), help_text="List of days (0=Monday, 6=Sunday)")
    start_time = models.TimeField()
    end_time = models.TimeField()
    slot_duration = models.IntegerField(help_text="Duration in minutes")
    active_from = models.DateField()
    active_to = models.DateField(blank=True, null=True)
    breaks = models.JSONField(default=list, blank=True, help_text="List of break times, e.g. [{'start': '12:00', 'end': '13:00'}]")
    is_active = models.BooleanField(default=True)

    # Migration tracking fields (for deprecation)
    migrated_to_roster = models.BooleanField(
        default=False,
        help_text='Whether this schedule has been migrated to roster-based availability'
    )
    migrated_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When this schedule was migrated to roster-based availability'
    )
    roster_duty_type = models.ForeignKey(
        'organization.DepartmentDutyType',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='migrated_schedules',
        help_text='The duty type this schedule was migrated to'
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_recurring_schedules')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_recurring_schedules')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'is_active']),
            models.Index(fields=['practitioner', 'is_active', 'active_from']),
            models.Index(fields=['days_of_week']),
            models.Index(fields=['migrated_to_roster']),
        ]

    def __str__(self):
        return f"{self.name} - {self.practitioner}"


class BlockedTime(models.Model):
    """
    Model for one-off blocked times (vacations, emergencies, closures, etc.).
    Used to block specific time ranges that override recurring schedules.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        null=False,
        blank=False,
        related_name='blocked_times',
        help_text="Facility where this blocked time applies"
    )
    practitioner = models.ForeignKey(PractitionerProfile, on_delete=models.CASCADE, related_name='blocked_times')
    date = models.DateField(help_text="Date to block")
    start_time = models.TimeField(help_text="Start time of blocked period")
    end_time = models.TimeField(help_text="End time of blocked period")
    reason = models.CharField(max_length=200, help_text="Reason for blocking (e.g., 'Vacation', 'Emergency', 'Training')")
    is_all_day = models.BooleanField(default=False, help_text="Block the entire day")

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_blocked_times')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_blocked_times')

    class Meta:
        ordering = ['date', 'start_time']
        indexes = [
            models.Index(fields=['facility', 'date']),
            models.Index(fields=['practitioner', 'date']),
            models.Index(fields=['date']),
        ]
        verbose_name = "Blocked Time"
        verbose_name_plural = "Blocked Times"

    def __str__(self):
        if self.is_all_day:
            return f"{self.practitioner} - {self.date} (All Day): {self.reason}"
        return f"{self.practitioner} - {self.date} {self.start_time}-{self.end_time}: {self.reason}"
