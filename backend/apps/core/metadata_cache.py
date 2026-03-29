"""
Helpers for low-churn metadata caches.
"""
from __future__ import annotations

import logging
from typing import Callable

from django.core.cache import cache

logger = logging.getLogger(__name__)


def metadata_cache_key(namespace: str, *parts) -> str:
    normalized_parts = [str(namespace).strip()]
    normalized_parts.extend(str(part).strip() for part in parts if part is not None and str(part).strip())
    return ':'.join(normalized_parts)


def get_or_set_metadata(cache_key: str, loader: Callable[[], object], *, timeout: int = 300, lock_timeout: int = 15):
    """
    Resolve low-churn metadata from cache with a short single-flight lock.
    """
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    lock_key = f'{cache_key}:lock'
    lock_acquired = cache.add(lock_key, '1', timeout=lock_timeout)
    try:
        if not lock_acquired:
            cached = cache.get(cache_key)
            if cached is not None:
                return cached

        value = loader()
        cache.set(cache_key, value, timeout=timeout)
        return value
    finally:
        if lock_acquired:
            cache.delete(lock_key)


def invalidate_metadata_prefix(prefix: str) -> None:
    """
    Invalidate a metadata cache namespace.
    """
    try:
        if hasattr(cache, 'delete_pattern'):
            cache.delete_pattern(f'{prefix}*')
        else:
            cache.clear()
    except Exception as exc:
        logger.warning("Failed to invalidate metadata cache for prefix %s: %s", prefix, exc)
