"""
Deployment profile and feature flag utilities.

The profile matrix is intentionally separate from Django settings so it can be
used while settings are being built and by runtime code that needs a stable
capability contract.
"""

from copy import deepcopy

from hms_backend.feature_manifest import (
    FEATURE_MANIFEST,
    PRODUCT_TIER_PROFILES,
    api_feature_prefixes,
    base_feature_defaults,
    feature_dependency_map,
    non_toggleable_feature_keys,
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


DEPLOYMENT_PROFILES = deepcopy(PRODUCT_TIER_PROFILES)


API_FEATURE_PREFIXES = api_feature_prefixes()


FEATURE_DEPENDENCIES = feature_dependency_map()


NON_TOGGLEABLE_FEATURES = non_toggleable_feature_keys()


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


def normalize_feature_set(feature_values):
    """
    Return a fail-closed feature matrix.

    Non-toggleable core features stay enabled. Dependent features are disabled
    unless every declared dependency is enabled.
    """
    normalized = {
        feature_key: bool(feature_values.get(feature_key, False))
        for feature_key in FEATURE_MANIFEST
    }

    for feature_key in NON_TOGGLEABLE_FEATURES:
        normalized[feature_key] = True

    changed = True
    while changed:
        changed = False
        for feature_key, dependencies in FEATURE_DEPENDENCIES.items():
            if not normalized.get(feature_key, False):
                continue
            if all(
                normalized.get(dependency_key, False)
                for dependency_key in dependencies
            ):
                continue
            normalized[feature_key] = False
            changed = True

    return normalized


def feature_dependency_violations(feature_values):
    normalized = {
        feature_key: bool(feature_values.get(feature_key, False))
        for feature_key in FEATURE_MANIFEST
    }
    return tuple(
        (feature_key, dependency_key)
        for feature_key, dependencies in FEATURE_DEPENDENCIES.items()
        if normalized.get(feature_key, False)
        for dependency_key in dependencies
        if not normalized.get(dependency_key, False)
    )


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

    features = normalize_feature_set(features)
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


def _legacy_setting_feature_values(django_settings, default):
    features = {
        feature_key: bool(
            getattr(django_settings, 'DEPLOYMENT_FEATURES', {}).get(
                feature_key,
                default,
            )
        )
        for feature_key in FEATURE_MANIFEST
    }

    if hasattr(django_settings, 'FACILITY_CONTEXT_REQUIRED'):
        features['facility_context_required'] = bool(
            django_settings.FACILITY_CONTEXT_REQUIRED
        )
    if hasattr(django_settings, 'MULTI_FACILITY_MODE'):
        features['multi_facility'] = bool(django_settings.MULTI_FACILITY_MODE)
    if hasattr(django_settings, 'ALLOW_CROSS_FACILITY_ACCESS'):
        features['cross_facility_access'] = bool(
            django_settings.ALLOW_CROSS_FACILITY_ACCESS
        )
    if hasattr(django_settings, 'PRACTITIONER_SCHEDULING_MODE'):
        features['department_rosters'] = (
            getattr(django_settings, 'PRACTITIONER_SCHEDULING_MODE') == 'roster'
        )
    if hasattr(django_settings, 'REQUIRE_OUTPATIENT_ACTIVE_CLINIC'):
        features['outpatient_active_clinic_required'] = bool(
            django_settings.REQUIRE_OUTPATIENT_ACTIVE_CLINIC
        )

    return normalize_feature_set(features)


def setting_feature_default(feature_key, django_settings=None, default=False):
    """
    Return the settings/profile default for a feature.

    Legacy setting names remain authoritative at runtime because tests and
    existing deployments already override them directly.
    """
    if django_settings is None:
        from django.conf import settings as django_settings

    if feature_key not in FEATURE_MANIFEST:
        return bool(default)

    features = _legacy_setting_feature_values(django_settings, default)
    return bool(features.get(feature_key, default))


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
