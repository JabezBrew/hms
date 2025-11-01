import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils.translation import gettext_lazy as _


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
