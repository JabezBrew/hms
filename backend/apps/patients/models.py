import uuid
from django.db import models
from django.contrib.auth import get_user_model
from ..users.models import PatientProfile

User = get_user_model()


class PatientFHIRMapping(models.Model):
    """
    Mapping between local patient data and FHIR resources.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_profile = models.OneToOneField(PatientProfile, on_delete=models.CASCADE, related_name='fhir_mapping')
    
    # FHIR resource references
    fhir_patient_id = models.CharField(max_length=100, unique=True)
    fhir_resource_version = models.CharField(max_length=50, blank=True, null=True)
    
    # Sync status
    last_synced = models.DateTimeField(auto_now=True)
    is_synced = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_patient_mappings')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_patient_mappings')
    
    def __str__(self):
        return f"Mapping for {self.patient_profile.user.get_full_name()} - {self.fhir_patient_id}"


class PatientSearch(models.Model):
    """
    Model to store patient search history.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='patient_searches')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='patient_searches',
        help_text="Facility context for this patient search"
    )
    search_query = models.CharField(max_length=255)
    search_date = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-search_date']
        indexes = [
            models.Index(fields=['facility', 'user', '-search_date'], name='pat_search_fac_user_dt_idx'),
        ]
    
    def __str__(self):
        return f"{self.user.email} - {self.search_query}"


class RecentPatient(models.Model):
    """
    Model to store recently accessed patients for each user.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='recent_patients')
    patient_profile = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='recent_accesses')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='recent_patient_accesses',
        help_text="Facility context for this recent patient access"
    )
    access_date = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-access_date']
        unique_together = ['user', 'patient_profile']
        indexes = [
            models.Index(fields=['facility', 'user', '-access_date'], name='pat_recent_fac_user_dt_idx'),
        ]
    
    def __str__(self):
        return f"{self.user.email} - {self.patient_profile.user.get_full_name()}"


class PatientRegistrationValidation(models.Model):
    """
    Model to store validation rules for patient registration.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    field_name = models.CharField(max_length=100)
    validation_regex = models.CharField(max_length=255, blank=True, null=True)
    validation_message = models.CharField(max_length=255)
    is_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_validations')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_validations')
    
    def __str__(self):
        return f"Validation for {self.field_name}"


class PatientNote(models.Model):
    """
    Model to store notes about patients.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_profile = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='notes')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='patient_notes',
        help_text="Facility context for this patient note"
    )
    note_text = models.TextField()
    is_private = models.BooleanField(default=False)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_patient_notes')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_patient_notes')
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['facility', 'patient_profile', '-created_at'], name='pat_note_fac_pat_dt_idx'),
        ]
    
    def __str__(self):
        return f"Note for {self.patient_profile.user.get_full_name()} by {self.created_by.get_full_name()}"
