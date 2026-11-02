from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from deployment_fixtures import copy_lease_helper


ROOT = Path(__file__).resolve().parents[2]


def candidate(tmp_path, name):
    root = tmp_path / name
    (root / "ops").mkdir(parents=True)
    shutil.copy2(ROOT / "ops/prebuilt_state.py", root / "ops/prebuilt_state.py")
    copy_lease_helper(root, tmp_path / ".hms-deploy-state/deploy.lock")
    return root


def run(root, environment=None, lease=True):
    env = os.environ.copy()
    for key in ("HMS_SCHEMA_FENCE_FILE", "HMS_DEPLOY_ATTEMPT_FILE", "HMS_PREBUILT_STATE_DIR", "HMS_DEPLOY_LEASE_FD"):
        env.pop(key, None)
    env.update(environment or {})
    command = [sys.executable, str(root / "ops/prebuilt_state.py"), "--root", str(root)]
    if lease:
        command = [sys.executable, str(root / "ops/deploy-lease.py"), "--", *command]
    return subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)


def test_release_trees_share_monotonic_fence_and_quiescing_state(tmp_path):
    first, second = candidate(tmp_path, "release-a"), candidate(tmp_path, "release-b")
    old = first / ".hms-schema-compatibility.local"
    old.write_text("202610300030\n")
    (first / ".hms-deploy-attempt.local").write_text("quiescing\n")
    result = run(first)
    assert result.returncode == 0, result.stderr
    state = Path(result.stdout.strip())
    assert state == tmp_path / ".hms-deploy-state/prebuilt/hms-free-test"
    assert (state / "schema-compatibility").read_text() == "202610300030\n"
    assert (state / "deploy-attempt").read_text() == "quiescing\n"
    (second / ".hms-schema-compatibility.local").write_text("202610180029\n")
    (second / ".hms-deploy-attempt.local").write_text("pre_quiesce\n")
    result = run(second)
    assert result.returncode == 0 and Path(result.stdout.strip()) == state
    assert (state / "schema-compatibility").read_text() == "202610300030\n"
    assert (state / "deploy-attempt").read_text() == "quiescing\n"
    assert old.read_text() == "202610300030\n"
    assert state.stat().st_mode & 0o777 == 0o700
    assert (state / "schema-compatibility").stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("key", ["HMS_SCHEMA_FENCE_FILE", "HMS_DEPLOY_ATTEMPT_FILE", "HMS_PREBUILT_STATE_DIR"])
def test_caller_cannot_redirect_recovery_state(tmp_path, key):
    root = candidate(tmp_path, "release")
    result = run(root, {key: str(root / "other-state")})
    assert result.returncode != 0
    assert not (root / "other-state").exists()


def test_no_lease_or_forged_descriptor_cannot_create_state(tmp_path):
    root = candidate(tmp_path, "release")
    result = run(root, {"HMS_DEPLOY_LEASE_FD": "198"}, lease=False)
    assert result.returncode != 0
    assert not (tmp_path / ".hms-deploy-state/prebuilt").exists()


@pytest.mark.parametrize("content", ["", "unknown", "202610300030\n202610310031", "secret-sentinel"])
def test_bad_legacy_state_is_preserved_and_not_echoed(tmp_path, content):
    root = candidate(tmp_path, "release")
    old = root / ".hms-schema-compatibility.local"
    old.write_text(content)
    result = run(root)
    assert result.returncode != 0
    assert old.read_text() == content
    assert "secret-sentinel" not in result.stdout + result.stderr
    assert not (tmp_path / ".hms-deploy-state/prebuilt/hms-free-test/schema-compatibility").exists()


def test_legacy_symlink_and_unsafe_shared_directory_are_refused(tmp_path):
    root = candidate(tmp_path, "release")
    target = tmp_path / "preserve"
    target.write_text("202610300030\n")
    (root / ".hms-schema-compatibility.local").symlink_to(target)
    result = run(root)
    assert result.returncode != 0
    assert target.read_text() == "202610300030\n"
    (root / ".hms-schema-compatibility.local").unlink()
    state = tmp_path / ".hms-deploy-state/prebuilt/hms-free-test"
    state.chmod(0o755)
    assert run(root).returncode != 0
