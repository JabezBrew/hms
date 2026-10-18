from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

import pytest
from deployment_fixtures import copy_lease_helper


REPO = Path(__file__).resolve().parents[2]
TREATMENT_EPOCH = '202610170023'
REFERRAL_EPOCH = '202610170024'
ADMISSION_EPOCH = '202610170025'
CONSULTATION_EPOCH = '202610170026'
OLD_EPOCH = '202610170027'
EPOCH = '202610170028'


def executable(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(0o755)


def release(root: Path, *, declared: bool = True) -> None:
    copy_lease_helper(root, root.parent / '.hms-deploy-state/deploy.lock')
    for relative in ['ops/compose-v2/deploy.sh', 'ops/schema-compatibility.sh']:
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / relative, target)
    (root / 'ops/compose-v2/compose.yml').write_text('services: {}\n')
    (root / 'ops/compose-v2/.env').write_text('CLIENT_DOMAIN=synthetic.example.invalid\nHMS_ENV=staging\n')
    migrations = root / 'backend-rs/migrations'
    migrations.mkdir(parents=True)
    (migrations / f'{TREATMENT_EPOCH}_treatment_course_windows.sql').write_text('-- fixture only\n')
    (migrations / f'{REFERRAL_EPOCH}_referral_response_records.sql').write_text('-- fixture only\n')
    (migrations / f'{ADMISSION_EPOCH}_admission_moves.sql').write_text('-- fixture only\n')
    (migrations / f'{CONSULTATION_EPOCH}_referral_consultation_starts.sql').write_text('-- fixture only\n')
    (migrations / f'{OLD_EPOCH}_organization_unit_lifecycle.sql').write_text('-- fixture only\n')
    (migrations / f'{EPOCH}_storage_location_lifecycle.sql').write_text('-- fixture only\n')
    if declared:
        (root / 'ops/compose-v2/runtime-schema-epoch').write_text(EPOCH + '\n')
    (root / 'identity.txt').write_text('candidate')
    executable(root / 'deploy', '#!/bin/sh\nexec ops/compose-v2/deploy.sh --skip-pull --skip-healthcheck\n')
    executable(root / 'ops/deploy.sh', '#!/bin/sh\nexit 0\n')
    executable(root / 'ops/gcp-staging/deploy.sh', '#!/bin/sh\nexit 0\n')
    executable(root / 'ops/gcp-staging/verify-edge.sh', '#!/bin/sh\nexit 0\n')


def environment(tmp: Path) -> dict[str, str]:
    binary = tmp / 'bin'
    binary.mkdir()
    executable(binary / 'docker', f'''#!{sys.executable}
import os, pathlib, sys
a = sys.argv[1:]
with open(os.environ['DOCKER_LOG'], 'a') as log:
    log.write(' '.join(a) + '\\n')
def fail(stage):
    if os.environ.get('FAIL_STAGE') == stage:
        sys.exit(17)
if a[0] == 'inspect':
    print('healthy'); sys.exit(0)
if a[0] == 'ps':
    if os.environ.get('ORPHAN') and (os.environ.get('ORPHAN_STILL_RUNNING') or not pathlib.Path(os.environ['DATABASE_EPOCH_FILE'] + '.stopped').exists()):
        print('abcdef123456')
    sys.exit(0)
if a[0] == 'stop':
    if os.environ.get('ORPHAN_STOP_FAIL'): sys.exit(19)
    pathlib.Path(os.environ['DATABASE_EPOCH_FILE'] + '.stopped').write_text('stopped')
    sys.exit(0)
if 'config' in a:
    print('name: synthetic-test\\nservices: {{}}'); sys.exit(0)
if 'build' in a:
    fail('build'); sys.exit(0)
if 'stop' in a:
    if os.environ.get('DELETE_INTENT'):
        pathlib.Path(os.environ['HMS_DEPLOY_ATTEMPT_FILE']).unlink(missing_ok=True)
    if os.environ.get('CORRUPT_INTENT'):
        pathlib.Path(os.environ['HMS_DEPLOY_ATTEMPT_FILE']).write_text('unknown-stage')
    fail('stop'); sys.exit(0)
if 'ps' in a:
    if '--status' in a:
        if os.environ.get('UNDRAINED'): print('synthetic-running-writer')
    else: print('synthetic-container')
    sys.exit(0)
if 'check-db' in a:
    fail('check_db'); sys.exit(0)
if 'schema-compatibility' in a:
    state = pathlib.Path(os.environ['DATABASE_EPOCH_FILE'])
    after = state.exists()
    if after and os.environ.get('ROLLBACK_PROBE_FAIL'): sys.exit(18)
    print(os.environ.get('ROLLBACK_PROBE_OUTPUT', state.read_text().strip()) if after else os.environ.get('PROBE_OUTPUT', '0'))
    fail('probe'); sys.exit(0)
if 'run' in a:
    if os.environ.get('ADVANCE_SCHEMA'):
        pathlib.Path(os.environ['DATABASE_EPOCH_FILE']).write_text('{EPOCH}')
    fail('migrate'); sys.exit(0)
sys.exit(0)
''')
    executable(binary / 'curl', '#!/bin/sh\nexit 0\n')
    executable(binary / 'git', '#!/bin/sh\nprintf synthetic-build\\n\n')
    env = os.environ.copy()
    for key in ['ENV_FILE', 'COMPOSE_FILE', 'COMPOSE_FILES', 'HMS_DATABASE_URL', 'SKIP_MIGRATIONS',
                'HMS_SCHEMA_FENCE_FILE', 'HMS_DEPLOY_ATTEMPT_FILE', 'HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED']:
        env.pop(key, None)
    env.update(PATH=str(binary) + os.pathsep + env['PATH'], DATABASE_MODE='compose-postgres',
               HMS_BUILD_SHA='synthetic-build', PUBLIC_HEALTHCHECK_MODE='skip',
               DOCKER_LOG=str(tmp / 'docker.log'), DATABASE_EPOCH_FILE=str(tmp / 'database-epoch'))
    return env


def calls(tmp: Path) -> str:
    log = tmp / 'docker.log'
    return log.read_text() if log.exists() else ''


def deploy(root: Path, env: dict[str, str], *options: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([str(root / 'ops/compose-v2/deploy.sh'), '--skip-pull', '--skip-healthcheck', *options],
                          env=env, text=True, capture_output=True, timeout=15)


def test_deploy_builds_and_checks_before_durable_intent_drain_and_migration(tmp_path):
    root = tmp_path / 'release'
    release(root)
    env = environment(tmp_path)
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode == 0, result.stderr
    log = calls(tmp_path)
    assert log.index('build hms-api frontend') < log.index('hms-migrator check-db') < log.index('hms-migrator schema-compatibility')
    assert log.index('stop --timeout 60 hms-api hms-worker') < log.index('ps --status running -q hms-api hms-worker')
    assert log.index('ps --status running -q hms-api hms-worker') < log.index('run --rm hms-migrator\n') < log.index('up -d --no-deps hms-api')
    assert (root / '.hms-deploy-attempt.local').read_text() == 'quiescing\n'
    fence = root / '.hms-schema-compatibility.local'
    assert fence.read_text() == EPOCH + '\n'
    assert fence.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('stage', ['build', 'check_db', 'probe'])
def test_prequiesce_failure_never_stops_existing_writers(tmp_path, stage):
    root = tmp_path / 'release'
    release(root)
    env = environment(tmp_path)
    env['FAIL_STAGE'] = stage
    assert deploy(root, env).returncode != 0
    assert 'stop --timeout' not in calls(tmp_path)
    assert 'run --rm hms-migrator\n' not in calls(tmp_path)
    assert not (root / '.hms-deploy-attempt.local').exists()


@pytest.mark.parametrize('probe', ['', 'unknown', EPOCH + '\nextra', '-1'])
def test_malformed_probe_fails_before_quiesce(tmp_path, probe):
    root = tmp_path / 'release'
    release(root)
    env = environment(tmp_path)
    env['PROBE_OUTPUT'] = probe
    assert deploy(root, env).returncode != 0
    assert 'stop --timeout' not in calls(tmp_path)


def test_running_writer_blocks_migration_after_durable_intent(tmp_path):
    root = tmp_path / 'release'
    release(root)
    env = environment(tmp_path)
    env['UNDRAINED'] = '1'
    assert deploy(root, env).returncode != 0
    assert (root / '.hms-deploy-attempt.local').read_text() == 'quiescing\n'
    assert 'run --rm hms-migrator\n' not in calls(tmp_path)
    assert 'up -d --no-deps hms-api' not in calls(tmp_path)


def test_missing_runtime_declaration_cannot_infer_compatibility_from_migration_file(tmp_path):
    root = tmp_path / 'release'
    release(root, declared=False)
    result = deploy(root, environment(tmp_path))
    assert result.returncode != 0
    assert 'incompatible' in result.stderr
    assert 'stop --timeout' not in calls(tmp_path)


@pytest.mark.parametrize('declaration', ['', 'unknown', EPOCH + '\nextra', '202610180024'])
def test_malformed_candidate_declaration_is_never_treated_as_epoch_zero(tmp_path, declaration):
    root = tmp_path / 'release'
    release(root)
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(declaration)
    assert deploy(root, environment(tmp_path)).returncode != 0
    assert 'stop --timeout' not in calls(tmp_path)
    assert 'run --rm hms-migrator\n' not in calls(tmp_path)


def test_skip_migrations_does_not_bypass_committed_schema_compatibility(tmp_path):
    root = tmp_path / 'release'
    release(root, declared=False)
    env = environment(tmp_path)
    env.update(PROBE_OUTPUT=EPOCH, HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED='true')
    assert deploy(root, env, '--skip-migrations').returncode != 0
    assert 'up -d --no-deps hms-api' not in calls(tmp_path)


@pytest.mark.parametrize('epoch', ['0', TREATMENT_EPOCH, REFERRAL_EPOCH, ADMISSION_EPOCH, CONSULTATION_EPOCH, OLD_EPOCH, 'unknown', EPOCH + '\nextra', '202610180024'])
def test_post_migration_schema_must_be_confirmed_before_starting_new_runtime(tmp_path, epoch):
    root = tmp_path / 'release'
    release(root)
    env = environment(tmp_path)
    env.update(ADVANCE_SCHEMA='1', ROLLBACK_PROBE_OUTPUT=epoch)
    assert deploy(root, env).returncode != 0
    assert 'run --rm hms-migrator\n' in calls(tmp_path)
    assert 'up -d --no-deps hms-api' not in calls(tmp_path)


@pytest.mark.parametrize('database_epoch', ['0', TREATMENT_EPOCH, REFERRAL_EPOCH, ADMISSION_EPOCH, CONSULTATION_EPOCH, OLD_EPOCH])
def test_skip_migrations_cannot_start_new_runtime_before_required_schema(tmp_path, database_epoch):
    root = tmp_path / 'release'
    release(root)
    env = environment(tmp_path)
    env.update(HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED='true', PROBE_OUTPUT=database_epoch)
    assert deploy(root, env, '--skip-migrations').returncode != 0
    assert 'stop --timeout' not in calls(tmp_path)
    assert 'up -d --no-deps hms-api' not in calls(tmp_path)


def install_fixture(tmp: Path, *, old_epoch: str | None = None):
    live = tmp / 'hms'
    release(live)
    (live / 'identity.txt').write_text('old')
    declaration = live / 'ops/compose-v2/runtime-schema-epoch'
    if old_epoch is None:
        declaration.unlink()
    else:
        declaration.write_text(old_epoch + '\n')
    executable(live / 'deploy', '''#!/bin/sh
case "${1:-}" in
  --help) printf '%s\\n' '--skip-migrations'; exit 0 ;;
esac
printf '%s\\n' old-runtime-started >> "$DOCKER_LOG"
''')
    candidate = tmp / 'candidate'
    release(candidate)
    archive = tmp / 'release.tgz'
    with tarfile.open(archive, 'w:gz') as bundle:
        for item in candidate.iterdir():
            bundle.add(item, arcname=item.name)
    installer = tmp / 'install.sh'
    script = (REPO / 'ops/gcp-staging/install-archive.sh').read_text()
    # Test the actual installer only in the temporary managed-root substitute.
    original = 'if [ "$DEPLOY_ROOT" != "/opt/hms" ]; then'
    assert script.count(original) == 1
    executable(installer, script.replace(original, f'if [ "$DEPLOY_ROOT" != "{live}" ]; then'))
    shutil.copy2(live / 'ops/deploy-lease.py', tmp / 'deploy-lease.py')
    env = environment(tmp)
    env.update(EXTERNAL_DB_BACKUP_CONFIRMED='true',
               COMPOSE_FILES=str(live / 'ops/compose-v2/compose.yml'))
    return live, archive, installer, env


def install(live, archive, installer, env):
    return subprocess.run([str(installer), str(archive), 'synthetic-build', str(live)],
                          env=env, text=True, capture_output=True, timeout=20)


def test_archive_prequiesce_failure_restores_source_only_without_touching_running_containers(tmp_path):
    live, archive, installer, env = install_fixture(tmp_path)
    env['FAIL_STAGE'] = 'build'
    result = install(live, archive, installer, env)
    assert result.returncode != 0
    assert (live / 'identity.txt').read_text() == 'old'
    assert 'stop --timeout' not in calls(tmp_path)
    assert 'old-runtime-started' not in calls(tmp_path)
    assert 'Pre-quiesce failure' in result.stderr


@pytest.mark.parametrize('failure', ['incompatible', 'older_runtime_023', 'older_runtime_024', 'older_runtime_025', 'older_runtime_026', 'older_runtime_027', 'probe_error', 'probe_malformed', 'missing_intent', 'malformed_intent', 'malformed_old_declaration'])
def test_archive_postquiesce_uncertainty_never_restores_or_restarts_old_runtime(tmp_path, failure):
    prior = {'malformed_old_declaration': 'unknown', 'older_runtime_023': TREATMENT_EPOCH, 'older_runtime_024': REFERRAL_EPOCH, 'older_runtime_025': ADMISSION_EPOCH, 'older_runtime_026': CONSULTATION_EPOCH, 'older_runtime_027': OLD_EPOCH}.get(failure)
    live, archive, installer, env = install_fixture(tmp_path, old_epoch=prior)
    env.update(FAIL_STAGE='migrate', ADVANCE_SCHEMA='1')
    if failure == 'probe_error': env['ROLLBACK_PROBE_FAIL'] = '1'
    if failure == 'probe_malformed': env['ROLLBACK_PROBE_OUTPUT'] = EPOCH + '\nextra'
    if failure == 'missing_intent': env['DELETE_INTENT'] = '1'
    if failure == 'malformed_intent': env['CORRUPT_INTENT'] = '1'
    result = install(live, archive, installer, env)
    assert result.returncode != 0
    assert (live / 'identity.txt').read_text() == 'candidate'
    assert len(list(tmp_path.glob('hms.pre-deploy-*'))) == 1
    assert 'old-runtime-started' not in calls(tmp_path)
    assert 'up -d --no-deps hms-api' not in calls(tmp_path)
    assert 'No database restore was attempted' in result.stderr


@pytest.mark.parametrize('old_epoch,advance', [(EPOCH, True), (OLD_EPOCH, False), (CONSULTATION_EPOCH, False), (ADMISSION_EPOCH, False), (REFERRAL_EPOCH, False), (TREATMENT_EPOCH, False), (None, False)])
def test_archive_uses_authoritative_db_epoch_before_known_compatible_runtime_recovery(tmp_path, old_epoch, advance):
    live, archive, installer, env = install_fixture(tmp_path, old_epoch=old_epoch)
    env['FAIL_STAGE'] = 'migrate'
    if old_epoch in (TREATMENT_EPOCH, REFERRAL_EPOCH, ADMISSION_EPOCH, CONSULTATION_EPOCH, OLD_EPOCH):
        env['PROBE_OUTPUT'] = old_epoch
    if advance: env['ADVANCE_SCHEMA'] = '1'
    result = install(live, archive, installer, env)
    assert result.returncode != 0
    assert (live / 'identity.txt').read_text() == 'old'
    assert calls(tmp_path).count('old-runtime-started') == 1
    assert len(list(tmp_path.glob('hms.failed-deploy-*'))) == 1
    assert (tmp_path / '.hms-deploy-state/schema-compatibility.local').read_text() == EPOCH + '\n'


@pytest.mark.parametrize('failure', ['stop', 'still_running'])
def test_archive_orphan_migrator_failure_prevents_probe_and_old_runtime_restart(tmp_path, failure):
    live, archive, installer, env = install_fixture(tmp_path, old_epoch=EPOCH)
    env.update(FAIL_STAGE='migrate', ADVANCE_SCHEMA='1', ORPHAN='1')
    env['ORPHAN_STOP_FAIL' if failure == 'stop' else 'ORPHAN_STILL_RUNNING'] = '1'
    result = install(live, archive, installer, env)
    assert result.returncode != 0
    assert (live / 'identity.txt').read_text() == 'candidate'
    log = calls(tmp_path)
    assert log.count('hms-migrator schema-compatibility') == 1, 'no recovery probe runs while an orphan may still migrate'
    assert 'old-runtime-started' not in log
    assert 'label=com.docker.compose.project=synthetic-test' in log
    assert 'label=com.docker.compose.service=hms-migrator' in log
    assert 'label=com.docker.compose.oneoff=True' in log


def test_archive_stops_only_label_scoped_orphan_before_authoritative_probe(tmp_path):
    live, archive, installer, env = install_fixture(tmp_path, old_epoch=EPOCH)
    env.update(FAIL_STAGE='migrate', ADVANCE_SCHEMA='1', ORPHAN='1')
    result = install(live, archive, installer, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert log.index('stop --time 60 abcdef123456') < log.rindex('hms-migrator schema-compatibility') < log.index('old-runtime-started')
    assert (live / 'identity.txt').read_text() == 'old'
