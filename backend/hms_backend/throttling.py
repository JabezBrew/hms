"""
Custom throttle classes with load test bypass capability.

Usage:
1. Set LOAD_TEST_SECRET_KEY environment variable in the deployment environment.
2. In k6 test, add header: 'X-Load-Test-Key': '<your-secret-key>'
3. Requests with valid key bypass throttling

Security:
- Key is stored in environment variable (never in code)
- Key is compared using constant-time comparison (prevents timing attacks)
- Header name is intentionally generic
"""
import os
import hmac
from django.conf import settings
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


def _has_valid_load_test_key(request):
    """
    Check if request has valid load test bypass key.
    Uses constant-time comparison to prevent timing attacks.
    """
    secret_key = os.environ.get('LOAD_TEST_SECRET_KEY')

    # If no secret key configured, bypass is disabled
    if not secret_key or not getattr(settings, 'LOAD_TEST_THROTTLE_BYPASS_ENABLED', False):
        return False

    request_key = request.META.get('HTTP_X_LOAD_TEST_KEY', '')

    # Constant-time comparison prevents timing attacks
    return hmac.compare_digest(secret_key, request_key)


class LoadTestAwareAnonThrottle(AnonRateThrottle):
    """Anonymous throttle that can be bypassed with load test key."""

    def allow_request(self, request, view):
        if _has_valid_load_test_key(request):
            return True
        return super().allow_request(request, view)


class LoadTestAwareUserThrottle(UserRateThrottle):
    """User throttle that can be bypassed with load test key."""

    def allow_request(self, request, view):
        if _has_valid_load_test_key(request):
            return True
        return super().allow_request(request, view)


class MFARecoveryThrottle(LoadTestAwareAnonThrottle):
    """Strict throttle for MFA recovery verification."""

    rate = '3/hour'
