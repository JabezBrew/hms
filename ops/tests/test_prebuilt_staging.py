from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from test_prebuilt_release import Bundle, archive


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("prebuilt_stage", ROOT / "ops/free-testing/stage-release.py")
STAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STAGE)


def test_stage_exact_source_without_changing_existing_release(tmp_path):
    bundle = Bundle(tmp_path)
    old = tmp_path / "old-release"
    old.mkdir()
    (old / "anchor").write_text("preserve")
    destination = tmp_path / "new-release"
    STAGE.stage(bundle.path, destination)
    for name, content, _ in bundle.members:
        assert (destination / name).read_bytes() == content
        assert (destination / name).stat().st_mode & 0o777 == 0o644
    assert (old / "anchor").read_text() == "preserve"
    with pytest.raises(STAGE.VerificationError, match="already exists"):
        STAGE.stage(bundle.path, destination)


@pytest.mark.parametrize("member", [
    ("../escaped", b"bad", "file"),
    ("/absolute", b"bad", "file"),
    ("linked", b"../outside", "symlink"),
    ("linked", b"ops/compose-v2/deploy.sh", "hardlink"),
    ("ops/compose-v2/deploy.sh", b"duplicate", "file"),
])
def test_unsafe_archive_refused_before_output_is_created(tmp_path, member):
    bundle = Bundle(tmp_path)
    archive(bundle.path / "source.tar.gz", [*bundle.members, member], bundle.value["revision"])
    bundle.refresh()
    destination = tmp_path / "candidate"
    with pytest.raises(STAGE.VerificationError):
        STAGE.stage(bundle.path, destination)
    assert not destination.exists()
    assert not (tmp_path / "escaped").exists()


def test_wrong_source_epoch_removes_only_new_candidate(tmp_path):
    bundle = Bundle(tmp_path)
    members = [(name, b"202610310031\n" if name.endswith("runtime-schema-epoch") else content, kind)
               for name, content, kind in bundle.members]
    archive(bundle.path / "source.tar.gz", members, bundle.value["revision"])
    bundle.refresh()
    destination = tmp_path / "candidate"
    with pytest.raises(STAGE.VerificationError):
        STAGE.stage(bundle.path, destination)
    assert not destination.exists()
    assert bundle.root.exists()


def test_link_destination_and_corrupt_transfer_are_refused(tmp_path):
    bundle = Bundle(tmp_path)
    linked = tmp_path / "linked"
    linked.symlink_to(bundle.root, target_is_directory=True)
    with pytest.raises(STAGE.VerificationError):
        STAGE.stage(bundle.path, linked)
    (bundle.path / "source.tar.gz").write_bytes(b"corrupt")
    with pytest.raises(STAGE.VerificationError):
        STAGE.stage(bundle.path, tmp_path / "candidate")
    assert bundle.root.exists()
