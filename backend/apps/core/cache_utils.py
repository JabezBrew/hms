"""
Cache helpers for facility-scoped keys.
"""
from hms_backend.tenancy import get_facility_cache_prefix


def facility_cache_key(key: str) -> str:
    prefix = get_facility_cache_prefix()
    return f"{prefix}{key}" if prefix else key


def facility_cache_key_for_code(facility_code: str, key: str) -> str:
    if not facility_code:
        return key
    code = str(facility_code).strip().upper()
    return f"facility:{code}:{key}"
