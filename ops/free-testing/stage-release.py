#!/usr/bin/env python3
"""Stage a new, immutable source tree from a verified offline release.

This never replaces an existing tree, reads credentials, loads images, starts
services or restores a database. Run the staged deployment with an external
private ENV_FILE; retain the previous tree for compatible recovery.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prebuilt_release import (MAX_SOURCE, VerificationError, manifest, require,
                             safe_member, verify_archives, verify_source)


def stage(bundle: Path, destination: Path):
    value = manifest(bundle)
    verify_archives(bundle, value)
    require(not os.path.lexists(destination), "Release destination already exists.")
    parent = destination.parent
    require(parent.is_dir() and not parent.is_symlink() and parent.resolve() == parent.absolute(),
            "Release parent must be an existing real directory.")
    info = parent.stat()
    require(info.st_uid == os.geteuid() and not info.st_mode & 0o022,
            "Release parent must be owned by the operator and not writable by others.")
    require(shutil.disk_usage(parent).free >= MAX_SOURCE + 1024 ** 3,
            "Insufficient source-staging disk headroom.")
    # Validate the complete member set before creating any output.
    names, total = set(), 0
    with tarfile.open(bundle / "source.tar.gz", "r:gz") as archive:
        for index, member in enumerate(archive):
            require(index < 100000, "Source archive contains excessive members.")
            name = str(safe_member(member.name))
            require(name not in names, "Source archive contains duplicate members.")
            names.add(name)
            require(member.isdir() or member.isfile(), "Source archive contains links or special files.")
            require(member.size >= 0 and not member.mode & 0o7000, "Unsafe source member mode or size.")
            total += member.size
            require(total <= MAX_SOURCE, "Source archive exceeds its staging budget.")
        require(archive.pax_headers.get("comment") == value["revision"],
                "Source archive commit identity mismatch.")
    destination.mkdir(mode=0o700)
    created = destination.stat()
    try:
        with tarfile.open(bundle / "source.tar.gz", "r:gz") as archive:
            for member in archive:
                path = destination.joinpath(*safe_member(member.name).parts)
                if member.isdir():
                    path.mkdir(mode=0o755, parents=True, exist_ok=True)
                    continue
                path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "wb") as output, archive.extractfile(member) as source:
                    shutil.copyfileobj(source, output)
                path.chmod(0o755 if member.mode & 0o111 else 0o644)
        verify_source(bundle, value, destination)
        print(json.dumps({"revision": value["revision"], "schema_epoch": value["schema_epoch"],
                          "staged": True, "deployed": False}))
    except BaseException:
        current = destination.lstat()
        if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
            shutil.rmtree(destination)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    try:
        stage(args.bundle.absolute(), args.destination.absolute())
    except (VerificationError, OSError, tarfile.TarError, ValueError):
        parser.exit(1, "Release source staging failed; no existing release was replaced.\n")


if __name__ == "__main__":
    main()
