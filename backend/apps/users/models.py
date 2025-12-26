import uuid
import hashlib
import secrets
from datetime import timedelta
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils.translation import gettext_lazy as _
from django.utils import timezone


class User(AbstractUser):
    """
    Custom User model that extends Django's AbstractUser.
    Uses email as the unique identifier instead of username.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(_('email address'), unique=True)

    # Additional fields
    phone_number = models.CharField(max_length=20, blank=True, null=True)
    date_of_birth = models.DateField(blank=True, null=True)

    GENDER_CHOICES = (
        ('M', 'Male'),
        ('F', 'Female'),
        ('O', 'Other'),
    )
    gender = models.CharField(max_length=1, choices=GENDER_CHOICES, blank=True, null=True)

    # User type choices
    USER_TYPE_CHOICES = (
        ('admin', 'Administrator'),
        ('doctor', 'Doctor'),
        ('nurse', 'Nurse'),
        ('receptionist', 'Receptionist'),
        ('lab_technician', 'Lab Technician'),
        ('pharmacist', 'Pharmacist'),
        ('billing', 'Billing Clerk'),
        ('patient', 'Patient'),
    )
    user_type = models.CharField(max_length=20, choices=USER_TYPE_CHOICES, default='patient')

    # Required for using email as username
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']  # Username still required by AbstractUser

    def __str__(self):
        return self.email


class Staff(models.Model):
    """
    Staff model for all hospital staff members.
    Links to User model and contains staff-specific information.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='staff_profile')
    employee_id = models.CharField(max_length=20, unique=True)
    department = models.CharField(max_length=100)
    position = models.CharField(max_length=100)
    hire_date = models.DateField()

    # Facility association (for multi-facility support)
    primary_facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.SET_NULL,
        null=True,  # Nullable for backward compatibility during migration
        blank=True,
        related_name='staff_members',
        help_text="Primary facility where this staff member works"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_staff')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_staff')

    def __str__(self):
        return f"{self.employee_id} - {self.user.get_full_name()}"


class PractitionerProfile(models.Model):
    """
    Practitioner profile for doctors and nurses.
    Contains medical credentials and specialization.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    staff = models.OneToOneField(Staff, on_delete=models.CASCADE, related_name='practitioner_profile')
    license_number = models.CharField(max_length=50, unique=True)
    specialization = models.CharField(max_length=100)
    qualification = models.CharField(max_length=200)

    # FHIR resource reference
    fhir_practitioner_id = models.CharField(max_length=100, blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_practitioners')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_practitioners')

    def __str__(self):
        return f"Dr. {self.staff.user.get_full_name()} - {self.specialization}"


class PractitionerFHIRMapping(models.Model):
    """
    Mapping between local practitioner data and FHIR resources.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    practitioner_profile = models.OneToOneField(PractitionerProfile, on_delete=models.CASCADE, related_name='fhir_mapping')

    # FHIR resource references
    fhir_practitioner_id = models.CharField(max_length=100, unique=True)
    fhir_resource_version = models.CharField(max_length=50, blank=True, null=True)

    # Sync status
    last_synced = models.DateTimeField(auto_now=True)
    is_synced = models.BooleanField(default=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_practitioner_mappings')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_practitioner_mappings')

    def __str__(self):
        return f"Mapping for {self.practitioner_profile.staff.user.get_full_name()} - {self.fhir_practitioner_id}"


class PatientProfile(models.Model):
    """
    Patient profile for patients.
    Contains patient-specific information and links to FHIR Patient resource.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='patient_profile')
    medical_record_number = models.CharField(max_length=20, unique=True)
    nhis_id = models.CharField(max_length=50, blank=True, null=True)
    blood_group = models.CharField(max_length=5, blank=True, null=True)
    allergies = models.TextField(blank=True, null=True)
    emergency_contact_name = models.CharField(max_length=100, blank=True, null=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True, null=True)
    emergency_contact_relationship = models.CharField(max_length=50, blank=True, null=True)

    # FHIR resource reference
    fhir_patient_id = models.CharField(max_length=100, blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_patients')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_patients')

    def __str__(self):
        return f"{self.medical_record_number} - {self.user.get_full_name()}"

    class Meta:
        indexes = [
            models.Index(fields=['medical_record_number']),
            models.Index(fields=['nhis_id']),
            models.Index(fields=['fhir_patient_id']),
            models.Index(fields=['created_at']),
        ]


class PasswordResetToken(models.Model):
    """
    Secure password reset token model.
    Tokens are stored hashed (not plain text) for security.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='password_reset_tokens')

    # Store hashed token, not plain text
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)

    # Token metadata
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    # Track usage
    used_at = models.DateTimeField(null=True, blank=True)
    is_used = models.BooleanField(default=False)

    # Reset type
    RESET_TYPE_CHOICES = (
        ('self_service', 'Self Service'),
        ('admin_force', 'Admin Force Reset'),
    )
    reset_type = models.CharField(max_length=20, choices=RESET_TYPE_CHOICES, default='self_service')

    # For admin-initiated resets, track who initiated
    initiated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='initiated_password_resets'
    )

    class Meta:
        db_table = 'password_reset_tokens'
        indexes = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['expires_at']),
        ]

    @classmethod
    def hash_token(cls, token):
        """Hash a token using SHA-256"""
        return hashlib.sha256(token.encode()).hexdigest()

    @classmethod
    def generate_token(cls):
        """Generate a cryptographically secure token"""
        return secrets.token_urlsafe(32)

    @classmethod
    def create_for_user(cls, user, reset_type='self_service', initiated_by=None, expiry_minutes=15):
        """
        Create a new password reset token for a user.
        Returns the plain token (to be sent in email) and the model instance.
        """
        # Generate a secure token
        plain_token = cls.generate_token()
        token_hash = cls.hash_token(plain_token)

        # Invalidate any existing unused tokens for this user
        cls.objects.filter(user=user, is_used=False).update(is_used=True)

        # Create new token
        token_obj = cls.objects.create(
            user=user,
            token_hash=token_hash,
            expires_at=timezone.now() + timedelta(minutes=expiry_minutes),
            reset_type=reset_type,
            initiated_by=initiated_by,
        )

        return plain_token, token_obj

    @classmethod
    def verify_token(cls, plain_token):
        """
        Verify a token and return the associated user if valid.
        Returns (user, token_obj) if valid, (None, None) if invalid.
        """
        token_hash = cls.hash_token(plain_token)

        try:
            token_obj = cls.objects.select_related('user').get(
                token_hash=token_hash,
                is_used=False,
                expires_at__gt=timezone.now()
            )
            return token_obj.user, token_obj
        except cls.DoesNotExist:
            return None, None

    def mark_as_used(self):
        """Mark the token as used"""
        self.is_used = True
        self.used_at = timezone.now()
        self.save(update_fields=['is_used', 'used_at'])

    def __str__(self):
        return f"Password reset token for {self.user.email} ({'used' if self.is_used else 'active'})"


class UserPatientList(models.Model):
    """
    Personal patient list for clinicians.
    Allows users to maintain a quick-access list of patients they are actively managing.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='patient_lists')
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='in_user_lists')

    # Optional organization
    notes = models.CharField(max_length=255, blank=True)
    is_pinned = models.BooleanField(default=False)

    # Timestamps
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'patient')
        ordering = ['-is_pinned', '-added_at']
        indexes = [
            models.Index(fields=['user', '-added_at']),
            models.Index(fields=['user', '-is_pinned', '-added_at']),
        ]
        verbose_name = 'User Patient List'
        verbose_name_plural = 'User Patient Lists'

    def __str__(self):
        return f"{self.user.email} -> {self.patient.medical_record_number}"
