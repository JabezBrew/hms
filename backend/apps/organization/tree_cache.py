"""
Tree cache utilities for organization hierarchy.

Precomputes a full tree snapshot and serves it from cache with ETag metadata.
"""
import hashlib
import json
import time

from django.core.cache import cache
from mptt.utils import get_cached_trees

from apps.core.cache_utils import facility_cache_key
from hms_backend.tenancy import get_current_facility_code
from .models import ClinicalUnit
from .serializers import ClinicalUnitTreeSerializer

ORG_TREE_CACHE_TTL = 60 * 60  # 1 hour
ORG_TREE_CACHE_VERSION_KEY = 'org_tree_version'
ORG_TREE_LAST_MODIFIED_KEY = 'org_tree_last_modified'


def get_org_tree_cache_version():
    version_key = facility_cache_key(ORG_TREE_CACHE_VERSION_KEY)
    last_modified_key = facility_cache_key(ORG_TREE_LAST_MODIFIED_KEY)
    version = cache.get(version_key)
    if version is None:
        version = time.time_ns()
        cache.set(version_key, version, timeout=None)
        cache.set(last_modified_key, int(time.time()), timeout=None)
    return version


def bump_org_tree_cache_version():
    version = time.time_ns()
    version_key = facility_cache_key(ORG_TREE_CACHE_VERSION_KEY)
    last_modified_key = facility_cache_key(ORG_TREE_LAST_MODIFIED_KEY)
    cache.set(version_key, version, timeout=None)
    cache.set(last_modified_key, int(time.time()), timeout=None)
    return version


def build_org_tree_cache_key(version, facility_id=None, include_inactive=False):
    facility_part = facility_id or 'all'
    state_part = 'all' if include_inactive else 'active'
    return f'org_tree:v{version}:{facility_part}:{state_part}'


def _get_last_modified_timestamp():
    cache_key = facility_cache_key(ORG_TREE_LAST_MODIFIED_KEY)
    last_modified = cache.get(cache_key)
    if last_modified is None:
        last_modified = int(time.time())
        cache.set(cache_key, last_modified, timeout=None)
    return last_modified


def _get_tree_queryset(facility_id=None, include_inactive=False):
    queryset = ClinicalUnit.objects.all()
    if not include_inactive:
        queryset = queryset.filter(is_active=True)
    if facility_id:
        queryset = queryset.filter(root_unit_id=facility_id)
    return (
        queryset.select_related('unit_type')
        .only(
            'id', 'code', 'name', 'short_name', 'unit_type_id',
            'is_active', 'level', 'staffing_mode', 'parent_id',
            'tree_id', 'lft', 'rght',
            'unit_type__id', 'unit_type__name', 'unit_type__code',
            'unit_type__icon', 'unit_type__color',
        )
        .order_by('tree_id', 'lft')
    )


def _serialize_tree_payload(data):
    return json.dumps(data, separators=(',', ':'), ensure_ascii=True)


def _build_etag(payload):
    return hashlib.md5(payload.encode('utf-8')).hexdigest()


def build_org_tree_payload(facility_id=None, include_inactive=False):
    queryset = _get_tree_queryset(
        facility_id=facility_id,
        include_inactive=include_inactive
    )
    roots = [root for root in get_cached_trees(queryset) if root.parent_id is None]
    serializer = ClinicalUnitTreeSerializer(
        roots,
        many=True,
        context={'include_inactive': include_inactive}
    )
    data = serializer.data
    serialized = _serialize_tree_payload(data)
    return {
        'data': data,
        'etag': _build_etag(serialized),
        'last_modified': _get_last_modified_timestamp(),
    }


def get_org_tree_payload(facility_id=None, include_inactive=False):
    version = get_org_tree_cache_version()
    cache_key = build_org_tree_cache_key(version, facility_id, include_inactive)
    payload = cache.get(facility_cache_key(cache_key))
    if payload is not None:
        return payload
    payload = build_org_tree_payload(
        facility_id=facility_id,
        include_inactive=include_inactive
    )
    cache.set(facility_cache_key(cache_key), payload, timeout=ORG_TREE_CACHE_TTL)
    return payload


def schedule_org_tree_cache_rebuild(version=None, facility_id=None, include_inactive=False):
    try:
        from .tasks import rebuild_org_tree_cache
        rebuild_org_tree_cache.delay(
            version=version,
            facility_id=str(facility_id) if facility_id else None,
            include_inactive=include_inactive,
            facility_code=get_current_facility_code(),
        )
    except Exception:
        return
