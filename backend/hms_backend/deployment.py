"""
Deployment profile and feature flag utilities.

The profile matrix is intentionally separate from Django settings so it can be
used while settings are being built and by runtime code that needs a stable
capability contract.
"""

from copy import deepcopy


PROFILE_ALIASES = {
    'clinic': 'clinic',
    'small_clinic': 'clinic',
    'hospital': 'hospital',
    'single_hospital': 'hospital',
    'hospital_network': 'hospital_network',
    'network': 'hospital_network',
}


BASE_FEATURES = {
    # Tenancy and facility scope
    'facility_context_required': True,
    'multi_facility': False,
    'facility_switcher': False,
    'cross_facility_access': False,
    'cross_facility_referrals': False,
    'cross_facility_record_exchange': False,

    # Care delivery
    'patient_registration': True,
    'patient_chronicle': True,
    'outpatient_encounters': True,
    'outpatient_active_clinic_required': True,
    'department_rosters': True,
    'inpatient_admissions': True,
    'wards': True,
    'bed_management': True,
    'emergency_encounters': True,
    'nursing_workflows': True,
    'discharge_workflows': True,

    # Operational modules
    'appointments': True,
    'billing': True,
    'inventory': True,
    'laboratory': True,
    'pharmacy': True,
    'referrals': True,
    'clinical_notes': True,
    'audit': True,
}


DEPLOYMENT_PROFILES = {
    'clinic': {
        'label': 'Clinic',
        'facility_scope': 'single',
        'description': 'Lean single-site outpatient deployment.',
        'features': {
            'outpatient_active_clinic_required': False,
            'department_rosters': False,
            'inpatient_admissions': False,
            'wards': False,
            'bed_management': False,
            'nursing_workflows': False,
            'discharge_workflows': False,
            'cross_facility_referrals': False,
            'cross_facility_record_exchange': False,
        },
    },
    'hospital': {
        'label': 'Hospital',
        'facility_scope': 'single',
        'description': 'Single hospital deployment with full inpatient and outpatient workflows.',
        'features': {},
    },
    'hospital_network': {
        'label': 'Hospital Network',
        'facility_scope': 'network',
        'description': 'Multi-facility deployment with network-level sharing and administration.',
        'features': {
            'multi_facility': True,
            'facility_switcher': True,
            'cross_facility_access': True,
            'cross_facility_referrals': True,
            'cross_facility_record_exchange': True,
        },
    },
}


API_FEATURE_PREFIXES = (
    ('/api/admissions/', 'inpatient_admissions'),
    ('/api/admin/audit-logs/', 'audit'),
    ('/api/appointments/', 'appointments'),
    ('/api/billing/', 'billing'),
    ('/api/charts/', 'clinical_notes'),
    ('/api/clinical-notes/', 'clinical_notes'),
    ('/api/consent/', 'cross_facility_referrals'),
    ('/api/dashboards/inpatient/', 'inpatient_admissions'),
    ('/api/dashboards/nurse/', 'nursing_workflows'),
    ('/api/discharges/', 'discharge_workflows'),
    ('/api/inventory/', 'inventory'),
    ('/api/interop/', 'cross_facility_record_exchange'),
    ('/api/laboratory/', 'laboratory'),
    ('/api/nursing/', 'nursing_workflows'),
    ('/api/organization/department-duty-types/', 'department_rosters'),
    ('/api/organization/on-duty/', 'department_rosters'),
    ('/api/organization/roster/', 'department_rosters'),
    ('/api/organization/rotation-rules/', 'department_rosters'),
    ('/api/organization/validation-rules/', 'department_rosters'),
    ('/api/organization/ward-allocations/', 'wards'),
    ('/api/pharmacy/', 'pharmacy'),
    ('/api/wards/', 'wards'),
    ('/api/workflows/discharge', 'discharge_workflows'),
    ('/api/workflows/ward-round', 'wards'),
)


TRUE_VALUES = {'1', 'true', 'yes', 'on'}
FALSE_VALUES = {'0', 'false', 'no', 'off'}


def normalize_deployment_profile(profile):
    normalized = str(profile or 'hospital').strip().lower()
    return PROFILE_ALIASES.get(normalized, 'hospital')


def coerce_feature_value(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False
    return None


def build_deployment_config(profile, feature_overrides=None):
    canonical_profile = normalize_deployment_profile(profile)
    profile_config = DEPLOYMENT_PROFILES[canonical_profile]
    features = deepcopy(BASE_FEATURES)
    features.update(profile_config.get('features', {}))

    for key, value in (feature_overrides or {}).items():
        if key not in features:
            continue
        coerced = coerce_feature_value(value)
        if coerced is not None:
            features[key] = coerced

    practitioner_scheduling_mode = 'roster' if features['department_rosters'] else 'simple'

    return {
        'deployment_profile': canonical_profile,
        'profile_label': profile_config['label'],
        'facility_scope': profile_config['facility_scope'],
        'description': profile_config['description'],
        'features': features,
        'capabilities': {
            'practitioner_scheduling_mode': practitioner_scheduling_mode,
            'supports_department_rosters': features['department_rosters'],
            'outpatient_requires_active_clinic_schedule': features[
                'outpatient_active_clinic_required'
            ],
            'facility_context_required': features['facility_context_required'],
            'multi_facility_mode': features['multi_facility'],
            'facility_switcher': features['facility_switcher'],
            'cross_facility_access': features['cross_facility_access'],
            'cross_facility_referrals': features['cross_facility_referrals'],
            'cross_facility_record_exchange': features['cross_facility_record_exchange'],
            'inpatient_admissions': features['inpatient_admissions'],
            'wards': features['wards'],
            'bed_management': features['bed_management'],
        },
    }


def feature_enabled(feature_key, django_settings=None, default=False):
    """
    Return the effective value for a feature.

    Legacy setting names remain authoritative at runtime because tests and
    existing deployments already override them directly.
    """
    if django_settings is None:
        from django.conf import settings as django_settings

    if feature_key == 'facility_context_required' and hasattr(
        django_settings, 'FACILITY_CONTEXT_REQUIRED'
    ):
        return bool(django_settings.FACILITY_CONTEXT_REQUIRED)
    if feature_key == 'multi_facility' and hasattr(
        django_settings, 'MULTI_FACILITY_MODE'
    ):
        return bool(django_settings.MULTI_FACILITY_MODE)
    if feature_key in {
        'cross_facility_access',
        'cross_facility_referrals',
        'cross_facility_record_exchange',
    } and hasattr(django_settings, 'ALLOW_CROSS_FACILITY_ACCESS'):
        if feature_key == 'cross_facility_access':
            return bool(django_settings.ALLOW_CROSS_FACILITY_ACCESS)
    if feature_key == 'department_rosters' and hasattr(
        django_settings, 'PRACTITIONER_SCHEDULING_MODE'
    ):
        return getattr(django_settings, 'PRACTITIONER_SCHEDULING_MODE') == 'roster'
    if feature_key == 'outpatient_active_clinic_required' and hasattr(
        django_settings, 'REQUIRE_OUTPATIENT_ACTIVE_CLINIC'
    ):
        return bool(django_settings.REQUIRE_OUTPATIENT_ACTIVE_CLINIC)

    return bool(getattr(django_settings, 'DEPLOYMENT_FEATURES', {}).get(feature_key, default))


def feature_for_api_path(path):
    normalized_path = str(path or '')
    if normalized_path.startswith('/api/organization/departments/'):
        roster_segments = (
            '/on-duty/',
            '/roster/',
            '/rotation-rules/',
            '/validation-rules/',
        )
        if any(segment in normalized_path for segment in roster_segments):
            return 'department_rosters'

    for prefix, feature_key in API_FEATURE_PREFIXES:
        if normalized_path.startswith(prefix):
            return feature_key
    return None


def api_path_enabled(path, django_settings=None):
    feature_key = feature_for_api_path(path)
    if not feature_key:
        return True, None
    return feature_enabled(feature_key, django_settings=django_settings), feature_key
