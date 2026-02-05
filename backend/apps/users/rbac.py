from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.db.models.signals import post_save
from django.dispatch import receiver
from rest_framework import permissions

from .models import User, Staff, PractitionerProfile, PatientProfile


# Define role-based permission classes
class IsAdmin(permissions.BasePermission):
    """
    Permission class for administrators.
    Grants full access to all data and configuration.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'admin'


class IsDoctor(permissions.BasePermission):
    """
    Permission class for doctors.
    Can view and manage their patients, consultations, encounters, and prescriptions.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'doctor'


class IsNurse(permissions.BasePermission):
    """
    Permission class for nurses.
    Can assist with vitals, medications, observations, and inpatient management.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'nurse'


class IsReceptionist(permissions.BasePermission):
    """
    Permission class for receptionists.
    Can register patients, schedule appointments, view basic demographics.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'receptionist'


class IsLabTechnician(permissions.BasePermission):
    """
    Permission class for lab technicians.
    Can receive lab orders, enter results, view patient identifiers.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'lab_technician'


class IsPharmacist(permissions.BasePermission):
    """
    Permission class for pharmacists.
    Can fulfill prescriptions, update inventory.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'pharmacist'


class IsBillingOfficer(permissions.BasePermission):
    """
    Permission class for billing officers.
    Can view charges, payments, and generate invoices.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'billing'


class IsPatient(permissions.BasePermission):
    """
    Permission class for patients.
    Can view personal info, lab results, bills (if patient portal is enabled).
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'patient'


class IsClinicalProvider(permissions.BasePermission):
    """
    Permission class for clinical providers.
    Includes doctors, nurses, lab technicians, and pharmacists.
    Used for features like "My Patients" that are specific to clinical staff.
    """
    CLINICAL_ROLES = ['doctor', 'nurse', 'lab_technician', 'pharmacist']

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated and
            request.user.user_type in self.CLINICAL_ROLES
        )


# Define custom permissions for specific actions
def create_custom_permissions(using=None):
    """
    Create custom permissions for the RBAC system.
    """
    db_alias = using or 'default'
    content_types = ContentType.objects.db_manager(db_alias)
    permissions = Permission.objects.using(db_alias)

    # Define content types for models
    user_content_type = content_types.get_for_model(User)
    staff_content_type = content_types.get_for_model(Staff)
    practitioner_content_type = content_types.get_for_model(PractitionerProfile)
    patient_content_type = content_types.get_for_model(PatientProfile)
    
    # Create custom permissions
    permissions_to_create = [
        # User permissions
        ('can_view_user_profile', 'Can view user profile', user_content_type),
        ('can_edit_user_profile', 'Can edit user profile', user_content_type),
        
        # Staff permissions
        ('can_create_staff', 'Can create staff', staff_content_type),
        ('can_view_staff', 'Can view staff', staff_content_type),
        ('can_edit_staff', 'Can edit staff', staff_content_type),
        
        # Practitioner permissions
        ('can_create_practitioner', 'Can create practitioner', practitioner_content_type),
        ('can_view_practitioner', 'Can view practitioner', practitioner_content_type),
        ('can_edit_practitioner', 'Can edit practitioner', practitioner_content_type),
        
        # Patient permissions
        ('can_create_patient', 'Can create patient', patient_content_type),
        ('can_view_patient_profile', 'Can view patient profile', patient_content_type),
        ('can_edit_patient_profile', 'Can edit patient profile', patient_content_type),
        
        # Clinical permissions
        ('can_create_encounter', 'Can create encounter', patient_content_type),
        ('can_view_lab_results', 'Can view lab results', patient_content_type),
        ('can_update_vitals', 'Can update vitals', patient_content_type),
        ('can_create_prescription', 'Can create prescription', patient_content_type),
        
        # Billing permissions
        ('can_access_billing', 'Can access billing', patient_content_type),
    ]
    
    # Create permissions if they don't exist
    for codename, name, content_type in permissions_to_create:
        permissions.get_or_create(
            codename=codename,
            name=name,
            content_type=content_type
        )


# Define function to set up groups with permissions
def setup_groups_and_permissions(using=None):
    """
    Set up groups and assign permissions according to the RBAC matrix.
    """
    db_alias = using or 'default'
    groups = Group.objects.using(db_alias)
    permissions = Permission.objects.using(db_alias)

    # Create groups if they don't exist
    admin_group, _ = groups.get_or_create(name='Admin')
    doctor_group, _ = groups.get_or_create(name='Doctor')
    nurse_group, _ = groups.get_or_create(name='Nurse')
    receptionist_group, _ = groups.get_or_create(name='Receptionist')
    lab_tech_group, _ = groups.get_or_create(name='Lab Technician')
    pharmacist_group, _ = groups.get_or_create(name='Pharmacist')
    billing_group, _ = groups.get_or_create(name='Billing')
    patient_group, _ = groups.get_or_create(name='Patient')
    
    # Ensure custom permissions exist
    create_custom_permissions(using=db_alias)
    
    # Clear existing permissions
    admin_group.permissions.clear()
    doctor_group.permissions.clear()
    nurse_group.permissions.clear()
    receptionist_group.permissions.clear()
    lab_tech_group.permissions.clear()
    pharmacist_group.permissions.clear()
    billing_group.permissions.clear()
    patient_group.permissions.clear()
    
    # Assign permissions based on the RBAC matrix
    
    # Admin - Full access to all permissions
    all_permissions = permissions.all()
    admin_group.permissions.add(*all_permissions)
    
    # Doctor permissions
    doctor_permissions = permissions.filter(codename__in=[
        'can_view_user_profile',
        'can_view_staff',
        'can_view_practitioner',
        'can_view_patient_profile',
        'can_create_patient',
        'can_edit_patient_profile',
        'can_create_encounter',
        'can_view_lab_results',
        'can_update_vitals',
        'can_create_prescription',
        'can_access_billing',
    ])
    doctor_group.permissions.add(*doctor_permissions)
    
    # Nurse permissions
    nurse_permissions = permissions.filter(codename__in=[
        'can_view_user_profile',
        'can_view_staff',
        'can_view_practitioner',
        'can_view_patient_profile',
        'can_create_patient',
        'can_edit_patient_profile',
        'can_create_encounter',
        'can_view_lab_results',
        'can_update_vitals',
    ])
    nurse_group.permissions.add(*nurse_permissions)
    
    # Receptionist permissions
    receptionist_permissions = permissions.filter(codename__in=[
        'can_view_user_profile',
        'can_view_staff',
        'can_view_patient_profile',
        'can_create_patient',
        'can_edit_patient_profile',
        'can_access_billing',
    ])
    receptionist_group.permissions.add(*receptionist_permissions)
    
    # Lab Technician permissions
    lab_tech_permissions = permissions.filter(codename__in=[
        'can_view_user_profile',
        'can_view_patient_profile',
        'can_view_lab_results',
    ])
    lab_tech_group.permissions.add(*lab_tech_permissions)
    
    # Pharmacist permissions
    pharmacist_permissions = permissions.filter(codename__in=[
        'can_view_user_profile',
        'can_view_patient_profile',
        'can_create_prescription',
    ])
    pharmacist_group.permissions.add(*pharmacist_permissions)
    
    # Billing Officer permissions
    billing_permissions = permissions.filter(codename__in=[
        'can_view_user_profile',
        'can_view_patient_profile',
        'can_view_lab_results',
        'can_access_billing',
    ])
    billing_group.permissions.add(*billing_permissions)
    
    # Patient permissions (if patient portal is enabled)
    patient_permissions = permissions.filter(codename__in=[
        'can_view_user_profile',
        'can_view_patient_profile',
        'can_view_lab_results',
    ])
    patient_group.permissions.add(*patient_permissions)


# Signal to auto-assign roles on user creation
@receiver(post_save, sender=User)
def assign_user_to_group(sender, instance, created, **kwargs):
    """
    Signal handler to automatically assign users to groups based on their user_type.
    """
    if created or instance.user_type:
        db_alias = instance._state.db or 'default'
        # Remove user from all groups first
        instance.groups.clear()

        # Map user_type to group name
        user_type_to_group = {
            'admin': 'Admin',
            'doctor': 'Doctor',
            'nurse': 'Nurse',
            'receptionist': 'Receptionist',
            'lab_technician': 'Lab Technician',
            'pharmacist': 'Pharmacist',
            'billing': 'Billing',
            'patient': 'Patient',
        }

        # Get the group for this user_type
        group_name = user_type_to_group.get(instance.user_type)
        if group_name:
            try:
                group = Group.objects.using(db_alias).get(name=group_name)
                instance.groups.add(group)
            except Group.DoesNotExist:
                # Group doesn't exist yet, create it
                setup_groups_and_permissions(using=db_alias)
                group = Group.objects.using(db_alias).get(name=group_name)
                instance.groups.add(group)
