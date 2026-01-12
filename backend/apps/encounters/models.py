"""
Encounter models for clinical visit/encounter management.

This module provides the core Encounter model that represents patient visits
and interactions with the healthcare system. Encounters are a cross-cutting
concern used by clinical_notes, nursing, billing, workflows, and other apps.
"""
import uuid

from django.db import models
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
            models.Index(fields=['status', 'start_time']),
            models.Index(fields=['encounter_type', 'status']),
            models.Index(fields=['fhir_id']),
            models.Index(fields=['fhir_synced']),
            models.Index(fields=['start_time']),
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
