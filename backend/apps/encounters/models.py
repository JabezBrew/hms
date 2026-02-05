"""
Encounter models for clinical visit/encounter management.

This module provides the core Encounter model that represents patient visits
and interactions with the healthcare system. Encounters are a cross-cutting
concern used by clinical_notes, nursing, billing, workflows, and other apps.
"""
import uuid

from django.db import models
from django.db.models import Q, Case, When
from django.utils import timezone
from django.contrib.auth import get_user_model

from apps.users.models import PatientProfile, PractitionerProfile

User = get_user_model()


class Encounter(models.Model):
    """
    Local model for clinical encounters/visits.

    This replaces the FHIR-first approach with a local-first model that syncs to FHIR
    in the background. This provides fast queries while maintaining FHIR compliance.

    Encounter types:
    - inpatient: Hospital admission (linked to Admission model)
    - outpatient: Clinic visit, consultation
    - emergency: Emergency department visit
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Core relationships
    patient = models.ForeignKey(
        PatientProfile,
        on_delete=models.CASCADE,
        related_name='encounters'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        null=False,
        blank=False,
        related_name='encounters',
        help_text="Facility where this encounter occurred"
    )
    practitioner = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='encounters'
    )
    clinic = models.ForeignKey(
        'organization.Clinic',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='encounters'
    )
    department = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='encounters',
        help_text="Owning department for this encounter"
    )
    primary_team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='primary_encounters',
        help_text='Primary clinical team responsible for this encounter'
    )
    admitted_by_team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='admitted_encounters',
        help_text='Team that originally admitted the patient'
    )
    appointment = models.ForeignKey(
        'appointments.Appointment',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='encounters'
    )

    # Encounter classification
    ENCOUNTER_TYPE_CHOICES = (
        ('inpatient', 'Inpatient'),
        ('outpatient', 'Outpatient'),
        ('emergency', 'Emergency'),
    )
    encounter_type = models.CharField(
        max_length=20,
        choices=ENCOUNTER_TYPE_CHOICES,
        default='outpatient'
    )

    # Encounter status lifecycle
    STATUS_CHOICES = (
        ('planned', 'Planned'),
        ('in-progress', 'In Progress'),
        ('finished', 'Finished'),
        ('cancelled', 'Cancelled'),
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='planned'
    )

    # Timing
    start_time = models.DateTimeField(default=timezone.now)
    end_time = models.DateTimeField(null=True, blank=True)

    # Clinical context
    reason = models.TextField(blank=True, null=True, help_text="Chief complaint or reason for visit")
    service_type = models.CharField(max_length=100, blank=True, null=True, help_text="Type of service (e.g., General Practice, Cardiology)")
    location = models.CharField(max_length=200, blank=True, null=True, help_text="Ward, clinic, or room")

    # Hospitalization details (for inpatient)
    admission_source = models.CharField(max_length=50, blank=True, null=True)
    discharge_disposition = models.CharField(max_length=50, blank=True, null=True)
    destination = models.CharField(max_length=200, blank=True, null=True)

    # Link to Admission (for inpatient encounters)
    # Using string reference to avoid circular import
    admission = models.OneToOneField(
        'wards.Admission',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='encounter'
    )

    # M2M to consulting teams via through model
    consulting_teams = models.ManyToManyField(
        'organization.ClinicalUnit',
        through='EncounterCareTeam',
        related_name='consulting_encounters',
        blank=True
    )

    # FHIR synchronization
    fhir_id = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        unique=True,
        help_text="FHIR Encounter resource ID"
    )
    fhir_synced = models.BooleanField(
        default=False,
        help_text="Whether this encounter has been synced to FHIR"
    )
    fhir_last_synced = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last successful FHIR sync time"
    )
    fhir_sync_error = models.TextField(
        blank=True,
        null=True,
        help_text="Last FHIR sync error message"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_encounters'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_encounters'
    )

    class Meta:
        ordering = ['-start_time']
        db_table = 'wards_encounter'  # Keep existing table name for migration
        indexes = [
            models.Index(fields=['facility', 'status']),
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['practitioner', 'status']),
            models.Index(fields=['clinic', 'status']),
            models.Index(fields=['appointment', 'status']),
            models.Index(fields=['status', 'start_time']),
            models.Index(fields=['department', 'start_time']),
            models.Index(fields=['encounter_type', 'status']),
            models.Index(fields=['primary_team', 'status']),
            models.Index(fields=['patient', 'primary_team', 'status']),
            models.Index(fields=['admitted_by_team', 'status']),
            models.Index(fields=['fhir_id']),
            models.Index(fields=['fhir_synced']),
            models.Index(fields=['start_time']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['appointment'],
                condition=Q(appointment__isnull=False),
                name='unique_encounter_per_appointment'
            )
        ]

    def __str__(self):
        patient_name = self.patient.user.get_full_name() if self.patient else "Unknown"
        return f"{patient_name} - {self.get_encounter_type_display()} ({self.get_status_display()}) - {self.start_time.strftime('%Y-%m-%d')}"

    # SECURITY: Define valid status transitions to prevent manipulation
    VALID_STATUS_TRANSITIONS = {
        'planned': ['in-progress', 'cancelled'],
        'in-progress': ['finished', 'cancelled'],
        'finished': [],  # Terminal state
        'cancelled': [],  # Terminal state
    }

    def save(self, *args, **kwargs):
        """
        Override save method to validate status transitions.
        """
        # SECURITY: Validate status transitions on updates
        if self.pk and not self._state.adding:
            try:
                old_encounter = Encounter.objects.get(pk=self.pk)
                old_status = old_encounter.status
                new_status = self.status

                if old_status != new_status:
                    valid_transitions = self.VALID_STATUS_TRANSITIONS.get(old_status, [])
                    if new_status not in valid_transitions:
                        from django.core.exceptions import ValidationError
                        raise ValidationError(
                            f"Invalid status transition from '{old_status}' to '{new_status}'."
                        )
            except Encounter.DoesNotExist:
                pass  # New record, no validation needed

        super().save(*args, **kwargs)

    @property
    def patient_name(self):
        """Get patient's full name."""
        if self.patient and self.patient.user:
            return self.patient.user.get_full_name() or "Unknown Patient"
        return "Unknown Patient"

    @property
    def practitioner_name(self):
        """Get practitioner's full name."""
        if self.practitioner and self.practitioner.staff and self.practitioner.staff.user:
            return self.practitioner.staff.user.get_full_name() or "Unknown Practitioner"
        return "Unknown Practitioner"

    @property
    def duration_minutes(self):
        """Calculate encounter duration in minutes."""
        if self.end_time:
            delta = self.end_time - self.start_time
            return int(delta.total_seconds() / 60)
        return None

    def finish(self, end_time=None, discharge_disposition=None, destination=None):
        """Mark the encounter as finished."""
        self.status = 'finished'
        self.end_time = end_time or timezone.now()
        if discharge_disposition:
            self.discharge_disposition = discharge_disposition
        if destination:
            self.destination = destination
        self.fhir_synced = False  # Mark for re-sync
        self.save()

    def cancel(self):
        """Cancel the encounter."""
        self.status = 'cancelled'
        self.end_time = timezone.now()
        self.fhir_synced = False  # Mark for re-sync
        self.save()


class OutpatientVisit(models.Model):
    """Lifecycle details for outpatient encounters."""

    class VisitStatus(models.TextChoices):
        CHECKED_IN = 'checked_in', 'Checked In'
        WAITING = 'waiting', 'Waiting'
        CALLED = 'called', 'Called'
        IN_PROGRESS = 'in_progress', 'With Doctor'
        ON_HOLD = 'on_hold', 'On Hold'
        READY_CHECKOUT = 'ready_checkout', 'Ready for Checkout'
        CHECKED_OUT = 'checked_out', 'Checked Out'
        NO_SHOW = 'no_show', 'No Show'
        CANCELLED = 'cancelled', 'Cancelled'

    appointment = models.OneToOneField(
        'appointments.Appointment',
        on_delete=models.CASCADE,
        related_name='visit'
    )
    encounter = models.OneToOneField(
        Encounter,
        on_delete=models.CASCADE,
        related_name='outpatient_visit'
    )
    clinic = models.ForeignKey(
        'organization.Clinic',
        on_delete=models.PROTECT,
        related_name='outpatient_visits'
    )
    visit_status = models.CharField(
        max_length=20,
        choices=VisitStatus.choices,
        default=VisitStatus.CHECKED_IN
    )
    queue_number = models.PositiveIntegerField(null=True, blank=True)

    checked_in_at = models.DateTimeField(auto_now_add=True)
    checked_in_by = models.ForeignKey(
        User,
        null=True,
        on_delete=models.SET_NULL,
        related_name='outpatient_checkins'
    )
    called_at = models.DateTimeField(null=True, blank=True)
    consultation_started_at = models.DateTimeField(null=True, blank=True)
    consultation_ended_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    checked_out_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='outpatient_checkouts'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['clinic', 'visit_status', 'checked_in_at']),
            models.Index(fields=['queue_number', 'checked_in_at']),
        ]

    def __str__(self):
        return f"Visit {self.encounter_id} ({self.visit_status})"


class TriageQueue(models.Model):
    """Queue for walk-in patients awaiting triage and clinic assignment."""

    class Priority(models.TextChoices):
        EMERGENCY = 'emergency', 'Emergency'
        URGENT = 'urgent', 'Urgent'
        ROUTINE = 'routine', 'Routine'

    class Status(models.TextChoices):
        WAITING = 'waiting', 'Waiting for Triage'
        TRIAGED = 'triaged', 'Triaged'
        ASSIGNED = 'assigned', 'Assigned to Clinic'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='triage_queue'
    )
    patient = models.ForeignKey(
        PatientProfile,
        on_delete=models.CASCADE,
        related_name='triage_entries'
    )
    priority = models.CharField(
        max_length=20,
        choices=Priority.choices,
        default=Priority.ROUTINE
    )
    chief_complaint = models.TextField(blank=True)
    triage_notes = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.WAITING
    )

    triaged_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='triage_assessments'
    )
    triaged_at = models.DateTimeField(null=True, blank=True)

    assigned_clinic = models.ForeignKey(
        'organization.Clinic',
        null=True,
        blank=True,
        on_delete=models.SET_NULL
    )
    assigned_practitioner = models.ForeignKey(
        PractitionerProfile,
        null=True,
        blank=True,
        on_delete=models.SET_NULL
    )
    assigned_at = models.DateTimeField(null=True, blank=True)

    appointment = models.OneToOneField(
        'appointments.Appointment',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='triage_entry'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = [
            models.Case(
                models.When(priority='emergency', then=0),
                models.When(priority='urgent', then=1),
                models.When(priority='routine', then=2),
                default=3,
            ),
            'created_at'
        ]
        indexes = [
            models.Index(fields=['facility', 'status']),
            models.Index(fields=['patient', 'created_at']),
            models.Index(fields=['priority', 'created_at']),
        ]

    def __str__(self):
        return f"Triage {self.patient_id} ({self.status})"


class EncounterCareTeam(models.Model):
    """
    Consulting/co-managing teams for an encounter.
    Primary team is stored on Encounter.primary_team (not here).
    """
    ROLE_CHOICES = [
        ('consulting', 'Consulting'),
        ('co_managing', 'Co-Managing'),
        ('procedure', 'Procedure Team'),
    ]

    STATUS_CHOICES = [
        ('requested', 'Requested'),
        ('accepted', 'Accepted'),
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('declined', 'Declined'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    encounter = models.ForeignKey(
        Encounter,
        on_delete=models.CASCADE,
        related_name='care_team_assignments'
    )
    team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        related_name='encounter_consulting_assignments'
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='consulting')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='requested')

    # Consult workflow
    consult_reason = models.TextField(blank=True, null=True)
    consult_requested_at = models.DateTimeField(null=True, blank=True)
    consult_accepted_at = models.DateTimeField(null=True, blank=True)
    consult_completed_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='created_encounter_care_teams'
    )

    class Meta:
        db_table = 'encounters_encountercareTeam'
        unique_together = [('encounter', 'team')]
        indexes = [
            models.Index(fields=['encounter', 'status', 'is_active']),
            models.Index(fields=['team', 'status', 'is_active']),
        ]
        verbose_name = 'Encounter Care Team'
        verbose_name_plural = 'Encounter Care Teams'

    def __str__(self):
        return f'{self.team.name} ({self.get_role_display()}) for {self.encounter}'
