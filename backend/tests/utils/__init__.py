"""
Test utilities module.

Provides:
- base.py: Base test classes with common setup
- api.py: API testing helpers
"""
from .base import BaseTestCase, BaseAPITestCase
from .api import (
    assert_api_response,
    assert_api_error,
    assert_requires_auth,
    assert_requires_role,
    get_auth_header,
)

__all__ = [
    'BaseTestCase',
    'BaseAPITestCase',
    'assert_api_response',
    'assert_api_error',
    'assert_requires_auth',
    'assert_requires_role',
    'get_auth_header',
]
