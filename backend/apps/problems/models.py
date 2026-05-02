"""
Problem List models.

Design notes:
- ProblemCode is terminology-agnostic. Phase 1 uses WHO ICD-10; SNOMED can be added
  later by inserting rows with a different `code_system`. Linkages on Problem reference
  ProblemCode by FK, so changing terminology is additive.
- ProblemLink uses explicit per-source FKs (one nullable column per linkable model)
  rather than a generic ContentType FK. Per CLAUDE.md performance guidance: this lets
  Postgres use partial indexes and avoids extra joins on hot patient-chronicle reads.
- All clinical patient data is owned by PatientChroniclePage per CLAUDE.md
  architectural rule. The Problem List is a sidebar widget within that page.
"""
import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.db import models
from django.utils import timezone


class CodeSystem(models.TextChoices):
    """Terminology systems supported by ProblemCode."""

    ICD10_WHO = 'icd10-who', 'WHO ICD-10'
    ICD10_CM = 'icd10-cm', 'ICD-10-CM (US)'
    ICD11 = 'icd11', 'WHO ICD-11'
    SNOMED = 'snomed', 'SNOMED CT'
    GHANA_QUICKPICK = 'ghana-quickpick', 'Ghana Quick Pick'
    LOCAL = 'local', 'Local / Free Text'


class ProblemCategory(models.TextChoices):
    """Coarse clinical category. Used for filtering and UI grouping."""

    DIAGNOSIS = 'diagnosis', 'Diagnosis'
    SYMPTOM = 'symptom', 'Symptom'
    FINDING = 'finding', 'Clinical Finding'
    PROCEDURE_HISTORY = 'procedure-history', 'Procedure History'
    SOCIAL = 'social', 'Social'
    FAMILY_HISTORY = 'family-history', 'Family History'
    OTHER = 'other', 'Other'


class ProblemCode(models.Model):
    """
    Cached terminology entry. Loaded from WHO ICD-10 + Ghana quick-picks in Phase 1.

    NOT facility-scoped: terminology is global infrastructure.

    Local search uses GIN trigram index on `display`. Free-text problem entry
    bypasses this table (Problem.free_text_label is used).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    code = models.CharField(max_length=64)
    code_system = models.CharField(max_length=32, choices=CodeSystem.choices)
    display = models.CharField(max_length=512)

    category = models.CharField(
        max_length=32,
        choices=ProblemCategory.choices,
        default=ProblemCategory.DIAGNOSIS,
    )
    is_chronic_default = models.BooleanField(
        default=False,
        help_text="Hint for UI: pre-select 'chronic' status when this code is picked.",
    )
    is_quick_pick = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Surface at top of search results (Ghana common conditions).",
    )
    quick_pick_rank = models.PositiveSmallIntegerField(
        default=0,
        help_text="Lower = higher in quick-pick ordering. Ignored if is_quick_pick is False.",
    )

    parent_code = models.CharField(
        max_length=64,
        blank=True,
        help_text="Parent code in same code_system (for hierarchy navigation).",
    )

    is_active = models.BooleanField(default=True)
    needs_clinical_review = models.BooleanField(
        default=False,
        help_text="True for seed entries pending clinician sign-off.",
    )

    source_release = models.CharField(
        max_length=32,
        blank=True,
        help_text="e.g. 'WHO-ICD10-2019' for re-import tracking.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['code_system', 'code'],
                name='problems_code_system_code_unique',
            ),
        ]
        indexes = [
            models.Index(fields=['code_system', 'is_active']),
            models.Index(fields=['is_quick_pick', 'quick_pick_rank']),
            models.Index(fields=['category', 'is_active']),
            GinIndex(fields=['display'], name='problem_code_display_trgm', opclasses=['gin_trgm_ops']),
        ]
        ordering = ['code_system', 'code']

    def __str__(self):
        return f"[{self.code_system}] {self.code} {self.display}"


class ClinicalStatus(models.TextChoices):
    ACTIVE = 'active', 'Active'
    INACTIVE = 'inactive', 'Inactive'
    RESOLVED = 'resolved', 'Resolved'
    REMISSION = 'remission', 'In Remission'
    RECURRENCE = 'recurrence', 'Recurrence'


class VerificationStatus(models.TextChoices):
    PROVISIONAL = 'provisional', 'Provisional'
    DIFFERENTIAL = 'differential', 'Differential'
    CONFIRMED = 'confirmed', 'Confirmed'
    REFUTED = 'refuted', 'Refuted'
    ENTERED_IN_ERROR = 'entered-in-error', 'Entered in Error'


class Priority(models.TextChoices):
    HIGH = 'high', 'High'
    MEDIUM = 'medium', 'Medium'
    LOW = 'low', 'Low'


class ProblemChronicity(models.TextChoices):
    """Distinct from clinical status; some active problems are acute, some chronic."""

    ACUTE = 'acute', 'Acute'
    CHRONIC = 'chronic', 'Chronic'
    UNSPECIFIED = 'unspecified', 'Unspecified'


class Problem(models.Model):
    """
    A patient's problem list entry.

    Either `code` (preferred, coded) OR `free_text_label` (fallback, uncoded) must be set.
    Free-text entries are flagged for later coding by clinical staff.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='problems',
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='problems',
        help_text="Facility where the problem was first recorded.",
    )

    code = models.ForeignKey(
        ProblemCode,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='problems',
    )
    free_text_label = models.CharField(
        max_length=512,
        blank=True,
        help_text="Required when code is null. Flagged for later coding.",
    )

    clinical_status = models.CharField(
        max_length=20,
        choices=ClinicalStatus.choices,
        default=ClinicalStatus.ACTIVE,
    )
    verification_status = models.CharField(
        max_length=24,
        choices=VerificationStatus.choices,
        default=VerificationStatus.PROVISIONAL,
    )
    priority = models.CharField(
        max_length=10,
        choices=Priority.choices,
        default=Priority.MEDIUM,
    )
    chronicity = models.CharField(
        max_length=16,
        choices=ProblemChronicity.choices,
        default=ProblemChronicity.UNSPECIFIED,
    )

    onset_date = models.DateField(null=True, blank=True)
    abatement_date = models.DateField(null=True, blank=True)
    last_assessed_at = models.DateTimeField(null=True, blank=True)

    note = models.TextField(blank=True, help_text="Free-text clinical note about this problem.")

    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='recorded_problems',
    )
    recorded_at = models.DateTimeField(default=timezone.now)

    last_updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_problems',
    )

    # FHIR sync (matches drug_safety pattern; lights up later when fhir_client is wired)
    fhir_id = models.CharField(max_length=100, blank=True, null=True, unique=True)
    fhir_synced = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-recorded_at']
        indexes = [
            models.Index(fields=['patient', 'clinical_status']),
            models.Index(fields=['patient', '-recorded_at']),
            models.Index(fields=['facility', 'clinical_status']),
            models.Index(fields=['code']),
        ]
        constraints = [
            # Either coded or free-text, not neither.
            models.CheckConstraint(
                check=(
                    models.Q(code__isnull=False)
                    | ~models.Q(free_text_label='')
                ),
                name='problems_problem_has_code_or_free_text',
            ),
        ]

    def __str__(self):
        label = self.code.display if self.code else self.free_text_label
        return f"{label} [{self.clinical_status}]"

    @property
    def display_label(self) -> str:
        return self.code.display if self.code else self.free_text_label

    @property
    def is_coded(self) -> bool:
        return self.code_id is not None


class ProblemStatusEvent(models.Model):
    """
    Append-only audit trail of clinical_status changes on a Problem.
    Captures clinical reasoning for status transitions.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    problem = models.ForeignKey(
        Problem,
        on_delete=models.CASCADE,
        related_name='status_events',
    )
    from_status = models.CharField(max_length=20, choices=ClinicalStatus.choices, blank=True)
    to_status = models.CharField(max_length=20, choices=ClinicalStatus.choices)
    reason = models.TextField(blank=True)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='problem_status_events',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-changed_at']
        indexes = [
            models.Index(fields=['problem', '-changed_at']),
        ]


class ProblemLink(models.Model):
    """
    Many-to-many link between a Problem and a clinical artifact.

    Per-source nullable FKs (not GenericForeignKey) for query speed:
    a single SELECT with patient + problem joins resolves all linked artifacts
    via partial indexes. Add new linkable types by adding new nullable FK columns.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    problem = models.ForeignKey(
        Problem,
        on_delete=models.CASCADE,
        related_name='links',
    )

    # Linkable artifacts. Exactly one must be non-null (enforced by check constraint).
    note_entry = models.ForeignKey(
        'clinical_notes.NoteEntry',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='problem_links',
    )
    prescription = models.ForeignKey(
        'clinical_notes.Prescription',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='problem_links',
    )
    lab_order = models.ForeignKey(
        'laboratory.LabOrder',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='problem_links',
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='problem_links',
    )

    linked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='problem_links_created',
    )
    linked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # Exactly one target FK must be set. Prevents accidental dual-linkage
            # (which would let one ProblemLink row claim two artifacts).
            models.CheckConstraint(
                check=(
                    models.Q(
                        note_entry__isnull=False,
                        prescription__isnull=True,
                        lab_order__isnull=True,
                        encounter__isnull=True,
                    )
                    | models.Q(
                        note_entry__isnull=True,
                        prescription__isnull=False,
                        lab_order__isnull=True,
                        encounter__isnull=True,
                    )
                    | models.Q(
                        note_entry__isnull=True,
                        prescription__isnull=True,
                        lab_order__isnull=False,
                        encounter__isnull=True,
                    )
                    | models.Q(
                        note_entry__isnull=True,
                        prescription__isnull=True,
                        lab_order__isnull=True,
                        encounter__isnull=False,
                    )
                ),
                name='problems_link_exactly_one_target',
            ),
            # Prevent duplicate links per (problem, target).
            models.UniqueConstraint(
                fields=['problem', 'note_entry'],
                condition=models.Q(note_entry__isnull=False),
                name='problems_link_problem_note_unique',
            ),
            models.UniqueConstraint(
                fields=['problem', 'prescription'],
                condition=models.Q(prescription__isnull=False),
                name='problems_link_problem_rx_unique',
            ),
            models.UniqueConstraint(
                fields=['problem', 'lab_order'],
                condition=models.Q(lab_order__isnull=False),
                name='problems_link_problem_lab_unique',
            ),
            models.UniqueConstraint(
                fields=['problem', 'encounter'],
                condition=models.Q(encounter__isnull=False),
                name='problems_link_problem_enc_unique',
            ),
        ]
        indexes = [
            models.Index(fields=['problem', '-linked_at']),
            models.Index(fields=['note_entry']),
            models.Index(fields=['prescription']),
            models.Index(fields=['lab_order']),
            models.Index(fields=['encounter']),
        ]
