from __future__ import annotations

import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

import pytest

from deployment_fixtures import copy_lease_helper
from test_schema_compatibility_deploy import REPO, calls, deploy, environment, executable, install, install_fixture, release


def wait_for(path: Path, process: subprocess.Popen) -> None:
    until = time.monotonic() + 5
    while not path.exists():
        assert process.poll() is None, 'lease holder must reach its actual barrier'
        assert time.monotonic() < until, 'bounded fixture barrier'
        time.sleep(0.01)


def holder(tmp: Path):
    helper = copy_lease_helper(tmp / 'holder', tmp / '.hms-deploy-state/deploy.lock')
    ready, finish = tmp / 'ready', tmp / 'finish'
    script = tmp / 'hold.py'
    script.write_text('''import pathlib, sys, time
ready, finish = map(pathlib.Path, sys.argv[1:])
ready.write_text('ready')
until = time.monotonic() + 12
while not finish.exists():
    if time.monotonic() > until: raise SystemExit(2)
    time.sleep(.01)
''')
    process = subprocess.Popen([sys.executable, str(helper), '--', sys.executable, str(script), str(ready), str(finish)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    wait_for(ready, process)
    return helper, process, finish


def probe(helper: Path, *command: str, env=None, pass_fds=()):
    return subprocess.run([sys.executable, str(helper), '--', *command], env=env,
                          pass_fds=pass_fds, capture_output=True, text=True, timeout=10)


def test_actual_kernel_lease_rejects_parallel_and_forged_environment_then_releases(tmp_path):
    helper, process, finish = holder(tmp_path)
    try:
        marker = tmp_path / 'forbidden'
        env = os.environ.copy()
        env['HMS_DEPLOY_LEASE_FD'] = '198'
        blocked = probe(helper, sys.executable, '-c', f'open({str(marker)!r},"w").close()', env=env)
        assert blocked.returncode == 75
        assert not marker.exists()
        # A real but unrelated inherited descriptor is also not a lease.
        with (tmp_path / 'unrelated').open('w') as other:
            env['HMS_DEPLOY_LEASE_FD'] = str(other.fileno())
            assert probe(helper, sys.executable, '-c', 'pass', env=env, pass_fds=(other.fileno(),)).returncode == 75
    finally:
        finish.touch()
        assert process.wait(timeout=5) == 0
    assert probe(helper, sys.executable, '-c', 'pass').returncode == 0
    assert (tmp_path / '.hms-deploy-state/deploy.lock').exists(), 'kernel lease never unlinks a persistent lock inode'


def test_nested_real_shell_entrypoints_retain_actual_same_file_lease(tmp_path):
    helper = copy_lease_helper(tmp_path / 'release', tmp_path / '.hms-deploy-state/deploy.lock')
    nested = tmp_path / 'nested.sh'
    nested.write_text(f'''#!/bin/sh
set -eu
python3 '{helper}' --check
python3 '{helper}' -- /bin/sh -c 'python3 "{helper}" --check'
''')
    assert probe(helper, '/bin/sh', str(nested)).returncode == 0


def test_legacy_lock_is_rejected_without_pid_inference_deletion_or_new_lease(tmp_path):
    helper = copy_lease_helper(tmp_path / 'release', tmp_path / '.hms-deploy-state/deploy.lock')
    legacy = tmp_path / 'legacy-deploy.lock'
    legacy.mkdir()
    (legacy / 'info').write_text('runner_pid=99999999\n')
    result = probe(helper, sys.executable, '-c', 'pass')
    assert result.returncode == 75
    assert 'operator review' in result.stderr
    assert (legacy / 'info').read_text() == 'runner_pid=99999999\n'
    assert not (tmp_path / '.hms-deploy-state').exists()


def test_actual_generated_remote_runner_acquires_new_lease_without_creating_legacy_lock(tmp_path):
    helper = copy_lease_helper(tmp_path / 'release', tmp_path / '.hms-deploy-state/deploy.lock')
    shutil.copy2(helper, tmp_path / 'deploy-lease.py')
    executable(tmp_path / 'install-archive.sh', '''#!/bin/sh
exec python3 ./deploy-lease.py -- /bin/sh -c 'python3 ./deploy-lease.py --check && touch started'
''')
    source = (REPO / 'ops/deploy.sh').read_text()
    start = source.index("  {\n    printf '#!/usr/bin/env sh\\n'")
    end = source.index('  } >"$runner"', start) + len('  } >"$runner"')
    env = os.environ.copy()
    env.update(runner=str(tmp_path / 'runner.sh'), remote_tmp=str(tmp_path),
               archive_name='fixture.tgz', sha='synthetic-build', GCP_REMOTE_ROOT='/opt/hms')
    generated = subprocess.run(['/bin/sh', '-c', source[start:end]], env=env, capture_output=True, text=True)
    assert generated.returncode == 0
    executed = subprocess.run(['/bin/sh', str(tmp_path / 'runner.sh')], capture_output=True, text=True, timeout=10)
    assert executed.returncode == 0, executed.stderr
    assert 'REMOTE_INSTALL_EXIT_STATUS=0' in executed.stdout
    assert (tmp_path / 'started').exists()
    assert not (tmp_path / 'legacy-deploy.lock').exists()


@pytest.mark.parametrize('entrypoint', ['compose', 'gcp', 'frontdoor', 'installer', 'free_testing', 'legacy_forwarder'])
def test_all_advertised_host_entrypoints_reject_a_concurrent_kernel_lease_before_mutation(tmp_path, entrypoint):
    live, archive, installer, env = install_fixture(tmp_path)
    for relative in ['ops/gcp-staging/deploy.sh', 'ops/free-testing/deploy.sh',
                     'ops/hetzner-v2/deploy.sh', 'ops/deploy.sh', 'deploy']:
        target = live / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / relative, target)
    env['ENV_FILE'] = str(live / 'ops/compose-v2/.env')
    if entrypoint == 'gcp':
        with Path(env['ENV_FILE']).open('a') as output:
            output.write('HMS_DATABASE_URL=postgres://synthetic:fixture@10.216.13.2/synthetic\n')
        env['DATABASE_MODE'] = 'external-postgres'
    if entrypoint == 'free_testing':
        # Preflight dependency only: its production no-write check is covered by
        # the existing free-testing suite. Execute the actual wrapper/lease here.
        (live / 'ops/free-testing/prepare-env.py').write_text('raise SystemExit(0)\n')
    commands = {
        'compose': [str(live / 'ops/compose-v2/deploy.sh'), '--skip-pull'],
        'gcp': [str(live / 'ops/gcp-staging/deploy.sh'), '--skip-pull'],
        'frontdoor': [str(live / 'deploy'), 'compose', '--in-place', '--skip-pull'],
        'installer': [str(installer), str(archive), 'synthetic-build', str(live)],
        'free_testing': [str(live / 'ops/free-testing/deploy.sh'), '--local-only'],
        'legacy_forwarder': [str(live / 'ops/hetzner-v2/deploy.sh'), '--skip-pull'],
    }
    _, process, finish = holder(tmp_path)
    try:
        result = subprocess.run(commands[entrypoint], env=env, capture_output=True, text=True, timeout=8)
        assert result.returncode == 75
        assert calls(tmp_path) == '', 'no container, migration or runtime mutation occurs while another deployment owns the lease'
        assert (live / 'identity.txt').read_text() == 'old'
        assert not list(tmp_path.glob('hms.pre-deploy-*'))
    finally:
        finish.touch()
        assert process.wait(timeout=5) == 0


@pytest.mark.parametrize('unsafe', ['file_symlink', 'directory_symlink', 'public_file', 'public_directory'])
def test_unsafe_shared_lease_paths_fail_closed_without_changing_them(tmp_path, unsafe):
    path = tmp_path / '.hms-deploy-state/deploy.lock'
    helper = copy_lease_helper(tmp_path / 'release', path)
    target = tmp_path / 'unrelated'
    target.write_text('preserve')
    if unsafe == 'directory_symlink':
        path.parent.symlink_to(tmp_path)
    else:
        path.parent.mkdir(mode=0o700)
        if unsafe == 'file_symlink': path.symlink_to(target)
        else:
            path.touch(mode=0o600)
            if unsafe == 'public_file': path.chmod(0o644)
            else: path.parent.chmod(0o755)
    assert probe(helper, sys.executable, '-c', 'pass').returncode == 75
    assert target.read_text() == 'preserve'


def test_killed_supervisor_cannot_unlock_a_still_running_deployment_child(tmp_path):
    helper, process, finish = holder(tmp_path)
    try:
        process.kill()
        assert process.wait(timeout=5) == -signal.SIGKILL
        assert probe(helper, sys.executable, '-c', 'pass').returncode == 75
    finally:
        finish.touch()
    # The child carries the same kernel file description; release requires its
    # actual exit, never a stale PID cleanup/reused PID decision.
    until = time.monotonic() + 5
    while probe(helper, sys.executable, '-c', 'pass').returncode != 0:
        assert time.monotonic() < until
        time.sleep(.01)


def test_competing_actual_compose_deploy_cannot_migrate_between_rollback_probe_and_restart(tmp_path):
    live, archive, installer, env = install_fixture(tmp_path)
    candidate = tmp_path / 'competitor'
    release(candidate)
    Path(env['DATABASE_EPOCH_FILE']).write_text('0')
    env['FAIL_STAGE'] = 'migrate'
    executable(live / 'deploy', '''#!/bin/sh
case "${1:-}" in --help) printf '%s\\n' '--skip-migrations'; exit 0 ;; esac
printf 'old-runtime-started epoch=' >> "$DOCKER_LOG"
cat "$DATABASE_EPOCH_FILE" >> "$DOCKER_LOG"
printf '\\n' >> "$DOCKER_LOG"
''')
    executable(tmp_path / 'bin/mv', f'''#!{sys.executable}
import os,pathlib,subprocess,sys
if any('hms.failed-deploy-' in arg for arg in sys.argv[1:]):
    env=os.environ.copy()
    env.pop('HMS_DEPLOY_LEASE_FD',None)
    env.pop('FAIL_STAGE',None)
    env.pop('HMS_DEPLOY_ATTEMPT_FILE',None)
    env.pop('HMS_SCHEMA_FENCE_FILE',None)
    env['ADVANCE_SCHEMA']='1'
    attempt=subprocess.run([{str(candidate / 'ops/compose-v2/deploy.sh')!r},'--skip-pull','--skip-healthcheck'],env=env,capture_output=True,timeout=8)
    pathlib.Path({str(tmp_path / 'competitor-status')!r}).write_text(str(attempt.returncode))
raise SystemExit(subprocess.run(['/bin/mv',*sys.argv[1:]]).returncode)
''')
    result = install(live, archive, installer, env)
    assert result.returncode != 0
    assert (tmp_path / 'competitor-status').read_text() == '75'
    assert 'old-runtime-started epoch=0' in calls(tmp_path)
    assert Path(env['DATABASE_EPOCH_FILE']).read_text() == '0'


def test_skip_migration_runtime_replacement_failure_uses_guarded_recovery_not_untouched_claim(tmp_path):
    live, archive, installer, env = install_fixture(tmp_path)
    env.update(SKIP_MIGRATIONS='true', HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED='true', PROBE_OUTPUT='202610170026')
    docker = tmp_path / 'bin/docker'
    source = docker.read_text()
    source = source.replace("if 'config' in a:", "if 'up' in a and 'hms-api' in a: sys.exit(17)\nif 'config' in a:")
    docker.write_text(source)
    result = install(live, archive, installer, env)
    assert result.returncode != 0
    assert 'up -d --no-deps hms-api hms-worker frontend' in calls(tmp_path)
    assert 'Pre-quiesce failure' not in result.stderr
    assert (live / 'identity.txt').read_text() == 'candidate'
    assert 'old-runtime-started' not in calls(tmp_path)
    assert [p.read_text().strip() for p in (tmp_path / '.hms-deploy-state').glob('attempt-*')] == ['quiescing']


@pytest.mark.parametrize('missing_migration', ['202610170023_treatment_course_windows.sql', '202610170024_referral_response_records.sql', '202610170025_admission_moves.sql', '202610170026_referral_consultation_starts.sql'])
def test_declared_new_runtime_with_missing_migration_cannot_drain_migrate_or_start(tmp_path, missing_migration):
    root = tmp_path / 'release'
    release(root)
    (root / 'backend-rs/migrations' / missing_migration).unlink()
    result = deploy(root, environment(tmp_path))
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'stop --timeout' not in log
    assert 'run --rm hms-migrator\n' not in log
    assert 'up -d --no-deps hms-api' not in log
