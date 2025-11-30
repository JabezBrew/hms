"""
Django settings for hms_backend project.
"""

import os
import sys
from pathlib import Path
import environ
import logging.config




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

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env.bool('DEBUG', default=False)

ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1'])

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party apps
    'rest_framework',
    'corsheaders',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',

    # Local apps
    'apps.core.apps.CoreConfig',  # Shared utilities for API optimization
    'apps.users.apps.UsersConfig',  # Use this instead of 'apps.users'
    'apps.fhir_client',
    'apps.appointments',
    'apps.patients',
    'apps.wards',
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
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'hms_backend.middleware.JWTUserTypeValidationMiddleware',  # Validate JWT claims
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

# Database
# https://docs.djangoproject.com/en/5.0/ref/settings/#databases

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

# Password validation
# https://docs.djangoproject.com/en/5.0/ref/settings/#auth-password-validators

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

# Cache configuration
if DEBUG:
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
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle'
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/hour',
        'user': '1000/hour',
        'login': '5/minute',
        'password_reset': '3/hour',
    }
}

# CORS settings
CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=['http://localhost:3000', 'http://localhost:5173'])
CORS_ALLOW_CREDENTIALS = True

# CSRF settings
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=['http://localhost:3000', 'http://localhost:5173'])

# Security Headers
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_HSTS_SECONDS = env.int('SECURE_HSTS_SECONDS', default=31536000 if not DEBUG else 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool('SECURE_HSTS_INCLUDE_SUBDOMAINS', default=True if not DEBUG else False)
SECURE_HSTS_PRELOAD = env.bool('SECURE_HSTS_PRELOAD', default=True if not DEBUG else False)
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=False)
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=True if not DEBUG else False)
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=True if not DEBUG else False)

# Email settings - SendGrid Web API
EMAIL_BACKEND = 'hms_backend.email_backends.SendGridEmailBackend'
SENDGRID_API_KEY = env('SENDGRID_API_KEY')
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL')

# Google Cloud Healthcare API settings
GOOGLE_APPLICATION_CREDENTIALS = env('GOOGLE_APPLICATION_CREDENTIALS')
GOOGLE_CLOUD_PROJECT = env('GOOGLE_CLOUD_PROJECT')
GOOGLE_HEALTHCARE_DATASET = env('GOOGLE_HEALTHCARE_DATASET')
GOOGLE_FHIR_STORE = env('GOOGLE_FHIR_STORE')
GOOGLE_DICOM_STORE = env('GOOGLE_DICOM_STORE')
GOOGLE_HL7V2_STORE = env('GOOGLE_HL7V2_STORE')

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
JWT_AUTH_SAMESITE = env('JWT_AUTH_SAMESITE', default='Lax')  # SameSite cookie setting

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
            'handlers': ['mail_admins', 'file'],
            'level': 'ERROR',
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
}
