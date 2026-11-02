#!/usr/bin/env python3
"""Record verified releases and plan narrowly scoped application image cleanup.

All commands require the real host deployment lease. Cleanup is opt-in and
requires the digest of a fresh plan. Database volumes, other image tags, caches,
transfer archives and source trees are never cleanup targets.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile
import tempfile
import uuid


def load_module(name, filename):
    specification = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


prebuilt = load_module("retention_prebuilt", "prebuilt_release.py")
state_helper = load_module("retention_state", "prebuilt_state.py")
FORMAT = "hms-prebuilt-retention-v1"
MAX_RECORDS = 4096
COMPONENTS = ("rust", "frontend")


class RetentionError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise RetentionError(message)


def canonical_json(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def private_json(path):
    info = prebuilt.regular(path, private=True)
    require(stat.S_IMODE(info.st_mode) == 0o600, "Ledger files must have mode 0600.")
    return prebuilt.json_file(path, private=True)


def private_directory(path):
    state_helper.private_directory(path)


def ledger_directory(root, state, create=False):
    expected = state_helper.state_directory(root) / "releases"
    require(state.is_absolute() and state == expected, "Release ledger cannot be redirected.")
    if not state.exists() and not create:
        return False
    private_directory(state)
    for name in ("receipts", "events", "cleanup"):
        if create or (state / name).exists():
            private_directory(state / name)
    return True


def require_local_docker():
    require(not os.environ.get("DOCKER_HOST") and not os.environ.get("DOCKER_CONTEXT"),
            "Release retention requires the local Docker endpoint without overrides.")
    contexts = prebuilt.docker_json(["context", "inspect"])
    require(isinstance(contexts, list) and len(contexts) == 1 and isinstance(contexts[0], dict),
            "Local Docker context could not be verified.")
    endpoint = contexts[0].get("Endpoints", {}).get("docker", {}).get("Host")
    require(isinstance(endpoint, str) and endpoint.startswith("unix:///"),
            "Release retention cannot target a remote Docker endpoint.")


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json(path, value, replace=False):
    content = canonical_json(value)
    descriptor, temporary = tempfile.mkstemp(prefix=".ledger-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            if os.path.lexists(path):
                private_json(path)
            os.replace(temporary, path)
        else:
            os.link(temporary, path)
            os.unlink(temporary)
        sync_directory(path.parent)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def timestamp(value):
    require(isinstance(value, str) and len(value) <= 40, "Invalid release timestamp.")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise RetentionError("Invalid release timestamp.") from None
    require(parsed.tzinfo is not None and parsed.utcoffset().total_seconds() == 0,
            "Release timestamps must use UTC.")
    require(parsed.isoformat(timespec="microseconds") == value, "Release timestamps must use canonical UTC form.")
    return parsed


def absolute_path(value):
    require(isinstance(value, str) and value.startswith("/") and "\x00" not in value,
            "Invalid retained artifact path.")
    path = Path(value)
    require(path == path.resolve(), "Retained artifact paths cannot use symlink aliases.")
    return path


def source_facts(bundle, value):
    """Retain a compact proof of the exact source archive, without extraction."""
    source = bundle / "source.tar.gz"
    require(prebuilt.regular(source).st_size == value["source"]["size"]
            and prebuilt.digest_file(source) == value["source"]["sha256"],
            "Retained source archive identity changed.")
    names, files, total, epoch = set(), {}, 0, None
    with tarfile.open(source, "r:gz") as archive:
        for index, member in enumerate(archive):
            require(index < 100000, "Retained source has too many entries.")
            name = str(prebuilt.safe_member(member.name))
            require(name not in names and (member.isdir() or member.isfile()),
                    "Retained source has duplicate, linked or special entries.")
            names.add(name)
            if member.isdir():
                continue
            require(member.mode in (0o644, 0o664, 0o755, 0o775) and member.size >= 0,
                    "Retained source mode or size is invalid.")
            total += member.size
            require(total <= prebuilt.MAX_SOURCE, "Retained source exceeds the source budget.")
            stream = archive.extractfile(member)
            require(stream is not None, "Retained source entry is unreadable.")
            hashed, seen, small = hashlib.sha256(), 0, bytearray()
            with stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    hashed.update(block)
                    seen += len(block)
                    if name == "ops/compose-v2/runtime-schema-epoch":
                        require(seen <= 64, "Invalid retained schema declaration.")
                        small.extend(block)
            require(seen == member.size, "Retained source entry was truncated.")
            files[name] = [member.mode, seen, hashed.hexdigest()]
            if name == "ops/compose-v2/runtime-schema-epoch":
                epoch = small.decode("ascii").strip()
        require(archive.pax_headers.get("comment") == value["revision"], "Retained source commit changed.")
    require(epoch == value["schema_epoch"], "Retained source schema declaration changed.")
    require({"ops/prebuilt_release.py", "ops/prebuilt_retention.py", "ops/compose-v2/deploy.sh",
             "ops/free-testing/deploy.sh"} <= files.keys(), "Retained source lacks deployment controls.")
    return {"files": len(files), "bytes": total, "sha256": digest(files)}


def event_name(value):
    return timestamp(value["success_at"]).strftime("%Y%m%dT%H%M%S%fZ") + "-" + value["nonce"] + ".json"


def record(args):
    ledger_directory(args.root, args.state, create=True)
    require_local_docker()
    value, _model, services = prebuilt.verified_model(args.bundle, args.config, args.override, args.tunnel)
    prebuilt.verify_containers(args.bundle, args.config, args.override, args.tunnel)
    prebuilt.verify_archives(args.bundle, value)
    prebuilt.verify_source(args.bundle, value, args.root)
    info = prebuilt.json_file(args.build_info, private=True)
    require(isinstance(info, dict) and info.get("commit") == value["revision"]
            and info.get("mode") == "production", "Served frontend identity differs from this release.")
    require(args.tunnel == (args.exposure != "local-only"), "Exposure and tunnel verification disagree.")
    image_ids = {"rust": services["hms-api"]["image"], "frontend": services["frontend"]["image"]}
    key = prebuilt.digest_file(args.bundle / "manifest.json")
    receipt = {"format": FORMAT, "manifest_sha256": key, "manifest": value,
               "project": prebuilt.PROJECT, "image_ids": image_ids,
               "source": source_facts(args.bundle, value), "first_verified_at": utc_now()}
    destination = args.state / "receipts" / (key + ".json")
    require(len(list((args.state / "receipts").iterdir())) < MAX_RECORDS,
            "Release receipt capacity requires operator archival review.")
    if destination.exists():
        previous = validate_receipt(destination)
        require({k: v for k, v in previous.items() if k != "first_verified_at"}
                == {k: v for k, v in receipt.items() if k != "first_verified_at"},
                "A release receipt cannot change its recorded identity.")
    else:
        write_json(destination, receipt)
    require(len(list((args.state / "events").iterdir())) < MAX_RECORDS,
            "Release event capacity requires operator archival review.")
    event = {"format": FORMAT, "receipt": key, "success_at": utc_now(), "nonce": uuid.uuid4().hex,
             "bundle": str(args.bundle.resolve()), "verified_root": str(args.root.resolve()),
             "exposure": args.exposure, "tunnel": args.tunnel}
    name = event_name(event)
    write_json(args.state / "events" / name, event)
    write_json(args.state / "current.json", {"format": FORMAT, "receipt": key, "event": name}, replace=True)
    print("Verified prebuilt release recorded; no images or archives were removed.")


def validate_receipt(path):
    value = private_json(path)
    prebuilt.keys(value, ("format", "manifest_sha256", "manifest", "project", "image_ids", "source", "first_verified_at"),
                  "Invalid release receipt.")
    key = value["manifest_sha256"]
    require(value["format"] == FORMAT and isinstance(key, str) and prebuilt.SHA256.fullmatch(key)
            and path.name == key + ".json" and value["project"] == prebuilt.PROJECT,
            "Release receipt identity is invalid.")
    prebuilt.keys(value["image_ids"], COMPONENTS, "Invalid recorded engine images.")
    require(all(isinstance(item, str) and prebuilt.DIGEST.fullmatch(item) for item in value["image_ids"].values()),
            "Invalid recorded image identity.")
    prebuilt.keys(value["source"], ("files", "bytes", "sha256"), "Invalid recorded source proof.")
    require(type(value["source"]["files"]) is int and 0 < value["source"]["files"] <= 100000
            and type(value["source"]["bytes"]) is int and 0 < value["source"]["bytes"] <= prebuilt.MAX_SOURCE
            and isinstance(value["source"]["sha256"], str) and prebuilt.SHA256.fullmatch(value["source"]["sha256"]),
            "Invalid recorded source facts.")
    timestamp(value["first_verified_at"])
    return value


def read_ledger(state):
    current = private_json(state / "current.json")
    prebuilt.keys(current, ("format", "receipt", "event"), "Invalid current release pointer.")
    require(current["format"] == FORMAT and isinstance(current["receipt"], str)
            and prebuilt.SHA256.fullmatch(current["receipt"]), "Invalid current release identity.")
    receipts, latest, events, fingerprint = {}, {}, {}, {}
    for path in sorted((state / "receipts").iterdir()):
        require(len(receipts) < MAX_RECORDS and path.suffix == ".json", "Release receipt capacity or shape is invalid.")
        value = validate_receipt(path)
        receipts[value["manifest_sha256"]] = value
        fingerprint["receipts/" + path.name] = prebuilt.digest_file(path)
    for path in sorted((state / "events").iterdir()):
        require(len(events) < MAX_RECORDS, "Release event capacity requires review.")
        value = private_json(path)
        prebuilt.keys(value, ("format", "receipt", "success_at", "nonce", "bundle", "verified_root", "exposure", "tunnel"),
                      "Invalid release success event.")
        require(value["format"] == FORMAT and value["receipt"] in receipts
                and isinstance(value["nonce"], str) and re.fullmatch(r"[a-f0-9]{32}", value["nonce"])
                and path.name == event_name(value) and value["exposure"] in ("local-only", "access", "public")
                and type(value["tunnel"]) is bool and value["tunnel"] == (value["exposure"] != "local-only"),
                "Invalid release event identity or exposure.")
        absolute_path(value["bundle"])
        absolute_path(value["verified_root"])
        events[path.name] = value
        previous = latest.get(value["receipt"])
        if previous is None or (value["success_at"], path.name) > (previous["success_at"], event_name(previous)):
            latest[value["receipt"]] = value
        fingerprint["events/" + path.name] = prebuilt.digest_file(path)
    require(isinstance(current["event"], str) and current["event"] in events
            and events[current["event"]]["receipt"] == current["receipt"], "Current release lacks its success event.")
    fingerprint["current.json"] = prebuilt.digest_file(state / "current.json")
    return current, receipts, latest, digest(fingerprint)


def verify_anchor(receipt, event, verify_source=True, verify_loaded_images=True):
    bundle = absolute_path(event["bundle"])
    value = prebuilt.manifest(bundle)
    require(prebuilt.digest_file(bundle / "manifest.json") == receipt["manifest_sha256"]
            and value == receipt["manifest"], "Retained manifest identity changed.")
    if verify_source:
        prebuilt.verify_archives(bundle, value)
        require(source_facts(bundle, value) == receipt["source"], "Retained source bytes or modes changed.")
    if verify_loaded_images:
        prebuilt.verify_images(value, receipt["image_ids"])
    return value


def all_containers():
    identifiers = prebuilt.run(["docker", "ps", "--all", "--quiet", "--no-trunc"]).decode().splitlines()
    require(len(identifiers) <= 10000 and len(identifiers) == len(set(identifiers))
            and all(re.fullmatch(r"[0-9a-f]{64}", item) for item in identifiers),
            "Container reference inventory is unavailable or excessive.")
    result = []
    for offset in range(0, len(identifiers), 128):
        items = prebuilt.docker_json(["inspect", *identifiers[offset:offset + 128]])
        require(isinstance(items, list) and len(items) == len(identifiers[offset:offset + 128]),
                "Container reference inventory changed during inspection.")
        for item in items:
            require(isinstance(item, dict) and isinstance(item.get("Id"), str)
                    and item["Id"] in identifiers[offset:offset + 128]
                    and isinstance(item.get("Config"), dict)
                    and (item["Config"].get("Labels") is None or isinstance(item["Config"].get("Labels"), dict))
                    and isinstance(item.get("State"), dict)
                    and isinstance(item.get("Image"), str) and prebuilt.DIGEST.fullmatch(item["Image"]),
                    "Container image reference is invalid.")
            result.append(item)
    return result


def require_running_current(receipt, containers):
    for service in ("hms-api", "hms-worker", "frontend"):
        selected = [item for item in containers
                    if (item["Config"].get("Labels") or {}).get("com.docker.compose.project") == prebuilt.PROJECT
                    and (item["Config"].get("Labels") or {}).get("com.docker.compose.service") == service
                    and (item["Config"].get("Labels") or {}).get("com.docker.compose.oneoff") == "False"
                    and item.get("State", {}).get("Running") is True]
        require(len(selected) == 1 and selected[0]["Image"] == receipt["image_ids"]["frontend" if service == "frontend" else "rust"],
                "Running applications differ from the recorded current release.")


def removable(proposal, used, kept):
    if proposal["id"] in used or proposal["id"] in kept:
        return False
    try:
        item = prebuilt.inspect_image(proposal["ref"])
    except prebuilt.VerificationError:
        return False
    if not isinstance(item.get("Config"), dict):
        return False
    labels = item["Config"].get("Labels") or {}
    repo = proposal["ref"].rsplit(":", 1)[0]
    allowed_objects = {proposal["id"], proposal["config_id"], proposal["producer_id"]}
    repo_digests = item.get("RepoDigests")
    if repo_digests is None:
        repo_digests = []
    if not isinstance(repo_digests, list):
        return False
    for reference in repo_digests:
        if not isinstance(reference, str) or reference.count("@") != 1:
            return False
        repository, object_id = reference.split("@", 1)
        if repository not in (repo, "docker.io/library/" + repo) or object_id not in allowed_objects:
            return False
    return (isinstance(labels, dict) and item["Id"] == proposal["id"] and item.get("RepoTags") == [proposal["ref"]]
            and labels.get("org.opencontainers.image.revision") == proposal["revision"]
            and labels.get("systems.thehms.component") == proposal["component"])


def plan(root, state):
    present = ledger_directory(root, state)
    require_local_docker()
    value = {"format": FORMAT, "current": None, "rollback": None, "retained": [], "proposals": [], "blocked": []}
    if not present or not (state / "current.json").exists():
        value["blocked"].append("No verified current prebuilt release is recorded.")
        value["digest"] = digest(value)
        return value
    current, receipts, latest, ledger_hash = read_ledger(state)
    key = current["receipt"]
    value.update(current=key, retained=[key], ledger_sha256=ledger_hash)
    current_manifest = verify_anchor(receipts[key], latest[key])
    fence = state.parent / "schema-compatibility"
    if fence.exists():
        require(int(state_helper.scalar(fence)) <= int(current_manifest["schema_epoch"]),
                "A newer schema fence prevents release cleanup.")
    containers = all_containers()
    require_running_current(receipts[key], containers)
    candidates = sorted((item for item in latest if item != key),
                        key=lambda item: (latest[item]["success_at"], item), reverse=True)
    for candidate in candidates:
        receipt = receipts[candidate]
        if not isinstance(receipt["manifest"], dict) or receipt["manifest"].get("schema_epoch") != current_manifest["schema_epoch"]:
            continue
        try:
            verify_anchor(receipt, latest[candidate])
        except (RetentionError, prebuilt.VerificationError, OSError, ValueError, tarfile.TarError):
            continue
        value["rollback"] = candidate
        value["retained"].append(candidate)
        break
    if value["rollback"] is None:
        value["blocked"].append("No verified same-schema rollback release is available; no cleanup is proposed.")
    else:
        kept = {image for retained in value["retained"] for image in receipts[retained]["image_ids"].values()}
        used = {item["Image"] for item in containers}
        seen = set()
        for candidate in candidates:
            if candidate in value["retained"]:
                continue
            try:
                manifest = verify_anchor(receipts[candidate], latest[candidate], verify_source=False,
                                         verify_loaded_images=False)
            except (RetentionError, prebuilt.VerificationError, OSError, ValueError, tarfile.TarError):
                continue
            for component in COMPONENTS:
                image = manifest["images"][component]
                try:
                    prebuilt.verify_images({**manifest, "images": {component: image}},
                                           {component: receipts[candidate]["image_ids"][component]})
                except (prebuilt.VerificationError, OSError, ValueError):
                    continue
                proposal = {"receipt": candidate, "revision": manifest["revision"], "component": component,
                            "ref": image["ref"], "id": receipts[candidate]["image_ids"][component],
                            "config_id": image["config_id"], "producer_id": image["id"]}
                if proposal["ref"] not in seen and removable(proposal, used, kept):
                    seen.add(proposal["ref"])
                    value["proposals"].append(proposal)
    value["digest"] = digest(value)
    return value


def apply(root, state, expected):
    require(isinstance(expected, str) and prebuilt.SHA256.fullmatch(expected), "A valid reviewed plan digest is required.")
    proposed = plan(root, state)
    require(proposed["digest"] == expected, "Retention plan changed; review a fresh plan before applying.")
    require(not proposed["blocked"], "Release cleanup requires a verified current and rollback release.")
    _current, receipts, _latest, _hash = read_ledger(state)
    private_directory(state / "cleanup")
    require(len(list((state / "cleanup").iterdir())) < MAX_RECORDS, "Cleanup audit capacity requires review.")
    kept = {item for key in proposed["retained"] for item in receipts[key]["image_ids"].values()}
    removed = []
    try:
        for proposal in proposed["proposals"]:
            require_local_docker()
            containers = all_containers()
            require_running_current(receipts[proposed["current"]], containers)
            require(removable(proposal, {item["Image"] for item in containers}, kept),
                    "Image ownership or container references changed; cleanup stopped.")
            prebuilt.run(["docker", "image", "rm", proposal["ref"]])
            removed.append(proposal)
    finally:
        if removed:
            write_json(state / "cleanup" / (uuid.uuid4().hex + ".json"), {
                "format": FORMAT, "plan_digest": expected, "removed": removed, "recorded_at": utc_now()})
    print(json.dumps({"removed_tags": len(removed), "plan_digest": expected}, sort_keys=True))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("record", "plan", "apply"):
        child = commands.add_parser(command)
        child.add_argument("--root", type=Path, required=True)
        child.add_argument("--state", type=Path, required=True)
        if command == "record":
            for name in ("bundle", "config", "override", "build-info"):
                child.add_argument("--" + name, type=Path, required=True)
            child.add_argument("--tunnel", action="store_true")
            child.add_argument("--exposure", choices=("local-only", "access", "public"), default="local-only")
        if command == "apply":
            child.add_argument("--plan-digest", required=True)
            child.add_argument("--apply", action="store_true", required=True)
    args = parser.parse_args(argv)
    try:
        prebuilt.hold_inherited_lease(args.root)
        if args.command == "record":
            record(args)
        elif args.command == "plan":
            print(json.dumps(plan(args.root, args.state), indent=2, sort_keys=True))
        else:
            apply(args.root, args.state, args.plan_digest)
        return 0
    except (RetentionError, prebuilt.VerificationError, state_helper.StateError, OSError,
            ValueError, KeyError, TypeError, UnicodeError, tarfile.TarError):
        print("Prebuilt release retention refused; preserve all remaining artifacts and review the ledger or host state.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
