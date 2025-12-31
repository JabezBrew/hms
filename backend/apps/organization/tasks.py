"""
Celery tasks for organization app.
"""
from celery import shared_task
from django.core.cache import cache

from .tree_cache import (
    ORG_TREE_CACHE_TTL,
    build_org_tree_cache_key,
    build_org_tree_payload,
    get_org_tree_cache_version,
)


@shared_task
def rebuild_org_tree_cache(version=None, facility_id=None, include_inactive=False):
    current_version = get_org_tree_cache_version()
    if version is not None and version != current_version:
        return
    payload = build_org_tree_payload(
        facility_id=facility_id,
        include_inactive=include_inactive
    )
    cache_key = build_org_tree_cache_key(
        current_version,
        facility_id,
        include_inactive
    )
    cache.set(cache_key, payload, timeout=ORG_TREE_CACHE_TTL)
