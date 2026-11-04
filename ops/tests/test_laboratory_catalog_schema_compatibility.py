"""Exercise the 033 deployment protocol with isolated process fixtures only."""
from pathlib import Path
import subprocess
import tarfile

import pytest

from test_inventory_supplier_schema_compatibility import (
    SUPPLIER_EPOCH,
    SUPPLIER_MIGRATION,
    PREDECESSORS as SUPPLIER_PREDECESSORS,
    supplier_release,
)
from test_inventory_category_schema_compatibility import CATEGORY_MIGRATION
from test_inventory_item_schema_compatibility import INVENTORY_MIGRATION
from test_appointment_type_schema_compatibility import APPOINTMENT_MIGRATION
from test_schema_compatibility_deploy import calls, deploy, environment, install, install_fixture


LABORATORY_EPOCH = '202611030033'
LABORATORY_MIGRATION = '202611030033_laboratory_catalog_governance.sql'
PREDECESSORS = [*SUPPLIER_PREDECESSORS, LABORATORY_MIGRATION]


def laboratory_release(root: Path, declaration: str = LABORATORY_EPOCH) -> None:
    supplier_release(root)
    (root / 'backend-rs/migrations' / LABORATORY_MIGRATION).write_text('-- fixture only\n')
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(declaration + '\n')


def shell(root: Path, expression: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['sh', '-c', '. "$1/ops/schema-compatibility.sh"; ' + expression,
         'schema-test', str(root)], capture_output=True, text=True, timeout=10,
    )


@pytest.mark.parametrize('declaration', [LABORATORY_EPOCH, SUPPLIER_EPOCH])
def test_actual_laboratory_migration_requires033_even_with_older_declaration(tmp_path, declaration):
    root = tmp_path / 'release'
    laboratory_release(root, declaration)
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode == 0, result.stderr
    assert result.stdout == LABORATORY_EPOCH + '\n'


def test_laboratory_database_and_runtime_are_explicitly_recognized(tmp_path):
    root = tmp_path / 'release'
    laboratory_release(root)
    result = shell(root, 'hms_validate_database_epoch 202611030033 && hms_require_candidate_schema_ready "$1" 202611030033')
    assert result.returncode == 0, result.stderr


def test_supported_protocol_fences033_on032_and032_on033(tmp_path):
    root = tmp_path / 'release'
    laboratory_release(root)
    assert shell(root, 'hms_require_candidate_schema_ready "$1" 202611020032').returncode != 0
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(SUPPLIER_EPOCH + '\n')
    result = shell(root, 'hms_require_runtime_compatible "$1" 202611030033')
    assert result.returncode != 0
    assert 'incompatible' in result.stderr


@pytest.mark.parametrize('migration', PREDECESSORS)
def test_laboratory_candidate_requires_every_predecessor(tmp_path, migration):
    root = tmp_path / 'release'
    laboratory_release(root)
    (root / 'backend-rs/migrations' / migration).unlink()
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode != 0
    assert result.stdout == ''
    assert 'missing its required breaking migration' in result.stderr


def test_existing032_release_remains_valid_without033_migration(tmp_path):
    root = tmp_path / 'release'
    supplier_release(root)
    result = shell(root, 'hms_require_candidate_schema_ready "$1" 202611020032')
    assert result.returncode == 0, result.stderr


def test033_deploy_drains_writers_and_starts_only_after033(tmp_path):
    root = tmp_path / 'release'
    laboratory_release(root)
    env = environment(tmp_path, target_epoch=LABORATORY_EPOCH)
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode == 0, result.stderr
    log = calls(tmp_path)
    assert log.index('stop --timeout 60 hms-api hms-worker') < log.index('run --rm hms-migrator\n')
    assert log.index('run --rm hms-migrator\n') < log.index('up -d --no-deps hms-api')
    assert (root / '.hms-schema-compatibility.local').read_text() == LABORATORY_EPOCH + '\n'


def test033_candidate_stays_stopped_when_migration_leaves_database_at032(tmp_path):
    root = tmp_path / 'release'
    laboratory_release(root)
    env = environment(tmp_path, target_epoch=SUPPLIER_EPOCH)
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'run --rm hms-migrator\n' in log
    assert 'up -d --no-deps hms-api' not in log


def test_supported_old032_candidate_never_drains_or_migrates033_database(tmp_path):
    root = tmp_path / 'release'
    supplier_release(root)
    env = environment(tmp_path)
    env['PROBE_OUTPUT'] = LABORATORY_EPOCH
    result = deploy(root, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'stop --timeout' not in log
    assert 'run --rm hms-migrator\n' not in log
    assert 'up -d --no-deps hms-api' not in log


@pytest.mark.parametrize('database_epoch', [SUPPLIER_EPOCH, LABORATORY_EPOCH + '\nextra', '202611030034'])
def test_skip_migrations_cannot_bypass033_required_schema(tmp_path, database_epoch):
    root = tmp_path / 'release'
    laboratory_release(root)
    env = environment(tmp_path)
    env.update(PROBE_OUTPUT=database_epoch, HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED='true')
    result = deploy(root, env, '--skip-migrations')
    assert result.returncode != 0
    assert 'stop --timeout' not in calls(tmp_path)
    assert 'run --rm hms-migrator\n' not in calls(tmp_path)
    assert 'up -d --no-deps hms-api' not in calls(tmp_path)


def test033_archive_failure_after_commit_keeps032_runtime_stopped(tmp_path):
    live, archive, installer, env = install_fixture(tmp_path, old_epoch=SUPPLIER_EPOCH)
    old_migrations = [APPOINTMENT_MIGRATION, INVENTORY_MIGRATION, CATEGORY_MIGRATION, SUPPLIER_MIGRATION]
    for migration in old_migrations:
        (live / 'backend-rs/migrations' / migration).write_text('-- fixture only\n')
    candidate = tmp_path / 'candidate'
    for migration in [*old_migrations, LABORATORY_MIGRATION]:
        (candidate / 'backend-rs/migrations' / migration).write_text('-- fixture only\n')
    (candidate / 'ops/compose-v2/runtime-schema-epoch').write_text(LABORATORY_EPOCH + '\n')
    with tarfile.open(archive, 'w:gz') as bundle:
        for item in candidate.iterdir():
            bundle.add(item, arcname=item.name)
    docker = tmp_path / 'bin/docker'
    source = docker.read_text()
    previous = "write_text('202610170028')"
    assert source.count(previous) == 1
    docker.write_text(source.replace(previous, "write_text('202611030033')"))
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
