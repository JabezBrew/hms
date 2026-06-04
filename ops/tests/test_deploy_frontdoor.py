from __future__ import annotations

import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT_DEPLOY = REPO_ROOT / 'deploy'
OPS_DEPLOY = REPO_ROOT / 'ops' / 'deploy.sh'
INSTALL_ARCHIVE = REPO_ROOT / 'ops' / 'gcp-staging' / 'install-archive.sh'
DEPLOY_CMD = ['/bin/sh', str(ROOT_DEPLOY)]


def write_dirty_marker() -> Path:
    marker = REPO_ROOT / f'.deploy-ignore-dirty-test-{os.getpid()}'
    marker.write_text('dirty\n', encoding='utf-8')
    return marker


def test_deploy_frontdoor_shell_syntax_is_valid():
    for script in (ROOT_DEPLOY, OPS_DEPLOY, INSTALL_ARCHIVE):
        result = subprocess.run(
            ['sh', '-n', str(script)],
            check=False,
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, f'{script}: {result.stderr}'


def test_deploy_help_shows_short_happy_paths():
    result = subprocess.run(
        [*DEPLOY_CMD, '--help'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert './deploy [staging]' in result.stdout
    assert './deploy --in-place' in result.stdout
    assert './deploy verify' in result.stdout
    assert '--ignore-dirty' in result.stdout
    assert '--edge-verify=auto|required|skip' in result.stdout
    assert 'GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS' in result.stdout
    assert 'GCP_REMOTE_DEPLOY_MAX_ALIVE_TIMEOUTS' in result.stdout
    assert 'GCP_SSH_COMMAND_TIMEOUT_SECONDS' in result.stdout
    assert 'GCP_SSH_CONNECT_TIMEOUT_SECONDS' in result.stdout


def test_deploy_remote_dry_run_defaults_to_gcp_staging():
    result = subprocess.run(
        [*DEPLOY_CMD, 'staging', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert 'Target: gcp-staging' in result.stdout
    assert 'Mode: remote' in result.stdout
    assert 'Would archive committed SHA:' in result.stdout
    assert 'Would upload committed archive installer from' in result.stdout
    assert 'Would stream archive over SSH' in result.stdout
    assert 'Would verify remote archive byte count before install.' in result.stdout
    assert 'Would run detached remote installer' in result.stdout
    assert 'Would verify edge after remote deploy.' in result.stdout


def test_deploy_in_place_dry_run_sets_safe_gcp_defaults():
    result = subprocess.run(
        [*DEPLOY_CMD, '--in-place', '--dry-run'],
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
        [*DEPLOY_CMD, '--in-place'],
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
        [*DEPLOY_CMD, '--in-place'],
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
        [*DEPLOY_CMD, 'staging', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert 'Current staging deploy root is /opt/hms' in result.stderr


def test_deploy_remote_rejects_invalid_timing_env():
    env = os.environ.copy()
    env['GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS'] = '0'

    result = subprocess.run(
        [*DEPLOY_CMD, 'staging', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 2
    assert 'GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS must be greater than zero' in result.stderr


def test_deploy_remote_dry_run_refuses_dirty_checkout_by_default():
    marker = write_dirty_marker()
    try:
        result = subprocess.run(
            [*DEPLOY_CMD, 'staging', '--dry-run'],
            check=False,
            capture_output=True,
            text=True,
        )
    finally:
        if marker.exists():
            marker.unlink()

    assert result.returncode == 1
    assert 'Refusing remote deploy from a dirty checkout' in result.stderr
    assert 'Dirty checkout has' in result.stderr


def test_deploy_remote_refuses_dirty_checkout_by_default():
    marker = write_dirty_marker()
    try:
        result = subprocess.run(
            [*DEPLOY_CMD, 'staging'],
            check=False,
            capture_output=True,
            text=True,
        )
    finally:
        if marker.exists():
            marker.unlink()

    assert result.returncode == 1
    assert 'Refusing remote deploy from a dirty checkout' in result.stderr
    assert 'Dirty checkout has' in result.stderr


def test_deploy_remote_ignore_dirty_dry_run_prints_explicit_head_release():
    marker = write_dirty_marker()
    try:
        result = subprocess.run(
            [*DEPLOY_CMD, 'staging', '--ignore-dirty', '--dry-run'],
            check=False,
            capture_output=True,
            text=True,
        )
    finally:
        if marker.exists():
            marker.unlink()

    assert result.returncode == 0, result.stderr
    assert 'Dirty checkout detected. Would ignore local changes and deploy committed SHA' in result.stderr
    assert 'Dirty checkout has' in result.stderr
    assert 'Would archive committed SHA:' in result.stdout
    assert 'Would upload committed archive installer from' in result.stdout


def test_deploy_ignore_dirty_is_remote_only():
    result = subprocess.run(
        [*DEPLOY_CMD, '--in-place', '--ignore-dirty', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 2
    assert '--ignore-dirty only applies to remote GCP staging deploys.' in result.stderr


def test_deploy_frontdoor_preserves_safety_in_script_text():
    root_script = ROOT_DEPLOY.read_text(encoding='utf-8')
    script = OPS_DEPLOY.read_text(encoding='utf-8')
    installer = INSTALL_ARCHIVE.read_text(encoding='utf-8')

    assert 'exec /bin/sh "$ROOT_DIR/ops/deploy.sh" "$@"' in root_script
    assert 'git -C "$ROOT_DIR" status --porcelain --untracked-files=normal' in script
    assert 'print_dirty_status_summary' in script
    assert 'Full path list omitted from deploy logs' in script
    assert 'Refusing remote deploy from a dirty checkout' in script
    assert 'IGNORE_DIRTY="false"' in script
    assert '--ignore-dirty' in script
    assert 'Refusing --ignore-dirty because deploy control files have uncommitted changes.' in script
    assert 'deploy control files have uncommitted changes' in script
    assert 'Dirty checkout detected. Ignoring local changes and deploying committed SHA' in script
    assert 'Dirty checkout detected. Would ignore local changes and deploy committed SHA' in script
    assert 'rev-parse --verify \'HEAD^{commit}\'' in script
    assert 'GIT_ATTR_NOSYSTEM=1 git -C "$ROOT_DIR" -c core.attributesFile=/dev/null archive --format=tar "$commit"' in script
    assert 'git -C "$ROOT_DIR" show "$commit:ops/gcp-staging/install-archive.sh"' in script
    assert 'validate_migration_versions_at_commit "$commit"' in script
    assert 'local .git/info/attributes can change git archive output' in script
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
    assert 'gcloud compute scp' not in script
    assert 'run_command_with_timeout "$GCP_SSH_COMMAND_TIMEOUT_SECONDS"' in script
    assert 'Timed out after {timeout_seconds:g}s' in script
    assert '--ssh-flag="-o ConnectTimeout=$GCP_SSH_CONNECT_TIMEOUT_SECONDS"' in script
    assert '--ssh-flag="-o ServerAliveInterval=$GCP_SSH_ALIVE_INTERVAL_SECONDS"' in script
    assert 'cat > \'$remote_tmp/$archive_name\'' in script
    assert 'remote_archive_bytes' in script
    assert 'nohup sh ./run-install.sh' in script
    assert 'install.pid' in script
    assert 'REMOTE_INSTALL_EXIT_STATUS' in script
    assert 'REMOTE_INSTALL_PID_ALIVE' in script
    assert 'REMOTE_INSTALL_PID_DEAD' in script
    assert 'continuing to avoid an ambiguous deploy state' in script
    assert 'refusing to wait forever' in script
    assert 'late_status_line' in script
    assert 'polling pid/log in case it launched before SSH disconnected' in script
    assert 'hms-deploy.lock' in script
    assert 'stale_lock_dir' in script
    assert 'runner_pid=$$' in script
    assert 'Removing stale HMS deploy lock' in script
    assert 'require_positive_integer' in script
    assert 'GCP_EDGE_VERIFY=skip sh ./install-archive.sh' in script
    assert 'EXTERNAL_DB_BACKUP_CONFIRMED="true"' in installer
    assert 'restore_previous_tree' in installer
    assert 'Recreating runtime from restored tree' in installer
    assert './deploy --in-place --skip-pull --skip-healthcheck --assume-managed-backup' in installer
    assert './deploy --in-place --assume-managed-backup' in installer
    assert 'legacy GCP deploy wrapper' in installer
    assert 'ops/gcp-staging/deploy.sh --skip-pull --skip-healthcheck' in installer
    assert 'Refusing archive install into' in installer
    assert 'preserve_private_file ops/compose-v2/.env' in installer
    assert './deploy --in-place' in installer


def test_deploy_compose_dry_run_is_explicitly_in_place():
    result = subprocess.run(
        [*DEPLOY_CMD, 'compose', '--in-place', '--dry-run'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert 'Target: compose-v2' in result.stdout
    assert 'ops/compose-v2/deploy.sh' in result.stdout
