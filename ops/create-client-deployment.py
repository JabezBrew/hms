#!/usr/bin/env python3
"""
Generate a private HMS client VPS deployment environment file.

The generated file is intentionally not committed. It contains application
secrets, bootstrap admin credentials, client profile defaults, and backup
configuration for the one-VPS-per-client deployment model.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
import re
import secrets
import stat
import sys
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
FEATURE_MANIFEST_PATH = REPO_ROOT / 'backend' / 'hms_backend' / 'feature_manifest.py'
FEATURE_SPEC = importlib.util.spec_from_file_location(
    'hms_feature_manifest',
    FEATURE_MANIFEST_PATH,
)
if FEATURE_SPEC is None or FEATURE_SPEC.loader is None:
    raise RuntimeError(f'Unable to load feature manifest: {FEATURE_MANIFEST_PATH}')
feature_manifest_module = importlib.util.module_from_spec(FEATURE_SPEC)
FEATURE_SPEC.loader.exec_module(feature_manifest_module)
FEATURE_MANIFEST = feature_manifest_module.FEATURE_MANIFEST

PROFILE_ALIASES = {
    'clinic': 'clinic',
    'small_clinic': 'clinic',
    'hospital': 'hospital',
    'single_hospital': 'hospital',
    'hospital_network': 'hospital_network',
    'network': 'hospital_network',
}


DEFAULT_OUTPUT = REPO_ROOT / 'ops' / 'hetzner-client-vps' / '.env'
DEFAULT_PARENT_DOMAIN = 'thehms.systems'
DEFAULT_ACME_EMAIL = 'ops@thehms.systems'

SLUG_RE = re.compile(r'^[a-z][a-z0-9-]{1,39}$')
DOMAIN_LABEL_RE = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
FACILITY_CODE_RE = re.compile(r'^[A-Z0-9][A-Z0-9_-]{0,23}$')
FEATURE_VALUE_TRUE = {'1', 'true', 'yes', 'on'}
FEATURE_VALUE_FALSE = {'0', 'false', 'no', 'off'}

PRESERVED_FROM_ENV_KEYS = {
    'SECRET_KEY',
    'DB_PASSWORD',
    'DB_CONN_MAX_AGE',
    'DB_DISABLE_SERVER_SIDE_CURSORS',
    'ASGI_THREADS',
    'PGBOUNCER_MAX_CLIENT_CONN',
    'PGBOUNCER_DEFAULT_POOL_SIZE',
    'PGBOUNCER_RESERVE_POOL_SIZE',
    'CELERY_OPERABILITY_REFRESH_INTERVAL_SECONDS',
    'CELERY_OPERABILITY_INSPECT_TIMEOUT_SECONDS',
    'CELERY_OPERABILITY_REDIS_TIMEOUT_SECONDS',
    'MFA_ENCRYPTION_KEY',
    'RECORD_EXPORT_FERNET_KEY',
    'SESSION_HASH_SALT',
    'ADMIN_PASSWORD',
    'RESTIC_PASSWORD',
    'EMAIL_PROVIDER',
    'UNOSEND_API_KEY',
    'RESEND_API_KEY',
    'EMAIL_SENDER_DOMAIN',
    'EMAIL_WELCOME_LOCAL_PART',
    'EMAIL_SECURITY_LOCAL_PART',
    'WELCOME_FROM_EMAIL',
    'SECURITY_FROM_EMAIL',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_HEALTHCARE_DATASET',
    'GOOGLE_FHIR_STORE',
    'GOOGLE_DICOM_STORE',
    'GOOGLE_HL7V2_STORE',
}


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        raise ValueError(f'--from-env file does not exist: {path}')

    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[len('export ') :].strip()
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()
        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in {'"', "'"}
        ):
            value = value[1:-1]
        values[key] = value

    return values


def env_line(key: str, value: object) -> str:
    return f'{key}={value if value is not None else ""}'


def random_base64(byte_count: int = 32) -> str:
    return base64.b64encode(os.urandom(byte_count)).decode('ascii')


def random_fernet_key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode('ascii')


def validate_slug(slug: str) -> str:
    normalized = slug.strip()
    if not SLUG_RE.fullmatch(normalized) or '--' in normalized or normalized.endswith('-'):
        raise ValueError(
            'slug must be 2-40 lowercase characters, start with a letter, '
            'and contain only letters, numbers, and single hyphens'
        )
    return normalized


def validate_domain(domain: str) -> str:
    normalized = domain.strip().lower().rstrip('.')
    labels = normalized.split('.')
    if (
        len(labels) < 2
        or len(normalized) > 253
        or any(not DOMAIN_LABEL_RE.fullmatch(label) for label in labels)
    ):
        raise ValueError('domain must be a valid DNS name, for example acme.thehms.systems')
    return normalized


def validate_facility_code(code: str) -> str:
    normalized = code.strip().upper()
    if not FACILITY_CODE_RE.fullmatch(normalized):
        raise ValueError(
            'facility code must be 1-24 uppercase letters, numbers, underscores, or hyphens'
        )
    return normalized


def normalize_deployment_profile(profile: str) -> str:
    return PROFILE_ALIASES.get(str(profile or 'hospital').strip().lower(), 'hospital')


def validate_profile(profile: str) -> str:
    normalized = profile.strip().lower()
    if normalized not in PROFILE_ALIASES:
        allowed = ', '.join(sorted(PROFILE_ALIASES))
        raise ValueError(f'invalid profile {profile!r}; allowed values: {allowed}')
    return normalize_deployment_profile(normalized)


def parse_feature_overrides(raw_overrides: Iterable[str]) -> dict[str, bool]:
    overrides: dict[str, bool] = {}
    for raw_override in raw_overrides:
        if '=' not in raw_override:
            raise ValueError(f'feature override must be key=value: {raw_override!r}')
        key, raw_value = raw_override.split('=', 1)
        key = key.strip()
        value = raw_value.strip().lower()
        if key not in FEATURE_MANIFEST:
            raise ValueError(f'unknown feature override {key!r}')
        if value in FEATURE_VALUE_TRUE:
            overrides[key] = True
        elif value in FEATURE_VALUE_FALSE:
            overrides[key] = False
        else:
            raise ValueError(
                f'feature override {key!r} must be boolean: true, false, yes, no, 1, or 0'
            )
    return overrides


def derive_facility_code(slug: str) -> str:
    candidate = re.sub(r'[^A-Z0-9]', '', slug.upper())
    return candidate[:24] or 'MAIN'


def profile_facility_type(profile: str) -> str:
    return 'clinic' if profile == 'clinic' else 'hospital'


def generated_values(
    *,
    slug: str,
    name: str,
    profile: str,
    mode: str,
    domain: str,
    facility_code: str,
    compose_project: str,
    acme_email: str,
    admin_email: str,
    feature_overrides: dict[str, bool],
    from_env_values: dict[str, str],
) -> dict[str, str]:
    preserved = {
        key: value
        for key, value in from_env_values.items()
        if key in PRESERVED_FROM_ENV_KEYS and value
    }
    secure_origin = f'https://{domain}'
    is_production = mode == 'production'
    multi_facility = profile == 'hospital_network'
    feature_override_text = (
        json.dumps(feature_overrides, sort_keys=True, separators=(',', ':'))
        if feature_overrides
        else ''
    )

    values = {
        'VERSION': slug,
        'COMPOSE_PROJECT_NAME': compose_project,
        'CLIENT_SLUG': slug,
        'CLIENT_NAME': name,
        'CLIENT_DOMAIN': domain,
        'DEPLOYMENT_MODE': mode,
        'ACME_EMAIL': acme_email,
        'SECRET_KEY': secrets.token_urlsafe(64),
        'ALLOWED_HOSTS': domain,
        'CORS_ALLOWED_ORIGINS': secure_origin,
        'CSRF_TRUSTED_ORIGINS': secure_origin,
        'FRONTEND_URL': secure_origin,
        'PUBLIC_BASE_URL': secure_origin,
        'DB_NAME': 'hms',
        'DB_USER': 'hms',
        'DB_PASSWORD': random_base64(32),
        'DB_CONN_MAX_AGE': '60',
        'DB_DISABLE_SERVER_SIDE_CURSORS': 'True',
        'ASGI_THREADS': '12',
        'PGBOUNCER_MAX_CLIENT_CONN': '200',
        'PGBOUNCER_DEFAULT_POOL_SIZE': '15',
        'PGBOUNCER_RESERVE_POOL_SIZE': '5',
        'DEFAULT_FACILITY_CODE': facility_code,
        'DEFAULT_FACILITY_NAME': name,
        'DEFAULT_FACILITY_TYPE': profile_facility_type(profile),
        'DEFAULT_FACILITY_ADDRESS': 'Client Address',
        'DEFAULT_FACILITY_CITY': 'Accra',
        'DEFAULT_FACILITY_REGION': 'Greater Accra',
        'DEFAULT_FACILITY_COUNTRY': 'Ghana',
        'DEFAULT_FACILITY_PHONE': '+233000000000',
        'DEFAULT_FACILITY_EMAIL': admin_email,
        'ADMIN_EMAIL': admin_email,
        'ADMIN_PASSWORD': secrets.token_urlsafe(24),
        'ADMIN_FIRST_NAME': 'Client',
        'ADMIN_LAST_NAME': 'Administrator',
        'DEPLOYMENT_PROFILE': profile,
        'FEATURE_FLAG_OVERRIDES': feature_override_text,
        'AI_ENABLED': 'False',
        'CELERY_WORKER_CONCURRENCY': '2' if is_production else '1',
        'CELERY_WORKER_PREFETCH_MULTIPLIER': '1',
        'CELERY_OPERABILITY_REFRESH_INTERVAL_SECONDS': '60',
        'CELERY_OPERABILITY_INSPECT_TIMEOUT_SECONDS': '0.5',
        'CELERY_OPERABILITY_REDIS_TIMEOUT_SECONDS': '0.25',
        'ADMIN_DASHBOARD_PREWARM_INTERVAL_SECONDS': '0',
        'MULTI_FACILITY_MODE': 'true' if multi_facility else 'false',
        'SECURE_HSTS_SECONDS': '31536000' if is_production else '3600',
        'SECURE_HSTS_INCLUDE_SUBDOMAINS': 'True' if is_production else 'False',
        'SECURE_HSTS_PRELOAD': 'False',
        'MFA_ENCRYPTION_KEY': random_base64(32),
        'RECORD_EXPORT_FERNET_KEY': random_fernet_key(),
        'SESSION_HASH_SALT': secrets.token_hex(32),
        'WEBAUTHN_RP_ID': domain,
        'WEBAUTHN_ALLOWED_ORIGINS': secure_origin,
        'MFA_TOTP_ISSUER': f'HMS {name}',
        'EMAIL_PROVIDER': 'unosend',
        'UNOSEND_API_KEY': 'CHANGE_ME_unosend_api_key'
        if is_production
        else 'demo-dummy-unosend-disabled',
        'RESEND_API_KEY': '',
        'DEFAULT_FROM_EMAIL': f'noreply@{domain}',
        'EMAIL_SENDER_DOMAIN': domain,
        'EMAIL_WELCOME_LOCAL_PART': 'welcome',
        'EMAIL_SECURITY_LOCAL_PART': 'security',
        'WELCOME_FROM_EMAIL': '',
        'SECURITY_FROM_EMAIL': '',
        'GOOGLE_APPLICATION_CREDENTIALS': '/dev/null',
        'GOOGLE_CLOUD_PROJECT': 'client-disabled',
        'GOOGLE_HEALTHCARE_DATASET': 'client-disabled',
        'GOOGLE_FHIR_STORE': 'client-disabled',
        'GOOGLE_DICOM_STORE': 'client-disabled',
        'GOOGLE_HL7V2_STORE': 'client-disabled',
        'BACKUP_RETENTION_DAYS': '30' if is_production else '7',
        'RESTIC_REPOSITORY': 'CHANGE_ME_s3_restic_repository' if is_production else '',
        'RESTIC_PASSWORD': secrets.token_urlsafe(32) if is_production else '',
        'AWS_ACCESS_KEY_ID': 'CHANGE_ME_s3_access_key_id' if is_production else '',
        'AWS_SECRET_ACCESS_KEY': 'CHANGE_ME_s3_secret_access_key' if is_production else '',
    }

    values.update(preserved)
    return values


ENV_SECTIONS = (
    (
        'Compose/Caddy',
        (
            'VERSION',
            'COMPOSE_PROJECT_NAME',
            'CLIENT_SLUG',
            'CLIENT_NAME',
            'CLIENT_DOMAIN',
            'DEPLOYMENT_MODE',
            'ACME_EMAIL',
        ),
    ),
    (
        'Django core',
        (
            'SECRET_KEY',
            'ALLOWED_HOSTS',
            'CORS_ALLOWED_ORIGINS',
            'CSRF_TRUSTED_ORIGINS',
            'FRONTEND_URL',
            'PUBLIC_BASE_URL',
        ),
    ),
    (
        'Database',
        (
            'DB_NAME',
            'DB_USER',
            'DB_PASSWORD',
            'DB_CONN_MAX_AGE',
            'DB_DISABLE_SERVER_SIDE_CURSORS',
            'ASGI_THREADS',
            'PGBOUNCER_MAX_CLIENT_CONN',
            'PGBOUNCER_DEFAULT_POOL_SIZE',
            'PGBOUNCER_RESERVE_POOL_SIZE',
        ),
    ),
    (
        'Bootstrap facility/admin',
        (
            'DEFAULT_FACILITY_CODE',
            'DEFAULT_FACILITY_NAME',
            'DEFAULT_FACILITY_TYPE',
            'DEFAULT_FACILITY_ADDRESS',
            'DEFAULT_FACILITY_CITY',
            'DEFAULT_FACILITY_REGION',
            'DEFAULT_FACILITY_COUNTRY',
            'DEFAULT_FACILITY_PHONE',
            'DEFAULT_FACILITY_EMAIL',
            'ADMIN_EMAIL',
            'ADMIN_PASSWORD',
            'ADMIN_FIRST_NAME',
            'ADMIN_LAST_NAME',
        ),
    ),
    (
        'Product profile and cost controls',
        (
            'DEPLOYMENT_PROFILE',
            'FEATURE_FLAG_OVERRIDES',
            'AI_ENABLED',
            'CELERY_WORKER_CONCURRENCY',
            'CELERY_WORKER_PREFETCH_MULTIPLIER',
            'CELERY_OPERABILITY_REFRESH_INTERVAL_SECONDS',
            'CELERY_OPERABILITY_INSPECT_TIMEOUT_SECONDS',
            'CELERY_OPERABILITY_REDIS_TIMEOUT_SECONDS',
            'ADMIN_DASHBOARD_PREWARM_INTERVAL_SECONDS',
            'MULTI_FACILITY_MODE',
        ),
    ),
    (
        'Security',
        (
            'SECURE_HSTS_SECONDS',
            'SECURE_HSTS_INCLUDE_SUBDOMAINS',
            'SECURE_HSTS_PRELOAD',
            'MFA_ENCRYPTION_KEY',
            'RECORD_EXPORT_FERNET_KEY',
            'SESSION_HASH_SALT',
            'WEBAUTHN_RP_ID',
            'WEBAUTHN_ALLOWED_ORIGINS',
            'MFA_TOTP_ISSUER',
        ),
    ),
    (
        'Email',
        (
            'EMAIL_PROVIDER',
            'UNOSEND_API_KEY',
            'RESEND_API_KEY',
            'DEFAULT_FROM_EMAIL',
            'EMAIL_SENDER_DOMAIN',
            'EMAIL_WELCOME_LOCAL_PART',
            'EMAIL_SECURITY_LOCAL_PART',
            'WELCOME_FROM_EMAIL',
            'SECURITY_FROM_EMAIL',
        ),
    ),
    (
        'Google Healthcare API',
        (
            'GOOGLE_APPLICATION_CREDENTIALS',
            'GOOGLE_CLOUD_PROJECT',
            'GOOGLE_HEALTHCARE_DATASET',
            'GOOGLE_FHIR_STORE',
            'GOOGLE_DICOM_STORE',
            'GOOGLE_HL7V2_STORE',
        ),
    ),
    (
        'Backups',
        (
            'BACKUP_RETENTION_DAYS',
            'RESTIC_REPOSITORY',
            'RESTIC_PASSWORD',
            'AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY',
        ),
    ),
)


def render_env(values: dict[str, str]) -> str:
    lines = [
        '# Generated by ops/create-client-deployment.py.',
        '# Keep this file private. It contains secrets and bootstrap credentials.',
        '',
    ]
    for section, keys in ENV_SECTIONS:
        lines.append(f'# {section}')
        for key in keys:
            lines.append(env_line(key, values.get(key, '')))
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Generate a private .env file for a one-client Hetzner VPS.'
    )
    parser.add_argument('--slug', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--mode', choices=('demo', 'production'), default='demo')
    parser.add_argument('--domain')
    parser.add_argument('--facility-code')
    parser.add_argument('--compose-project')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--from-env', type=Path)
    parser.add_argument('--feature-override', action='append', default=[])
    parser.add_argument('--acme-email', default=DEFAULT_ACME_EMAIL)
    parser.add_argument('--admin-email')
    parser.add_argument('--force', action='store_true')
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        slug = validate_slug(args.slug)
        profile = validate_profile(args.profile)
        domain = validate_domain(args.domain or f'{slug}.{DEFAULT_PARENT_DOMAIN}')
        facility_code = validate_facility_code(args.facility_code or derive_facility_code(slug))
        feature_overrides = parse_feature_overrides(args.feature_override)
        output = args.output.expanduser()
        if not output.is_absolute():
            output = REPO_ROOT / output
        if output.exists() and not args.force:
            raise ValueError(f'output already exists: {output}; pass --force to overwrite')

        from_env_values = parse_env_file(args.from_env.expanduser()) if args.from_env else {}
        compose_project = args.compose_project or f'hms-{slug}'
        admin_email = args.admin_email or f'admin@{domain}'
        values = generated_values(
            slug=slug,
            name=args.name.strip(),
            profile=profile,
            mode=args.mode,
            domain=domain,
            facility_code=facility_code,
            compose_project=compose_project,
            acme_email=args.acme_email.strip(),
            admin_email=admin_email.strip(),
            feature_overrides=feature_overrides,
            from_env_values=from_env_values,
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(render_env(values), encoding='utf-8')
        output.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except ValueError as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2

    print('')
    print('Client deployment environment generated:')
    print(f'  Output: {output}')
    print(f'  Client: {values["CLIENT_NAME"]} ({values["CLIENT_SLUG"]})')
    print(f'  Domain: https://{values["CLIENT_DOMAIN"]}')
    print(f'  Mode/profile: {values["DEPLOYMENT_MODE"]} / {values["DEPLOYMENT_PROFILE"]}')
    print(f'  Compose project: {values["COMPOSE_PROJECT_NAME"]}')
    print('')
    print('Initial admin login:')
    print(f'  Email: {values["ADMIN_EMAIL"]}')
    print(f'  Password: {values["ADMIN_PASSWORD"]}')
    print('')
    print('Save this password now. It will not be shown again.')

    if values['DEPLOYMENT_MODE'] == 'production':
        placeholders = [
            key
            for key in ('RESTIC_REPOSITORY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')
            if values[key].startswith('CHANGE_ME')
        ]
        if placeholders:
            print('')
            print(
                'Production backup setup is incomplete until these values are replaced '
                f'and restic snapshots succeeds: {", ".join(placeholders)}'
            )

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
