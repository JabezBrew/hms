import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta
from ..users.models import PractitionerProfile

User = get_user_model()


class NoteTemplate(models.Model):
    """
    Model for clinical note templates.
    Stores reusable form templates with a JSON structure.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=100)  # e.g., "SOAP Note", "Nurse Shift Note"
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_public = models.BooleanField(default=False)  # If true, the template is available to everyone
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_templates')
    structure = models.JSONField()  # JSON schema-like definition

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_templates')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class NoteEntry(models.Model):
    """
    Model for submitted clinical note entries.
    Links to a template, patient encounter, and practitioner.
    Stores the actual values entered for each section.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(NoteTemplate, on_delete=models.CASCADE, related_name='entries')
    encounter_id = models.CharField(max_length=100)  # FHIR Encounter ID
    practitioner = models.ForeignKey(PractitionerProfile, on_delete=models.CASCADE, related_name='note_entries')
    composition_fhir_id = models.CharField(max_length=100, null=True, blank=True)  # FHIR Composition ID
    data = models.JSONField()  # Actual values entered for each section

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'Note entries'

    def __str__(self):
        return f"{self.template.title} for Encounter {self.encounter_id}"

    @property
    def encounter(self):
        """
        Get the local Encounter object.
        """
        if not hasattr(self, '_encounter'):
            try:
                from ..wards.models import Encounter
                self._encounter = Encounter.objects.select_related(
                    'patient', 'patient__user',
                    'practitioner', 'practitioner__staff', 'practitioner__staff__user'
                ).get(id=self.encounter_id)
            except Exception as e:
                # Log the error but don't raise it
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Encounter {self.encounter_id} not found locally: {str(e)}")
                self._encounter = None
        return self._encounter


class Prescription(models.Model):
    """
    Model for medication prescriptions.
    Created by doctors, used by nurses for medication administration.
    """
    # Route choices
    ROUTE_CHOICES = [
        ('oral', 'Oral (PO)'),
        ('iv', 'Intravenous (IV)'),
        ('im', 'Intramuscular (IM)'),
        ('sc', 'Subcutaneous (SC)'),
        ('topical', 'Topical'),
        ('inhaled', 'Inhaled'),
        ('sublingual', 'Sublingual (SL)'),
        ('rectal', 'Rectal (PR)'),
        ('ophthalmic', 'Ophthalmic'),
        ('otic', 'Otic (Ear)'),
        ('nasal', 'Nasal'),
        ('transdermal', 'Transdermal'),
        ('other', 'Other'),
    ]

    # Frequency choices
    FREQUENCY_CHOICES = [
        ('once', 'Once'),
        ('daily', 'Once Daily'),
        ('bid', 'Twice Daily (BID)'),
        ('tid', 'Three Times Daily (TID)'),
        ('qid', 'Four Times Daily (QID)'),
        ('q4h', 'Every 4 Hours'),
        ('q6h', 'Every 6 Hours'),
        ('q8h', 'Every 8 Hours'),
        ('q12h', 'Every 12 Hours'),
        ('qhs', 'At Bedtime (QHS)'),
        ('prn', 'As Needed (PRN)'),
        ('stat', 'Immediately (STAT)'),
        ('weekly', 'Weekly'),
        ('other', 'Other'),
    ]

    # Status choices
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('discontinued', 'Discontinued'),
        ('on_hold', 'On Hold'),
        ('draft', 'Draft'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Patient - link to PatientProfile (in users app)
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='prescriptions'
    )

    # Prescriber - the doctor who prescribed
    prescribed_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.CASCADE,
        related_name='prescriptions'
    )

    # Medication details
    medication_name = models.CharField(max_length=255)
    dosage = models.CharField(max_length=100)  # e.g., "500mg", "10ml"
    route = models.CharField(max_length=20, choices=ROUTE_CHOICES, default='oral')
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default='daily')

    # Duration and dates
    duration_days = models.PositiveIntegerField(null=True, blank=True)
    start_date = models.DateField(default=timezone.now)
    end_date = models.DateField(null=True, blank=True)

    # Additional info
    instructions = models.TextField(blank=True)  # Special instructions
    reason = models.TextField(blank=True)  # Reason for prescription

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')

    # Optional encounter link
    encounter_id = models.CharField(max_length=100, null=True, blank=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    discontinued_at = models.DateTimeField(null=True, blank=True)
    discontinued_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='discontinued_prescriptions'
    )
    discontinue_reason = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']
        db_table = 'clinical_prescriptions'

    def __str__(self):
        return f"{self.medication_name} {self.dosage} - {self.patient}"

    def save(self, *args, **kwargs):
        # Calculate end_date from duration if provided
        if self.duration_days and not self.end_date:
            self.end_date = self.start_date + timedelta(days=self.duration_days)
        super().save(*args, **kwargs)

    @property
    def is_active(self):
        """Check if prescription is currently active."""
        if self.status != 'active':
            return False
        if self.end_date and self.end_date < timezone.now().date():
            return False
        return True

    @property
    def days_remaining(self):
        """Calculate days remaining on prescription."""
        if not self.end_date:
            return None
        delta = self.end_date - timezone.now().date()
        return max(0, delta.days)
