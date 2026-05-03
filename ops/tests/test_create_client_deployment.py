from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / 'ops' / 'create-client-deployment.py'
SPEC = importlib.util.spec_from_file_location('create_client_deployment', SCRIPT_PATH)
create_client_deployment = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(create_client_deployment)


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key] = value
    return values


def generate_env(tmp_path: Path, *args: str):
    output = tmp_path / 'client.env'
    code = create_client_deployment.main(
        [
            '--slug',
            'acme',
            '--name',
            'Acme Clinic',
            '--profile',
            'clinic',
            '--mode',
            'demo',
            '--domain',
            'acme.thehms.systems',
            '--facility-code',
            'ACME',
            '--output',
            str(output),
            '--force',
            *args,
        ]
    )
    assert code == 0
    return output, read_env(output)


@pytest.mark.parametrize(
    ('profile', 'expected_multi_facility'),
    (
        ('clinic', 'false'),
        ('hospital', 'false'),
        ('hospital_network', 'true'),
    ),
)
def test_generates_valid_profile_env_files(tmp_path, profile, expected_multi_facility):
    output = tmp_path / f'{profile}.env'

    code = create_client_deployment.main(
        [
            '--slug',
            'acme',
            '--name',
            'Acme Clinic',
            '--profile',
            profile,
            '--mode',
            'production',
            '--domain',
            'acme.thehms.systems',
            '--facility-code',
            'ACME',
            '--output',
            str(output),
        ]
    )

    assert code == 0
    values = read_env(output)
    assert values['DEPLOYMENT_PROFILE'] == profile
    assert values['CLIENT_DOMAIN'] == 'acme.thehms.systems'
    assert values['MULTI_FACILITY_MODE'] == expected_multi_facility
    assert values['EMAIL_PROVIDER'] == 'unosend'
    assert values['UNOSEND_API_KEY'] == 'CHANGE_ME_unosend_api_key'
    assert values['RESEND_API_KEY'] == ''
    assert values['EMAIL_SENDER_DOMAIN'] == 'acme.thehms.systems'
    assert values['EMAIL_WELCOME_LOCAL_PART'] == 'welcome'
    assert values['EMAIL_SECURITY_LOCAL_PART'] == 'security'
    assert values['BACKUP_RETENTION_DAYS'] == '30'
    assert values['RESTIC_REPOSITORY'].startswith('CHANGE_ME')
    assert values['DB_CONN_MAX_AGE'] == '0'
    assert values['DB_DISABLE_SERVER_SIDE_CURSORS'] == 'True'
    assert values['ASGI_THREADS'] == '4'
    assert values['PGBOUNCER_DEFAULT_POOL_SIZE'] == '15'


def test_preserves_security_values_from_existing_env(tmp_path):
    old_env = tmp_path / 'old.env'
    old_env.write_text(
        '\n'.join(
            [
                'SECRET_KEY=old-secret',
                'DB_PASSWORD=old-db-password',
                'MFA_ENCRYPTION_KEY=old-mfa-key',
                'RECORD_EXPORT_FERNET_KEY=old-export-key',
                'SESSION_HASH_SALT=old-session-salt',
                'ADMIN_PASSWORD=old-admin-password',
                'EMAIL_PROVIDER=resend',
                'UNOSEND_API_KEY=old-unosend-key',
                'RESEND_API_KEY=old-resend-key',
                'EMAIL_SENDER_DOMAIN=emailing.acme.thehms.systems',
                'EMAIL_WELCOME_LOCAL_PART=hello',
                'EMAIL_SECURITY_LOCAL_PART=accounts',
                'WELCOME_FROM_EMAIL=hello@emailing.acme.thehms.systems',
                'SECURITY_FROM_EMAIL=accounts@emailing.acme.thehms.systems',
            ]
        ),
        encoding='utf-8',
    )

    output, values = generate_env(
        tmp_path,
        '--profile',
        'hospital',
        '--compose-project',
        'hms-cx23-staging',
        '--from-env',
        str(old_env),
    )

    assert output.stat().st_mode & 0o777 == 0o600
    assert values['COMPOSE_PROJECT_NAME'] == 'hms-cx23-staging'
    assert values['SECRET_KEY'] == 'old-secret'
    assert values['DB_PASSWORD'] == 'old-db-password'
    assert values['MFA_ENCRYPTION_KEY'] == 'old-mfa-key'
    assert values['RECORD_EXPORT_FERNET_KEY'] == 'old-export-key'
    assert values['SESSION_HASH_SALT'] == 'old-session-salt'
    assert values['ADMIN_PASSWORD'] == 'old-admin-password'
    assert values['EMAIL_PROVIDER'] == 'resend'
    assert values['UNOSEND_API_KEY'] == 'old-unosend-key'
    assert values['RESEND_API_KEY'] == 'old-resend-key'
    assert values['EMAIL_SENDER_DOMAIN'] == 'emailing.acme.thehms.systems'
    assert values['EMAIL_WELCOME_LOCAL_PART'] == 'hello'
    assert values['EMAIL_SECURITY_LOCAL_PART'] == 'accounts'
    assert values['WELCOME_FROM_EMAIL'] == 'hello@emailing.acme.thehms.systems'
    assert values['SECURITY_FROM_EMAIL'] == 'accounts@emailing.acme.thehms.systems'


@pytest.mark.parametrize(
    'args',
    (
        ['--slug', 'BadSlug'],
        ['--profile', 'nursing-home'],
        ['--domain', 'bad_domain'],
        ['--facility-code', 'bad code'],
    ),
)
def test_rejects_invalid_inputs(tmp_path, args):
    output = tmp_path / 'invalid.env'
    argv = [
        '--slug',
        'acme',
        '--name',
        'Acme Clinic',
        '--profile',
        'clinic',
        '--mode',
        'demo',
        '--domain',
        'acme.thehms.systems',
        '--facility-code',
        'ACME',
        '--output',
        str(output),
    ]
    for index in range(0, len(args), 2):
        flag = args[index]
        value = args[index + 1]
        existing_index = argv.index(flag)
        argv[existing_index + 1] = value

    assert create_client_deployment.main(argv) == 2
    assert not output.exists()


def test_rejects_overwrite_without_force(tmp_path):
    output, _ = generate_env(tmp_path)

    code = create_client_deployment.main(
        [
            '--slug',
            'acme',
            '--name',
            'Acme Clinic',
            '--profile',
            'clinic',
            '--mode',
            'demo',
            '--domain',
            'acme.thehms.systems',
            '--facility-code',
            'ACME',
            '--output',
            str(output),
        ]
    )

    assert code == 2


def test_emits_feature_overrides(tmp_path):
    _, values = generate_env(
        tmp_path,
        '--feature-override',
        'laboratory=false',
        '--feature-override',
        'pharmacy=true',
    )

    assert values['FEATURE_FLAG_OVERRIDES'] == '{"laboratory":false,"pharmacy":true}'


def test_rejects_unknown_feature_override(tmp_path):
    output = tmp_path / 'bad-feature.env'

    code = create_client_deployment.main(
        [
            '--slug',
            'acme',
            '--name',
            'Acme Clinic',
            '--profile',
            'clinic',
            '--mode',
            'demo',
            '--domain',
            'acme.thehms.systems',
            '--facility-code',
            'ACME',
            '--feature-override',
            'unknown=false',
            '--output',
            str(output),
        ]
    )

    assert code == 2
    assert not output.exists()
