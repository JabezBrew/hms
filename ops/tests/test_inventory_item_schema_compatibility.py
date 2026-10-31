"""Exercise030 deployment fencing with local protocol/process fixtures only."""
from pathlib import Path
import subprocess
import tarfile

import pytest

from test_appointment_type_schema_compatibility import (
    APPOINTMENT_EPOCH,
    APPOINTMENT_MIGRATION,
    PREDECESSORS as APPOINTMENT_PREDECESSORS,
    appointment_release,
)
from test_schema_compatibility_deploy import calls, deploy, environment, install, install_fixture


INVENTORY_EPOCH = '202610300030'
INVENTORY_MIGRATION = '202610300030_inventory_item_governance.sql'
PREDECESSORS = [*APPOINTMENT_PREDECESSORS, INVENTORY_MIGRATION]


def inventory_release(root: Path, declaration: str = INVENTORY_EPOCH) -> None:
    appointment_release(root)
    (root / 'backend-rs/migrations' / INVENTORY_MIGRATION).write_text('-- fixture only\n')
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(declaration + '\n')


def shell(root: Path, expression: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['sh', '-c', '. "$1/ops/schema-compatibility.sh"; ' + expression,
         'schema-test', str(root)], capture_output=True, text=True, timeout=10,
    )


@pytest.mark.parametrize('declaration', [INVENTORY_EPOCH, APPOINTMENT_EPOCH])
def test_actual_inventory_migration_requires030_even_with_older_declaration(tmp_path, declaration):
    root = tmp_path / 'release'
    inventory_release(root, declaration)
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode == 0, result.stderr
    assert result.stdout == INVENTORY_EPOCH + '\n'


def test_inventory_database_and_runtime_are_explicitly_recognized(tmp_path):
    root = tmp_path / 'release'
    inventory_release(root)
    result = shell(root, 'hms_validate_database_epoch 202610300030 && hms_require_candidate_schema_ready "$1" 202610300030')
    assert result.returncode == 0, result.stderr


def test_new_runtime_refuses029_and_old_runtime_refuses030(tmp_path):
    root = tmp_path / 'release'
    inventory_release(root)
    assert shell(root, 'hms_require_candidate_schema_ready "$1" 202610180029').returncode != 0
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(APPOINTMENT_EPOCH + '\n')
    result = shell(root, 'hms_require_runtime_compatible "$1" 202610300030')
    assert result.returncode != 0
    assert 'incompatible' in result.stderr


@pytest.mark.parametrize('migration', PREDECESSORS)
def test_inventory_candidate_requires_every_predecessor(tmp_path, migration):
    root = tmp_path / 'release'
    inventory_release(root)
    (root / 'backend-rs/migrations' / migration).unlink()
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode != 0
    assert result.stdout == ''
    assert 'missing its required breaking migration' in result.stderr


def test_existing029_release_remains_valid_without030_migration(tmp_path):
    root = tmp_path / 'release'
    appointment_release(root)
    result = shell(root, 'hms_require_candidate_schema_ready "$1" 202610180029')
    assert result.returncode == 0, result.stderr


def test030_deploy_stops_writers_before_migration_and_starts_only_after030(tmp_path):
    root = tmp_path / 'release'
    inventory_release(root)
    env = environment(tmp_path, target_epoch=INVENTORY_EPOCH)
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode == 0, result.stderr
    log = calls(tmp_path)
    assert log.index('stop --timeout 60 hms-api hms-worker') < log.index('run --rm hms-migrator\n')
    assert log.index('run --rm hms-migrator\n') < log.index('up -d --no-deps hms-api')
    assert (root / '.hms-schema-compatibility.local').read_text() == INVENTORY_EPOCH + '\n'


def test030_candidate_stays_stopped_when_migration_leaves_database_at029(tmp_path):
    root = tmp_path / 'release'
    inventory_release(root)
    env = environment(tmp_path, target_epoch=APPOINTMENT_EPOCH)
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'run --rm hms-migrator\n' in log
    assert 'up -d --no-deps hms-api' not in log


def test_old029_candidate_never_drains_or_migrates_a030_database(tmp_path):
    root = tmp_path / 'release'
    appointment_release(root)
    env = environment(tmp_path)
    env['PROBE_OUTPUT'] = INVENTORY_EPOCH
    result = deploy(root, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'stop --timeout' not in log
    assert 'run --rm hms-migrator\n' not in log
    assert 'up -d --no-deps hms-api' not in log


@pytest.mark.parametrize('database_epoch', [APPOINTMENT_EPOCH, INVENTORY_EPOCH + '\nextra', '202610300031'])
def test_skip_migrations_cannot_bypass030_required_schema(tmp_path, database_epoch):
    root = tmp_path / 'release'
    inventory_release(root)
    env = environment(tmp_path)
    env.update(PROBE_OUTPUT=database_epoch, HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED='true')
    result = deploy(root, env, '--skip-migrations')
    assert result.returncode != 0
    assert 'stop --timeout' not in calls(tmp_path)
    assert 'run --rm hms-migrator\n' not in calls(tmp_path)
    assert 'up -d --no-deps hms-api' not in calls(tmp_path)


def test030_archive_failure_after_commit_keeps029_runtime_stopped(tmp_path):
    live, archive, installer, env = install_fixture(tmp_path, old_epoch=APPOINTMENT_EPOCH)
    # Extend the existing local installer fixture with honest029/030 candidate
    # declarations. The Docker process remains the explicit protocol simulator.
    (live / 'backend-rs/migrations' / APPOINTMENT_MIGRATION).write_text('-- fixture only\n')
    candidate = tmp_path / 'candidate'
    for migration in [APPOINTMENT_MIGRATION, INVENTORY_MIGRATION]:
        (candidate / 'backend-rs/migrations' / migration).write_text('-- fixture only\n')
    (candidate / 'ops/compose-v2/runtime-schema-epoch').write_text(INVENTORY_EPOCH + '\n')
    with tarfile.open(archive, 'w:gz') as bundle:
        for item in candidate.iterdir():
            bundle.add(item, arcname=item.name)
    docker = tmp_path / 'bin/docker'
    source = docker.read_text()
    previous = "write_text('202610170028')"
    assert source.count(previous) == 1
    docker.write_text(source.replace(previous, "write_text('202610300030')"))
    env.update(FAIL_STAGE='migrate', ADVANCE_SCHEMA='1')
    result = install(live, archive, installer, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'run --rm hms-migrator\n' in log
    assert (live / 'identity.txt').read_text() == 'candidate'
    assert len(list(tmp_path.glob('hms.pre-deploy-*'))) == 1
    assert 'old-runtime-started' not in log
    assert 'up -d --no-deps hms-api' not in log
    assert 'No database restore was attempted' in result.stderr
