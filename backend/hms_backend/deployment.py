"""
Deployment profile and feature flag utilities.

The profile matrix is intentionally separate from Django settings so it can be
used while settings are being built and by runtime code that needs a stable
capability contract.
"""

from copy import deepcopy

from hms_backend.feature_manifest import (
    FEATURE_MANIFEST,
    PROFILE_FEATURE_OVERRIDES,
    api_feature_prefixes,
    base_feature_defaults,
)


PROFILE_ALIASES = {
    'clinic': 'clinic',
    'small_clinic': 'clinic',
    'hospital': 'hospital',
    'single_hospital': 'hospital',
    'hospital_network': 'hospital_network',
    'network': 'hospital_network',
}


BASE_FEATURES = base_feature_defaults()


DEPLOYMENT_PROFILES = {
    'clinic': {
        'label': 'Clinic',
        'facility_scope': 'single',
        'description': 'Lean single-site outpatient deployment.',
        'features': PROFILE_FEATURE_OVERRIDES['clinic'],
    },
    'hospital': {
        'label': 'Hospital',
        'facility_scope': 'single',
        'description': 'Single hospital deployment with full inpatient and outpatient workflows.',
        'features': PROFILE_FEATURE_OVERRIDES['hospital'],
    },
    'hospital_network': {
        'label': 'Hospital Network',
        'facility_scope': 'network',
        'description': 'Multi-facility deployment with network-level sharing and administration.',
        'features': PROFILE_FEATURE_OVERRIDES['hospital_network'],
    },
}


API_FEATURE_PREFIXES = api_feature_prefixes()


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


def setting_feature_default(feature_key, django_settings=None, default=False):
    """
    Return the settings/profile default for a feature.

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


def feature_enabled(
    feature_key,
    django_settings=None,
    default=False,
    *,
    facility=None,
    request=None,
):
    """
    Return the effective value for a feature.

    After Django apps are ready, DB entitlement overrides are applied by
    apps.core.features. During settings initialization or migrations, fall back
    to the import-safe deployment/settings default.
    """
    try:
        from django.apps import apps

        if apps.ready:
            from apps.core.features import feature_enabled as resolve_feature_enabled

            return resolve_feature_enabled(
                feature_key,
                facility=facility,
                request=request,
                django_settings=django_settings,
                default=default,
            )
    except Exception:
        pass

    return setting_feature_default(feature_key, django_settings, default)


def feature_manifest():
    return deepcopy(FEATURE_MANIFEST)


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


def api_path_enabled(path, django_settings=None, *, facility=None, request=None):
    feature_key = feature_for_api_path(path)
    if not feature_key:
        return True, None
    return (
        feature_enabled(
            feature_key,
            django_settings=django_settings,
            facility=facility,
            request=request,
        ),
        feature_key,
    )
