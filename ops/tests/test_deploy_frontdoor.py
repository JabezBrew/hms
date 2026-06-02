from __future__ import annotations

import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT_DEPLOY = REPO_ROOT / 'deploy'
OPS_DEPLOY = REPO_ROOT / 'ops' / 'deploy.sh'
INSTALL_ARCHIVE = REPO_ROOT / 'ops' / 'gcp-staging' / 'install-archive.sh'


def test_deploy_frontdoor_shell_syntax_is_valid():
    result = subprocess.run(
        ['sh', '-n', str(ROOT_DEPLOY), str(OPS_DEPLOY), str(INSTALL_ARCHIVE)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_deploy_help_shows_short_happy_paths():
    result = subprocess.run(
        [str(ROOT_DEPLOY), '--help'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert './deploy [staging]' in result.stdout
    assert './deploy --in-place' in result.stdout
    assert './deploy verify' in result.stdout
    assert '--edge-verify=auto|required|skip' in result.stdout
    assert 'GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS' in result.stdout


def test_deploy_remote_dry_run_defaults_to_gcp_staging():
    result = subprocess.run(
        [str(ROOT_DEPLOY), 'staging', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert 'Target: gcp-staging' in result.stdout
    assert 'Mode: remote' in result.stdout
    assert 'Would archive committed SHA:' in result.stdout
    assert 'Would verify edge after remote deploy.' in result.stdout


def test_deploy_in_place_dry_run_sets_safe_gcp_defaults():
    result = subprocess.run(
        [str(ROOT_DEPLOY), '--in-place', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert 'Target: gcp-staging' in result.stdout
    assert 'Mode: in-place' in result.stdout
    assert 'Would verify Cloud SQL backups/PITR' in result.stdout
    assert 'ops/gcp-staging/deploy.sh' in result.stdout


def test_deploy_in_place_refuses_to_run_from_laptop():
    result = subprocess.run(
        [str(ROOT_DEPLOY), '--in-place'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert 'only allowed from /opt/hms' in result.stderr
    assert 'use ./deploy staging' in result.stderr


def test_deploy_in_place_refuses_local_env_bypass():
    env = os.environ.copy()
    env['HMS_DEPLOY_ALLOW_LOCAL_IN_PLACE'] = 'true'

    result = subprocess.run(
        [str(ROOT_DEPLOY), '--in-place'],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert 'only allowed from /opt/hms' in result.stderr


def test_deploy_remote_rejects_noncanonical_gcp_root():
    env = os.environ.copy()
    env['GCP_REMOTE_ROOT'] = '/opt/hms; touch /tmp/bad'

    result = subprocess.run(
        [str(ROOT_DEPLOY), 'staging', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert 'Current staging deploy root is /opt/hms' in result.stderr


def test_deploy_frontdoor_preserves_safety_in_script_text():
    script = OPS_DEPLOY.read_text(encoding='utf-8')
    installer = INSTALL_ARCHIVE.read_text(encoding='utf-8')

    assert 'git -C "$ROOT_DIR" status --porcelain' in script
    assert 'Refusing remote deploy from a dirty checkout' in script
    assert 'git -C "$ROOT_DIR" archive --format=tar HEAD | gzip' in script
    assert 'ops/gcp-staging/verify-edge.sh' in script
    assert 'verify_cloudsql_backups' in script
    assert 'gcloud sql backups list' in script
    assert 'GCP_CLOUDSQL_HOST' in script
    assert 'GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS' in script
    assert 'pointInTimeRecoveryEnabled' in script
    assert 'settings.deletionProtectionEnabled' in script
    assert 'ipAddresses.type,ipAddresses.ipAddress' in script
    assert 'Using explicit EXTERNAL_DB_BACKUP_CONFIRMED=true' not in script
    assert 'HMS_DEPLOY_ALLOW_LOCAL_IN_PLACE' not in script
    assert "GCP_EDGE_VERIFY='skip'" in script
    assert 'EXTERNAL_DB_BACKUP_CONFIRMED="true"' in installer
    assert 'restore_previous_tree' in installer
    assert 'Recreating runtime from restored tree' in installer
    assert './deploy --in-place --skip-pull --skip-healthcheck' in installer
    assert 'Refusing archive install into' in installer
    assert 'preserve_private_file ops/compose-v2/.env' in installer
    assert './deploy --in-place' in installer


def test_deploy_compose_dry_run_is_explicitly_in_place():
    result = subprocess.run(
        [str(ROOT_DEPLOY), 'compose', '--in-place', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert 'Target: compose-v2' in result.stdout
    assert 'ops/compose-v2/deploy.sh' in result.stdout
