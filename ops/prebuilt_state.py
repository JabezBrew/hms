#!/usr/bin/env python3
"""Resolve shared prebuilt recovery state under the canonical host lease.

No caller-selected state directory is accepted. Legacy known install fences are
copied conservatively; their original files remain untouched.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


class StateError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise StateError(message)


def host_lease(root):
    spec = importlib.util.spec_from_file_location("prebuilt_host_lease", root / "ops/deploy-lease.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        module.inherited_fd()
    except (module.LeaseError, OSError, ValueError):
        raise StateError("Shared prebuilt state requires the canonical host lease.") from None
    return module


def private_directory(path):
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o700, "Shared prebuilt state directory is unsafe.")


def scalar(path, values=None, legacy=False):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
            and not info.st_mode & 0o022 and info.st_size <= 64,
            "Recovery state must be a small owned regular file.")
    if not legacy:
        require(stat.S_IMODE(info.st_mode) == 0o600, "Shared recovery state must have mode 0600.")
    value = path.read_text().strip()
    require(value in values if values else re.fullmatch(r"[0-9]{1,14}", value),
            "Recovery state content requires operator review.")
    return value


def atomic_scalar(path, value):
    descriptor, name = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(value + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.lexists(name):
            os.unlink(name)


def state_directory(root):
    lease = host_lease(root)
    parent = lease.LEASE_PATH.parent
    private_directory(parent)
    private_directory(parent / "prebuilt")
    state = parent / "prebuilt/hms-free-test"
    private_directory(state)
    fence, attempt = state / "schema-compatibility", state / "deploy-attempt"
    for key, path in (("HMS_SCHEMA_FENCE_FILE", fence), ("HMS_DEPLOY_ATTEMPT_FILE", attempt),
                      ("HMS_PREBUILT_STATE_DIR", state)):
        require(key not in os.environ or os.environ[key] == str(path),
                "Prebuilt recovery state cannot be redirected into a source tree or another scope.")
    epochs, stages = [], []
    if os.path.lexists(fence):
        epochs.append(scalar(fence))
    if os.path.lexists(attempt):
        stages.append(scalar(attempt, {"pre_quiesce", "quiescing"}))
    # The prior canonical install and the selected candidate are the known
    # legacy locations. A missing file is not proof that a failed migration was
    # rolled back; retain the largest observed fence and quiescing state.
    for legacy_root in {root.resolve(), parent.parent / "hms"}:
        for name, target, values in ((".hms-schema-compatibility.local", epochs, None),
                                     (".hms-deploy-attempt.local", stages, {"pre_quiesce", "quiescing"})):
            path = legacy_root / name
            if os.path.lexists(path):
                target.append(scalar(path, values, legacy=True))
    if epochs:
        maximum = max(epochs, key=int)
        if not fence.exists() or scalar(fence) != maximum:
            atomic_scalar(fence, maximum)
    if stages:
        retained = "quiescing" if "quiescing" in stages else "pre_quiesce"
        if not attempt.exists() or scalar(attempt, {"pre_quiesce", "quiescing"}) != retained:
            atomic_scalar(attempt, retained)
    return state


def require_source_mode_allowed(root):
    """Read-only refusal of source compilation after prebuilt adoption."""
    lease = host_lease(root)
    parent = lease.LEASE_PATH.parent / "prebuilt"
    state = parent / "hms-free-test"
    for path in (parent, state, state / "releases"):
        if os.path.lexists(path):
            info = path.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                    and stat.S_IMODE(info.st_mode) == 0o700,
                    "Persistent prebuilt state is unsafe; source deployment is refused.")
    require(not any(os.path.lexists(path) for path in (
        state / "schema-compatibility", state / "deploy-attempt", state / "releases/current.json")),
        "This project has durable prebuilt deployment state; a verified bundle is required.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--check-source-mode", action="store_true")
    args = parser.parse_args()
    try:
        if args.check_source_mode:
            require_source_mode_allowed(args.root)
        else:
            print(state_directory(args.root))
    except (StateError, OSError, UnicodeError, ValueError):
        parser.exit(1, "Shared prebuilt recovery state is unavailable or requires operator review.\n")


if __name__ == "__main__":
    main()
