"""
Test-specific Django settings.

Used for E2E tests to avoid rate limiting and other production constraints.

Usage:
    DJANGO_SETTINGS_MODULE=hms_backend.settings_test python manage.py runserver
"""
from .settings import *  # noqa: F401, F403

# Override throttle rates for testing - allow more requests
REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'] = {
    'anon': '1000/hour',
    'user': '10000/hour',
    'login': '100/minute',  # Increased from 5/minute for E2E tests
    'password_reset': '100/hour',
}

# Disable throttling classes entirely for tests (optional - uncomment if needed)
# REST_FRAMEWORK['DEFAULT_THROTTLE_CLASSES'] = []

# Faster password hashing for tests
PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.MD5PasswordHasher',
]

# Use console email backend for tests
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
