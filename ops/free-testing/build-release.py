#!/usr/bin/env python3
"""Build an offline, exact-commit Linux ARM64 release; never build on Oracle.

Requires a clean tracked checkout. Untracked files are excluded by Git archive.
The default host disk budget is deliberately conservative, not a build-size
prediction. BuildKit/Docker storage must also have space; no cache is pruned.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import shutil
import subprocess
import sys
import tarfile
import tempfile

GIB = 1024 ** 3
SHA = re.compile(r"[a-f0-9]{40}\Z")
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
MAX_SOURCE_BYTES = 2 * GIB


class ReleaseError(ValueError):
    pass


def command(args, *, cwd=None, stdout=subprocess.PIPE, timeout=120):
    # Suppress command stderr: Docker/Git diagnostics may include private local
    # configuration. Callers receive the safe command identity and exit status.
    try:
        result = subprocess.run(args, cwd=cwd, stdout=stdout, stderr=subprocess.DEVNULL,
                                check=False, env=clean_environment(), timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ReleaseError(f"{Path(args[0]).name} {args[1]} timed out; no retry attempted") from None
    if result.returncode:
        raise ReleaseError(f"{Path(args[0]).name} {args[1]} failed ({result.returncode})")
    return result.stdout


def clean_environment():
    env = dict(os.environ)
    # Do not let Git configuration/environment redirect the source repository,
    # apply external attributes or inject alternative object directories.
    for key in tuple(env):
        if key.startswith("GIT_"):
            del env[key]
    env.update(GIT_ATTR_NOSYSTEM="1", GIT_CONFIG_NOSYSTEM="1",
               GIT_CONFIG_GLOBAL=os.devnull, GIT_NO_REPLACE_OBJECTS="1")
    return env


def git(repository, *args, stdout=subprocess.PIPE):
    return command(["git", "-C", str(repository), "-c", "core.attributesFile=" + os.devnull,
                    "-c", "tar.umask=022",
                    *args], stdout=stdout)


def sha256(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def file_record(path):
    return {"file": path.name, "sha256": sha256(path), "size": path.stat().st_size}


def ensure_space(path, budget_gib, reserve_gib):
    required = (budget_gib + reserve_gib) * GIB
    if shutil.disk_usage(path).free < required:
        raise ReleaseError(f"Insufficient host disk headroom: need {budget_gib} GiB build "
                           f"budget plus {reserve_gib} GiB reserve; no build started")


def source_tree(repository, revision):
    if not SHA.fullmatch(revision):
        raise ReleaseError("Revision must be a full lowercase 40-character commit SHA")
    if git(repository, "rev-parse", "--verify", revision + "^{commit}").decode().strip() != revision:
        raise ReleaseError("Revision did not resolve to the exact requested commit")
    if git(repository, "status", "--porcelain", "--untracked-files=no").strip():
        raise ReleaseError("Commit all tracked changes before producing a release")
    for directory in ("--git-dir", "--git-common-dir"):
        location = Path(git(repository, "rev-parse", directory).decode().strip())
        if not location.is_absolute():
            location = repository / location
        attributes = location / "info" / "attributes"
        if attributes.is_symlink() or (attributes.exists() and attributes.stat().st_size):
            raise ReleaseError("Local .git/info/attributes may alter the release archive")
    records = {}
    for row in git(repository, "ls-tree", "-rz", "--full-tree", revision).split(b"\0"):
        if not row:
            continue
        metadata, raw_name = row.split(b"\t", 1)
        mode, kind, blob = metadata.decode("ascii").split()
        name = raw_name.decode("utf-8", "strict")
        parts = PurePosixPath(name).parts
        if (kind != "blob" or mode not in ("100644", "100755") or not parts or
                any(part in ("..", ".git", "node_modules", "target") for part in parts) or
                any(part == ".env" or (part.startswith(".env.") and part != ".env.example")
                    for part in parts)):
            raise ReleaseError("Source contains an unsupported or private archive entry")
        records[name] = (int(mode, 8) & 0o777, blob)
    return records


def extract_source(archive, destination, revision, expected):
    """No tar extraction shortcuts: only exact committed regular files/modes."""
    seen = set()
    files = set()
    total = 0
    with tarfile.open(archive, "r:") as source:
        if source.pax_headers.get("comment") != revision:
            raise ReleaseError("Git archive commit metadata does not match revision")
        for entry in source:
            name = entry.name.rstrip("/") if entry.isdir() else entry.name
            parts = PurePosixPath(name).parts
            if (not name or name.startswith("/") or "\\" in name or
                    PurePosixPath(name).as_posix() != name or ".." in parts or
                    name in seen or not (entry.isdir() or entry.isfile())):
                raise ReleaseError("Unsupported source archive path or type")
            seen.add(name)
            target = destination.joinpath(*parts)
            if entry.isdir():
                target.mkdir(mode=0o755, parents=True, exist_ok=True)
                continue
            wanted = expected.get(name)
            if wanted is None or entry.mode != wanted[0] or entry.size < 0:
                raise ReleaseError("Archive file or mode differs from committed source")
            total += entry.size
            if total > MAX_SOURCE_BYTES:
                raise ReleaseError("Source exceeds the bounded archive size")
            stream = source.extractfile(entry)
            if stream is None:
                raise ReleaseError("Source archive file is unreadable")
            digest = hashlib.sha1(f"blob {entry.size}\0".encode())
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            with target.open("xb") as output:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                    output.write(chunk)
            target.chmod(wanted[0])
            if digest.hexdigest() != wanted[1]:
                raise ReleaseError("Archive content differs from committed source")
            files.add(name)
    if set(expected) != files:
        raise ReleaseError("Archive does not contain the complete committed source")


def source_epoch(source):
    epoch = (source / "ops/compose-v2/runtime-schema-epoch").read_text().strip()
    if not re.fullmatch(r"[0-9]{12}", epoch):
        raise ReleaseError("Source runtime schema epoch is invalid")
    # Use the source's real declaration/migration compatibility protocol.
    check = 'set -eu; . "$1/ops/schema-compatibility.sh"; hms_candidate_breaking_epoch "$1"'
    if command(["sh", "-c", check, "prebuilt-schema", str(source)]).decode().strip() != epoch:
        raise ReleaseError("Source runtime epoch differs from its migration declaration")
    versions = set()
    for migration in (source / "backend-rs/migrations").glob("*.sql"):
        version = migration.name.split("_", 1)[0]
        if not version.isascii() or not version.isdigit() or version in versions:
            raise ReleaseError("Source migration versions are invalid or duplicated")
        versions.add(version)
    return epoch


def inspect_image(reference, revision, component, epoch):
    try:
        inspected = json.loads(command(["docker", "image", "inspect", reference]))
        if not isinstance(inspected, list) or len(inspected) != 1:
            raise ValueError
        image = inspected[0]
        labels = image["Config"]["Labels"]
        size = image["Size"]
        if (image["Os"] != "linux" or image["Architecture"] != "arm64" or
                image.get("Variant", "") not in ("", "v8") or
                not IMAGE_ID.fullmatch(image["Id"]) or
                labels.get("org.opencontainers.image.revision") != revision or
                labels.get("systems.thehms.component") != component or
                (component == "rust" and labels.get("systems.thehms.schema-epoch") != epoch) or
                type(size) is not int or not 0 < size <= 100 * GIB):
            raise ValueError
        descriptor = image.get("Descriptor")
        config_id = image["Id"]
        if descriptor is not None:
            config_id = descriptor["annotations"]["config.digest"]
            if (descriptor["digest"] != image["Id"] or
                    descriptor["mediaType"] not in (
                        "application/vnd.oci.image.manifest.v1+json",
                        "application/vnd.docker.distribution.manifest.v2+json") or
                    not isinstance(config_id, str) or not IMAGE_ID.fullmatch(config_id)):
                raise ValueError
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ReleaseError("Built image platform, identity or provenance did not match") from None
    return {"ref": reference, "id": image["Id"], "config_id": config_id,
            "component": component, "size": size}


def verify_local_engine():
    # A remote ARM64 context could silently compile on Oracle again. The
    # operator's selected local Unix context is allowed; endpoint overrides are
    # deliberately refused rather than guessed or changed by the producer.
    if any(os.environ.get(key) for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "BUILDX_BUILDER", "BUILDKIT_HOST")):
        raise ReleaseError("Unset Docker endpoint overrides before building locally")
    try:
        context = json.loads(command(["docker", "context", "inspect"]))
        if (not isinstance(context, list) or len(context) != 1 or
                not context[0].get("Endpoints", {}).get("docker", {}).get("Host", "").startswith("unix:///")):
            raise ReleaseError("Producer requires a local Unix Docker endpoint")
        builder = context[0].get("Name")
        endpoint = context[0]["Endpoints"]["docker"]["Host"]
        if not isinstance(builder, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", builder):
            raise ReleaseError("Local Docker context identity could not be verified")
        engine = json.loads(command(["docker", "info", "--format", "{{json .}}"]));
        if (not isinstance(engine, dict) or engine.get("OSType") != "linux" or
                engine.get("Architecture") not in ("aarch64", "arm64")):
            raise ReleaseError("Producer requires a Linux ARM64 Docker engine")
        builders = [json.loads(row) for row in command(
            ["docker", "buildx", "ls", "--format", "{{json .}}"]
        ).decode().splitlines() if row.strip()]
        selected = [item for item in builders if isinstance(item, dict) and item.get("Name") == builder]
        if not selected:
            raise ReleaseError("Local Docker context builder is unavailable")
        for item in selected:
            nodes = item.get("Nodes")
            if (item.get("Driver") != "docker" or not isinstance(nodes, list) or len(nodes) != 1 or
                    not isinstance(nodes[0], dict) or nodes[0].get("Endpoint") not in (builder, endpoint) or
                    nodes[0].get("Status") != "running" or
                    not isinstance(nodes[0].get("Platforms"), list) or
                    not {"linux/arm64", "linux/arm64/v8"}.intersection(nodes[0]["Platforms"])):
                raise ReleaseError("Producer requires a verified local Docker-driver ARM64 builder")
        return builder
    except (ValueError, TypeError, AttributeError):
        raise ReleaseError("Local Docker engine platform could not be verified") from None


def compress_file(source, target):
    with source.open("rb") as input_stream, target.open("xb") as raw:
        with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as output:
            shutil.copyfileobj(input_stream, output, 1024 * 1024)


def measure_saved_images(source, bundle, revision, epoch, images):
    """Use the same reviewed parser that the receiving host will execute."""
    try:
        specification = importlib.util.spec_from_file_location(
            "hms_committed_prebuilt_verifier", source / "ops/prebuilt_release.py")
        verifier = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(verifier)
        measured = verifier.measure_image_archive(bundle, {
            "revision": revision, "schema_epoch": epoch, "images": images})
        if (set(measured) != {"rust", "frontend"} or
                any(type(value) is not int or not 0 < value <= 100 * GIB
                    for value in measured.values())):
            raise ValueError
        verifier.verify_image_archive(bundle, {
            "revision": revision, "schema_epoch": epoch,
            "images": {component: {**image, "unpacked_size": measured[component]}
                       for component, image in images.items()}})
        return measured
    except Exception:
        # Archive/parser exceptions must never expose Docker/config contents.
        raise ReleaseError("Committed image archive integrity verification failed") from None


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish(bundle, output):
    """Publish the manifest last; mkdir/link never replace an existing path.

    A bundle without manifest.json is incomplete and cannot pass verification.
    Linking on the same filesystem avoids another full archive copy. Even an
    empty directory created by another process is never replaced or removed.
    """
    output.mkdir(mode=0o700)
    created = []
    try:
        for name in ("source.tar.gz", "images.tar.gz", "manifest.json"):
            source, target = bundle / name, output / name
            source.chmod(0o600)
            os.link(source, target)
            created.append((target, target.stat().st_ino))
            # Archive links must be durable before the manifest publishes.
            sync_directory(output)
        sync_directory(output.parent)
    except BaseException:
        for path, inode in reversed(created):
            try:
                if not path.is_symlink() and path.stat().st_ino == inode:
                    path.unlink()
            except FileNotFoundError:
                pass
        try:
            output.rmdir()
        except OSError:
            pass  # Preserve unknown files created by another process.
        raise


def produce(args):
    repository = args.repository.resolve(strict=True)
    output = args.output.absolute()
    if output.exists() or output.is_symlink():
        raise ReleaseError("Output must be a new directory, never an existing path")
    parent = output.parent.resolve(strict=True)
    # Work and output reside on the same filesystem, so atomic publish is real.
    if parent != output.parent:
        raise ReleaseError("Output parent must be a real path without symlink aliases")
    expected = source_tree(repository, args.revision)
    ensure_space(parent, args.build_budget_gib, args.reserve_gib)
    if args.cargo_build_jobs < 1 or args.cargo_build_jobs > 4:
        raise ReleaseError("Cargo build jobs must be between 1 and 4")
    builder = verify_local_engine()
    command(["docker", "buildx", "version"])
    with tempfile.TemporaryDirectory(prefix=".hms-prebuilt-", dir=parent) as temporary:
        work = Path(temporary)
        bundle = work / "bundle"
        bundle.mkdir(mode=0o700)
        source = work / "source"
        source.mkdir(mode=0o700)
        archive = work / "source.tar"
        with archive.open("xb") as stream:
            git(repository, "archive", "--format=tar", args.revision, stdout=stream)
        extract_source(archive, source, args.revision, expected)
        epoch = source_epoch(source)
        for relative in ("backend-rs/Dockerfile", "frontend/Dockerfile"):
            if "ARG HMS_BUILD_SHA" not in (source / relative).read_text():
                raise ReleaseError("Requested commit predates prebuilt image provenance support")
        if not (source / "ops/prebuilt_release.py").is_file():
            raise ReleaseError("Requested commit lacks the image archive verifier")
        compress_file(archive, bundle / "source.tar.gz")
        archive.unlink()
        images = {}
        for component, directory in (("rust", "backend-rs"), ("frontend", "frontend")):
            ensure_space(parent, args.build_budget_gib, args.reserve_gib)
            if verify_local_engine() != builder:
                raise ReleaseError("Local builder context changed during release construction")
            reference = f"hms-prebuilt-{component}:{args.revision}"
            print(f"Building Linux ARM64 {component} for {args.revision}", flush=True)
            build = ["docker", "buildx", "build", "--platform", "linux/arm64", "--load",
                     "--builder", builder,
                     "--provenance=false", "--sbom=false",
                     "--tag", reference, "--build-arg", f"HMS_BUILD_SHA={args.revision}",
                     "--label", f"org.opencontainers.image.revision={args.revision}",
                     "--label", f"systems.thehms.component={component}"]
            if component == "rust":
                build += ["--build-arg", f"CARGO_BUILD_JOBS={args.cargo_build_jobs}",
                          "--build-arg", f"HMS_SCHEMA_EPOCH={epoch}", "--label",
                          f"systems.thehms.schema-epoch={epoch}"]
            command([*build, str(source / directory)], stdout=subprocess.DEVNULL, timeout=7200)
            images[component] = inspect_image(reference, args.revision, component, epoch)
        # Reserve enough for an uncompressed save AND compressed output, without
        # assuming shared layers or compression ratio. Do not overwrite archives.
        needed = 2 * sum(image["size"] for image in images.values()) + args.reserve_gib * GIB
        if shutil.disk_usage(parent).free < needed:
            raise ReleaseError("Insufficient archive headroom; images retained, no bundle published")
        image_tar = work / "images.tar"
        command(["docker", "image", "save", "--output", str(image_tar),
                 images["rust"]["ref"], images["frontend"]["ref"]], stdout=subprocess.DEVNULL, timeout=900)
        # Detect retagging between inspect and save; both config IDs are carried
        # in the archive and the server independently validates them after load.
        for component, image in images.items():
            if inspect_image(image["ref"], args.revision, component, epoch) != image:
                raise ReleaseError("Image identity changed during export")
        compress_file(image_tar, bundle / "images.tar.gz")
        image_tar.unlink()
        measured = measure_saved_images(source, bundle, args.revision, epoch, images)
        for component, unpacked_size in measured.items():
            images[component]["unpacked_size"] = unpacked_size
        manifest = {"format": "hms-prebuilt-release-v1", "revision": args.revision,
                    "schema_epoch": epoch, "platform": "linux/arm64",
                    "source": file_record(bundle / "source.tar.gz"),
                    "images_archive": file_record(bundle / "images.tar.gz"), "images": images}
        (bundle / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        for path in bundle.iterdir():
            with path.open("rb") as stream:
                os.fsync(stream.fileno())
        publish(bundle, output)
    print(f"Published bundle for {args.revision}: {output}", flush=True)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--revision", required=True, help="Full 40-character Git commit")
    result.add_argument("--output", type=Path, required=True, help="New bundle directory")
    result.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[2])
    result.add_argument("--build-budget-gib", type=int, default=24)
    result.add_argument("--reserve-gib", type=int, default=16)
    result.add_argument("--cargo-build-jobs", type=int, default=1)
    return result


def main():
    args = parser().parse_args()
    if not 8 <= args.build_budget_gib <= 256 or not 8 <= args.reserve_gib <= 256:
        raise SystemExit("Build budget and reserve must each be between 8 and 256 GiB")
    def interrupted(signum, _frame):
        raise KeyboardInterrupt(signum)

    previous_handlers = {signum: signal.signal(signum, interrupted)
                         for signum in (signal.SIGINT, signal.SIGTERM)}
    try:
        produce(args)
    except KeyboardInterrupt as error:
        print("Prebuilt release interrupted; no incomplete bundle is accepted.", file=sys.stderr)
        return 128 + (error.args[0] if error.args else signal.SIGINT)
    except (ReleaseError, OSError, UnicodeError, tarfile.TarError) as error:
        # Exceptions from this file contain only controlled metadata/path facts.
        # Avoid dumping subprocess output or private configuration values.
        print(f"Prebuilt release failed: {error}", file=sys.stderr)
        return 1
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
