#!/usr/bin/env python3
"""Verify an operator-produced ARM64 bundle without a build or pull fallback.

The manifest protects identity and transfer integrity, not builder authenticity.
Only the reviewed free-testing Compose profile is supported by this interface.
Configuration and Docker output stay in memory; errors never echo their contents.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import subprocess
import sys
import tarfile
import zlib


FORMAT = "hms-prebuilt-release-v1"
REVISION = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
EPOCH = re.compile(r"[0-9]{12}\Z")
GIB = 1024 ** 3
MAX_JSON = 16 * 1024 * 1024
MAX_SOURCE = 2 * GIB
MAX_EXPANDED_IMAGE = 256 * GIB
PROJECT = "hms-free-test"
RUST_SERVICES = ("hms-api", "hms-worker", "hms-migrator")
APP_SERVICES = (*RUST_SERVICES, "frontend")
INFRA = ("caddy", "db", "pgbouncer", "redis")
_LEASE_MODULE = None
_LEASE_DESCRIPTOR = None


class VerificationError(Exception):
    """An intentionally PHI- and credential-free operator diagnostic."""


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def keys(value, expected, message):
    require(isinstance(value, dict) and set(value) == set(expected), message)


def positive(value, message, maximum=1024 ** 5):
    require(type(value) is int and 0 < value <= maximum, message)


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "JSON contains duplicate keys.")
        result[key] = value
    return result


def strict_json(raw):
    require(len(raw) <= MAX_JSON, "JSON exceeds the verification limit.")
    try:
        return json.loads(raw, object_pairs_hook=no_duplicates,
                          parse_constant=lambda _: (_ for _ in ()).throw(VerificationError("JSON contains a non-finite number.")))
    except (ValueError, UnicodeError, RecursionError):
        raise VerificationError("Invalid JSON document.") from None


def regular(path, private=False):
    try:
        info = path.lstat()
    except OSError:
        raise VerificationError("A required regular file is missing.") from None
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
            "Required files must be regular, unlinked files.")
    if private:
        require(info.st_uid == os.geteuid() and not info.st_mode & 0o077,
                "Private verification files require current ownership and mode 600.")
    return info


def json_file(path, private=False):
    info = regular(path, private)
    require(info.st_size <= MAX_JSON, "JSON exceeds the verification limit.")
    return strict_json(path.read_bytes())


def json_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    allow_nan=False).encode()).hexdigest()


def digest_file(path):
    regular(path)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def manifest(bundle):
    require(bundle.is_dir() and not bundle.is_symlink(), "Bundle must be a real directory.")
    directory = bundle.stat()
    require(directory.st_uid == os.geteuid() and not directory.st_mode & 0o022,
            "Bundle directory must be owned by the deployment user and not writable by others.")
    manifest_path = bundle / "manifest.json"
    info = regular(manifest_path)
    require(info.st_uid == os.geteuid() and not info.st_mode & 0o022,
            "Bundle manifest must not be writable by another user.")
    value = json_file(manifest_path)
    keys(value, ("format", "revision", "schema_epoch", "platform", "source", "images_archive", "images"),
         "Unknown or missing manifest fields.")
    require(value["format"] == FORMAT and value["platform"] == "linux/arm64", "Unsupported bundle format or platform.")
    require(isinstance(value["revision"], str) and REVISION.fullmatch(value["revision"]), "Invalid full commit identity.")
    require(isinstance(value["schema_epoch"], str) and EPOCH.fullmatch(value["schema_epoch"]), "Invalid schema epoch.")
    for field, filename in (("source", "source.tar.gz"), ("images_archive", "images.tar.gz")):
        item = value[field]
        keys(item, ("file", "sha256", "size"), "Invalid archive identity.")
        require(item["file"] == filename and isinstance(item["sha256"], str) and SHA256.fullmatch(item["sha256"]),
                "Invalid archive filename or checksum.")
        positive(item["size"], "Invalid archive size.")
    keys(value["images"], ("rust", "frontend"), "Exactly two application images are required.")
    for component, image in value["images"].items():
        keys(image, ("ref", "id", "config_id", "component", "size", "unpacked_size"), "Invalid image identity fields.")
        require(image["component"] == component and image["ref"] == f"hms-prebuilt-{component}:{value['revision']}",
                "Image component or commit-specific reference mismatch.")
        require(isinstance(image["id"], str) and DIGEST.fullmatch(image["id"]), "Invalid full engine image object digest.")
        require(isinstance(image["config_id"], str) and DIGEST.fullmatch(image["config_id"]), "Invalid canonical image config digest.")
        positive(image["size"], "Invalid image size.")
        positive(image["unpacked_size"], "Invalid unpacked image size.", MAX_EXPANDED_IMAGE)
    require(value["images"]["rust"]["id"] != value["images"]["frontend"]["id"], "Application image identities must differ.")
    require(value["images"]["rust"]["config_id"] != value["images"]["frontend"]["config_id"], "Canonical application config identities must differ.")
    return value


def verify_archives(bundle, value):
    for field in ("source", "images_archive"):
        item = value[field]
        path = bundle / item["file"]
        info = regular(path)
        require(info.st_uid == os.geteuid() and not info.st_mode & 0o022,
                "Bundle archives must not be writable by another user.")
        require(info.st_size == item["size"], "Transferred archive size mismatch.")
        require(digest_file(path) == item["sha256"], "Transferred archive checksum mismatch.")


def git_source(root, revision):
    """Use committed objects, never a staged index or ambient Git redirection."""
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_NO_REPLACE_OBJECTS="1")
    command = ["git", "-C", str(root), "-c", "core.fsmonitor=false"]
    actual = run([*command, "rev-parse", "--verify", "HEAD"], env=environment).decode().strip()
    require(actual == revision, "Git checkout is not the bundle commit.")
    entries = {}
    rows = run([*command, "ls-tree", "-rz", "--full-tree", revision], env=environment)
    for row in rows.split(b"\0"):
        if not row:
            continue
        metadata, separator, raw_name = row.partition(b"\t")
        require(bool(separator), "Invalid committed source tree.")
        fields = metadata.decode("ascii").split()
        require(len(fields) == 3 and fields[0] in ("100644", "100755") and fields[1] == "blob"
                and re.fullmatch(r"[0-9a-f]{40}", fields[2]), "Committed source must contain only ordinary files.")
        name = str(safe_member(raw_name.decode("utf-8")))
        require(name not in entries, "Committed source contains duplicate files.")
        entries[name] = (fields[0], fields[2])
    return entries


def measure_image_archive(bundle, value):
    """Producer Interface: measure saved layer expansion before manifest publish.

    The exact committed producer imports this module from its extracted source.
    Config/platform/provenance and OCI object identity are still fully checked;
    only the yet-to-be-published unpacked_size is measured rather than compared.
    """
    return _verify_image_archive(bundle, value, measuring=True)


def verify_image_archive(bundle, value):
    return _verify_image_archive(bundle, value, measuring=False)


def _verify_image_archive(bundle, value, measuring):
    """Bound docker-save expansion and prove its config blobs before loading.

    Docker Size differs across image stores. Bound the transferred archive by
    the larger reported/expanded size plus metadata, then independently stream
    every layer's expansion and compare its config's uncompressed digest.
    """
    maximum = sum(max(item["size"], item.get("unpacked_size", 0)) for item in value["images"].values()) + 16 * 1024 * 1024
    total, names, configs, saved_manifest = 0, set(), {}, None
    blobs, metadata, top_index, layout, repositories = {}, {}, None, None, None
    metadata_bytes = 0
    try:
        with tarfile.open(bundle / "images.tar.gz", "r:gz") as archive:
            for index, member in enumerate(archive):
                require(index < 100000, "Image archive has excessive members.")
                name = str(safe_member(member.name))
                require(name not in names and (member.isdir() or member.isfile()), "Image archive has duplicate, linked or special members.")
                names.add(name)
                require(member.size >= 0, "Invalid image archive member size.")
                total += member.size
                require(total <= maximum, "Image archive expansion exceeds the declared image budget.")
                if not member.isfile():
                    continue
                if name in ("manifest.json", "index.json", "oci-layout", "repositories") or name.endswith(".json") or name.startswith("blobs/sha256/"):
                    # Only small config/manifest blobs are read into memory.
                    if member.size > MAX_JSON:
                        if name.startswith("blobs/sha256/"):
                            stream = archive.extractfile(member)
                            require(stream is not None, "Unreadable image content blob.")
                            digest = hashlib.sha256()
                            for block in iter(lambda: stream.read(1024 * 1024), b""):
                                digest.update(block)
                            require(name == "blobs/sha256/" + digest.hexdigest(), "Image blob checksum mismatch.")
                            blobs["sha256:" + digest.hexdigest()] = member.size
                        continue
                    stream = archive.extractfile(member)
                    require(stream is not None, "Unreadable image metadata.")
                    raw = stream.read(MAX_JSON + 1)
                    if name == "manifest.json":
                        saved_manifest = strict_json(raw)
                    elif name == "index.json":
                        top_index = strict_json(raw)
                    elif name == "oci-layout":
                        layout = strict_json(raw)
                    elif name == "repositories":
                        repositories = strict_json(raw)
                    else:
                        digest = "sha256:" + hashlib.sha256(raw).hexdigest()
                        if name.startswith("blobs/sha256/"):
                            require(name == "blobs/sha256/" + digest[7:], "Image blob checksum mismatch.")
                            blobs[digest] = member.size
                            if raw.lstrip().startswith(b"{"):
                                candidate = strict_json(raw)
                                if isinstance(candidate, dict) and candidate.get("schemaVersion") == 2:
                                    metadata_bytes += len(raw)
                                    require(metadata_bytes <= MAX_JSON, "OCI image metadata exceeds the verification limit.")
                                    metadata[digest] = candidate
                        if digest in {item["config_id"] for item in value["images"].values()}:
                            configs[name] = (digest, strict_json(raw))
        require(isinstance(saved_manifest, list) and len(saved_manifest) == 2, "Docker-save archive must contain exactly two images.")
        found, saved_layers = set(), {}
        for saved in saved_manifest:
            require(isinstance(saved, dict) and isinstance(saved.get("Config"), str), "Invalid docker-save manifest.")
            require(saved["Config"] in configs, "Saved image config does not match either manifest image digest.")
            digest, config = configs[saved["Config"]]
            require(isinstance(config, dict) and isinstance(config.get("config"), dict),
                    "Saved image configuration has an invalid shape.")
            component = next(name for name, item in value["images"].items() if item["config_id"] == digest)
            require(component not in found, "Docker-save archive repeats an image identity.")
            found.add(component)
            require(saved.get("RepoTags") == [value["images"][component]["ref"]], "Saved image transport tag mismatch.")
            require(isinstance(saved.get("Layers"), list) and all(isinstance(layer, str) and layer in names for layer in saved["Layers"]),
                    "Saved image layer is absent from the archive.")
            saved_layers[component] = saved["Layers"]
            require(config.get("os") == "linux" and config.get("architecture") == "arm64", "Saved image config platform mismatch.")
            labels = config.get("config", {}).get("Labels") or {}
            require(isinstance(labels, dict), "Saved image provenance labels have an invalid shape.")
            require(labels.get("org.opencontainers.image.revision") == value["revision"]
                    and labels.get("systems.thehms.component") == component, "Saved image provenance label mismatch.")
            if component == "rust":
                require(labels.get("systems.thehms.schema-epoch") == value["schema_epoch"], "Saved image schema epoch mismatch.")
        require(found == {"rust", "frontend"}, "Docker-save archive lacks an application image.")
        if top_index is not None or layout is not None:
            verify_oci_index(top_index, layout, metadata, blobs, saved_layers, value)
        else:
            require(all(image["id"] == image["config_id"] for image in value["images"].values()),
                    "Non-OCI image archives must use canonical config object IDs.")
        if repositories is not None:
            expected_repositories = {}
            for component, image in value["images"].items():
                require(saved_layers[component], "Legacy repository map requires image layers.")
                expected_repositories[image["ref"].split(":", 1)[0]] = {
                    value["revision"]: saved_layers[component][-1].split("/", 1)[0]}
            require(repositories == expected_repositories, "Legacy image repository map contains unexpected tags.")
        layer_names = {name for layers in saved_layers.values() for name in layers}
        layer_facts = {}
        maximum_expansion = (2 * MAX_EXPANDED_IMAGE if measuring else
                             sum(image["unpacked_size"] for image in value["images"].values()))
        expanded_total = 0
        with tarfile.open(bundle / "images.tar.gz", "r:gz") as archive:
            for member in archive:
                if member.name not in layer_names:
                    continue
                require(member.isfile(), "Saved image layers must be ordinary archive files.")
                stream = archive.extractfile(member)
                require(stream is not None, "Saved image layer is unreadable.")
                # Inspect without extracting anything onto the host. Docker owns
                # container rootfs extraction, including legitimate image links.
                stream = stream if hasattr(stream, "peek") else io.BufferedReader(stream)
                expanded = gzip.GzipFile(fileobj=stream, mode="rb") if stream.peek(2)[:2] == b"\x1f\x8b" else stream
                digest, size = hashlib.sha256(), 0
                with expanded:
                    for block in iter(lambda: expanded.read(1024 * 1024), b""):
                        size += len(block)
                        expanded_total += len(block)
                        require(size <= MAX_EXPANDED_IMAGE and expanded_total <= maximum_expansion,
                                "Image layer expansion exceeds the declared storage limit.")
                        digest.update(block)
                layer_facts[member.name] = ("sha256:" + digest.hexdigest(), size)
        require(layer_names <= set(layer_facts), "Saved image layers could not be verified.")
        unpacked = {}
        for component, image in value["images"].items():
            config = next(config for digest, config in configs.values() if digest == image["config_id"])
            rootfs = config.get("rootfs")
            require(isinstance(rootfs, dict) and rootfs.get("type") == "layers"
                    and isinstance(rootfs.get("diff_ids"), list), "Saved image lacks exact uncompressed layer identities.")
            layers = saved_layers[component]
            require(len(layers) == len(set(layers)) and len(layers) == len(rootfs["diff_ids"])
                    and [layer_facts[name][0] for name in layers] == rootfs["diff_ids"],
                    "Expanded image layers disagree with their canonical config.")
            size = sum(layer_facts[name][1] for name in layers)
            positive(size, "Invalid expanded image size.", MAX_EXPANDED_IMAGE)
            require(measuring or size == image["unpacked_size"], "Declared unpacked image size differs from verified layer expansion.")
            unpacked[component] = size
        return unpacked
    except (OSError, EOFError, tarfile.TarError, UnicodeError, StopIteration, zlib.error):
        raise VerificationError("Image archive could not be verified.") from None


def verify_oci_index(index, layout, metadata, blobs, saved_layers, value):
    """Bind modern docker-save OCI graphs as well as its legacy manifest.

    Docker may preserve absent foreign-platform descriptors in a sparse index.
    Present leaves must all be one of the exact two ARM64 application configs;
    provenance attestations and extra tags/images are deliberately unsupported.
    """
    require(layout == {"imageLayoutVersion": "1.0.0"} and isinstance(index, dict)
            and index.get("schemaVersion") == 2 and isinstance(index.get("manifests"), list)
            and len(index["manifests"]) == 2, "OCI archive must index exactly the two release images.")
    reached, present_configs = set(), set()
    index_types = {"application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"}
    image_types = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}

    def descriptor(item, depth=0):
        require(isinstance(item, dict) and depth < 8 and isinstance(item.get("digest"), str)
                and DIGEST.fullmatch(item["digest"]), "Invalid OCI image descriptor.")
        digest = item["digest"]
        require("urls" not in item and "data" not in item, "External OCI descriptor content is forbidden.")
        positive(item.get("size"), "Invalid OCI descriptor size.")
        require(blobs.get(digest) == item["size"], "OCI descriptor content is missing or has a different size.")
        require(digest not in reached, "OCI metadata contains a duplicate or cyclic descriptor.")
        reached.add(digest)
        content = metadata.get(digest)
        require(isinstance(content, dict) and content.get("schemaVersion") == 2
                and content.get("mediaType") == item.get("mediaType"), "OCI descriptor media type mismatch.")
        platform_value = item.get("platform")
        if platform_value is not None:
            require(isinstance(platform_value, dict) and platform_value.get("os") == "linux"
                    and platform_value.get("architecture") == "arm64" and platform_value.get("variant", "") in ("", "v8"),
                    "OCI archive contains an unsupported platform or attestation.")
        if item["mediaType"] in index_types:
            children = content.get("manifests")
            require(isinstance(children, list) and len(children) <= 64, "Invalid OCI image index.")
            found = set()
            for child in children:
                require(isinstance(child, dict) and isinstance(child.get("digest"), str)
                        and DIGEST.fullmatch(child["digest"]) and child.get("mediaType") in index_types | image_types,
                        "Invalid nested OCI descriptor.")
                positive(child.get("size"), "Invalid nested OCI descriptor size.")
                if child["digest"] not in blobs:
                    foreign = child.get("platform", {})
                    require(isinstance(foreign, dict) and foreign.get("os") and foreign.get("architecture")
                            and (foreign["os"], foreign["architecture"]) != ("linux", "arm64"),
                            "OCI index is missing the declared target platform.")
                    continue
                found.update(descriptor(child, depth + 1))
            require(len(found) == 1, "OCI component must resolve to exactly one application config.")
            return found
        require(item["mediaType"] in image_types and isinstance(content.get("config"), dict)
                and isinstance(content.get("layers"), list), "Unsupported OCI image manifest.")
        config = content["config"]
        require("urls" not in config and "data" not in config
                and config.get("mediaType") in ("application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"),
                "External or unsupported OCI config content is forbidden.")
        config_id = config.get("digest")
        matching = [component for component, image in value["images"].items() if image["config_id"] == config_id]
        require(len(matching) == 1 and blobs.get(config_id) == config.get("size"),
                "OCI manifest config is outside the verified release.")
        component = matching[0]
        require(value["images"][component]["id"] in (config_id, digest),
                "Producer object ID does not identify the canonical config or its platform manifest.")
        reached.add(config_id)
        paths = []
        for layer in content["layers"]:
            require(isinstance(layer, dict) and isinstance(layer.get("digest"), str)
                    and DIGEST.fullmatch(layer["digest"]) and type(layer.get("size")) is int
                    and blobs.get(layer["digest"]) == layer["size"] and "urls" not in layer and "data" not in layer
                    and layer.get("mediaType") in ("application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip",
                                                   "application/vnd.docker.image.rootfs.diff.tar.gzip"),
                    "OCI layer identity, content type or size mismatch.")
            reached.add(layer["digest"])
            paths.append("blobs/sha256/" + layer["digest"][7:])
        require(paths == saved_layers[component], "OCI layers disagree with the docker-save manifest.")
        return {config_id}

    for item in index["manifests"]:
        configs = descriptor(item)
        require(not configs & present_configs, "OCI index repeats an application image.")
        present_configs.update(configs)
        config_id = next(iter(configs))
        component = next(component for component, image in value["images"].items() if image["config_id"] == config_id)
        reference = value["images"][component]["ref"]
        annotations = item.get("annotations", {})
        require(isinstance(annotations, dict), "Invalid OCI transport annotations.")
        require("config.digest" not in annotations or annotations["config.digest"] == config_id,
                "OCI transport config annotation disagrees with the canonical image config.")
        for key in ("io.containerd.image.name", "org.opencontainers.image.ref.name"):
            if key in annotations:
                accepted = {reference, "docker.io/library/" + reference}
                if key == "org.opencontainers.image.ref.name":
                    accepted.add(value["revision"])
                require(annotations[key] in accepted, "OCI index contains an unexpected transport tag.")
    require(present_configs == {image["config_id"] for image in value["images"].values()}
            and set(blobs) == reached, "OCI archive contains missing or unreferenced image content.")


def safe_member(name):
    require(isinstance(name, str) and name and "\\" not in name and "\x00" not in name,
            "Unsafe source archive member.")
    path = PurePosixPath(name)
    require(not path.is_absolute() and all(part not in ("", ".", "..") for part in name.rstrip("/").split("/")),
            "Unsafe source archive member.")
    require(path.parts[0] != ".git", "Source archive cannot contain Git private state.")
    return path


def run(args, timeout=120, env=None):
    descriptors = ()
    if _LEASE_MODULE is not None:
        try:
            require(_LEASE_MODULE.inherited_fd() == _LEASE_DESCRIPTOR, "The deployment lease changed during verification.")
        except (_LEASE_MODULE.LeaseError, OSError, ValueError):
            raise VerificationError("The canonical host deployment lease is no longer held.") from None
        descriptors = (_LEASE_DESCRIPTOR,)
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False, env=env,
                                pass_fds=descriptors)
    except (OSError, subprocess.TimeoutExpired):
        raise VerificationError("A required verification command failed or timed out.") from None
    require(result.returncode == 0, "A required verification command failed.")
    require(len(result.stdout) <= MAX_JSON, "Verification command returned excessive output.")
    return result.stdout


def hold_inherited_lease(root):
    """Validate the canonical kernel lease and retain it in child processes."""
    global _LEASE_MODULE, _LEASE_DESCRIPTOR
    require(root.resolve() == Path(__file__).resolve().parents[1],
            "Prebuilt preparation must execute the candidate's own deployment controls.")
    helper = root / "ops/deploy-lease.py"
    regular(helper)
    spec = importlib.util.spec_from_file_location("_hms_prebuilt_deploy_lease", helper)
    require(spec is not None and spec.loader is not None, "The canonical deployment lease helper is unavailable.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        descriptor = module.inherited_fd()
    except (module.LeaseError, OSError, ValueError):
        raise VerificationError("Prebuilt preparation requires the canonical host deployment lease.") from None
    _LEASE_MODULE, _LEASE_DESCRIPTOR = module, descriptor


def verify_source(bundle, value, root):
    """Compare without extracting; links and special files never reach the host."""
    require(root.is_dir() and not root.is_symlink(), "Source root must be a real directory.")
    root = root.resolve()
    committed = git_source(root, value["revision"]) if (root / ".git").exists() else None
    names, files, total, epoch = set(), set(), 0, None
    try:
        with tarfile.open(bundle / "source.tar.gz", "r:gz") as archive:
            for index, member in enumerate(archive):
                require(index < 100000, "Source archive has excessive members.")
                relative = safe_member(member.name)
                name = str(relative)
                require(name not in names, "Source archive contains duplicate members.")
                names.add(name)
                require(member.isdir() or member.isfile(), "Source archive contains links or special files.")
                target = root.joinpath(*relative.parts)
                require(target.resolve().is_relative_to(root), "Source path resolves outside its root.")
                require(not any(root.joinpath(*relative.parts[:n]).is_symlink() for n in range(1, len(relative.parts) + 1)),
                        "Source paths cannot contain symlinks.")
                if member.isdir():
                    require(target.is_dir(), "Source archive directory is missing from the candidate.")
                    continue
                require(member.size >= 0, "Invalid source member size.")
                total += member.size
                require(total <= MAX_SOURCE, "Source archive exceeds the expanded size limit.")
                info = regular(target)
                expected_mode = 0o755 if member.mode & 0o111 else 0o644
                require(stat.S_IMODE(info.st_mode) == expected_mode and info.st_size == member.size,
                        "Candidate source mode or size differs from its commit archive.")
                stream = archive.extractfile(member)
                require(stream is not None, "Unreadable source archive member.")
                digest = hashlib.sha256()
                blob_digest = hashlib.sha1(f"blob {member.size}\0".encode())
                remaining = member.size
                with stream:
                    while remaining:
                        block = stream.read(min(1024 * 1024, remaining))
                        require(bool(block), "Truncated source archive member.")
                        remaining -= len(block)
                        digest.update(block)
                        blob_digest.update(block)
                require(digest.hexdigest() == digest_file(target), "Candidate source bytes differ from the commit archive.")
                if committed is not None:
                    mode = "100755" if member.mode & 0o111 else "100644"
                    require(committed.get(name) == (mode, blob_digest.hexdigest()),
                            "Archive source bytes or mode differ from the actual commit object.")
                files.add(name)
                if name == "ops/compose-v2/runtime-schema-epoch":
                    require(member.size <= 64, "Invalid archived schema declaration.")
                    epoch = target.read_text().strip()
            require(archive.pax_headers.get("comment") == value["revision"], "Git archive commit identity mismatch.")
    except (OSError, tarfile.TarError, UnicodeError):
        raise VerificationError("Source archive could not be verified.") from None
    require(epoch == value["schema_epoch"], "Archived runtime schema epoch mismatch.")
    required = {"ops/prebuilt_release.py", "ops/compose-v2/deploy.sh", "ops/free-testing/deploy.sh",
                "ops/compose-v2/compose.yml", "ops/free-testing/compose.yml"}
    require(required <= files, "Source archive lacks prebuilt deployment controls.")
    if committed is not None:
        require(set(committed) == files, "Committed source set differs from the commit archive.")
    return total


def read_env(path):
    regular(path, private=True)
    require(path.stat().st_size <= 1024 * 1024, "Private env file exceeds the size limit.")
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        require(separator and re.fullmatch(r"[A-Z][A-Z_0-9]*", key) and key not in values,
                "Private env has invalid or duplicate settings.")
        require(not any(char in value for char in "\x00\r\n"), "Private env contains invalid content.")
        values[key] = value
    for key, expected in {"COMPOSE_PROJECT_NAME": PROJECT, "HMS_ENV": "staging", "HMS_SEED_DEMO_DATA": "true",
                          "HMS_DEMO_SEED_PROFILE": "smoke", "HMS_COOKIE_SECURE": "true"}.items():
        require(values.get(key) == expected, "Prebuilt deployment requires the private synthetic profile.")
    return values


def verify_environment(root, values, value):
    require(not os.environ.get("COMPOSE_PROFILES"), "Ambient Compose profiles are forbidden for prebuilt deployment.")
    for key in ("COMPOSE_ENV_FILES", "COMPOSE_PATH_SEPARATOR"):
        require(not os.environ.get(key), "Ambient Compose discovery overrides are forbidden.")
    variables = set(values)
    for relative in ("ops/compose-v2/compose.yml", "ops/free-testing/compose.yml"):
        variables.update(re.findall(r"(?<!\$)\$\{([A-Z][A-Z_0-9]*)", (root / relative).read_text()))
    for key in variables:
        if key not in os.environ or key == "HMS_DEPLOYED_AT":
            continue
        expected = value["revision"] if key == "HMS_BUILD_SHA" else values.get(key, "")
        require(os.environ[key] == expected, "Shell settings conflict with the verified private Compose configuration.")


def docker_json(args):
    return strict_json(run(["docker", *args]))


def verify_platform(item):
    require(item.get("Os", item.get("OSType")) == "linux" and item.get("Architecture") in ("arm64", "aarch64"),
            "Prebuilt images require a Linux ARM64 Docker engine and image platform.")
    require(item.get("Variant", "") in ("", "v8"), "Unsupported ARM64 image variant.")


def engine():
    require(platform.system() == "Linux", "Server preflight must run on the Linux deployment host.")
    require(not os.environ.get("DOCKER_HOST") and not os.environ.get("DOCKER_CONTEXT"),
            "Remote Docker endpoint overrides cannot establish local disk headroom.")
    context = docker_json(["context", "inspect"])
    require(isinstance(context, list) and len(context) == 1
            and context[0].get("Endpoints", {}).get("docker", {}).get("Host", "").startswith("unix:///"),
            "Disk preflight requires a local Unix Docker endpoint.")
    info = docker_json(["info", "--format", "{{json .}}"])
    require(isinstance(info, dict), "Invalid Docker engine metadata.")
    verify_platform(info)
    directory = storage_directory(info.get("DockerRootDir"), "Docker volume storage directory is unavailable or unsafe.")
    return directory, info


def storage_directory(value, message):
    require(isinstance(value, str) and value.startswith("/") and "\x00" not in value, message)
    path = Path(value)
    require(path != Path("/") and path.is_dir() and path.resolve(strict=True) == path, message)
    return path


def image_storage(docker_root, info, values):
    """Docker's containerd image store may live outside DockerRootDir.

    The explicit containerd path is an operator attestation from reviewed daemon
    configuration, not an automatic discovery claim. Unknown stores fail closed.
    """
    status = info.get("DriverStatus", [])
    require(isinstance(status, list) and all(isinstance(row, list) and len(row) == 2
            and all(isinstance(item, str) for item in row) for row in status),
            "Docker storage driver metadata is unavailable or invalid.")
    entries = dict(status)
    require(len(entries) == len(status), "Docker storage driver metadata is ambiguous.")
    driver = info.get("Driver")
    store = entries.get("driver-type")
    if store == "io.containerd.snapshotter.v1":
        require(isinstance(driver, str) and driver in ("overlayfs", "native", "fuse-overlayfs"),
                "Unsupported containerd snapshotter storage driver.")
        reviewed = os.environ.get("HMS_CONTAINERD_ROOT", values.get("HMS_CONTAINERD_ROOT"))
        return storage_directory(reviewed,
                "Containerd image storage requires an explicit reviewed HMS_CONTAINERD_ROOT real directory.")
    require(store is None and driver in ("overlay2", "fuse-overlayfs", "vfs"),
            "Docker image storage cannot be established for this driver.")
    return docker_root


def gib_setting(values, key, default):
    raw = os.environ.get(key, values.get(key, str(default)))
    require(isinstance(raw, str) and raw.isdigit() and 0 < int(raw) <= 1048576,
            "Deployment storage budgets must be positive whole GiB values.")
    return int(raw) * GIB


def headroom(bundle, value, root, env_file, expanded_source=MAX_SOURCE):
    values = read_env(env_file)
    docker_root, info = engine()
    image_root = image_storage(docker_root, info, values)
    reserve = gib_setting(values, "HMS_DEPLOY_RESERVE_GIB", 10)
    backup = gib_setting(values, "HMS_DEPLOY_BACKUP_BUDGET_GIB", 4)
    migration = gib_setting(values, "HMS_DEPLOY_MIGRATION_BUDGET_GIB", 2)
    # Archive and source charges deliberately overestimate already transferred
    # files. Shared image layers are also counted twice rather than guessed.
    image_bytes = sum(max(image["size"], 2 * image["unpacked_size"]) + GIB
                      for image in value["images"].values())
    backup_path = Path(os.environ.get("BACKUP_DIR", values.get("BACKUP_DIR", str(root / "ops/compose-v2/backups"))))
    if not backup_path.is_absolute():
        backup_path = root / backup_path
    backup_path = backup_path.resolve()
    while not backup_path.exists():
        backup_path = backup_path.parent
    require(backup_path.is_dir(), "Backup filesystem cannot be measured.")
    charges = [(image_root, image_bytes), (docker_root, migration),
               (bundle, value["images_archive"]["size"] + value["source"]["size"] + expanded_source),
               (root, migration), (backup_path, backup)]
    grouped = {}
    for path, required_bytes in charges:
        device = path.stat().st_dev
        previous = grouped.get(device, (path, 0))
        grouped[device] = (path, previous[1] + required_bytes)
    facts = []
    for path, required_bytes in grouped.values():
        disk = os.statvfs(path)
        total = disk.f_blocks * disk.f_frsize
        free = disk.f_bavail * disk.f_frsize
        require(total > 0 and free >= 0, "Disk capacity could not be measured.")
        remaining = free - required_bytes
        require(remaining > reserve and (total - remaining) * 100 < total * 85,
                "Insufficient deployment headroom: preserve PostgreSQL reserve and stay below 85% projected usage.")
        facts.append({"free_bytes": free, "budget_bytes": required_bytes, "reserve_bytes": reserve,
                      "warning": (total - free) * 100 >= total * 70})
    return facts


def report_storage_warning(facts):
    if any(item.get("warning") for item in facts):
        print("Storage warning: at least one deployment filesystem is 70% used or higher; review capacity.")


def inspect_image(reference):
    items = docker_json(["image", "inspect", reference])
    require(isinstance(items, list) and len(items) == 1 and isinstance(items[0], dict), "Required image is not locally available.")
    verify_platform(items[0])
    require(isinstance(items[0].get("Id"), str) and DIGEST.fullmatch(items[0]["Id"]), "Invalid loaded image identity.")
    return items[0]


def verify_images(value, image_ids=None):
    actual_ids = {}
    for component, expected in value["images"].items():
        actual = inspect_image(expected["ref"])
        require(isinstance(actual.get("Config"), dict), "Loaded image configuration has an invalid shape.")
        labels = actual.get("Config", {}).get("Labels") or {}
        require(isinstance(labels, dict), "Loaded image labels have an invalid shape.")
        require(actual["Id"] in (expected["id"], expected["config_id"]), "Loaded image object ID does not match the release.")
        if image_ids is not None:
            require(actual["Id"] == image_ids[component], "Loaded image object identity changed after preparation.")
        if actual["Id"] != expected["config_id"]:
            descriptor = actual.get("Descriptor")
            require(isinstance(descriptor, dict) and descriptor.get("digest") == actual["Id"]
                    and isinstance(descriptor.get("annotations"), dict)
                    and descriptor["annotations"].get("config.digest") == expected["config_id"],
                    "Loaded engine object is not bound to the canonical image config.")
        positive(actual.get("Size"), "Loaded image reported an invalid storage size.")
        require(actual["Size"] <= max(expected["size"], expected["unpacked_size"]) + 16 * 1024 * 1024,
                "Loaded image storage exceeds the verified image budget.")
        require(labels.get("org.opencontainers.image.revision") == value["revision"]
                and labels.get("systems.thehms.component") == component,
                "Loaded image commit or component label mismatch.")
        if component == "rust":
            require(labels.get("systems.thehms.schema-epoch") == value["schema_epoch"], "Loaded Rust image schema epoch mismatch.")
        require(inspect_image(actual["Id"])["Id"] == actual["Id"], "Loaded engine image identity is not locally addressable.")
        actual_ids[component] = actual["Id"]
    return actual_ids


def compose_model(root, env_file, tunnel=False):
    args = ["docker", "compose", "--env-file", str(env_file), "-f", str(root / "ops/compose-v2/compose.yml"),
            "-f", str(root / "ops/free-testing/compose.yml")]
    if tunnel:
        args.extend(["--profile", "tunnel"])
    return strict_json(run([*args, "config", "--format", "json"]))


def model_contract(model, tunnel=False, value=None, infra_ids=None, image_ids=None):
    require(isinstance(model, dict) and model.get("name") == PROJECT, "Unexpected Compose project.")
    services = model.get("services")
    expected = set(APP_SERVICES) | set(INFRA) | ({"cloudflared"} if tunnel else set())
    require(isinstance(services, dict) and set(services) == expected, "Unexpected or missing active Compose service.")
    for name, service in services.items():
        require(isinstance(service, dict), "Invalid Compose service.")
        require(isinstance(service.get("ports", []), list)
                and isinstance(service.get("environment", {}), dict), "Invalid Compose service settings.")
        for port in service.get("ports", []):
            require(isinstance(port, dict) and name == "caddy" and port.get("host_ip") == "127.0.0.1",
                    "Prebuilt profile exposes an unexpected host port.")
        if value:
            require("build" not in service, "Prebuilt Compose configuration retains a build declaration.")
            require(service.get("pull_policy") == "never" and service.get("platform") == "linux/arm64",
                    "Prebuilt services must explicitly forbid pulls and bind ARM64.")
            if name in APP_SERVICES:
                image = image_ids["frontend" if name == "frontend" else "rust"]
            else:
                image = infra_ids[name]
            require(service.get("image") == image, "Compose image identity differs from verified image pins.")
    for name in RUST_SERVICES:
        environment = services[name].get("environment", {})
        require(environment.get("HMS_ENV") == "staging" and environment.get("HMS_COOKIE_SECURE") == "true"
                and environment.get("HMS_DEPLOYMENT_PROFILE") == "hospital",
                "Unexpected clinical deployment runtime profile.")
        require(environment.get("HMS_AUTO_MIGRATE") == "false", "Application runtime must not auto-migrate.")
        if value:
            require(environment.get("HMS_BUILD_SHA") == value["revision"] and environment.get("HMS_IMAGE_TAG") == value["revision"],
                    "Runtime provenance differs from the image manifest.")
    migrator = services["hms-migrator"]["environment"]
    require(migrator.get("HMS_SEED_DEMO_DATA") == "true" and migrator.get("HMS_DEMO_SEED_PROFILE") == "smoke",
            "Prebuilt free-testing mode requires the synthetic smoke seed.")
    api = services["hms-api"]["environment"]
    require(api.get("HMS_ACCOUNT_SETUP_DELIVERY_MODE") == "disabled", "Synthetic account delivery must remain disabled.")
    frontend = services["frontend"].get("environment", {})
    require(frontend.get("HMS_API_MODE") == "rust-v2" and frontend.get("V2_API_BASE_URL") == "/api/v2",
            "Frontend must use the Rust V2 API.")
    return services


def pinned_model(base, value, infra, image_ids=None):
    image_ids = image_ids or {component: image["id"] for component, image in value["images"].items()}
    expected = copy.deepcopy(base)
    for name, service in expected["services"].items():
        service.update(platform="linux/arm64", pull_policy="never")
        if name in APP_SERVICES:
            service.pop("build", None)
            service["image"] = image_ids["frontend" if name == "frontend" else "rust"]
        else:
            service["image"] = infra[name]
        if name in RUST_SERVICES:
            service["environment"].update(HMS_BUILD_SHA=value["revision"], HMS_IMAGE_TAG=value["revision"])
    return expected


def private_output_parent(path):
    parent = path.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.geteuid() and not parent.st_mode & 0o077,
            "Verification output requires a private directory owned by the deployment user.")


def private_write(path, content):
    private_output_parent(path)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def prepare(bundle, root, env_file, override, tunnel=False):
    require(not os.path.lexists(override) and not os.path.lexists(str(override) + ".verification.json"),
            "Verification output already exists.")
    private_output_parent(override)
    value = manifest(bundle)
    verify_archives(bundle, value)
    expanded = verify_source(bundle, value, root)
    verify_image_archive(bundle, value)
    values = read_env(env_file)
    verify_environment(root, values, value)
    base_model = compose_model(root, env_file, tunnel)
    services = model_contract(base_model, tunnel)
    facts = headroom(bundle, value, root, env_file, expanded)
    report_storage_warning(facts)
    infra = {}
    for name in (*INFRA, *(("cloudflared",) if tunnel else ())):
        reference = services[name].get("image")
        require(isinstance(reference, str) and reference, "Required infrastructure image reference is missing.")
        infra[name] = inspect_image(reference)["Id"]
    run(["docker", "image", "load", "--input", str(bundle / "images.tar.gz")], timeout=1800)
    image_ids = verify_images(value)
    lines = ["# Generated from a verified prebuilt bundle; do not edit.", "services:"]
    for name in (*APP_SERVICES, *infra):
        image = image_ids["frontend" if name == "frontend" else "rust"] if name in APP_SERVICES else infra[name]
        lines.extend([f"  {name}:", f"    image: '{image}'", "    platform: linux/arm64", "    pull_policy: never"])
        if name in APP_SERVICES:
            lines.append("    build: !reset null")
        if name in RUST_SERVICES:
            lines.extend(["    environment:", f"      HMS_BUILD_SHA: '{value['revision']}'", f"      HMS_IMAGE_TAG: '{value['revision']}'"])
    content = ("\n".join(lines) + "\n").encode()
    sidecar = {"format": FORMAT, "manifest_sha256": digest_file(bundle / "manifest.json"),
               "override_sha256": hashlib.sha256(content).hexdigest(), "infra_ids": infra,
               "model_sha256": json_digest(pinned_model(base_model, value, infra, image_ids)),
               "image_ids": image_ids, "tunnel": tunnel, "disk": facts}
    private_write(override, content)
    private_write(Path(str(override) + ".verification.json"), (json.dumps(sidecar, sort_keys=True) + "\n").encode())
    print("Prebuilt bundle, source, ARM64 images and deployment headroom verified.")


def verified_model(bundle, config, override, tunnel=False):
    value = manifest(bundle)
    sidecar = json_file(Path(str(override) + ".verification.json"), private=True)
    keys(sidecar, ("format", "manifest_sha256", "override_sha256", "infra_ids", "image_ids", "model_sha256", "tunnel", "disk"), "Invalid preparation receipt.")
    require(sidecar["format"] == FORMAT and sidecar["tunnel"] is tunnel
            and sidecar["manifest_sha256"] == digest_file(bundle / "manifest.json"), "Preparation receipt is for another bundle or profile.")
    regular(override, private=True)
    require(sidecar["override_sha256"] == digest_file(override), "Generated Compose override changed after verification.")
    infra = sidecar["infra_ids"]
    keys(infra, (*INFRA, *(("cloudflared",) if tunnel else ())), "Invalid infrastructure image pins.")
    require(all(isinstance(item, str) and DIGEST.fullmatch(item) for item in infra.values()), "Invalid infrastructure image identity.")
    image_ids = sidecar["image_ids"]
    keys(image_ids, ("rust", "frontend"), "Invalid application engine image pins.")
    require(all(isinstance(item, str) and DIGEST.fullmatch(item) for item in image_ids.values()), "Invalid engine image identity.")
    model = json_file(config, private=True)
    services = model_contract(model, tunnel, value, infra, image_ids)
    require(sidecar["model_sha256"] == json_digest(model),
            "Final Compose settings differ from the verified source and private configuration.")
    # Detect deletion/replacement of a loaded image before mutating Compose calls.
    verify_images(value, image_ids)
    for image in infra.values():
        require(inspect_image(image)["Id"] == image, "Pinned infrastructure image is missing.")
    return value, model, services


def verify_containers(bundle, config, override, tunnel=False):
    value, _, services = verified_model(bundle, config, override, tunnel)
    for service in ("hms-api", "hms-worker", "frontend"):
        identifiers = run(["docker", "ps", "--quiet", "--filter", f"label=com.docker.compose.project={PROJECT}",
                           "--filter", f"label=com.docker.compose.service={service}",
                           "--filter", "label=com.docker.compose.oneoff=False"]).decode().splitlines()
        require(len(identifiers) == 1 and re.fullmatch(r"[0-9a-f]{12,64}", identifiers[0]),
                "Expected exactly one running application container per service.")
        items = docker_json(["inspect", identifiers[0]])
        require(isinstance(items, list) and len(items) == 1, "Application container could not be inspected.")
        item = items[0]
        require(isinstance(item, dict) and isinstance(item.get("Config"), dict)
                and isinstance(item.get("State"), dict), "Invalid running container metadata.")
        labels = item.get("Config", {}).get("Labels") or {}
        require(labels.get("com.docker.compose.project") == PROJECT
                and labels.get("com.docker.compose.service") == service
                and labels.get("com.docker.compose.oneoff") == "False"
                and item.get("State", {}).get("Running") is True
                and item.get("Image") == services[service]["image"], "Running container identity differs from the verified release.")
        config = item["Config"]
        environment = config.get("Env")
        require(isinstance(environment, list) and all(isinstance(entry, str) and "=" in entry for entry in environment),
                "Running container environment cannot be verified.")
        entries = [entry.split("=", 1) for entry in environment]
        actual_env = dict(entries)
        require(len(actual_env) == len(entries), "Running container environment contains ambiguous settings.")
        for key, expected in services[service].get("environment", {}).items():
            require((expected is None and key not in actual_env) or (isinstance(expected, str) and actual_env.get(key) == expected),
                    "Running container settings differ from the verified private configuration.")
        image_config = inspect_image(item["Image"]).get("Config", {})
        require(isinstance(image_config, dict), "Loaded runtime image configuration is invalid.")
        command = services[service].get("command", image_config.get("Cmd"))
        entrypoint = services[service].get("entrypoint", image_config.get("Entrypoint"))
        require((config.get("Cmd") or []) == (command or [])
                and (config.get("Entrypoint") or []) == (entrypoint or []),
                "Running container command differs from the verified release.")
    print("Running application containers match the verified prebuilt release.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "headroom", "check-compose", "verify-containers", "revision"):
        child = subparsers.add_parser(command)
        child.add_argument("--bundle", type=Path, required=True)
        if command in ("prepare", "headroom"):
            child.add_argument("--root", type=Path, required=True)
            child.add_argument("--env-file", type=Path, required=True)
        if command in ("prepare", "check-compose", "verify-containers"):
            child.add_argument("--override", type=Path, required=True)
            child.add_argument("--tunnel", action="store_true")
        if command in ("check-compose", "verify-containers"):
            child.add_argument("--config", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            hold_inherited_lease(args.root)
        elif os.environ.get("HMS_DEPLOY_LEASE_FD"):
            hold_inherited_lease(Path(__file__).resolve().parents[1])
        if args.command == "prepare":
            prepare(args.bundle, args.root, args.env_file, args.override, args.tunnel)
        elif args.command == "revision":
            print(manifest(args.bundle)["revision"])
        elif args.command == "headroom":
            value = manifest(args.bundle)
            facts = headroom(args.bundle, value, args.root, args.env_file)
            report_storage_warning(facts)
            print("Deployment disk headroom remains sufficient.")
        elif args.command == "check-compose":
            verified_model(args.bundle, args.config, args.override, args.tunnel)
            print("Final Compose model uses only verified images without build or pull.")
        else:
            verify_containers(args.bundle, args.config, args.override, args.tunnel)
        return 0
    except VerificationError as error:
        print(f"Prebuilt verification refused: {error} No build or pull fallback is permitted.", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError, UnicodeError):
        # Never print exception repr: JSON, env, Docker and subprocess failures
        # can otherwise include credentials or protected runtime configuration.
        print("Prebuilt release verification failed; no build or pull fallback is permitted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
