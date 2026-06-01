from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = REPO_ROOT / 'ops' / 'compose-v2' / 'deploy.sh'
COMPOSE_FILE = REPO_ROOT / 'ops' / 'compose-v2' / 'compose.yml'
ENV_EXAMPLE = REPO_ROOT / 'ops' / 'compose-v2' / 'env.example'
GCP_DEPLOY_SCRIPT = REPO_ROOT / 'ops' / 'gcp-staging' / 'deploy.sh'
GCP_EDGE_VERIFY_SCRIPT = REPO_ROOT / 'ops' / 'gcp-staging' / 'verify-edge.sh'
CLOUDSQL_OVERRIDE = REPO_ROOT / 'ops' / 'gcp-staging' / 'compose.cloudsql.yml'
GCP_CADDYFILE = REPO_ROOT / 'ops' / 'gcp-staging' / 'Caddyfile'
LEGACY_DEPLOY_SHIM = REPO_ROOT / 'ops' / 'hetzner-v2' / 'deploy.sh'
LEGACY_GCP_DEPLOY_SHIM = REPO_ROOT / 'ops' / 'gcp-staging' / 'deploy-cloudsql-staging.sh'
DUMMY_CLOUDSQL_URL = 'postgres://hms:secret@10.216.13.2:5432/hms'


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding='utf-8')
    path.chmod(0o755)


def test_v2_deploy_script_help_documents_external_database_mode():
    result = subprocess.run(
        [str(DEPLOY_SCRIPT), '--help'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert 'DATABASE_MODE        compose-postgres|external-postgres' in result.stdout
    assert 'COMPOSE_FILES        Space-separated Compose files' in result.stdout
    assert 'EXTERNAL_DB_BACKUP_CONFIRMED' in result.stdout
    assert 'EXTERNAL_DB_BACKUP_TARGET_HOST' in result.stdout
    assert 'DB_CONNECTIVITY_CHECK' in result.stdout


def test_v2_deploy_script_shell_syntax_is_valid():
    result = subprocess.run(
        ['sh', '-n', str(DEPLOY_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_gcp_cloudsql_wrapper_shell_syntax_is_valid():
    for script in [GCP_DEPLOY_SCRIPT, GCP_EDGE_VERIFY_SCRIPT, LEGACY_DEPLOY_SHIM, LEGACY_GCP_DEPLOY_SHIM]:
        result = subprocess.run(
            ['sh', '-n', str(script)],
            check=False,
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, result.stderr


def test_v2_deploy_has_external_postgres_guardrails():
    script = DEPLOY_SCRIPT.read_text(encoding='utf-8')

    assert 'DATABASE_MODE="${DATABASE_MODE:-compose-postgres}"' in script
    assert 'reject_external_database_host' in script
    assert 'Using external Postgres from HMS_DATABASE_URL; local db/pgbouncer are not started.' in script
    assert 'compose up -d db redis pgbouncer' in script
    assert 'compose up -d redis' in script
    assert 'EXTERNAL_DB_BACKUP_CONFIRMED=true' in script
    assert 'EXTERNAL_DB_BACKUP_TARGET_HOST is required' in script
    assert 'stop_stale_local_database_services' in script
    assert 'validate_external_postgres_compose_contract' in script
    assert 'compose run --rm hms-migrator hms-migrator check-db' in script


def test_gcp_cloudsql_override_requires_external_database_url():
    override = CLOUDSQL_OVERRIDE.read_text(encoding='utf-8')

    assert '../gcp-staging/Caddyfile:/etc/caddy/Caddyfile:ro' in override
    assert '"80:80"' in override
    assert '"443:443"' not in override
    assert 'monitoring-disabled' in override
    assert 'HMS_DATABASE_URL: ${HMS_DATABASE_URL:?set HMS_DATABASE_URL to the Cloud SQL private IP URL in the private env}' in override
    assert 'depends_on: !reset []' in override
    assert 'networks: !override' in override
    assert '- edge' in override
    assert 'local-postgres-disabled' in override


def test_gcp_caddyfile_is_http_backend_for_gcp_https_load_balancer():
    caddyfile = GCP_CADDYFILE.read_text(encoding='utf-8')
    lines = [line.strip() for line in caddyfile.splitlines()]

    assert 'http://{$CLIENT_DOMAIN}' in caddyfile
    assert '{$CLIENT_DOMAIN} {' not in lines
    assert 'reverse_proxy @api hms-api:8080' in caddyfile
    assert 'reverse_proxy frontend:80' in caddyfile
    assert '/api/v2/metrics' in caddyfile
    assert 'respond @publicMetrics 404' in caddyfile


@pytest.mark.skipif(shutil.which('docker') is None, reason='docker is not installed')
def test_gcp_cloudsql_compose_contract_disables_local_postgres_and_gives_migrator_egress():
    env = os.environ.copy()
    env['HMS_DATABASE_URL'] = DUMMY_CLOUDSQL_URL

    services = subprocess.run(
        [
            'docker',
            'compose',
            '--env-file',
            str(ENV_EXAMPLE),
            '-f',
            str(COMPOSE_FILE),
            '-f',
            str(CLOUDSQL_OVERRIDE),
            'config',
            '--services',
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    ).stdout.splitlines()

    assert 'db' not in services
    assert 'pgbouncer' not in services
    assert 'prometheus' not in services
    assert 'grafana' not in services
    assert {'hms-api', 'hms-worker', 'hms-migrator'}.issubset(services)

    config = subprocess.run(
        [
            'docker',
            'compose',
            '--env-file',
            str(ENV_EXAMPLE),
            '-f',
            str(COMPOSE_FILE),
            '-f',
            str(CLOUDSQL_OVERRIDE),
            'config',
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    ).stdout
    caddy_block = config.split('  caddy:', 1)[1].split('\n  frontend:', 1)[0]
    migrator_block = config.split('  hms-migrator:', 1)[1].split('\n  hms-worker:', 1)[0]

    assert 'target: 80' in caddy_block
    assert 'target: 443' not in caddy_block
    assert 'ops/gcp-staging/Caddyfile' in caddy_block
    assert f'HMS_DATABASE_URL: {DUMMY_CLOUDSQL_URL}' in migrator_block
    assert 'edge: null' in migrator_block
    assert 'internal: null' in migrator_block


def test_external_postgres_preflight_blocks_migrator_without_edge_network(tmp_path):
    env_file = tmp_path / 'deploy.env'
    env_file.write_text(
        '\n'.join(
            [
                'CLIENT_DOMAIN=staging.example.test',
                'CLIENT_SLUG=staging',
                'HMS_ENV=staging',
                f'HMS_DATABASE_URL={DUMMY_CLOUDSQL_URL}',
            ]
        ),
        encoding='utf-8',
    )
    base_compose = tmp_path / 'compose.yml'
    override_compose = tmp_path / 'compose.cloudsql.yml'
    base_compose.write_text('services: {}\n', encoding='utf-8')
    override_compose.write_text('services: {}\n', encoding='utf-8')

    fake_config = tmp_path / 'bad-config.yml'
    fake_config.write_text(
        f'''
services:
  hms-api:
    environment:
      HMS_DATABASE_URL: {DUMMY_CLOUDSQL_URL}
    networks:
      edge: null
  hms-migrator:
    environment:
      HMS_DATABASE_URL: {DUMMY_CLOUDSQL_URL}
    networks:
      internal: null
  hms-worker:
    environment:
      HMS_DATABASE_URL: {DUMMY_CLOUDSQL_URL}
    networks:
      edge: null
  redis:
    image: redis:7-alpine
networks:
  edge:
    driver: bridge
  internal:
    driver: bridge
    internal: true
''',
        encoding='utf-8',
    )

    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    _write_executable(
        bin_dir / 'docker',
        '''#!/usr/bin/env sh
set -eu
if [ "$1" != "compose" ]; then
  echo "unexpected docker command: $*" >&2
  exit 99
fi
case "$*" in
  *"config --services"*)
    printf '%s\\n' hms-api hms-migrator hms-worker redis
    ;;
  *"config"*)
    cat "$FAKE_COMPOSE_CONFIG"
    ;;
  *)
    echo "preflight should have stopped before: $*" >&2
    exit 98
    ;;
esac
''',
    )
    _write_executable(bin_dir / 'git', '#!/usr/bin/env sh\nexit 0\n')
    _write_executable(bin_dir / 'curl', '#!/usr/bin/env sh\nexit 0\n')

    env = os.environ.copy()
    env.update(
        {
            'PATH': f'{bin_dir}{os.pathsep}{env["PATH"]}',
            'ENV_FILE': str(env_file),
            'COMPOSE_FILES': f'{base_compose} {override_compose}',
            'DATABASE_MODE': 'external-postgres',
            'FAKE_COMPOSE_CONFIG': str(fake_config),
            'HMS_BUILD_SHA': 'testsha123456',
        }
    )

    result = subprocess.run(
        [str(DEPLOY_SCRIPT), '--skip-pull', '--skip-healthcheck'],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert 'requires hms-migrator on the edge network' in result.stderr
    assert 'preflight should have stopped before' not in result.stderr


def test_external_postgres_preflight_rejects_no_port_local_database_host(tmp_path):
    env_file = tmp_path / 'deploy.env'
    env_file.write_text(
        '\n'.join(
            [
                'CLIENT_DOMAIN=staging.example.test',
                'CLIENT_SLUG=staging',
                'HMS_ENV=staging',
                'HMS_DATABASE_URL=postgres://hms:secret@db/hms',
            ]
        ),
        encoding='utf-8',
    )
    base_compose = tmp_path / 'compose.yml'
    override_compose = tmp_path / 'compose.cloudsql.yml'
    base_compose.write_text('services: {}\n', encoding='utf-8')
    override_compose.write_text('services: {}\n', encoding='utf-8')

    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    _write_executable(
        bin_dir / 'docker',
        '''#!/usr/bin/env sh
set -eu
echo "docker should not run after local DB host validation: $*" >&2
exit 98
''',
    )
    _write_executable(bin_dir / 'curl', '#!/usr/bin/env sh\nexit 0\n')

    env = os.environ.copy()
    env.update(
        {
            'PATH': f'{bin_dir}{os.pathsep}{env["PATH"]}',
            'ENV_FILE': str(env_file),
            'COMPOSE_FILES': f'{base_compose} {override_compose}',
            'DATABASE_MODE': 'external-postgres',
            'HMS_BUILD_SHA': 'testsha123456',
        }
    )

    result = subprocess.run(
        [str(DEPLOY_SCRIPT), '--skip-pull', '--skip-healthcheck'],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert 'cannot point HMS_DATABASE_URL at local/Docker database host "db"' in result.stderr
    assert 'docker should not run' not in result.stderr


def test_gcp_wrapper_rejects_ambient_database_url_mismatch(tmp_path):
    env_file = tmp_path / 'gcp.env'
    env_file.write_text(
        '\n'.join(
            [
                'CLIENT_DOMAIN=staging.example.test',
                'CLIENT_SLUG=staging',
                'HMS_ENV=staging',
                f'HMS_DATABASE_URL={DUMMY_CLOUDSQL_URL}',
            ]
        ),
        encoding='utf-8',
    )

    env = os.environ.copy()
    env.update(
        {
            'ENV_FILE': str(env_file),
            'HMS_DATABASE_URL': 'postgres://hms:secret@10.216.13.99:5432/hms',
        }
    )

    result = subprocess.run(
        [str(GCP_DEPLOY_SCRIPT), '--skip-pull'],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert 'shell HMS_DATABASE_URL differs' in result.stderr


def test_gcp_wrapper_rejects_compose_postgres_mode(tmp_path):
    env_file = tmp_path / 'gcp.env'
    env_file.write_text(
        '\n'.join(
            [
                'CLIENT_DOMAIN=staging.example.test',
                'CLIENT_SLUG=staging',
                'HMS_ENV=staging',
                f'HMS_DATABASE_URL={DUMMY_CLOUDSQL_URL}',
            ]
        ),
        encoding='utf-8',
    )

    env = os.environ.copy()
    env.update({'ENV_FILE': str(env_file), 'DATABASE_MODE': 'compose-postgres'})

    result = subprocess.run(
        [str(GCP_DEPLOY_SCRIPT), '--skip-pull'],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert 'requires DATABASE_MODE=external-postgres' in result.stderr


def test_gcp_wrapper_requires_public_edge_health_by_default():
    wrapper = GCP_DEPLOY_SCRIPT.read_text(encoding='utf-8')

    assert 'PUBLIC_HEALTHCHECK_MODE="${PUBLIC_HEALTHCHECK_MODE:-required}"' in wrapper
    assert 'GCP_EDGE_VERIFY' in wrapper
    assert 'ops/gcp-staging/verify-edge.sh' in wrapper
