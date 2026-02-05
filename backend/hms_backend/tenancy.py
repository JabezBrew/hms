"""
Request-scoped tenant/facility context helpers.

Uses contextvars so async tasks and ASGI requests keep the right facility.
"""
from __future__ import annotations

from contextlib import contextmanager
from functools import wraps
from contextvars import ContextVar
from typing import Optional

from django.conf import settings


_current_facility_code: ContextVar[Optional[str]] = ContextVar(
    'current_facility_code',
    default=None
)


def _normalize_facility_code(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    return code.strip().upper()


def set_current_facility_code(code: Optional[str]) -> None:
    _current_facility_code.set(_normalize_facility_code(code))


def clear_current_facility_code() -> None:
    _current_facility_code.set(None)


def get_current_facility_code() -> Optional[str]:
    code = _current_facility_code.get()
    if code:
        return code
    default_code = getattr(settings, 'DEFAULT_FACILITY_CODE', None)
    if default_code:
        return _normalize_facility_code(default_code)
    return None


def get_facility_cache_prefix() -> str:
    code = get_current_facility_code()
    if not code:
        return ''
    return f"facility:{code}:"


def facility_task(func):
    """
    Decorator for Celery tasks to set facility context from kwargs.
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        facility_code = kwargs.pop('facility_code', None)
        with facility_context(facility_code):
            return func(*args, **kwargs)
    return wrapper


@contextmanager
def facility_context(facility_code: Optional[str]):
    previous = _current_facility_code.get()
    set_current_facility_code(facility_code)
    try:
        yield
    finally:
        _current_facility_code.set(previous)
