"""
Django settings for hms_backend project.
"""

import os
import re
import sys
import json
import importlib.util
from pathlib import Path
import environ
import logging.config
from urllib.parse import urlparse, parse_qs
from kombu import Queue

from hms_backend.deployment import build_deployment_config, coerce_feature_value




# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Add the apps directory to Python path
sys.path.insert(0, str(BASE_DIR))

# Load environment variables from .env file
env = environ.Env(
    # set casting and default values
    DEBUG=(bool, False)
)

# Look for a .env file in BASE_DIR
env_file = BASE_DIR / '.env'
if env_file.exists():
    env.read_env(str(env_file))

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = env('SECRET_KEY')

# Detect if we are running in a build environment (e.g. Docker build for collectstatic)
IS_BUILD = (SECRET_KEY == 'build_dummy_key')

def env_required(var_name, default=None):
    """
    Helper to get environment variables that are required in production
    but can be dummy values during build.
    """
    if IS_BUILD:
        return default or 'build_dummy_value'
    # In production, default=None means it will raise ImproperlyConfigured if missing
    return env(var_name, default=default) if default is not None else env(var_name)


def _parse_database_url(db_url):
    parsed = urlparse(db_url)
    if parsed.scheme in ('postgres', 'postgresql', 'psql'):
        engine = 'django.db.backends.postgresql'
    elif parsed.scheme in ('sqlite',):
        engine = 'django.db.backends.sqlite3'
    else:
        raise ValueError(f"Unsupported database scheme: {parsed.scheme}")

    db_name = parsed.path.lstrip('/') if parsed.path else ''
    options = {}
    if parsed.query:
        options = {k: v[-1] for k, v in parse_qs(parsed.query).items()}

    return {
        'ENGINE': engine,
        'NAME': db_name,
        'USER': parsed.username or '',
        'PASSWORD': parsed.password or '',
        'HOST': parsed.hostname or '',
        'PORT': parsed.port or '',
        'OPTIONS': options,
    }


def _validated_origin_regexes(candidates):
    patterns = []
    for candidate in candidates:
        value = str(candidate or '').strip()
        if not value:
            continue
        try:
            re.compile(value)
        except re.error:
            continue
        patterns.append(value)
    return patterns


def _env_bool_override(var_name):
    raw_value = env(var_name, default=None)
    return coerce_feature_value(raw_value)


def _parse_feature_flag_overrides(raw_value):
    """
    Parse feature flag overrides from JSON or comma-separated key=value pairs.
    Unknown feature keys are ignored later by the deployment matrix.
    """
    if not raw_value:
        return {}

    value = str(raw_value).strip()
    if not value:
        return {}

    if value.startswith('{'):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return parsed
        return {}

    overrides = {}
    for item in value.split(','):
        if '=' not in item:
            continue
        key, flag_value = item.split('=', 1)
        key = key.strip()
        if key:
            overrides[key] = flag_value.strip()
    return overrides


def _module_available(module_path):
    try:
        return importlib.util.find_spec(module_path) is not None
    except (ModuleNotFoundError, ValueError):
        return False


# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env.bool('DEBUG', default=False)

ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1'])

# Application definition
INSTALLED_APPS = [
    'daphne',  # ASGI server - must be first for static files handling
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.postgres',  # PostgreSQL features (GIN indexes, etc.)

    # Third-party apps
    'channels',  # WebSocket support
    'rest_framework',
    'django_filters',
    'corsheaders',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'mptt',  # Tree structures for organizational hierarchy

    # Local apps
    'apps.core.apps.CoreConfig',  # Shared utilities for API optimization
    'apps.users.apps.UsersConfig',  # Use this instead of 'apps.users'
    'apps.mpi.apps.MPIConfig',  # Control-plane MPI
    'apps.consent.apps.ConsentConfig',  # Control-plane consent
    'apps.fhir_client',
    'apps.appointments.apps.AppointmentsConfig',
    'apps.patients',
    'apps.admissions.apps.AdmissionsConfig',
    'apps.wards.apps.WardsConfig',
    'apps.encounters.apps.EncountersConfig',  # Extracted from wards for cleaner architecture
    'apps.inventory',
    'apps.billing',
    'apps.clinical_notes.apps.ClinicalNotesConfig',
    'apps.nursing.apps.NursingConfig',
    'apps.discharge.apps.DischargeConfig',
    'apps.workflows.apps.WorkflowsConfig',
    'apps.dashboards.apps.DashboardsConfig',
    'apps.audit.apps.AuditConfig',
    'apps.drug_safety.apps.DrugSafetyConfig',
    'apps.laboratory.apps.LaboratoryConfig',
    'apps.referrals.apps.ReferralsConfig',
    'apps.charts.apps.ChartsConfig',
    'apps.pharmacy.apps.PharmacyConfig',
    'apps.organization.apps.OrganizationConfig',  # Flexible organizational hierarchy
    'apps.interop.apps.InteropConfig',  # Cross-facility record exchange
    'apps.notifications.apps.NotificationsConfig',
    'apps.ai.apps.AIConfig',
]

if _module_available('apps.ward_board'):
    INSTALLED_APPS.append('apps.ward_board.apps.WardBoardConfig')

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',  # Must be first to handle preflight requests
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.middleware.gzip.GZipMiddleware',  # Compress responses > 200 bytes
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'hms_backend.middleware.FacilityContextMiddleware',  # Resolve facility context for scoping
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'hms_backend.middleware.JWTUserTypeValidationMiddleware',  # Validate JWT claims
    'hms_backend.middleware.PasswordChangeRequiredMiddleware',  # Enforce first-login password update
    'hms_backend.middleware.OffSiteDetectionMiddleware',  # Off-site read-only mode detection
    'apps.audit.middleware.AuditMiddleware',  # Audit logging context
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'hms_backend.middleware.RequestLoggingMiddleware',
]

ROOT_URLCONF = 'hms_backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'hms_backend.wsgi.application'
ASGI_APPLICATION = 'hms_backend.asgi.application'

# Channels Layer Configuration (WebSocket support)
# Uses Redis for cross-process communication in production
if DEBUG or IS_BUILD:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        }
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [env('REDIS_URL', default='redis://127.0.0.1:6379/2')],
                'capacity': 1500,  # Max messages in channel before oldest dropped
                'expiry': 10,  # Message expiry in seconds
            },
        },
    }

# Database
# https://docs.djangoproject.com/en/5.0/ref/settings/#databases
#
# Supports two configuration methods:
# 1. DATABASE_URL
# 2. Individual DB_* variables (Docker, traditional hosting)

if IS_BUILD:
    # Use SQLite for build process (collectstatic doesn't need real DB)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }
elif env('DATABASE_URL', default=None):
    # Parse DATABASE_URL (e.g., postgresql://user:pass@host:5432/dbname)
    DATABASES = {
        'default': env.db('DATABASE_URL')
    }
else:
    # Use individual environment variables
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': env('DB_NAME'),
            'USER': env('DB_USER'),
            'PASSWORD': env('DB_PASSWORD'),
            'HOST': env('DB_HOST'),
            'PORT': env('DB_PORT'),
        }
    }

CONTROL_PLANE_DB_ALIAS = env('CONTROL_PLANE_DB_ALIAS', default='control')
if "pytest" in sys.modules:
    CONTROL_PLANE_DB_ALIAS = 'default'
CONTROL_PLANE_DATABASE_URL = env('CONTROL_PLANE_DATABASE_URL', default=None)
if not IS_BUILD:
    if CONTROL_PLANE_DATABASE_URL:
        DATABASES[CONTROL_PLANE_DB_ALIAS] = _parse_database_url(CONTROL_PLANE_DATABASE_URL)
    else:
        if CONTROL_PLANE_DB_ALIAS not in DATABASES:
            DATABASES[CONTROL_PLANE_DB_ALIAS] = DATABASES['default'].copy()


if not IS_BUILD:
    # Add connection pooling and health checks
    DATABASES['default'].update({
        # Connection pooling - persistent connections for 10 minutes
        'CONN_MAX_AGE': 600,
        # Health checks ensure stale connections are recycled (Django 4.1+)
        'CONN_HEALTH_CHECKS': True,
        'OPTIONS': {
            'connect_timeout': 10,
            # Note: statement_timeout removed - incompatible with PgBouncer transaction pooling
        },
    })

    # Read replica configuration (optional - enable by setting DB_REPLICA_HOST)
    # Routes read queries to replica for horizontal scaling
    DB_REPLICA_HOST = env('DB_REPLICA_HOST', default='')
    if DB_REPLICA_HOST:
        DATABASES['replica'] = {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': env('DB_NAME'),
            'USER': env('DB_REPLICA_USER', default=env('DB_USER')),
            'PASSWORD': env('DB_REPLICA_PASSWORD', default=env('DB_PASSWORD')),
            'HOST': DB_REPLICA_HOST,
            'PORT': env('DB_REPLICA_PORT', default=env('DB_PORT')),
            'CONN_MAX_AGE': 600,
            'CONN_HEALTH_CHECKS': True,
            'OPTIONS': {
                'connect_timeout': 10,
            },
        }
        DATABASE_ROUTERS = ['hms_backend.db_router.ReadReplicaRouter']
    else:
        DATABASE_ROUTERS = []
else:
    DATABASE_ROUTERS = []

# Password validation
# https://docs.djangoproject.com/en/5.0/ref/settings/#auth-password-validators

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
# https://docs.djangoproject.com/en/5.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.0/howto/static-files/

STATIC_URL = 'static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Media files
MEDIA_URL = 'media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# Default primary key field type
# https://docs.djangoproject.com/en/5.0/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Custom user model
AUTH_USER_MODEL = 'users.User'

# Facility context settings
FACILITY_HEADER_NAME = env('FACILITY_HEADER_NAME', default='X-Facility-Code')
DEFAULT_FACILITY_CODE = env('DEFAULT_FACILITY_CODE', default=None)
if "pytest" in sys.modules and not DEFAULT_FACILITY_CODE:
    DEFAULT_FACILITY_CODE = 'TEST'

MFA_REQUIRED_FOR_ADMIN = env.bool('MFA_REQUIRED_FOR_ADMIN', default=True)
MFA_REQUIRED_FOR_ALL = env.bool('MFA_REQUIRED_FOR_ALL', default=True)
MFA_TOTP_ISSUER = env('MFA_TOTP_ISSUER', default='HMS')
MFA_SESSION_TTL_MINUTES = env.int('MFA_SESSION_TTL_MINUTES', default=5)
MFA_ENROLLMENT_TTL_MINUTES = env.int('MFA_ENROLLMENT_TTL_MINUTES', default=30)
MFA_ENCRYPTION_KEY = env('MFA_ENCRYPTION_KEY', default=None)

WEBAUTHN_RP_ID = env('WEBAUTHN_RP_ID', default='localhost')
WEBAUTHN_RP_NAME = env('WEBAUTHN_RP_NAME', default='HMS')
WEBAUTHN_ALLOWED_ORIGINS = env.list(
    'WEBAUTHN_ALLOWED_ORIGINS',
    default=['http://localhost:5173'],
)
WEBAUTHN_ALLOWED_ORIGIN_REGEXES = _validated_origin_regexes(
    env.list('WEBAUTHN_ALLOWED_ORIGIN_REGEXES', default=[]),
)
WEBAUTHN_TIMEOUT_MS = env.int('WEBAUTHN_TIMEOUT_MS', default=60000)

# Deployment profile/capabilities.
# DEPLOYMENT_PROFILE chooses the default matrix. FEATURE_FLAG_OVERRIDES and the
# legacy env vars below can override specific flags per customer deployment.
_deployment_feature_overrides = _parse_feature_flag_overrides(
    env('FEATURE_FLAG_OVERRIDES', default='')
)

_facility_context_required_override = _env_bool_override('FACILITY_CONTEXT_REQUIRED')
if _facility_context_required_override is not None:
    _deployment_feature_overrides['facility_context_required'] = (
        _facility_context_required_override
    )

_multi_facility_override = _env_bool_override('MULTI_FACILITY_MODE')
if _multi_facility_override is not None:
    _deployment_feature_overrides['multi_facility'] = _multi_facility_override
    _deployment_feature_overrides['facility_switcher'] = _multi_facility_override

_cross_facility_override = _env_bool_override('ALLOW_CROSS_FACILITY_ACCESS')
if _cross_facility_override is not None:
    _deployment_feature_overrides['cross_facility_access'] = _cross_facility_override

_outpatient_clinic_override = _env_bool_override('REQUIRE_OUTPATIENT_ACTIVE_CLINIC')
if _outpatient_clinic_override is not None:
    _deployment_feature_overrides['outpatient_active_clinic_required'] = (
        _outpatient_clinic_override
    )

_scheduling_mode_override = env('PRACTITIONER_SCHEDULING_MODE', default='').strip().lower()
if _scheduling_mode_override in {'simple', 'roster'}:
    _deployment_feature_overrides['department_rosters'] = (
        _scheduling_mode_override == 'roster'
    )

DEPLOYMENT = build_deployment_config(
    env('DEPLOYMENT_PROFILE', default='hospital'),
    feature_overrides=_deployment_feature_overrides,
)
DEPLOYMENT_PROFILE = DEPLOYMENT['deployment_profile']
DEPLOYMENT_FEATURES = DEPLOYMENT['features']
DEPLOYMENT_CAPABILITIES = DEPLOYMENT['capabilities']

# Backward-compatible settings used by existing modules and deployments.
FACILITY_CONTEXT_REQUIRED = DEPLOYMENT_FEATURES['facility_context_required']
MULTI_FACILITY_MODE = DEPLOYMENT_FEATURES['multi_facility']
ALLOW_CROSS_FACILITY_ACCESS = DEPLOYMENT_FEATURES['cross_facility_access']
PRACTITIONER_SCHEDULING_MODE = DEPLOYMENT_CAPABILITIES['practitioner_scheduling_mode']
REQUIRE_OUTPATIENT_ACTIVE_CLINIC = DEPLOYMENT_FEATURES[
    'outpatient_active_clinic_required'
]

# Record export security
RECORD_EXPORT_FERNET_KEY = env('RECORD_EXPORT_FERNET_KEY', default='')
RECORD_EXPORT_TTL_HOURS = env.int('RECORD_EXPORT_TTL_HOURS', default=24)

# Public base URL (used for PSP callbacks). Prefer setting this explicitly in production.
PUBLIC_BASE_URL = env('PUBLIC_BASE_URL', default='')

# Billing feature flags
# Never block request threads on external I/O (FHIR). Default OFF.
BILLING_ENABLE_FHIR_CLAIMS = env.bool('BILLING_ENABLE_FHIR_CLAIMS', default=False)

# Legacy workflow compatibility: claim approval does NOT mean cash received.
# Keep this OFF by default; insurance payments should be posted from remittances.
BILLING_POST_INSURANCE_PAYMENTS_ON_CLAIM_APPROVAL = env.bool(
    'BILLING_POST_INSURANCE_PAYMENTS_ON_CLAIM_APPROVAL',
    default=False,
)

# AI Platform configuration
AI_ENABLED = env.bool('AI_ENABLED', default=False)
AI_HOSTING_MODE = env('AI_HOSTING_MODE', default='hybrid').strip().lower()
if AI_HOSTING_MODE not in {'managed', 'self_hosted', 'hybrid'}:
    AI_HOSTING_MODE = 'hybrid'

AI_PROVIDER = env('AI_PROVIDER', default='')
AI_PROVIDER_SECONDARY = env('AI_PROVIDER_SECONDARY', default='')
AI_PROVIDER_BASE_URL = env('AI_PROVIDER_BASE_URL', default='')
AI_PROVIDER_API_KEY = env('AI_PROVIDER_API_KEY', default='')
AI_PROVIDER_REGION = env('AI_PROVIDER_REGION', default='')
AI_PROVIDER_ZERO_RETENTION = env.bool('AI_PROVIDER_ZERO_RETENTION', default=True)
AI_PROVIDER_PRIVATE_NETWORK_ENABLED = env.bool('AI_PROVIDER_PRIVATE_NETWORK_ENABLED', default=False)

AI_MODEL_REASONER_PRIMARY = env('AI_MODEL_REASONER_PRIMARY', default='reasoner-primary')
AI_MODEL_REASONER_FALLBACK = env('AI_MODEL_REASONER_FALLBACK', default='reasoner-fallback')
AI_MODEL_WRITER_PRIMARY = env('AI_MODEL_WRITER_PRIMARY', default='writer-primary')
AI_MODEL_WRITER_FALLBACK = env('AI_MODEL_WRITER_FALLBACK', default='writer-fallback')
AI_MODEL_VALIDATOR = env('AI_MODEL_VALIDATOR', default='validator-small')
AI_MODEL_INTENT = env('AI_MODEL_INTENT', default='intent-small')
AI_MODEL_ASR_PRIMARY = env('AI_MODEL_ASR_PRIMARY', default='asr-primary')
AI_MODEL_ASR_FALLBACK = env('AI_MODEL_ASR_FALLBACK', default='asr-fallback')
AI_MODEL_EMBEDDING = env('AI_MODEL_EMBEDDING', default='embedding-model')
AI_MODEL_RERANKER = env('AI_MODEL_RERANKER', default='reranker-model')

AI_VECTOR_BACKEND = env('AI_VECTOR_BACKEND', default='pgvector').strip().lower()
if AI_VECTOR_BACKEND not in {'pgvector', 'external'}:
    AI_VECTOR_BACKEND = 'pgvector'
AI_VECTOR_INDEX_URL = env('AI_VECTOR_INDEX_URL', default='')

AI_OBJECT_STORAGE_BUCKET_AUDIO = env('AI_OBJECT_STORAGE_BUCKET_AUDIO', default='')
AI_OBJECT_STORAGE_BUCKET_TRANSCRIPTS = env('AI_OBJECT_STORAGE_BUCKET_TRANSCRIPTS', default='')
AI_OBJECT_STORAGE_KMS_KEY_ID = env('AI_OBJECT_STORAGE_KMS_KEY_ID', default='')

AI_REQUEST_TIMEOUT_MS = env.int('AI_REQUEST_TIMEOUT_MS', default=8000)
AI_REQUEST_TIMEOUT_ASR_MS = env.int('AI_REQUEST_TIMEOUT_ASR_MS', default=20000)
AI_MAX_CONTEXT_TOKENS = env.int('AI_MAX_CONTEXT_TOKENS', default=12000)
AI_MAX_OUTPUT_TOKENS = env.int('AI_MAX_OUTPUT_TOKENS', default=1600)
AI_MAX_AUDIO_CHUNK_SECONDS = env.int('AI_MAX_AUDIO_CHUNK_SECONDS', default=20)

AI_SCRIBE_REALTIME_QUEUE = env('AI_SCRIBE_REALTIME_QUEUE', default='ai_realtime')
AI_BATCH_QUEUE = env('AI_BATCH_QUEUE', default='ai_batch')
AI_MAINTENANCE_QUEUE = env('AI_MAINTENANCE_QUEUE', default='ai_maintenance')

AI_AUDIO_RETENTION_DAYS = env.int('AI_AUDIO_RETENTION_DAYS', default=3)
AI_TRANSCRIPT_RETENTION_DAYS = env.int('AI_TRANSCRIPT_RETENTION_DAYS', default=30)
AI_NO_TRAINING_ENFORCED = env.bool('AI_NO_TRAINING_ENFORCED', default=True)
AI_MESSAGE_ENCRYPTION_KEY = env('AI_MESSAGE_ENCRYPTION_KEY', default='')
AI_DAILY_SPEND_CAP_USD = env.float('AI_DAILY_SPEND_CAP_USD', default=200.0)

AI_CHRONICLE_COPILOT_ENABLED = env.bool('AI_CHRONICLE_COPILOT_ENABLED', default=False)
AI_NOTE_DRAFT_ENABLED = env.bool('AI_NOTE_DRAFT_ENABLED', default=False)
AI_NOTE_LINT_ENABLED = env.bool('AI_NOTE_LINT_ENABLED', default=False)
AI_AMBIENT_SCRIBE_ENABLED = env.bool('AI_AMBIENT_SCRIBE_ENABLED', default=False)
AI_LAB_INTERPRET_ENABLED = env.bool('AI_LAB_INTERPRET_ENABLED', default=False)
AI_OMNI_NL_ENABLED = env.bool('AI_OMNI_NL_ENABLED', default=False)
AI_PATIENT_ASSIST_ENABLED = env.bool('AI_PATIENT_ASSIST_ENABLED', default=False)

AI_FEATURE_FLAGS = {
    'chronicle_copilot': AI_CHRONICLE_COPILOT_ENABLED,
    'note_draft': AI_NOTE_DRAFT_ENABLED,
    'note_lint': AI_NOTE_LINT_ENABLED,
    'ambient_scribe': AI_AMBIENT_SCRIBE_ENABLED,
    'lab_interpretation': AI_LAB_INTERPRET_ENABLED,
    'omni_nl': AI_OMNI_NL_ENABLED,
    'patient_assist': AI_PATIENT_ASSIST_ENABLED,
}

# PSP (Hubtel) configuration
HUBTEL_API_BASE_URL = env('HUBTEL_API_BASE_URL', default='')
HUBTEL_CLIENT_ID = env('HUBTEL_CLIENT_ID', default='')
HUBTEL_CLIENT_SECRET = env('HUBTEL_CLIENT_SECRET', default='')
HUBTEL_WEBHOOK_SECRET = env('HUBTEL_WEBHOOK_SECRET', default='')
HUBTEL_HTTP_TIMEOUT_SECONDS = env.int('HUBTEL_HTTP_TIMEOUT_SECONDS', default=8)

# Cache configuration
if DEBUG or IS_BUILD:
    _dev_redis_url = env('REDIS_URL', default=None)
    if _dev_redis_url:
        CACHES = {
            'default': {
                'BACKEND': 'django.core.cache.backends.redis.RedisCache',
                'LOCATION': _dev_redis_url,
                'KEY_PREFIX': 'hms',
                'TIMEOUT': 300,  # 5 minutes default
            }
        }
    else:
        CACHES = {
            'default': {
                'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                'LOCATION': 'hms-local',
                'TIMEOUT': 300,  # 5 minutes default
            }
        }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': env('REDIS_URL', default='redis://127.0.0.1:6379/1'),
            'KEY_PREFIX': 'hms',
            'TIMEOUT': 300,  # 5 minutes default
        }
    }

# Django Rest Framework settings
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_THROTTLE_CLASSES': [
        'hms_backend.throttling.LoadTestAwareAnonThrottle',
        'hms_backend.throttling.LoadTestAwareUserThrottle'
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '1000/hour' if not DEBUG else '10000/hour',
        'user': '5000/hour' if not DEBUG else '50000/hour',
        'login': '5/minute' if not DEBUG else '100/minute',
        'password_reset': '3/hour',
    }
}

# CORS settings
# Filter out invalid origins (e.g., empty or just "https://")
_cors_origins = env.list('CORS_ALLOWED_ORIGINS', default=['http://localhost:3000', 'http://localhost:5173'])

CORS_ALLOWED_ORIGINS = [origin for origin in _cors_origins if origin and '://' in origin and len(origin) > 8]
if not CORS_ALLOWED_ORIGINS:
    CORS_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173']
CORS_ALLOWED_ORIGIN_REGEXES = _validated_origin_regexes(
    env.list('CORS_ALLOWED_ORIGIN_REGEXES', default=[]),
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-device-label',
    'x-facility-code',
    'x-mfa-session',
    'x-requested-with',
]

# CSRF settings
_csrf_origins = env.list('CSRF_TRUSTED_ORIGINS', default=['http://localhost:3000', 'http://localhost:5173'])

CSRF_TRUSTED_ORIGINS = [origin for origin in _csrf_origins if origin and '://' in origin and len(origin) > 8]
if not CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173']

# Security Headers
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
# Trust X-Forwarded-Proto from TLS-terminating reverse proxies.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
TRUST_PROXY_HEADERS = env.bool('TRUST_PROXY_HEADERS', default=False)
TRUSTED_PROXY_HOPS = env.int('TRUSTED_PROXY_HOPS', default=1)
TRUSTED_PROXY_CIDRS = env.list(
    'TRUSTED_PROXY_CIDRS',
    default=[
        '127.0.0.1/32',
        '::1/128',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
    ],
)
LOAD_TEST_THROTTLE_BYPASS_ENABLED = env.bool('LOAD_TEST_THROTTLE_BYPASS_ENABLED', default=False)
SECURE_HSTS_SECONDS = env.int('SECURE_HSTS_SECONDS', default=31536000 if not DEBUG else 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool('SECURE_HSTS_INCLUDE_SUBDOMAINS', default=True if not DEBUG else False)
SECURE_HSTS_PRELOAD = env.bool('SECURE_HSTS_PRELOAD', default=True if not DEBUG else False)
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=True if not DEBUG else False)
_probe_and_metrics_exempt_paths = [
    r'^api/health/$',
    r'^api/health/alive/$',
    r'^api/health/ready/$',
    r'^api/health/started/$',
    r'^api/metrics/$',
]
_secure_redirect_exempt = [
    pattern.strip()
    for pattern in env.list('SECURE_REDIRECT_EXEMPT', default=_probe_and_metrics_exempt_paths)
    if pattern and pattern.strip()
]
for pattern in _probe_and_metrics_exempt_paths:
    if pattern not in _secure_redirect_exempt:
        _secure_redirect_exempt.append(pattern)
SECURE_REDIRECT_EXEMPT = _secure_redirect_exempt
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=True if not DEBUG else False)
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=True if not DEBUG else False)

# Access control settings
TEAM_ACCESS_STRICT = env.bool('TEAM_ACCESS_STRICT', default=True)
BREAK_GLASS_TTL_MINUTES = env.int('BREAK_GLASS_TTL_MINUTES', default=30)

# Email settings - SendGrid Web API
EMAIL_BACKEND = 'hms_backend.email_backends.SendGridEmailBackend'
SENDGRID_API_KEY = env_required('SENDGRID_API_KEY')
DEFAULT_FROM_EMAIL = env_required('DEFAULT_FROM_EMAIL')

# Google Cloud Healthcare API settings
GOOGLE_APPLICATION_CREDENTIALS = env_required('GOOGLE_APPLICATION_CREDENTIALS')
GOOGLE_CLOUD_PROJECT = env_required('GOOGLE_CLOUD_PROJECT')
GOOGLE_HEALTHCARE_DATASET = env_required('GOOGLE_HEALTHCARE_DATASET')
GOOGLE_FHIR_STORE = env_required('GOOGLE_FHIR_STORE')
GOOGLE_DICOM_STORE = env_required('GOOGLE_DICOM_STORE')
GOOGLE_HL7V2_STORE = env_required('GOOGLE_HL7V2_STORE')

# JWT Authentication settings
from datetime import timedelta

# JWT Token Configuration
# Healthcare-grade security settings with strict session management
SIMPLE_JWT = {
    # Short-lived access tokens (15 minutes)
    # Users will need to refresh frequently, but tokens are rotated automatically
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),

    # Refresh token lifetime reduced to 7 days (from 30) for healthcare compliance
    # Combined with 8-hour absolute session timeout on frontend
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),

    # Rotate refresh tokens on each refresh for enhanced security
    'ROTATE_REFRESH_TOKENS': True,

    # Blacklist old refresh tokens after rotation to prevent reuse
    'BLACKLIST_AFTER_ROTATION': True,

    # Update last login timestamp on token refresh
    'UPDATE_LAST_LOGIN': True,

    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'VERIFYING_KEY': None,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
    'TOKEN_TYPE_CLAIM': 'token_type',
    'JTI_CLAIM': 'jti',
}

# Password reset settings
PASSWORD_RESET_TOKEN_EXPIRY_MINUTES = 15
FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:5173')

# dj-rest-auth settings
REST_USE_JWT = True
JWT_AUTH_COOKIE = None  # Don't store access token in cookie
JWT_AUTH_REFRESH_COOKIE = 'refresh_token'  # Store refresh token in cookie
JWT_AUTH_SECURE = env.bool('JWT_AUTH_SECURE', default=False if DEBUG else True)  # Secure cookie in prod, not in local dev
JWT_AUTH_HTTPONLY = True  # Use HttpOnly cookie for refresh token
JWT_AUTH_SAMESITE = env('JWT_AUTH_SAMESITE', default='None' if not DEBUG else 'Lax')  # Cross-origin requires 'None'; local dev uses 'Lax'

# Session tracking hash salt (defaults to SECRET_KEY)
SESSION_HASH_SALT = env('SESSION_HASH_SALT', default=SECRET_KEY)
USER_SESSION_RETENTION_DAYS = env.int('USER_SESSION_RETENTION_DAYS', default=90)
USER_SESSION_IDLE_TIMEOUT_MINUTES = env.int('USER_SESSION_IDLE_TIMEOUT_MINUTES', default=30)

# Logging Configuration
LOGS_DIR = os.path.join(BASE_DIR, 'logs')
os.makedirs(LOGS_DIR, exist_ok=True)
LOG_LEVEL = env('LOG_LEVEL', default='INFO').upper()
DJANGO_DB_LOG_LEVEL = env('DJANGO_DB_LOG_LEVEL', default='WARNING' if not DEBUG else 'INFO').upper()
LOG_AS_JSON = env.bool('LOG_AS_JSON', default=not DEBUG)
FILE_LOGGING_ENABLED = env.bool('FILE_LOGGING_ENABLED', default=DEBUG)
_console_formatter = 'json' if LOG_AS_JSON else 'standard'
_default_app_handlers = ['console'] + (['file'] if FILE_LOGGING_ENABLED else [])

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
        'standard': {
            'format': '[{asctime}] {levelname} {name}: {message}',
            'style': '{',
            'datefmt': '%Y-%m-%d %H:%M:%S',
        },
        'json': {
            '()': 'hms_backend.logging_utils.JsonLogFormatter',
        },
    },
    'filters': {
        'require_debug_false': {
            '()': 'django.utils.log.RequireDebugFalse',
        },
        'ai_privacy_redaction': {
            '()': 'apps.ai.logging_utils.AIPrivacyLogFilter',
        },
    },
    'handlers': {
        'console': {
            'level': LOG_LEVEL,
            'class': 'logging.StreamHandler',
            'formatter': _console_formatter,
        },
        'file': {
            'level': LOG_LEVEL,
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOGS_DIR, 'hms.log'),
            'maxBytes': 1024 * 1024 * 5,  # 5 MB
            'backupCount': 5,
            'formatter': 'standard',
        },
        'mail_admins': {
            'level': 'ERROR',
            'filters': ['require_debug_false'],
            'class': 'django.utils.log.AdminEmailHandler',
            'formatter': 'verbose',
        },
        'fhir_client_file': {
            'level': 'DEBUG',
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOGS_DIR, 'fhir_client.log'),
            'maxBytes': 1024 * 1024 * 5,  # 5 MB
            'backupCount': 5,
            'formatter': 'standard',
        },
        'ai_file': {
            'level': 'INFO',
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOGS_DIR, 'ai.log'),
            'maxBytes': 1024 * 1024 * 5,  # 5 MB
            'backupCount': 5,
            'formatter': 'standard',
            'filters': ['ai_privacy_redaction'],
        },
    },
    'loggers': {
        'django': {
            'handlers': _default_app_handlers + ['mail_admins'],
            'level': LOG_LEVEL,
            'propagate': True,
        },
        'django.request': {
            'handlers': _default_app_handlers + ['mail_admins'],
            'level': LOG_LEVEL,
            'propagate': False,
        },
        'django.security': {
            'handlers': ['mail_admins'] + (['file'] if FILE_LOGGING_ENABLED else ['console']),
            'level': 'ERROR',
            'propagate': False,
        },
        'django.db.backends': {
            'handlers': _default_app_handlers,
            'level': DJANGO_DB_LOG_LEVEL,
            'propagate': False,
        },
        'apps': {
            'handlers': _default_app_handlers,
            'level': LOG_LEVEL if not DEBUG else 'DEBUG',
            'propagate': True,
        },
        'apps.fhir_client': {
            'handlers': ['console'] + (['fhir_client_file'] if FILE_LOGGING_ENABLED else []),
            'level': 'DEBUG',
            'propagate': False,
        },
        'apps.ai': {
            'handlers': ['console'] + (['ai_file'] if FILE_LOGGING_ENABLED else []),
            'level': 'INFO',
            'propagate': False,
        },
    },
}

# Celery Configuration
CELERY_BROKER_URL = env('REDIS_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = env('CELERY_RESULT_BACKEND', default=CELERY_BROKER_URL)
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TASK_IGNORE_RESULT = env.bool('CELERY_TASK_IGNORE_RESULT', default=True)
CELERY_RESULT_EXPIRES = env.int('CELERY_RESULT_EXPIRES', default=3600)
CELERY_BROKER_CONNECTION_RETRY = env.bool('CELERY_BROKER_CONNECTION_RETRY', default=True)
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = env.bool(
    'CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP',
    default=True,
)
CELERY_BROKER_CONNECTION_MAX_RETRIES = env.int('CELERY_BROKER_CONNECTION_MAX_RETRIES', default=100)
CELERY_BROKER_CONNECTION_TIMEOUT = env.float('CELERY_BROKER_CONNECTION_TIMEOUT', default=8.0)
CELERY_BROKER_CHANNEL_ERROR_RETRY = env.bool('CELERY_BROKER_CHANNEL_ERROR_RETRY', default=True)
CELERY_BROKER_TRANSPORT_OPTIONS = {
    'socket_connect_timeout': env.float('CELERY_BROKER_SOCKET_CONNECT_TIMEOUT', default=8.0),
    'socket_timeout': env.float('CELERY_BROKER_SOCKET_TIMEOUT', default=30.0),
    'socket_keepalive': env.bool('CELERY_BROKER_SOCKET_KEEPALIVE', default=True),
    'health_check_interval': env.int('CELERY_BROKER_HEALTH_CHECK_INTERVAL', default=30),
    'retry_on_timeout': env.bool('CELERY_BROKER_RETRY_ON_TIMEOUT', default=True),
}
CELERY_REDIS_SOCKET_CONNECT_TIMEOUT = env.float('CELERY_REDIS_SOCKET_CONNECT_TIMEOUT', default=8.0)
CELERY_REDIS_SOCKET_TIMEOUT = env.float('CELERY_REDIS_SOCKET_TIMEOUT', default=30.0)
CELERY_REDIS_SOCKET_KEEPALIVE = env.bool('CELERY_REDIS_SOCKET_KEEPALIVE', default=True)
CELERY_REDIS_RETRY_ON_TIMEOUT = env.bool('CELERY_REDIS_RETRY_ON_TIMEOUT', default=True)
CELERY_REDIS_BACKEND_HEALTH_CHECK_INTERVAL = env.int(
    'CELERY_REDIS_BACKEND_HEALTH_CHECK_INTERVAL',
    default=30,
)
CELERY_RESULT_BACKEND_TRANSPORT_OPTIONS = {
    'retry_on_timeout': env.bool('CELERY_RESULT_BACKEND_RETRY_ON_TIMEOUT', default=True),
    'health_check_interval': env.int('CELERY_RESULT_BACKEND_HEALTH_CHECK_INTERVAL', default=30),
}
CELERY_WORKER_CANCEL_LONG_RUNNING_TASKS_ON_CONNECTION_LOSS = env.bool(
    'CELERY_WORKER_CANCEL_LONG_RUNNING_TASKS_ON_CONNECTION_LOSS',
    default=True,
)
# Bound Celery worker fan-out by default so deployments remain cost-predictable.
CELERY_WORKER_CONCURRENCY = env.int('CELERY_WORKER_CONCURRENCY', default=2)
CELERY_WORKER_PREFETCH_MULTIPLIER = env.int('CELERY_WORKER_PREFETCH_MULTIPLIER', default=1)
CELERY_WORKER_MAX_TASKS_PER_CHILD = env.int('CELERY_WORKER_MAX_TASKS_PER_CHILD', default=200)
CELERY_WORKER_MAX_MEMORY_PER_CHILD = env.int('CELERY_WORKER_MAX_MEMORY_PER_CHILD', default=262144)
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_DEFAULT_QUEUE = env('CELERY_TASK_DEFAULT_QUEUE', default='default')
CELERY_TASK_QUEUES = (
    Queue(CELERY_TASK_DEFAULT_QUEUE),
    Queue(AI_SCRIBE_REALTIME_QUEUE),
    Queue(AI_BATCH_QUEUE),
    Queue(AI_MAINTENANCE_QUEUE),
)
CELERY_TASK_ROUTES = {
    'apps.ai.tasks.realtime_generate_placeholder_artifact': {'queue': AI_SCRIBE_REALTIME_QUEUE},
    'apps.ai.tasks.batch_mark_stale_sessions_failed': {'queue': AI_BATCH_QUEUE},
    'apps.ai.tasks.maintenance_redact_expired_encrypted_messages': {'queue': AI_MAINTENANCE_QUEUE},
}
if "pytest" in sys.modules:
    CELERY_TASK_ALWAYS_EAGER = True
    CELERY_TASK_EAGER_PROPAGATES = True


# Celery Beat Schedule
CELERY_BEAT_SCHEDULE = {
    'cleanup-expired-password-tokens-daily': {
        'task': 'apps.users.tasks.cleanup_expired_tokens',
        'schedule': timedelta(days=1),  # Run once a day
    },
    'cleanup-user-sessions-daily': {
        'task': 'apps.users.tasks.cleanup_user_sessions',
        'schedule': timedelta(days=1),  # Run once a day
    },
}

if (
    DEPLOYMENT_FEATURES.get('outpatient_encounters', False)
    or DEPLOYMENT_FEATURES.get('emergency_encounters', False)
):
    CELERY_BEAT_SCHEDULE['cleanup-encounters-daily'] = {
        'task': 'apps.encounters.tasks.cleanup_encounters_daily',
        'schedule': timedelta(days=1),
    }

if DEPLOYMENT_FEATURES.get('appointments', False):
    CELERY_BEAT_SCHEDULE['generate-slots-weekly'] = {
        'task': 'apps.appointments.tasks.generate_slots_weekly',
        'schedule': timedelta(days=7),  # Run once a week
        'args': (14,),  # Generate slots for the next 14 days
        'options': {
            'expires': 3600,  # Task expires after 1 hour
        },
    }

if AI_ENABLED:
    CELERY_BEAT_SCHEDULE['ai-mark-stale-sessions'] = {
        'task': 'apps.ai.tasks.batch_mark_stale_sessions_failed',
        'schedule': timedelta(minutes=5),
    }
    CELERY_BEAT_SCHEDULE['ai-redact-expired-ai-messages'] = {
        'task': 'apps.ai.tasks.maintenance_redact_expired_encrypted_messages',
        'schedule': timedelta(hours=6),
    }

ADMIN_DASHBOARD_PREWARM_INTERVAL_SECONDS = env.int(
    'ADMIN_DASHBOARD_PREWARM_INTERVAL_SECONDS',
    default=0,
)
if (
    DEPLOYMENT_FEATURES.get('appointments', False)
    and ADMIN_DASHBOARD_PREWARM_INTERVAL_SECONDS > 0
):
    CELERY_BEAT_SCHEDULE['refresh-admin-dashboard-appointments'] = {
        'task': 'apps.dashboards.tasks.refresh_admin_dashboard_appointments_for_all_facilities',
        'schedule': float(ADMIN_DASHBOARD_PREWARM_INTERVAL_SECONDS),
        'options': {
            'expires': max(10, ADMIN_DASHBOARD_PREWARM_INTERVAL_SECONDS - 10),
        },
    }
