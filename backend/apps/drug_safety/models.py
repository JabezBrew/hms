import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta

User = get_user_model()


class AllergySeverity(models.TextChoices):
    MILD = 'mild', 'Mild'
    MODERATE = 'moderate', 'Moderate'
    SEVERE = 'severe', 'Severe'
    LIFE_THREATENING = 'life_threatening', 'Life-Threatening'


class AllergyType(models.TextChoices):
    DRUG = 'drug', 'Drug'
    FOOD = 'food', 'Food'
    ENVIRONMENTAL = 'environmental', 'Environmental'
    OTHER = 'other', 'Other'


class PatientAllergy(models.Model):
    """
    Structured patient allergy record replacing free-text allergies field.
    Enables programmatic checking against prescriptions and proper FHIR sync.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='structured_allergies'
    )

    # Allergy identification
    allergen_name = models.CharField(
        max_length=255,
        help_text="Human-readable allergen name (e.g., 'Penicillin', 'Peanuts')"
    )
    allergen_code = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Standard code (RxCUI, SNOMED CT, etc.)"
    )
    allergen_code_system = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Code system (e.g., 'RxNorm', 'SNOMED')"
    )

    # Classification
    allergy_type = models.CharField(
        max_length=20,
        choices=AllergyType.choices,
        default=AllergyType.DRUG
    )
    severity = models.CharField(
        max_length=20,
        choices=AllergySeverity.choices,
        default=AllergySeverity.MODERATE,
        help_text="Severity of allergic reaction"
    )

    # Reaction details
    reaction = models.TextField(
        blank=True,
        help_text="Description of allergic reaction (e.g., 'Rash', 'Anaphylaxis')"
    )
    onset_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date allergy was first observed"
    )

    # Status and verification
    is_active = models.BooleanField(
        default=True,
        help_text="Whether this allergy is currently active"
    )
    verified_by = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verified_allergies',
        help_text="Practitioner who verified this allergy"
    )
    verified_at = models.DateTimeField(null=True, blank=True)

    # FHIR sync
    fhir_id = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        unique=True,
        help_text="FHIR AllergyIntolerance resource ID"
    )
    fhir_synced = models.BooleanField(default=False)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_allergies'
    )

    class Meta:
        verbose_name = 'Patient Allergy'
        verbose_name_plural = 'Patient Allergies'
        ordering = ['-severity', 'allergen_name']
        indexes = [
            models.Index(fields=['patient', 'is_active']),
            models.Index(fields=['allergen_code']),
        ]

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.allergen_name} ({self.severity})"


class AlertSeverity(models.TextChoices):
    CRITICAL = 'critical', 'Critical (Hard Stop)'
    HIGH = 'high', 'High (Warning)'
    MODERATE = 'moderate', 'Moderate (Caution)'
    LOW = 'low', 'Low (Informational)'


class AlertType(models.TextChoices):
    DRUG_INTERACTION = 'drug_interaction', 'Drug-Drug Interaction'
    ALLERGY = 'allergy', 'Allergy Alert'
    CONTRAINDICATION = 'contraindication', 'Contraindication'
    DUPLICATE_THERAPY = 'duplicate_therapy', 'Duplicate Therapy'


class DrugSafetyAlert(models.Model):
    """
    Safety alerts generated during prescription creation.
    Tracks drug interactions, allergy warnings, and override decisions.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='drug_safety_alerts'
    )
    prescription = models.ForeignKey(
        'clinical_notes.Prescription',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='safety_alerts'
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='drug_safety_alerts'
    )

    # Alert details
    alert_type = models.CharField(
        max_length=30,
        choices=AlertType.choices
    )
    severity = models.CharField(
        max_length=20,
        choices=AlertSeverity.choices,
        help_text="Critical = hard stop, High = warning, Moderate/Low = informational"
    )
    title = models.CharField(
        max_length=255,
        help_text="Brief alert title (e.g., 'Severe Drug Interaction')"
    )
    description = models.TextField(
        help_text="Detailed description of the safety concern"
    )

    # Drug details
    triggering_medication = models.CharField(
        max_length=255,
        help_text="The medication being prescribed that triggered the alert"
    )
    conflicting_medication = models.CharField(
        max_length=255,
        blank=True,
        help_text="Existing medication or allergen causing the conflict"
    )

    # Override tracking
    is_overridden = models.BooleanField(
        default=False,
        help_text="Whether provider overrode this alert"
    )
    override_reason = models.TextField(
        blank=True,
        help_text="Required reason for overriding critical/high alerts"
    )
    overridden_by = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='overridden_alerts'
    )
    overridden_at = models.DateTimeField(null=True, blank=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Drug Safety Alert'
        verbose_name_plural = 'Drug Safety Alerts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['patient', 'created_at']),
            models.Index(fields=['prescription']),
            models.Index(fields=['severity', 'is_overridden']),
        ]

    def __str__(self):
        return f"{self.get_severity_display()}: {self.title}"

    def requires_override_reason(self):
        """Check if this alert severity requires an override reason."""
        return self.severity in [AlertSeverity.CRITICAL, AlertSeverity.HIGH]


class DrugInteractionCache(models.Model):
    """
    Cache for drug interaction data from external APIs (RxNorm, OpenFDA).
    Reduces API calls and improves performance.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Drug pair (normalized for consistent lookups)
    drug1_rxcui = models.CharField(
        max_length=20,
        help_text="RxCUI code for first drug"
    )
    drug2_rxcui = models.CharField(
        max_length=20,
        help_text="RxCUI code for second drug"
    )

    # Interaction details
    severity = models.CharField(
        max_length=20,
        help_text="Interaction severity from API"
    )
    description = models.TextField(
        help_text="Description of the interaction"
    )
    source = models.CharField(
        max_length=50,
        help_text="API source (e.g., 'RxNorm', 'OpenFDA')"
    )

    # Cache management
    fetched_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(
        help_text="Cache expiration time"
    )

    class Meta:
        verbose_name = 'Drug Interaction Cache'
        verbose_name_plural = 'Drug Interaction Cache'
        ordering = ['-fetched_at']
        indexes = [
            models.Index(fields=['drug1_rxcui', 'drug2_rxcui']),
            models.Index(fields=['expires_at']),
        ]
        # Ensure drug pairs are unique (order-independent)
        constraints = [
            models.UniqueConstraint(
                fields=['drug1_rxcui', 'drug2_rxcui'],
                name='unique_drug_pair'
            )
        ]

    def __str__(self):
        return f"{self.drug1_rxcui} + {self.drug2_rxcui} = {self.severity}"

    def is_expired(self):
        """Check if cache entry has expired."""
        return timezone.now() > self.expires_at

    def save(self, *args, **kwargs):
        """Set expiration time on creation (30 days default)."""
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(days=30)
        super().save(*args, **kwargs)
