"""
SECURITY: Centralized access control utilities for the HMS application.

This module implements DATA-TYPE SPECIFIC access control with team-based enforcement:
- Each data type (clinical, lab, prescription, billing) has its own access rules
- Clinical staff require team access or break-glass (when enabled) for patient data
- Support staff can ONLY access their specific data domain
"""
from rest_framework.exceptions import PermissionDenied
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission
from django.conf import settings
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
import logging
from hms_backend.deployment import feature_enabled

logger = logging.getLogger(__name__)


ACTIVE_ADMISSION_STATUSES = ['admitted', 'pending_discharge']
ACTIVE_ENCOUNTER_STATUSES = ['planned', 'in-progress']
FEATURE_DISABLED_MESSAGE = "This feature is not enabled for the current deployment."
CLINICAL_PATIENT_ACCESS_USER_TYPES = frozenset({
    'doctor',
    'nurse',
    'head_nurse',
    'nurse_practitioner',
    'physician',
    'practitioner',
    'inpatient_doctor',
})


def normalize_facility_code(code):
    if not code:
        return None
    return str(code).strip().upper()


def get_user_facility_codes(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return set()

    cached_codes = getattr(user, '_cached_facility_codes', None)
    if cached_codes is not None:
        return set(cached_codes)

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

    facility_codes = []
    try:
        prefetched = getattr(user, '_prefetched_objects_cache', {})
        if 'facilities' in prefetched:
            facility_codes = [facility.code for facility in prefetched['facilities']]
        else:
            facility_codes = user.facilities.values_list('code', flat=True)
    except Exception:
        facility_codes = []
    for code in facility_codes:
        normalized = normalize_facility_code(code)
        if normalized:
            codes.add(normalized)

    normalized_codes = frozenset(code for code in codes if code)
    user._cached_facility_codes = normalized_codes
    return set(normalized_codes)


def is_cross_facility_admin(user):
    try:
        from apps.users.admin_access import is_platform_admin
        return is_platform_admin(user)
    except Exception:
        return bool(
            user
            and getattr(user, 'is_authenticated', False)
            and getattr(user, 'is_superuser', False)
        )


def can_use_cross_facility_access(user):
    return bool(feature_enabled('cross_facility_access') and is_cross_facility_admin(user))


def feature_disabled_payload(feature_key):
    return {
        'detail': FEATURE_DISABLED_MESSAGE,
        'code': 'feature_disabled',
        'feature': feature_key,
    }


def _ensure_user_can_reference_patient_facility(user, patient_profile):
    if not user or not getattr(user, 'is_authenticated', False):
        raise PermissionDenied("Authentication required.")

    if is_cross_facility_admin(user):
        return

    patient_facility = getattr(patient_profile, 'facility', None)
    patient_facility_code = normalize_facility_code(getattr(patient_facility, 'code', None))
    if not patient_facility_code:
        raise PermissionDenied("Patient facility is required.")

    allowed_codes = get_user_facility_codes(user)
    if patient_facility_code in allowed_codes:
        return

    default_facility_code = normalize_facility_code(getattr(settings, 'DEFAULT_FACILITY_CODE', None))
    if not allowed_codes and default_facility_code and patient_facility_code == default_facility_code:
        return

    raise PermissionDenied("Patient does not belong to an authorized facility.")


def get_user_facility(request):
    if request is not None and getattr(request, '_cached_user_facility_resolved', False):
        return getattr(request, '_cached_user_facility', None)

    def _cache_and_return(facility_value):
        if request is not None:
            request._cached_user_facility = facility_value
            request._cached_user_facility_resolved = True
        return facility_value

    user = getattr(request, 'user', None) if request else None
    allowed_codes = None
    allow_cross_facility = False
    default_facility_code = normalize_facility_code(getattr(settings, 'DEFAULT_FACILITY_CODE', None))
    has_cross_facility_admin_access = False
    primary_facility = None
    primary_code = None
    if user and getattr(user, 'is_authenticated', False):
        allow_cross_facility = feature_enabled('cross_facility_access')
        has_cross_facility_admin_access = is_cross_facility_admin(user)
        primary_facility = getattr(user, 'primary_facility', None)
        if primary_facility:
            primary_code = normalize_facility_code(primary_facility.code)

    def _load_allowed_codes():
        nonlocal allowed_codes
        if allowed_codes is None:
            allowed_codes = get_user_facility_codes(user)
        return allowed_codes

    def _is_allowed(facility_code):
        if not facility_code:
            return True
        if not user or not getattr(user, 'is_authenticated', False):
            return True
        if allow_cross_facility and has_cross_facility_admin_access:
            return True
        if primary_code and facility_code == primary_code:
            return True
        resolved_codes = _load_allowed_codes()
        if resolved_codes:
            return facility_code in resolved_codes
        # Users without explicit assignments may only access deployment default facility.
        return bool(default_facility_code and facility_code == default_facility_code)

    facility = getattr(request, 'facility', None)
    if facility:
        facility_code = normalize_facility_code(getattr(facility, 'code', None))
        if _is_allowed(facility_code):
            return _cache_and_return(facility)

    facility_code = normalize_facility_code(getattr(request, 'facility_code', None))
    if facility_code and not _is_allowed(facility_code):
        facility_code = None
    if not facility_code and request:
        header_name = getattr(settings, 'FACILITY_HEADER_NAME', 'X-Facility-Code')
        header_key = f'HTTP_{header_name.upper().replace("-", "_")}'
        requested_code = normalize_facility_code(request.META.get(header_key))
        if _is_allowed(requested_code):
            facility_code = requested_code
    if not facility_code and user and getattr(user, 'is_authenticated', False):
        resolved_codes = _load_allowed_codes()
        if len(resolved_codes) == 1:
            facility_code = next(iter(resolved_codes))
    if not facility_code:
        if primary_code:
            facility_code = primary_code
        else:
            from hms_backend.tenancy import get_current_facility_code
            facility_code = get_current_facility_code()
    if not facility_code:
        return _cache_and_return(None)

    if not _is_allowed(facility_code):
        return _cache_and_return(None)

    if primary_facility and primary_code == facility_code and getattr(primary_facility, 'is_active', False):
        facility = primary_facility
    else:
        from apps.core.models import Facility
        facility = Facility.get_by_code(facility_code)
    if facility and request:
        request.facility = facility
        request.facility_code = facility.code
    return _cache_and_return(facility)


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


class FeatureRequiredPermission(BasePermission):
    """
    Allow endpoints to declare `required_feature = 'feature_key'`.
    """
    message = FEATURE_DISABLED_MESSAGE

    def has_permission(self, request, view):
        required_feature = getattr(view, 'required_feature', None)
        if not required_feature:
            return True
        if feature_enabled(required_feature, request=request):
            return True
        raise NotFound(feature_disabled_payload(required_feature))


def require_feature(feature_key):
    if not feature_enabled(feature_key):
        raise NotFound(feature_disabled_payload(feature_key))


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
    7. Explicit personal patient list membership
    """
    from apps.users.models import PatientProfile

    personal_list_access = Q(in_user_lists__user=user)

    practitioner = _get_practitioner_profile(user)
    if not practitioner:
        return PatientProfile.objects.filter(personal_list_access).distinct()

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
        admission_access | unit_access | encounter_access | break_glass_access | personal_list_access
    ).distinct()


def scope_patient_queryset_for_search_access(queryset, user, facility):
    """
    Restrict patient directory/search querysets to the caller's permitted patient set.

    Facility and platform admins plus receptionists can search the active facility
    directory. Clinical users are constrained to assigned/team-access patients.
    Support roles are constrained to patients with records in their domain.
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return queryset.none()

    user_type = getattr(user, 'user_type', None)

    if is_cross_facility_admin(user) or user_type in {'admin', 'receptionist'}:
        return queryset

    if user_type == 'patient':
        return queryset.filter(user=user)

    if user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES:
        accessible_patients = get_accessible_patients_for_clinician(user)
        return queryset.filter(pk__in=accessible_patients.values('pk'))

    if user_type == 'lab_technician':
        from apps.laboratory.models import LabOrder
        return queryset.filter(Exists(LabOrder.objects.filter(
            patient=OuterRef('pk'),
            facility=facility,
        )))

    if user_type == 'pharmacist':
        from apps.clinical_notes.models import Prescription
        return queryset.filter(Exists(Prescription.objects.filter(
            patient=OuterRef('pk'),
            facility=facility,
        )))

    if user_type == 'billing':
        from apps.billing.models import Invoice
        return queryset.filter(Exists(Invoice.objects.filter(
            patient=OuterRef('pk'),
            facility=facility,
        )))

    return queryset.none()


def scope_queryset_to_clinical_access(queryset, user, *, patient_lookup='patient', scope='clinical'):
    """
    Restrict a queryset to patients the caller may access for clinical workflows.

    Args:
        queryset: Base queryset already scoped to the active facility.
        user: Authenticated user.
        patient_lookup: Django ORM path from queryset model to PatientProfile.
        scope: Break-glass scope to apply when TEAM_ACCESS_STRICT is enabled.
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return queryset.none()

    user_type = getattr(user, 'user_type', None)
    if user_type == 'admin':
        return queryset

    if user_type == 'patient':
        return queryset.filter(**{f'{patient_lookup}__user': user})

    if user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES:
        if not getattr(settings, 'TEAM_ACCESS_STRICT', False):
            return queryset
        accessible_patients = get_accessible_patients_for_clinician(user, scope=scope)
        return queryset.filter(**{f'{patient_lookup}__in': accessible_patients})

    return queryset.none()


def check_clinical_access(user, patient_or_id):
    """
    SECURITY: Check access to CLINICAL data (vitals, notes, encounters, diagnoses).

    Allowed: Admin, Doctor, Nurse, Patient (own data)
    Denied: Lab Tech, Pharmacist, Billing, Receptionist
    """
    patient_profile = _get_patient_profile(patient_or_id)
    _ensure_user_can_reference_patient_facility(user, patient_profile)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES:
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
    _ensure_user_can_reference_patient_facility(user, patient_profile)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES:
        return check_clinical_access(user, patient_profile)

    if user.user_type == 'lab_technician':
        from apps.laboratory.models import LabOrder, LabOrderStatus
        if LabOrder.objects.filter(
            patient=patient_profile,
            facility=patient_profile.facility,
            status__in=[
                LabOrderStatus.ORDERED,
                LabOrderStatus.COLLECTED,
                LabOrderStatus.RECEIVED,
                LabOrderStatus.PROCESSING,
                LabOrderStatus.COMPLETED,
            ]
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
    _ensure_user_can_reference_patient_facility(user, patient_profile)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES:
        return check_clinical_access(user, patient_profile)

    if user.user_type == 'pharmacist':
        from apps.clinical_notes.models import Prescription
        if Prescription.objects.filter(
            patient=patient_profile,
            facility=patient_profile.facility,
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
    _ensure_user_can_reference_patient_facility(user, patient_profile)

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
    _ensure_user_can_reference_patient_facility(user, patient_profile)

    if user.user_type == 'admin':
        return True

    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return True
        raise PermissionDenied("You can only access your own data.")

    if user.user_type in CLINICAL_PATIENT_ACCESS_USER_TYPES or user.user_type == 'receptionist':
        return True

    # Support staff can see demographics only if they have relevant records
    if user.user_type == 'lab_technician':
        from apps.laboratory.models import LabOrder
        if LabOrder.objects.filter(patient=patient_profile, facility=patient_profile.facility).exists():
            return True

    if user.user_type == 'pharmacist':
        from apps.clinical_notes.models import Prescription
        if Prescription.objects.filter(patient=patient_profile, facility=patient_profile.facility).exists():
            return True

    if user.user_type == 'billing':
        from apps.billing.models import Invoice
        if Invoice.objects.filter(patient=patient_profile, facility=patient_profile.facility).exists():
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

    try:
        _ensure_user_can_reference_patient_facility(user, patient_profile)
    except PermissionDenied:
        return flags

    # Admin has full access
    if user.user_type == 'admin':
        return {k: True for k in flags}

    # Patient can access own data
    if user.user_type == 'patient':
        if hasattr(patient_profile, 'user') and patient_profile.user == user:
            return {k: True for k in flags}
        return flags

    # Clinical staff (doctor, nurse)
    if user.user_type in ['doctor', 'nurse', 'head_nurse', 'nurse_practitioner', 'physician', 'practitioner', 'inpatient_doctor']:
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
        from apps.laboratory.models import LabOrder, LabOrderStatus
        has_orders = LabOrder.objects.filter(
            patient=patient_profile,
            facility=patient_profile.facility,
            status__in=[
                LabOrderStatus.ORDERED,
                LabOrderStatus.COLLECTED,
                LabOrderStatus.RECEIVED,
                LabOrderStatus.PROCESSING,
                LabOrderStatus.COMPLETED,
            ]
        ).exists()
        flags['lab'] = has_orders
        flags['demographics'] = LabOrder.objects.filter(patient=patient_profile, facility=patient_profile.facility).exists()
        return flags

    # Pharmacist - check for prescriptions
    if user.user_type == 'pharmacist':
        from apps.clinical_notes.models import Prescription
        flags['prescription'] = Prescription.objects.filter(
            patient=patient_profile,
            facility=patient_profile.facility,
            status='active'
        ).exists()
        flags['demographics'] = Prescription.objects.filter(patient=patient_profile, facility=patient_profile.facility).exists()
        return flags

    # Billing staff
    if user.user_type == 'billing':
        from apps.billing.models import Invoice
        flags['billing'] = True
        flags['demographics'] = Invoice.objects.filter(patient=patient_profile, facility=patient_profile.facility).exists()
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
