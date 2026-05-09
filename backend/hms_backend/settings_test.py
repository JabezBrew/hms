"""
Test-specific Django settings.

Used by pytest and E2E tests to avoid production-cost services and constraints.

Usage:
    DJANGO_SETTINGS_MODULE=hms_backend.settings_test python manage.py runserver
"""
import os

os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('DEFAULT_FACILITY_CODE', 'TEST')
os.environ.setdefault('CONTROL_PLANE_DB_ALIAS', 'default')
os.environ.setdefault('EMAIL_PROVIDER', 'resend')
os.environ.setdefault('RESEND_API_KEY', 'test-resend-key')
os.environ.setdefault('UNOSEND_API_KEY', 'test-unosend-key')
os.environ.setdefault('DEFAULT_FROM_EMAIL', 'test@example.com')
os.environ.setdefault('DB_NAME', 'hms_test')
os.environ.setdefault('DB_USER', 'postgres')
os.environ.setdefault('DB_PASSWORD', 'postgres')
os.environ.setdefault('DB_HOST', 'localhost')
os.environ.setdefault('DB_PORT', '5432')

from .settings import *  # noqa: F401, F403

# Override throttle rates for testing - allow more requests
REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'] = {
    'anon': '1000/hour',
    'user': '10000/hour',
    'login': '100/minute',  # Increased from 5/minute for E2E tests
    'password_reset': '100/hour',
    'rum': '1000/minute',
}

# Disable throttling classes entirely for tests (optional - uncomment if needed)
# REST_FRAMEWORK['DEFAULT_THROTTLE_CLASSES'] = []

# Faster password hashing for tests
PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.MD5PasswordHasher',
]

# Keep test cache operations process-local and cheap. Individual Redis tests
# should override this explicitly instead of making the whole suite hit Redis.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'hms-test-cache',
        'TIMEOUT': 300,
    }
}

# Use in-memory email backend for assertions without external I/O.
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
