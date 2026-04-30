"""
Runtime feature entitlement service.

The source of truth for product-tier decisions is:
facility DB override -> global DB override -> deployment/profile settings.
"""

import hashlib
import json
from typing import Iterable

from django.conf import settings
from django.core.cache import cache
from django.db import OperationalError, ProgrammingError
from rest_framework.exceptions import NotFound

from hms_backend.deployment import normalize_feature_set, setting_feature_default
from hms_backend.feature_manifest import FEATURE_MANIFEST

CACHE_TIMEOUT_SECONDS = 300
CACHE_KEY_PREFIX = 'feature_entitlements:v1'
CACHE_VERSION_KEY = f'{CACHE_KEY_PREFIX}:version'


def _facility_code(facility=None, request=None):
    if facility is not None:
        return getattr(facility, 'code', None)
    if request is not None:
        request_facility = getattr(request, 'facility', None)
        if request_facility is not None:
            return getattr(request_facility, 'code', None)
        return getattr(request, 'facility_code', None)
    return None


def _base_features(django_settings=None, default=False):
    return {
        feature_key: setting_feature_default(
            feature_key,
            django_settings=django_settings,
            default=default,
        )
        for feature_key in FEATURE_MANIFEST
    }


def _base_signature(features):
    encoded = json.dumps(features, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()[:16]


def _cache_key(facility_code, base_features):
    facility_part = str(facility_code or 'global').upper()
    version = cache.get(CACHE_VERSION_KEY, 1)
    return f"{CACHE_KEY_PREFIX}:{version}:{_base_signature(base_features)}:{facility_part}"


def invalidate_feature_entitlement_cache(facility=None):
    try:
        cache.incr(CACHE_VERSION_KEY)
    except Exception:
        cache.set(CACHE_VERSION_KEY, 2, None)


def effective_feature_state(facility=None, request=None, django_settings=None, default=False):
    """
    Return effective features and source labels for the active facility context.
    """
    features = _base_features(django_settings=django_settings, default=default)
    facility_code = _facility_code(facility=facility, request=request)
    cache_key = _cache_key(facility_code, features)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    sources = {key: 'deployment_profile' for key in features}
    try:
        from apps.core.models import FeatureEntitlementOverride

        global_overrides = FeatureEntitlementOverride.objects.filter(
            scope=FeatureEntitlementOverride.SCOPE_GLOBAL,
            facility__isnull=True,
        ).only('id', 'feature_key', 'is_enabled', 'scope', 'facility_id')
        facility_overrides = FeatureEntitlementOverride.objects.none()
        if facility_code:
            facility_overrides = FeatureEntitlementOverride.objects.filter(
                scope=FeatureEntitlementOverride.SCOPE_FACILITY,
                facility__code__iexact=facility_code,
            ).select_related('facility').only(
                'id',
                'feature_key',
                'is_enabled',
                'scope',
                'facility_id',
                'facility__code',
            )

        for override in global_overrides:
            if override.feature_key not in FEATURE_MANIFEST:
                continue
            features[override.feature_key] = override.is_enabled
            sources[override.feature_key] = 'global_override'

        for override in facility_overrides:
            if override.feature_key not in FEATURE_MANIFEST:
                continue
            features[override.feature_key] = override.is_enabled
            sources[override.feature_key] = 'facility_override'
    except (OperationalError, ProgrammingError):
        pass

    features = normalize_feature_set(features)

    state = {
        'features': features,
        'feature_sources': sources,
    }
    cache.set(cache_key, state, CACHE_TIMEOUT_SECONDS)
    return state


def effective_features(facility=None, request=None, django_settings=None, default=False):
    return effective_feature_state(
        facility=facility,
        request=request,
        django_settings=django_settings,
        default=default,
    )['features']


def feature_enabled(feature_key, facility=None, request=None, django_settings=None, default=False):
    if feature_key not in FEATURE_MANIFEST:
        return bool(default)
    return bool(
        effective_features(
            facility=facility,
            request=request,
            django_settings=django_settings,
            default=default,
        ).get(feature_key, default)
    )


def require_feature(feature_key, facility=None, request=None):
    if not feature_enabled(feature_key, facility=facility, request=request):
        raise NotFound({
            'detail': 'This feature is not enabled for the current deployment.',
            'code': 'feature_disabled',
        })


def attach_required_feature(view_classes: Iterable[type], feature_key: str):
    """
    Attach required_feature and FeatureRequiredPermission to view classes.
    Useful for module-wide migrations without changing every class body.
    """
    from apps.core.security import FeatureRequiredPermission

    for view_class in view_classes:
        view_class.required_feature = feature_key
        permission_classes = list(getattr(view_class, 'permission_classes', []))
        if FeatureRequiredPermission not in permission_classes:
            view_class.permission_classes = [
                FeatureRequiredPermission,
                *permission_classes,
            ]


def bind_required_feature(module_globals, feature_key: str, exclude=()):
    from rest_framework.views import APIView

    excluded = set(exclude)
    view_classes = []
    for name, value in module_globals.items():
        if name in excluded or not isinstance(value, type):
            continue
        if issubclass(value, APIView) and value is not APIView:
            view_classes.append(value)
    attach_required_feature(view_classes, feature_key)
