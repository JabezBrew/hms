from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = REPO_ROOT / 'ops' / 'hetzner-v2' / 'deploy.sh'
GCP_DEPLOY_SCRIPT = REPO_ROOT / 'ops' / 'gcp-staging' / 'deploy-cloudsql-staging.sh'
CLOUDSQL_OVERRIDE = REPO_ROOT / 'ops' / 'gcp-staging' / 'cloudsql.compose.override.yml'


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


def test_v2_deploy_script_shell_syntax_is_valid():
    result = subprocess.run(
        ['sh', '-n', str(DEPLOY_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_gcp_cloudsql_wrapper_shell_syntax_is_valid():
    result = subprocess.run(
        ['sh', '-n', str(GCP_DEPLOY_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_v2_deploy_has_external_postgres_guardrails():
    script = DEPLOY_SCRIPT.read_text(encoding='utf-8')

    assert 'DATABASE_MODE="${DATABASE_MODE:-compose-postgres}"' in script
    assert 'DATABASE_MODE=external-postgres cannot point HMS_DATABASE_URL at Compose db or pgbouncer' in script
    assert 'Using external Postgres from HMS_DATABASE_URL; local db/pgbouncer are not started.' in script
    assert 'compose up -d db redis pgbouncer' in script
    assert 'compose up -d redis' in script
    assert 'EXTERNAL_DB_BACKUP_CONFIRMED=true' in script


def test_gcp_cloudsql_override_requires_external_database_url():
    override = CLOUDSQL_OVERRIDE.read_text(encoding='utf-8')

    assert 'HMS_DATABASE_URL: ${HMS_DATABASE_URL:?set HMS_DATABASE_URL to the Cloud SQL private IP URL in the private env}' in override
    assert 'depends_on: !reset []' in override
    assert 'local-postgres-disabled' in override
