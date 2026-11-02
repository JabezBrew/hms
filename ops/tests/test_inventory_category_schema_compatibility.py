"""Exercise031 supported deployment fencing using local process fixtures."""
from pathlib import Path
import subprocess
import tarfile

import pytest

from test_inventory_item_schema_compatibility import (
    INVENTORY_EPOCH,
    INVENTORY_MIGRATION,
    PREDECESSORS as INVENTORY_PREDECESSORS,
    inventory_release,
)
from test_appointment_type_schema_compatibility import APPOINTMENT_MIGRATION
from test_schema_compatibility_deploy import calls, deploy, environment, install, install_fixture


CATEGORY_EPOCH = '202610310031'
CATEGORY_MIGRATION = '202610310031_inventory_category_governance.sql'
PREDECESSORS = [*INVENTORY_PREDECESSORS, CATEGORY_MIGRATION]


def category_release(root: Path, declaration: str = CATEGORY_EPOCH) -> None:
    inventory_release(root)
    (root / 'backend-rs/migrations' / CATEGORY_MIGRATION).write_text('-- fixture only\n')
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(declaration + '\n')


def shell(root: Path, expression: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['sh', '-c', '. "$1/ops/schema-compatibility.sh"; ' + expression,
         'schema-test', str(root)], capture_output=True, text=True, timeout=10,
    )


@pytest.mark.parametrize('declaration', [CATEGORY_EPOCH, INVENTORY_EPOCH])
def test_actual_category_migration_requires031_even_with_older_declaration(tmp_path, declaration):
    root = tmp_path / 'release'
    category_release(root, declaration)
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode == 0, result.stderr
    assert result.stdout == CATEGORY_EPOCH + '\n'


def test_category_database_and_runtime_are_explicitly_recognized(tmp_path):
    root = tmp_path / 'release'
    category_release(root)
    result = shell(root, 'hms_validate_database_epoch 202610310031 && hms_require_candidate_schema_ready "$1" 202610310031')
    assert result.returncode == 0, result.stderr


def test_supported_protocol_fences031_on030_and030_on031(tmp_path):
    # This tests the supported current shell protocol, not an old executable's
    # ability to recognize an unknown future migration.
    root = tmp_path / 'release'
    category_release(root)
    assert shell(root, 'hms_require_candidate_schema_ready "$1" 202610300030').returncode != 0
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(INVENTORY_EPOCH + '\n')
    result = shell(root, 'hms_require_runtime_compatible "$1" 202610310031')
    assert result.returncode != 0
    assert 'incompatible' in result.stderr


@pytest.mark.parametrize('migration', PREDECESSORS)
def test_category_candidate_requires_every_predecessor(tmp_path, migration):
    root = tmp_path / 'release'
    category_release(root)
    (root / 'backend-rs/migrations' / migration).unlink()
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode != 0
    assert result.stdout == ''
    assert 'missing its required breaking migration' in result.stderr


def test_existing030_release_remains_valid_without031_migration(tmp_path):
    root = tmp_path / 'release'
    inventory_release(root)
    result = shell(root, 'hms_require_candidate_schema_ready "$1" 202610300030')
    assert result.returncode == 0, result.stderr


def test031_deploy_stops_writers_before_migration_and_starts_only_after031(tmp_path):
    root = tmp_path / 'release'
    category_release(root)
    env = environment(tmp_path, target_epoch=CATEGORY_EPOCH)
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode == 0, result.stderr
    log = calls(tmp_path)
    assert log.index('stop --timeout 60 hms-api hms-worker') < log.index('run --rm hms-migrator\n')
    assert log.index('run --rm hms-migrator\n') < log.index('up -d --no-deps hms-api')
    assert (root / '.hms-schema-compatibility.local').read_text() == CATEGORY_EPOCH + '\n'


def test031_candidate_stays_stopped_when_migration_leaves_database_at030(tmp_path):
    root = tmp_path / 'release'
    category_release(root)
    env = environment(tmp_path, target_epoch=INVENTORY_EPOCH)
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'run --rm hms-migrator\n' in log
    assert 'up -d --no-deps hms-api' not in log


def test_supported_old030_candidate_never_drains_or_migrates031_database(tmp_path):
    root = tmp_path / 'release'
    inventory_release(root)
    env = environment(tmp_path)
    env['PROBE_OUTPUT'] = CATEGORY_EPOCH
    result = deploy(root, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'stop --timeout' not in log
    assert 'run --rm hms-migrator\n' not in log
    assert 'up -d --no-deps hms-api' not in log


@pytest.mark.parametrize('database_epoch', [INVENTORY_EPOCH, CATEGORY_EPOCH + '\nextra', '202610310032'])
def test_skip_migrations_cannot_bypass031_required_schema(tmp_path, database_epoch):
    root = tmp_path / 'release'
    category_release(root)
    env = environment(tmp_path)
    env.update(PROBE_OUTPUT=database_epoch, HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED='true')
    result = deploy(root, env, '--skip-migrations')
    assert result.returncode != 0
    assert 'stop --timeout' not in calls(tmp_path)
    assert 'run --rm hms-migrator\n' not in calls(tmp_path)
    assert 'up -d --no-deps hms-api' not in calls(tmp_path)


def test031_archive_failure_after_commit_keeps030_runtime_stopped(tmp_path):
    live, archive, installer, env = install_fixture(tmp_path, old_epoch=INVENTORY_EPOCH)
    for migration in [APPOINTMENT_MIGRATION, INVENTORY_MIGRATION]:
        (live / 'backend-rs/migrations' / migration).write_text('-- fixture only\n')
    candidate = tmp_path / 'candidate'
    for migration in [APPOINTMENT_MIGRATION, INVENTORY_MIGRATION, CATEGORY_MIGRATION]:
        (candidate / 'backend-rs/migrations' / migration).write_text('-- fixture only\n')
    (candidate / 'ops/compose-v2/runtime-schema-epoch').write_text(CATEGORY_EPOCH + '\n')
    with tarfile.open(archive, 'w:gz') as bundle:
        for item in candidate.iterdir():
            bundle.add(item, arcname=item.name)
    docker = tmp_path / 'bin/docker'
    source = docker.read_text()
    previous = "write_text('202610170028')"
    assert source.count(previous) == 1
    docker.write_text(source.replace(previous, "write_text('202610310031')"))
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
