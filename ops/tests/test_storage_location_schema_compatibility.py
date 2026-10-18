"""The location epoch must be explicit in the supported deployment protocol."""
from pathlib import Path
import subprocess

import pytest

from test_schema_compatibility_deploy import release


LOCATION_EPOCH = '202610170028'
LOCATION_MIGRATION = '202610170028_storage_location_lifecycle.sql'


def location_release(root: Path, declaration: str = LOCATION_EPOCH) -> None:
    release(root)
    (root / 'backend-rs/migrations' / LOCATION_MIGRATION).write_text('-- fixture only\n')
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text(declaration + '\n')


def shell(root: Path, expression: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['sh', '-c', '. "$1/ops/schema-compatibility.sh"; ' + expression, 'schema-test', str(root)],
        capture_output=True, text=True, timeout=10,
    )


@pytest.mark.parametrize('declaration', [LOCATION_EPOCH, '202610170027'])
def test_location_migration_requires_its_actual_epoch_even_with_older_declaration(tmp_path, declaration):
    root = tmp_path / 'release'
    location_release(root, declaration)
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode == 0, result.stderr
    assert result.stdout == LOCATION_EPOCH + '\n'


def test_location_epoch_is_recognized_for_database_and_runtime(tmp_path):
    root = tmp_path / 'release'
    location_release(root)
    result = shell(root, 'hms_validate_database_epoch 202610170028 && hms_require_candidate_schema_ready "$1" 202610170028')
    assert result.returncode == 0, result.stderr


def test_location_runtime_refuses_prior_schema_and_prior_runtime_refuses_location_schema(tmp_path):
    root = tmp_path / 'release'
    location_release(root)
    assert shell(root, 'hms_require_candidate_schema_ready "$1" 202610170027').returncode != 0
    (root / 'ops/compose-v2/runtime-schema-epoch').write_text('202610170027\n')
    assert shell(root, 'hms_require_runtime_compatible "$1" 202610170028').returncode != 0


@pytest.mark.parametrize('migration', [
    '202610170023_treatment_course_windows.sql',
    '202610170024_referral_response_records.sql',
    '202610170025_admission_moves.sql',
    '202610170026_referral_consultation_starts.sql',
    '202610170027_organization_unit_lifecycle.sql',
    LOCATION_MIGRATION,
])
def test_location_candidate_requires_every_preceding_breaking_migration(tmp_path, migration):
    root = tmp_path / 'release'
    location_release(root)
    (root / 'backend-rs/migrations' / migration).unlink()
    result = shell(root, 'hms_candidate_breaking_epoch "$1"')
    assert result.returncode != 0
    assert result.stdout == ''
