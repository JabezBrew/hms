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
    Supports flexible sharing: private, role-based, department-based, or public.
    """
    # Visibility choices for sharing control
    VISIBILITY_CHOICES = [
        ('private', 'Private'),       # Only creator can see/use
        ('role', 'Role'),             # Shared with same user_type (doctors, nurses, etc.)
        ('department', 'Department'), # Shared with same department
        ('public', 'Public'),         # Available to all users
    ]

    # Category choices for organization
    CATEGORY_CHOICES = [
        ('general', 'General'),
        ('soap', 'SOAP Notes'),
        ('progress', 'Progress Notes'),
        ('procedure', 'Procedure Notes'),
        ('admission', 'Admission Notes'),
        ('discharge', 'Discharge Notes'),
        ('nursing', 'Nursing Notes'),
        ('consultation', 'Consultation Notes'),
        ('custom', 'Custom'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='note_templates',
        help_text="Facility that owns this note template"
    )
    title = models.CharField(max_length=100)  # e.g., "SOAP Note", "Nurse Shift Note"
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    # Sharing/visibility settings
    visibility = models.CharField(
        max_length=20,
        choices=VISIBILITY_CHOICES,
        default='private',
        help_text="Controls who can see and use this template"
    )
    department = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Department for department-level sharing"
    )

    # Organization
    category = models.CharField(
        max_length=50,
        choices=CATEGORY_CHOICES,
        default='custom',
        help_text="Category for organizing templates"
    )
    icon = models.CharField(
        max_length=50,
        default='file-text',
        help_text="Lucide icon name for UI display"
    )
    estimated_steps = models.PositiveIntegerField(
        default=3,
        help_text="Number of steps in the workflow"
    )

    # Legacy field - kept for backwards compatibility, use 'visibility' instead
    is_public = models.BooleanField(
        default=False,
        help_text="DEPRECATED: Use 'visibility' field instead"
    )

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_templates',
        help_text="User who created this template. Null for system templates."
    )
    structure = models.JSONField()  # JSON schema-like definition

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_templates')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'visibility']),
            models.Index(fields=['visibility', 'is_active']),
            models.Index(fields=['category', 'is_active']),
            models.Index(fields=['created_by', 'visibility']),
        ]

    def __str__(self):
        return self.title

    @property
    def is_system_template(self):
        """Check if this is a system-provided template."""
        return self.created_by is None

    def save(self, *args, **kwargs):
        # Sync is_public with visibility for backwards compatibility
        if self.visibility == 'public':
            self.is_public = True
        elif self.is_public and self.visibility == 'private':
            # If is_public was set directly, update visibility
            self.visibility = 'public'
        super().save(*args, **kwargs)


class NoteTemplateRevision(models.Model):
    """
    Immutable revision for a note template.
    Keeps authored defaults/version history independent from note entries.
    """

    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('in_review', 'In Review'),
        ('published', 'Published'),
        ('archived', 'Archived'),
    ]

    MODE_CHOICES = [
        ('structured', 'Structured'),
        ('written', 'Written'),
        ('hybrid', 'Hybrid'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        NoteTemplate,
        on_delete=models.CASCADE,
        related_name='revisions'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='note_template_revisions'
    )
    version = models.PositiveIntegerField()
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='draft'
    )
    mode = models.CharField(
        max_length=20,
        choices=MODE_CHOICES,
        default='structured'
    )
    content = models.JSONField(default=dict)
    change_summary = models.CharField(max_length=255, blank=True)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_note_template_revisions'
    )
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='submitted_note_template_revisions'
    )
    published_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='published_note_template_revisions'
    )

    submitted_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-version']
        constraints = [
            models.UniqueConstraint(
                fields=['template', 'version'],
                name='clinical_notes_template_revision_version_uniq',
            ),
            models.UniqueConstraint(
                fields=['template'],
                condition=models.Q(status='published'),
                name='clinical_notes_one_published_revision_per_template',
            ),
        ]
        indexes = [
            models.Index(fields=['template', 'status', '-version']),
            models.Index(fields=['facility', 'status']),
        ]

    def __str__(self):
        return f"{self.template.title} v{self.version}"


class NoteEntry(models.Model):
    """
    Model for submitted clinical note entries.
    Links to a template, patient, encounter, and practitioner.
    Stores the actual values entered for each section.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(NoteTemplate, on_delete=models.CASCADE, related_name='entries')
    template_revision = models.ForeignKey(
        'NoteTemplateRevision',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='entries',
        help_text="Immutable template revision used to initialize this note."
    )
    template_version = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Template revision version used at note creation."
    )

    # Patient - direct link for querying
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='note_entries',
        help_text="The patient this note is for"
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='note_entries',
        help_text="Facility context for this clinical note"
    )

    # Encounter - required link to group notes by clinical visit
    # The auto-encounter logic in views ensures this is always set
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.PROTECT,  # Prevent deletion of encounters with linked notes
        null=False,
        blank=False,
        related_name='note_entries',
        help_text="The clinical encounter/visit during which this note was created"
    )

    practitioner = models.ForeignKey(PractitionerProfile, on_delete=models.CASCADE, related_name='note_entries')
    composition_fhir_id = models.CharField(max_length=100, null=True, blank=True)  # FHIR Composition ID
    data = models.JSONField()  # Actual values entered for each section

    # Copy tracking - for "copy forward" workflow
    copied_from = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='copies',
        help_text="Source note this was copied from (for audit trail)"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'Note entries'
        indexes = [
            models.Index(fields=['patient', '-created_at']),
            models.Index(fields=['encounter', '-created_at']),
            models.Index(fields=['facility', '-created_at']),
            models.Index(fields=['facility', 'template', '-created_at']),
        ]

    def __str__(self):
        patient_name = self.patient.user.get_full_name() if self.patient else "Unknown"
        return f"{self.template.title} for {patient_name}"


class NoteEntryVersion(models.Model):
    """
    Model for storing historical versions of clinical notes.
    Created automatically when a NoteEntry is updated.
    Provides full audit trail of all changes to clinical documentation.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    note_entry = models.ForeignKey(
        NoteEntry,
        on_delete=models.CASCADE,
        related_name='versions',
        help_text="The note entry this version belongs to"
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='note_entry_versions',
        help_text="Facility context for this note entry version"
    )
    version_number = models.PositiveIntegerField(
        help_text="Sequential version number (1 = first version)"
    )
    data = models.JSONField(
        help_text="Snapshot of the note data at this version"
    )
    edited_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='note_edits',
        help_text="User who made the edit that created this version"
    )
    edit_reason = models.CharField(
        max_length=500,
        blank=True,
        help_text="Optional reason for the edit"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-version_number']
        verbose_name = 'Note Entry Version'
        verbose_name_plural = 'Note Entry Versions'
        unique_together = ('note_entry', 'version_number')
        indexes = [
            models.Index(fields=['note_entry', '-version_number']),
            models.Index(fields=['note_entry', '-created_at']),
            models.Index(fields=['facility', 'note_entry', '-created_at']),
        ]

    def __str__(self):
        return f"Version {self.version_number} of {self.note_entry}"

    @classmethod
    def create_version(cls, note_entry, edited_by=None, edit_reason=''):
        """
        Create a new version snapshot of a note entry.
        Should be called BEFORE updating the note_entry.data field.

        Args:
            note_entry: The NoteEntry being edited
            edited_by: User making the edit
            edit_reason: Optional reason for the edit

        Returns:
            The created NoteEntryVersion instance
        """
        # Get the next version number
        latest_version = cls.objects.filter(note_entry=note_entry).order_by('-version_number').first()
        next_version = (latest_version.version_number + 1) if latest_version else 1

        return cls.objects.create(
            note_entry=note_entry,
            facility=note_entry.facility,
            version_number=next_version,
            data=note_entry.data,  # Snapshot current data before update
            edited_by=edited_by,
            edit_reason=edit_reason,
        )


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
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='prescriptions',
        help_text="Facility context for this prescription"
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

    # Link to encounter - required, groups prescriptions by clinical visit
    # The auto-encounter logic in views ensures this is always set
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.PROTECT,  # Prevent deletion of encounters with linked prescriptions
        null=False,
        blank=False,
        related_name='prescriptions',
        help_text="The clinical encounter/visit during which this was prescribed"
    )
    discharge_case = models.ForeignKey(
        'discharge.DischargeCase',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='prescriptions',
        help_text="Optional discharge case for take-home discharge medications."
    )

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
        indexes = [
            models.Index(fields=['facility', 'status', '-created_at']),
            models.Index(fields=['discharge_case', 'status']),
        ]

    def __str__(self):
        return f"{self.medication_name} {self.dosage} - {self.patient}"

    def save(self, *args, **kwargs):
        # Calculate end_date from duration if provided
        if self.duration_days and not self.end_date:
            self.end_date = self.start_date + timedelta(days=self.duration_days)

        # Backward compatibility: derive facility from encounter/patient when omitted.
        if self.facility_id is None:
            encounter_facility_id = None
            if self.encounter_id:
                encounter_obj = getattr(self, 'encounter', None)
                encounter_facility_id = getattr(encounter_obj, 'facility_id', None)
                if encounter_facility_id is None:
                    from apps.encounters.models import Encounter
                    encounter_facility_id = Encounter.objects.filter(
                        id=self.encounter_id
                    ).values_list('facility_id', flat=True).first()

            if encounter_facility_id is not None:
                self.facility_id = encounter_facility_id
            elif self.patient_id:
                patient_obj = getattr(self, 'patient', None)
                patient_facility_id = getattr(patient_obj, 'facility_id', None)
                if patient_facility_id is None:
                    from apps.users.models import PatientProfile
                    patient_facility_id = PatientProfile.objects.filter(
                        id=self.patient_id
                    ).values_list('facility_id', flat=True).first()
                self.facility_id = patient_facility_id

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


class TimelineEvent(models.Model):
    """
    Denormalized table for efficient patient timeline queries.

    This table enables O(1) database pagination for patient timelines,
    eliminating the 500-item cliff and in-memory sorting issues.

    The timeline API uses this for pagination/filtering, then joins
    back to source models to return full details.
    """
    # Event type choices
    EVENT_TYPE_CHOICES = [
        ('note', 'Clinical Note'),
        ('prescription', 'Prescription'),
        ('vitals', 'Vital Signs'),
        ('lab', 'Lab Order'),
        ('referral', 'Referral'),
        ('fluid', 'Fluid Balance'),
        ('chart', 'Clinical Chart'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Core identifiers
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='timeline_events',
        db_index=True
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='timeline_events',
        db_index=True
    )

    # Event classification
    event_type = models.CharField(
        max_length=20,
        choices=EVENT_TYPE_CHOICES,
        db_index=True
    )
    event_subtype = models.CharField(
        max_length=50,
        blank=True,
        help_text="E.g., 'soap_note', 'admission_note' for notes"
    )

    # Polymorphic source reference
    source_model = models.CharField(
        max_length=50,
        help_text="Model name: 'NoteEntry', 'Prescription', etc."
    )
    source_id = models.UUIDField(db_index=True)

    # Pre-computed display data for fast filtering
    timestamp = models.DateTimeField(db_index=True)
    title = models.CharField(max_length=255)
    content_summary = models.CharField(
        max_length=500,
        blank=True,
        help_text="Short summary for search/preview"
    )
    author_name = models.CharField(max_length=150, blank=True)
    author_id = models.UUIDField(null=True, blank=True)

    # Denormalized flags for filtering
    is_critical = models.BooleanField(default=False)
    status = models.CharField(max_length=30, blank=True)

    # Version tracking (for notes)
    has_edits = models.BooleanField(default=False)
    version_count = models.PositiveIntegerField(default=0)

    # Template info (for notes - enables copy-forward)
    template_id = models.UUIDField(null=True, blank=True)
    template_title = models.CharField(max_length=100, blank=True)

    # Full-text search optimization
    search_text = models.TextField(
        blank=True,
        help_text="Concatenated searchable text"
    )

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-timestamp']
        db_table = 'clinical_timeline_events'
        indexes = [
            models.Index(fields=['patient', '-timestamp']),
            models.Index(fields=['patient', 'event_type', '-timestamp']),
            models.Index(fields=['source_model', 'source_id']),
        ]
        # Ensure one timeline event per source record
        unique_together = ('source_model', 'source_id')

    def __str__(self):
        return f"{self.event_type}: {self.title} ({self.timestamp})"
