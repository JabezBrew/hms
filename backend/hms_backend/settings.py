"""
Django settings for hms_backend project.
"""

import os
import sys
from pathlib import Path
import environ
import logging.config
from urllib.parse import urlparse, parse_qs




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

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env.bool('DEBUG', default=False)

ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1'])

# Auto-add Railway domains to ALLOWED_HOSTS
_railway_hosts = [
    'backend-staging-8afc.up.railway.app',
    'backend-production-40e0.up.railway.app',
    '.railway.app',  # Wildcard for any Railway subdomain
]
for host in _railway_hosts:
    if host not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(host)

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
    'apps.appointments',
    'apps.patients',
    'apps.wards',
    'apps.encounters.apps.EncountersConfig',  # Extracted from wards for cleaner architecture
    'apps.inventory',
    'apps.billing',
    'apps.clinical_notes.apps.ClinicalNotesConfig',
    'apps.nursing.apps.NursingConfig',
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
]

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
# 1. DATABASE_URL (Railway, Heroku, Render, etc.)
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
WEBAUTHN_TIMEOUT_MS = env.int('WEBAUTHN_TIMEOUT_MS', default=60000)
FACILITY_CONTEXT_REQUIRED = env.bool('FACILITY_CONTEXT_REQUIRED', default=True)
MULTI_FACILITY_MODE = env.bool('MULTI_FACILITY_MODE', default=False)
ALLOW_CROSS_FACILITY_ACCESS = env.bool('ALLOW_CROSS_FACILITY_ACCESS', default=False)

# Record export security
RECORD_EXPORT_FERNET_KEY = env('RECORD_EXPORT_FERNET_KEY', default='')
RECORD_EXPORT_TTL_HOURS = env.int('RECORD_EXPORT_TTL_HOURS', default=24)

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

# Add known Railway domains explicitly to ensure they work even if env vars are missing them
_railway_origins = [
    'https://frontend-staging-e202.up.railway.app',
    'https://frontend-production-40e0.up.railway.app',
]
for origin in _railway_origins:
    if origin not in _cors_origins:
        _cors_origins.append(origin)

CORS_ALLOWED_ORIGINS = [origin for origin in _cors_origins if origin and '://' in origin and len(origin) > 8]
if not CORS_ALLOWED_ORIGINS:
    CORS_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173']
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
    'x-facility-code',
    'x-requested-with',
]

# CSRF settings
_csrf_origins = env.list('CSRF_TRUSTED_ORIGINS', default=['http://localhost:3000', 'http://localhost:5173'])

# Add known Railway domains to CSRF trusted origins as well
for origin in _railway_origins:
    if origin not in _csrf_origins:
        _csrf_origins.append(origin)

CSRF_TRUSTED_ORIGINS = [origin for origin in _csrf_origins if origin and '://' in origin and len(origin) > 8]
if not CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173']

# Security Headers
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
# Trust X-Forwarded-Proto header from Railway/Heroku/etc load balancers
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_HSTS_SECONDS = env.int('SECURE_HSTS_SECONDS', default=31536000 if not DEBUG else 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool('SECURE_HSTS_INCLUDE_SUBDOMAINS', default=True if not DEBUG else False)
SECURE_HSTS_PRELOAD = env.bool('SECURE_HSTS_PRELOAD', default=True if not DEBUG else False)
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=False)
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=True if not DEBUG else False)
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=True if not DEBUG else False)

# Access control se = env.bool('TEAM_ACCESS_STRICT', default=True)
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

# Logging Configuration
LOGS_DIR = os.path.join(BASE_DIR, 'logs')
os.makedirs(LOGS_DIR, exist_ok=True)

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
    },
    'filters': {
        'require_debug_true': {
            '()': 'django.utils.log.RequireDebugTrue',
        },
        'require_debug_false': {
            '()': 'django.utils.log.RequireDebugFalse',
        },
    },
    'handlers': {
        'console': {
            'level': 'INFO',
            'filters': ['require_debug_true'],
            'class': 'logging.StreamHandler',
            'formatter': 'standard',
        },
        'file': {
            'level': 'INFO',
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
    },
    'loggers': {
        'django': {
            'handlers': ['console', 'file', 'mail_admins'],
            'level': 'INFO',
            'propagate': True,
        },
        'django.request': {
            'handlers': ['console', 'file', 'mail_admins'],
            'level': 'INFO',
            'propagate': False,
        },
        'django.security': {
            'handlers': ['mail_admins', 'file'],
            'level': 'ERROR',
            'propagate': False,
        },
        'django.db.backends': {
            'handlers': ['console', 'file'],
            'level': 'INFO',
            'propagate': False,
        },
        'apps': {
            'handlers': ['console', 'file'],
            'level': 'DEBUG',
            'propagate': True,
        },
        'apps.fhir_client': {
            'handlers': ['console', 'fhir_client_file'],
            'level': 'DEBUG',
            'propagate': False,
        },
    },
}

# Celery Configuration
CELERY_BROKER_URL = env('REDIS_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = env('REDIS_URL', default='redis://localhost:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE
if "pytest" in sys.modules:
    CELERY_TASK_ALWAYS_EAGER = True
    CELERY_TASK_EAGER_PROPAGATES = True


# Celery Beat Schedule
CELERY_BEAT_SCHEDULE = {
    'generate-slots-weekly': {
        'task': 'apps.appointments.tasks.generate_slots_weekly',
        'schedule': timedelta(days=7),  # Run once a week
        'args': (14,),  # Generate slots for the next 14 days
        'options': {
            'expires': 3600,  # Task expires after 1 hour
        },
    },
    'cleanup-expired-password-tokens-daily': {
        'task': 'apps.users.tasks.cleanup_expired_tokens',
        'schedule': timedelta(days=1),  # Run once a day
    },
    'cleanup-user-sessions-daily': {
        'task': 'apps.users.tasks.cleanup_user_sessions',
        'schedule': timedelta(days=1),  # Run once a day
    },
    'refresh-admin-dashboard-appointments': {
        'task': 'apps.dashboards.tasks.refresh_admin_dashboard_appointments_for_all_facilities',
        'schedule': 60.0,  # Every 60 seconds
        'options': {
            'expires': 50,
        },
    },
}
