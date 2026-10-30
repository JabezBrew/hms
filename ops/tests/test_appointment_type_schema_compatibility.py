"""Exercise029 deployment fencing without a database or remote process."""
from pathlib import Path
import subprocess

import pytest

from test_schema_compatibility_deploy import calls, deploy, environment, release


APPOINTMENT_EPOCH = '202610180029'
APPOINTMENT_MIGRATION = '202610180029_appointment_type_lifecycle.sql'
PREDECESSORS = [
    '202610170023_treatment_course_windows.sql',
    '202610170024_referral_response_records.sql',
    '202610170025_admission_moves.sql',
    '202610170026_referral_consultation_starts.sql',
    '202610170027_organization_unit_lifecycle.sql',
    '202610170028_storage_location_lifecycle.sql',
    APPOINTMENT_MIGRATION,
]


def appointment_release(root: Path, declaration: str = APPOINTMENT_EPOCH) -> None:
    release(root)
    (root / 'backend-rs/migrations' / APPOINTMENT_MIGRATION).write_text('-- fixture only\n')
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(declaration + '\n')


def shell(root: Path, expression: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['sh', '-c', '. "$1/ops/schema-compatibility.sh"; ' + expression,
         'schema-test', str(root)], capture_output=True, text=True, timeout=10,
    )


@pytest.mark.parametrize('declaration', [APPOINTMENT_EPOCH, '202610170028'])
def test_actual_appointment_migration_requires029_even_with_older_declaration(tmp_path, declaration):
    root = tmp_path / 'release'
    appointment_release(root, declaration)
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode == 0, result.stderr
    assert result.stdout == APPOINTMENT_EPOCH + '\n'


def test_appointment_database_and_runtime_are_explicitly_recognized(tmp_path):
    root = tmp_path / 'release'
    appointment_release(root)
    result = shell(root, 'hms_validate_database_epoch 202610180029 && hms_require_candidate_schema_ready "$1" 202610180029')
    assert result.returncode == 0, result.stderr


def test_new_runtime_refuses028_and_old_runtime_refuses029(tmp_path):
    root = tmp_path / 'release'
    appointment_release(root)
    assert shell(root, 'hms_require_candidate_schema_ready "$1" 202610170028').returncode != 0
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text('202610170028\n')
    assert shell(root, 'hms_require_runtime_compatible "$1" 202610180029').returncode != 0


@pytest.mark.parametrize('migration', PREDECESSORS)
def test_appointment_candidate_requires_every_predecessor(tmp_path, migration):
    root = tmp_path / 'release'
    appointment_release(root)
    (root / 'backend-rs/migrations' / migration).unlink()
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode != 0
    assert result.stdout == ''


def test_existing028_release_remains_valid_without029_migration(tmp_path):
    root = tmp_path / 'release'
    release(root)
    result = shell(root, 'hms_require_candidate_schema_ready "$1" 202610170028')
    assert result.returncode == 0, result.stderr


def test029_deploy_stops_writers_before_migration_and_starts_only_after029(tmp_path):
    root = tmp_path / 'release'
    appointment_release(root)
    env = environment(tmp_path, target_epoch=APPOINTMENT_EPOCH)
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode == 0, result.stderr
    log = calls(tmp_path)
    assert log.index('stop --timeout 60 hms-api hms-worker') < log.index('run --rm hms-migrator\n')
    assert log.index('run --rm hms-migrator\n') < log.index('up -d --no-deps hms-api')
    assert (root / '.hms-schema-compatibility.local').read_text() == APPOINTMENT_EPOCH + '\n'


def test029_candidate_stays_stopped_when_migration_leaves_database_at028(tmp_path):
    root = tmp_path / 'release'
    appointment_release(root)
    env = environment(tmp_path, target_epoch='202610170028')
    env['ADVANCE_SCHEMA'] = '1'
    result = deploy(root, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'run --rm hms-migrator\n' in log
    assert 'up -d --no-deps hms-api' not in log


def test_old028_candidate_never_drains_or_migrates_a029_database(tmp_path):
    root = tmp_path / 'release'
    release(root)
    env = environment(tmp_path)
    env['PROBE_OUTPUT'] = APPOINTMENT_EPOCH
    result = deploy(root, env)
    assert result.returncode != 0
    log = calls(tmp_path)
    assert 'stop --timeout' not in log
    assert 'run --rm hms-migrator\n' not in log
    assert 'up -d --no-deps hms-api' not in log
