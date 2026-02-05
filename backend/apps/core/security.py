"""
SECURITY: Centralized access control utilities for the HMS application.

This module implements DATA-TYPE SPECIFIC access control with team-based enforcement:
- Each data type (clinical, lab, prescription, billing) has its own access rules
- Clinical staff require team access or break-glass (when enabled) for patient data
- Support staff can ONLY access their specific data domain
"""
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)


ACTIVE_ADMISSION_STATUSES = ['admitted', 'waiting']
ACTIVE_ENCOUNTER_STATUSES = ['planned', 'in-progress']


def normalize_facility_code(code):
    if not code:
        return None
    return str(code).strip().upper()


def get_user_facility_codes(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return set()

    codes = set()
    primary_facility = getattr(user, 'primary_facility', None)
    if primary_facility:
        codes.add(normalize_facility_code(primary_facility.code))

    try:
        staff = getattr(user, 'staff_profile', None)
    except Exception:
        staff = None
    if staff and getattr(staff, 'primary_facility', None):
        codes.add(normalize_facility_code(staff.primary_facility.code))

    try:
        facility_codes = user.facilities.values_list('code', flat=True)
    except Exception:
        facility_codes = []
    for code in facility_codes:
        normalized = normalize_facility_code(code)
        if normalized:
            codes.add(normalized)

    codes.discard(None)
    return codes


def get_user_facility(request):
    user = getattr(request, 'user', None) if request else None
    allowed_codes = set()
    allow_cross_facility = False
    is_admin = False
    if user and getattr(user, 'is_authenticated', False):
        allowed_codes = get_user_facility_codes(user)
        allow_cross_facility = getattr(settings, 'ALLOW_CROSS_FACILITY_ACCESS', False)
        is_admin = bool(getattr(user, 'user_type', None) == 'admin')

    facility = getattr(request, 'facility', None)
    if facility:
        facility_code = normalize_facility_code(getattr(facility, 'code', None))
        if not allowed_codes or facility_code in allowed_codes or (allow_cross_facility and is_admin):
            return facility

    facility_code = normalize_facility_code(getattr(request, 'facility_code', None))
    if facility_code and allowed_codes and facility_code not in allowed_codes and not (allow_cross_facility and is_admin):
        facility_code = None
    if not facility_code and request:
        header_name = getattr(settings, 'FACILITY_HEADER_NAME', 'X-Facility-Code')
        header_key = f'HTTP_{header_name.upper().replace("-", "_")}'
        facility_code = normalize_facility_code(request.META.get(header_key))
    if not facility_code and user and getattr(user, 'is_authenticated', False):
        if len(allowed_codes) == 1:
            facility_code = next(iter(allowed_codes))
    if not facility_code:
        from hms_backend.tenancy import get_current_facility_code
        facility_code = get_current_facility_code()
    if not facility_code:
        return None

    if user and getattr(user, 'is_authenticated', False):
        if allowed_codes and facility_code not in allowed_codes and not (allow_cross_facility and is_admin):
            return None

    from apps.core.models import Facility
    facility = Facility.get_by_code(facility_code)
    if facility and request:
        request.facility = facility
        request.facility_code = facility.code
    return facility


def resolve_object_facility(obj):
    if obj is None:
        return None

    # Special handling for ClinicalUnit - its 'facility' property returns root_unit (another ClinicalUnit)
    # We need to map the root_unit's code to an actual Facility
    from apps.organization.models import ClinicalUnit
    if isinstance(obj, ClinicalUnit):
        root = obj.root_unit
        if root:
            from apps.core.models import Facility
            return Facility.get_by_code(root.code)
        return None

    # Special handling for DepartmentDutyType, RotationRule, RosterEntry, RosterValidationRule - department is a ClinicalUnit
    from apps.organization.models import DepartmentDutyType, RotationRule, RosterEntry, RosterValidationRule
    if isinstance(obj, (DepartmentDutyType, RotationRule, RosterEntry, RosterValidationRule)):
        department = getattr(obj, 'department', None)
        if department and isinstance(department, ClinicalUnit):
            root = department.root_unit
            if root:
                from apps.core.models import Facility
                return Facility.get_by_code(root.code)
        return None

    direct = getattr(obj, 'facility', None)
    if direct is not None:
        return direct

    for path in (
        ('primary_facility',),
        ('staff', 'primary_facility'),
        ('practitioner_profile', 'staff', 'primary_facility'),
        ('patient', 'facility'),
        ('patient_profile', 'facility'),
        ('encounter', 'facility'),
        ('admission', 'patient', 'facility'),
        ('admission', 'bed', 'ward', 'facility'),
        ('ward', 'facility'),
        ('bed', 'ward', 'facility'),
        ('department', 'facility'),
        ('unit', 'facility'),
        ('clinical_unit', 'facility'),
        ('root_unit',),
        ('order', 'patient', 'facility'),
        ('lab_order', 'patient', 'facility'),
        ('order_test', 'order', 'patient', 'facility'),
        ('specimen', 'order', 'patient', 'facility'),
        ('assignment', 'patient', 'facility'),
        ('treatment_entry', 'patient', 'facility'),
        ('prescription', 'patient', 'facility'),
        ('note_entry', 'patient', 'facility'),
        ('invoice', 'facility'),
        ('item', 'facility'),
        ('inventory_item', 'facility'),
        ('audit', 'facility'),
        ('schedule', 'facility'),
        ('recurring_schedule', 'facility'),
        ('blocked_time', 'facility'),
    ):
        value = obj
        for attr in path:
            value = getattr(value, attr, None)
            if value is None:
                break
        if value is not None:
            if path == ('root_unit',):
                try:
                    from apps.core.models import Facility
                    mapped = Facility.get_by_code(getattr(value, 'code', None))
                    if mapped:
                        return mapped
                except Exception:
                    pass
            return value

    facility_code = getattr(obj, 'facility_code', None)
    if facility_code:
        from apps.core.models import Facility
        return Facility.get_by_code(facility_code)

    return None

class FacilityScopedQuerysetMixin:
    """
    Scope querysets to the active facility on the request.
    """
    facility_field = 'facility'

    def get_facility_field(self):
        return self.facility_field

    def get_queryset(self):
        queryset = super().get_queryset()
        facility = get_user_facility(self.request)
        if not facility:
            return queryset.none()
        return queryset.filter(**{self.get_facility_field(): facility})


class FacilityScopedPermission(BasePermission):
    """
    Require that objects belong to the active facility.
    """
    message = "Facility access denied."

    def has_permission(self, request, view):
        return get_user_facility(request) is not None

    def has_object_permission(self, request, view, obj):
        facility = get_user_facility(request)
        if not facility:
            return False
        obj_facility = resolve_object_facility(obj)
        if obj_facility is not None:
            return getattr(obj_facility, 'id', None) == facility.id

        facility_id = getattr(obj, 'facility_id', None)
        if facility_id is not None:
            return facility_id == facility.id

        facility_code = getattr(obj, 'facility_code', None)
        if facility_code is not None:
            return normalize_facility_code(facility_code) == facility.code

        return False

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
    Check team-based access for clinicians using encounters.

    Access is granted if the user:
    1. Is the admitting doctor for an active admission
    2. Is assigned to the ward of an active admission (legacy)
    3. Is the practitioner for an active encounter
    4. Is assigned to a ClinicalUnit that is the primary_team of an active encounter
    5. Is assigned to a ClinicalUnit that is a consulting team for an active encounter
    """
    from apps.wards.models import Admission
    from apps.encounters.models import Encounter

    practitioner = _get_practitioner_profile(user)
    if not practitioner:
        return False

    # 1. Check if user is the admitting doctor (legacy, still valid for inpatient)
    if Admission.objects.filter(
        patient=patient,
        status__in=ACTIVE_ADMISSION_STATUSES,
        admitting_doctor=practitioner
    ).exists():
        return True

    # 2. Check if user is assigned to the ward (legacy ward-based access)
    if Admission.objects.filter(
        patient=patient,
        status__in=ACTIVE_ADMISSION_STATUSES,
        bed__isnull=False,
        bed__ward__staff_assignments__practitioner=practitioner,
        bed__ward__staff_assignments__is_active=True
    ).exists():
        return True

    # 3. Check if user is the practitioner for an active encounter
    if Encounter.objects.filter(
        patient=patient,
        practitioner=practitioner,
        status__in=ACTIVE_ENCOUNTER_STATUSES
    ).exists():
        return True

    # 4. Check ClinicalUnit-based access via Encounter (new source of truth)
    # Get all units the user is assigned to
    from apps.organization.services import UnitAccessService
    user_unit_ids = UnitAccessService.get_accessible_unit_ids(user)

    if user_unit_ids:
        # Check if user's units include the primary_team of an active encounter
        if Encounter.objects.filter(
            patient=patient,
            status__in=ACTIVE_ENCOUNTER_STATUSES,
            primary_team_id__in=user_unit_ids
        ).exists():
            return True

        # 5. Check if user's units include a consulting team for an active encounter
        if Encounter.objects.filter(
            patient=patient,
            status__in=ACTIVE_ENCOUNTER_STATUSES,
            care_team_assignments__team_id__in=user_unit_ids,
            care_team_assignments__is_active=True
        ).exists():
            return True

    return False


def get_accessible_patients_for_clinician(user, scope='clinical'):
    """
    Return a queryset of patients a clinician can access under team rules.

    Access is granted via:
    1. Admitting doctor relationship (legacy)
    2. Ward staff assignment (legacy)
    3. Active encounter as practitioner
    4. ClinicalUnit assignment (primary team on encounter)
    5. ClinicalUnit assignment (consulting team on encounter)
    6. Break-glass events
    """
    from apps.users.models import PatientProfile

    practitioner = _get_practitioner_profile(user)
    if not practitioner:
        return PatientProfile.objects.none()

    # Legacy admission access (admitting doctor or ward assignment)
    admission_access = Q(
        admissions__status__in=ACTIVE_ADMISSION_STATUSES
    ) & (
        Q(admissions__admitting_doctor=practitioner) |
        Q(
            admissions__bed__ward__staff_assignments__practitioner=practitioner,
            admissions__bed__ward__staff_assignments__is_active=True
        )
    )

    # Encounter practitioner access
    encounter_access = Q(
        encounters__practitioner=practitioner,
        encounters__status__in=ACTIVE_ENCOUNTER_STATUSES
    )

    # ClinicalUnit-based access via Encounter (new source of truth)
    from apps.organization.services import UnitAccessService
    user_unit_ids = UnitAccessService.get_accessible_unit_ids(user)

    unit_access = Q(pk__in=[])  # Empty Q that matches nothing
    if user_unit_ids:
        # Access via primary team on encounter
        primary_team_access = Q(
            encounters__status__in=ACTIVE_ENCOUNTER_STATUSES,
            encounters__primary_team_id__in=user_unit_ids
        )
        # Access via consulting team on encounter
        consulting_team_access = Q(
            encounters__status__in=ACTIVE_ENCOUNTER_STATUSES,
            encounters__care_team_assignments__team_id__in=user_unit_ids,
            encounters__care_team_assignments__is_active=True
        )
        unit_access = primary_team_access | consulting_team_access

    break_glass_access = Q(
        break_glass_events__user=user,
        break_glass_events__scope=scope,
        break_glass_events__expires_at__gt=timezone.now()
    )

    return PatientProfile.objects.filter(
        admission_access | unit_access | encounter_access | break_glass_access
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
        if not getattr(settings, 'TEAM_ACCESS_STRICT', False):
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
        from apps.clinical_notes.models import Prescription
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
        from apps.clinical_notes.models import Prescription
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
        if not getattr(settings, 'TEAM_ACCESS_STRICT', False):
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
        from apps.clinical_notes.models import Prescription
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
