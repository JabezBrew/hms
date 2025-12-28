"""
SECURITY: Centralized access control utilities for the HMS application.

This module implements DATA-TYPE SPECIFIC access control with team-based enforcement:
- Each data type (clinical, lab, prescription, billing) has its own access rules
- Clinical staff require team access or break-glass (when enabled) for patient data
- Support staff can ONLY access their specific data domain
"""
from rest_framework.exceptions import PermissionDenied
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)


ACTIVE_ADMISSION_STATUSES = ['admitted', 'waiting']
ACTIVE_ENCOUNTER_STATUSES = ['planned', 'in-progress']


def _get_patient_profile(patient_or_id):
    """Helper to get PatientProfile from ID or instance."""
    from apps.users.models import PatientProfile

    if not isinstance(patient_or_id, PatientProfile):
        try:
            return PatientProfile.objects.get(id=patient_or_id)
        except PatientProfile.DoesNotExist:
            raise PermissionDenied("Patient not found.")
    return patient_or_id


def _get_practitioner_profile(user):
    """Return PractitionerProfile for a user if available."""
    from apps.users.models import PractitionerProfile

    return PractitionerProfile.objects.filter(staff__user=user).first()


def _has_active_break_glass(user, patient, scope='clinical'):
    """Check if a user has an active break-glass event for a patient."""
    from apps.core.models import BreakGlassEvent

    return BreakGlassEvent.objects.filter(
        user=user,
        patient=patient,
        scope=scope,
        expires_at__gt=timezone.now()
    ).exists()


def _has_team_access(user, patient):
    """
    Check team-based access for clinicians using admissions and encounters.
    """
    from apps.wards.models import Admission
    from apps.encounters.models import Encounter

    practitioner = _get_practitioner_profile(user)
    if not practitioner:
        return False

    if Admission.objects.filter(
        patient=patient,
        status__in=ACTIVE_ADMISSION_STATUSES,
        admitting_doctor=practitioner
    ).exists():
        return True

    if Admission.objects.filter(
        patient=patient,
        status__in=ACTIVE_ADMISSION_STATUSES,
        bed__isnull=False,
        bed__ward__staff_assignments__practitioner=practitioner,
        bed__ward__staff_assignments__is_active=True
    ).exists():
        return True

    if Encounter.objects.filter(
        patient=patient,
        practitioner=practitioner,
        status__in=ACTIVE_ENCOUNTER_STATUSES
    ).exists():
        return True

    return False


def get_accessible_patients_for_clinician(user, scope='clinical'):
    """
    Return a queryset of patients a clinician can access under team rules.
    """
    from apps.users.models import PatientProfile

    practitioner = _get_practitioner_profile(user)
    if not practitioner:
        return PatientProfile.objects.none()

    admission_access = Q(
        admissions__status__in=ACTIVE_ADMISSION_STATUSES
    ) & (
        Q(admissions__admitting_doctor=practitioner) |
        Q(
            admissions__bed__ward__staff_assignments__practitioner=practitioner,
            admissions__bed__ward__staff_assignments__is_active=True
        )
    )

    encounter_access = Q(
        encounters__practitioner=practitioner,
        encounters__status__in=ACTIVE_ENCOUNTER_STATUSES
    )

    break_glass_access = Q(
        break_glass_events__user=user,
        break_glass_events__scope=scope,
        break_glass_events__expires_at__gt=timezone.now()
    )

    return PatientProfile.objects.filter(
        admission_access | encounter_access | break_glass_access
    ).distinct()


def check_clinical_access(user, patient_or_id):
    """
    SECURITY: Check access to CLINICAL data (vitals, notes, encounters, diagnoses).

    Allowed: Admin, Doctor, Nurse, Patient (own data)
    Denied: Lab Tech, Pharmacist, Billing, Receptionist
    """
    patient_profile = _get_patient_profile(patient_or_id)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type in ['doctor', 'nurse']:
        if not settings.TEAM_ACCESS_STRICT:
            return True

        if _has_team_access(user, patient_profile):
            return True

        if _has_active_break_glass(user, patient_profile, scope='clinical'):
            return True

        raise PermissionDenied("Team-based access required. Use break-glass to access this patient.")

    raise PermissionDenied("You do not have access to clinical data.")


def check_lab_access(user, patient_or_id):
    """
    SECURITY: Check access to LAB data (orders, results).

    Allowed: Admin, Doctor, Nurse, Lab Tech (with relevant orders), Patient (own data)
    Denied: Pharmacist, Billing, Receptionist
    """
    patient_profile = _get_patient_profile(patient_or_id)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type in ['doctor', 'nurse']:
        return check_clinical_access(user, patient_profile)

    if user.user_type == 'lab_technician':
        from apps.laboratory.models import LabOrder
        if LabOrder.objects.filter(
            patient=patient_profile,
            status__in=['pending', 'in_progress', 'collected', 'completed']
        ).exists():
            return True
        raise PermissionDenied("No lab orders found for this patient.")

    raise PermissionDenied("You do not have access to lab data.")


def check_prescription_access(user, patient_or_id):
    """
    SECURITY: Check access to PRESCRIPTION data.

    Allowed: Admin, Doctor, Nurse, Pharmacist (with active Rx), Patient (own data)
    Denied: Lab Tech, Billing, Receptionist
    """
    patient_profile = _get_patient_profile(patient_or_id)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type in ['doctor', 'nurse']:
        return check_clinical_access(user, patient_profile)

    if user.user_type == 'pharmacist':
        from apps.prescriptions.models import Prescription
        if Prescription.objects.filter(
            patient=patient_profile,
            status='active'
        ).exists():
            return True
        raise PermissionDenied("No active prescriptions for this patient.")

    raise PermissionDenied("You do not have access to prescription data.")


def check_billing_access(user, patient_or_id):
    """
    SECURITY: Check access to BILLING data (invoices, payments, claims).

    Allowed: Admin, Billing Staff, Patient (own data)
    Denied: Doctor, Nurse, Lab Tech, Pharmacist, Receptionist
    """
    patient_profile = _get_patient_profile(patient_or_id)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type == 'billing':
        return True

    raise PermissionDenied("You do not have access to billing data.")


def check_demographics_access(user, patient_or_id):
    """
    SECURITY: Check access to DEMOGRAPHICS data (name, contact, scheduling).

    Allowed: Admin, Doctor, Nurse, Receptionist, Patient (own data)
    Denied: Lab Tech, Pharmacist, Billing (unless they have billing records)
    """
    patient_profile = _get_patient_profile(patient_or_id)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type in ['doctor', 'nurse', 'receptionist']:
        return True

    # Support staff can see demographics only if they have relevant records
    if user.user_type == 'lab_technician':
        from apps.laboratory.models import LabOrder
        if LabOrder.objects.filter(patient=patient_profile).exists():
            return True

    if user.user_type == 'pharmacist':
        from apps.prescriptions.models import Prescription
        if Prescription.objects.filter(patient=patient_profile).exists():
            return True

    if user.user_type == 'billing':
        from apps.billing.models import Invoice
        if Invoice.objects.filter(patient=patient_profile).exists():
            return True

    raise PermissionDenied("You do not have access to this patient's data.")


def get_access_flags(user, patient_or_id):
    """
    Return a dict of access flags for a patient without raising exceptions.
    Used by frontend to conditionally fetch data (optimization hint only -
    backend still enforces access on every endpoint).

    Returns:
        dict: {
            'clinical': bool,  # Can access vitals, notes, encounters
            'lab': bool,       # Can access lab orders/results
            'prescription': bool,  # Can access prescriptions
            'billing': bool,   # Can access billing data
            'demographics': bool,  # Can access basic info
        }
    """
    patient_profile = _get_patient_profile(patient_or_id)
    flags = {
        'clinical': False,
        'lab': False,
        'prescription': False,
        'billing': False,
        'demographics': False,
    }

    # Admin has full access
    if user.user_type == 'admin':
        return {k: True for k in flags}

    # Patient can access own data
    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return {k: True for k in flags}
        return flags

    # Clinical staff (doctor, nurse)
    if user.user_type in ['doctor', 'nurse']:
        flags['demographics'] = True

        # Check team access or break-glass for clinical data
        has_clinical = False
        if not settings.TEAM_ACCESS_STRICT:
            has_clinical = True
        elif _has_team_access(user, patient_profile):
            has_clinical = True
        elif _has_active_break_glass(user, patient_profile, scope='clinical'):
            has_clinical = True

        flags['clinical'] = has_clinical
        flags['lab'] = has_clinical
        flags['prescription'] = has_clinical
        return flags

    # Receptionist - demographics only
    if user.user_type == 'receptionist':
        flags['demographics'] = True
        return flags

    # Lab technician - check for lab orders
    if user.user_type == 'lab_technician':
        from apps.laboratory.models import LabOrder
        has_orders = LabOrder.objects.filter(
            patient=patient_profile,
            status__in=['pending', 'in_progress', 'collected', 'completed']
        ).exists()
        flags['lab'] = has_orders
        flags['demographics'] = LabOrder.objects.filter(patient=patient_profile).exists()
        return flags

    # Pharmacist - check for prescriptions
    if user.user_type == 'pharmacist':
        from apps.prescriptions.models import Prescription
        flags['prescription'] = Prescription.objects.filter(
            patient=patient_profile,
            status='active'
        ).exists()
        flags['demographics'] = Prescription.objects.filter(patient=patient_profile).exists()
        return flags

    # Billing staff
    if user.user_type == 'billing':
        from apps.billing.models import Invoice
        flags['billing'] = True
        flags['demographics'] = Invoice.objects.filter(patient=patient_profile).exists()
        return flags

    return flags


def check_referral_access(user, referral):
    """
    SECURITY: Check if user has permission to modify a referral.

    Args:
        user: The authenticated user making the request
        referral: The Referral instance

    Returns:
        True if access is granted

    Raises:
        PermissionDenied: If access is denied
    """
    from apps.users.models import Staff, PractitionerProfile

    # Admin has full access
    if user.user_type == 'admin':
        return True

    # Only doctors can manage referrals
    if user.user_type != 'doctor':
        raise PermissionDenied("Only doctors can manage referrals.")

    try:
        staff = Staff.objects.get(user=user)
        practitioner = PractitionerProfile.objects.get(staff=staff)

        # Check if user is the referring or receiving provider
        if referral.referring_provider == practitioner:
            return True
        if referral.receiving_provider == practitioner:
            return True

    except (Staff.DoesNotExist, PractitionerProfile.DoesNotExist):
        pass

    raise PermissionDenied("You are not authorized to modify this referral.")
