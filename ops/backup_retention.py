#!/usr/bin/env python3
"""Private, verified PostgreSQL backups and fail-closed local retention.

The backup command never initializes or prunes a restic repository. Production
completion requires an exact snapshot read-back; local-only completion makes no
off-server protection claim. Retention is a dry run unless explicitly enabled.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid


FORMAT = "hms-postgres-backup-v1"
PLAN_FORMAT = "hms-backup-retention-plan-v1"
OWNER_FILE = ".hms-backup-owner.json"
GIB = 1024 ** 3
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,62}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,62}-\d{8}T\d{12}Z-[a-f0-9]{32}\.dump\Z")
MAX_JSON = 1024 * 1024


class BackupError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise BackupError(message)


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def timestamp(value):
    require(isinstance(value, str), "Invalid backup time.")
    try:
        result = dt.datetime.fromisoformat(value)
    except ValueError as error:
        raise BackupError("Invalid backup time.") from error
    require(result.tzinfo is not None and result.utcoffset() == dt.timedelta(0), "Backup time must be UTC.")
    return result


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def no_duplicates(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "Duplicate JSON key.")
        value[key] = item
    return value


def json_bytes(raw):
    require(len(raw) <= MAX_JSON, "Backup metadata is too large.")
    try:
        return json.loads(raw, object_pairs_hook=no_duplicates,
                          parse_constant=lambda _value: (_ for _ in ()).throw(BackupError("Invalid JSON number.")))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise BackupError("Invalid backup metadata.") from error


def keys(value, expected, message):
    require(isinstance(value, dict) and set(value) == set(expected), message)


def regular(path, private=True):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid(),
            "Backup file must be an owned regular file with one link.")
    if private:
        require(stat.S_IMODE(info.st_mode) == 0o600, "Backup file must have mode 0600.")
    return info


def read_json(path):
    regular(path)
    with path.open("rb") as stream:
        return json_bytes(stream.read(MAX_JSON + 1))


def digest(path):
    regular(path)
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def fsync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def private_file(path):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.fchmod(descriptor, 0o600)
    return os.fdopen(descriptor, "wb")


def publish(path, data):
    temporary = path.parent / (".hms-partial-" + uuid.uuid4().hex)
    try:
        with private_file(temporary) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # link+unlink publishes without ever replacing another file or symlink.
        os.link(temporary, path, follow_symlinks=False)
        temporary.unlink()
        fsync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def read_env(path):
    regular(path)
    require(path.stat().st_size <= MAX_JSON, "Private env file is too large.")
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        require(separator and re.fullmatch(r"[A-Z][A-Z0-9_]*", key) and key not in values,
                "Private env file has invalid or duplicate settings.")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        require("\x00" not in value and "\r" not in value, "Private env file has invalid values.")
        values[key] = value
    return values


def setting(values, key, default):
    return os.environ.get(key, values.get(key, str(default)))


def integer(values, key, default, minimum=1, maximum=1024 ** 5):
    value = setting(values, key, default)
    require(isinstance(value, str) and value.isascii() and value.isdigit(), "Invalid backup policy number.")
    result = int(value)
    require(minimum <= result <= maximum, "Backup policy number is out of range.")
    return result


def enabled(values, key, default="false"):
    value = setting(values, key, default)
    require(value in ("true", "false"), "Backup boolean setting must be true or false.")
    return value == "true"


def policy(values):
    result = {"days": integer(values, "BACKUP_RETENTION_DAYS", 7, maximum=3650),
              "min_count": integer(values, "BACKUP_MIN_COUNT", 2, minimum=2, maximum=10000),
              "max_count": integer(values, "BACKUP_MAX_COUNT", 14, maximum=10000),
              "max_bytes": integer(values, "BACKUP_MAX_BYTES", 10 * GIB)}
    require(result["max_count"] >= result["min_count"], "Backup maximum count cannot be below its protected minimum.")
    return result


def run(args, *, env=None, stdin=None, stdout=subprocess.PIPE, timeout=3600):
    try:
        if stdout == subprocess.PIPE:
            return bounded_stdout(args, env=env, stdin=stdin, timeout=timeout)
        result = subprocess.run(args, env=env, stdin=stdin, stdout=stdout,
                                stderr=subprocess.DEVNULL, timeout=timeout, check=False,
                                pass_fds=lease_descriptors())
    except (OSError, subprocess.TimeoutExpired) as error:
        raise BackupError("Backup command failed or timed out; prior backups were preserved.") from error
    require(result.returncode == 0, "Backup command failed; prior backups were preserved.")
    return result.stdout


def bounded_stdout(args, *, env=None, stdin=None, timeout=3600):
    """Enforce the metadata limit while reading, before materializing JSON."""
    process = None
    output = bytearray()
    try:
        process = subprocess.Popen(args, env=env, stdin=stdin, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, pass_fds=lease_descriptors())
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                require(time.monotonic() < deadline, "Backup metadata command timed out; prior backups were preserved.")
                if not selector.select(min(1.0, max(0.001, deadline - time.monotonic()))):
                    continue
                chunk = os.read(process.stdout.fileno(), min(64 * 1024, MAX_JSON - len(output) + 1))
                if not chunk:
                    break
                require(len(output) + len(chunk) <= MAX_JSON,
                        "Backup command exceeded its metadata stdout limit; prior backups were preserved.")
                output.extend(chunk)
            require(process.wait(timeout=max(0.001, deadline - time.monotonic())) == 0,
                    "Backup command failed; prior backups were preserved.")
        return bytes(output)
    finally:
        if process is not None:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            process.stdout.close()


def lease_descriptors():
    value = os.environ.get("HMS_DEPLOY_LEASE_FD", "")
    if value.isascii() and value.isdigit() and 3 <= int(value) < 10000:
        try:
            os.fstat(int(value))
            return (int(value),)
        except OSError:
            pass
    return ()


def stream_command(args, path, maximum, reserve, *, env=None, timeout=3600):
    """Bound file growth and wall time while retaining the host lease in children."""
    process = None
    total = 0
    try:
        with private_file(path) as output:
            process = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                       pass_fds=lease_descriptors())
            deadline = time.monotonic() + timeout
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    require(time.monotonic() < deadline, "Backup stream timed out; prior backups were preserved.")
                    if not selector.select(min(1.0, max(0.001, deadline - time.monotonic()))):
                        continue
                    chunk = os.read(process.stdout.fileno(), 64 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    require(total <= maximum, "Backup stream exceeds its reviewed byte budget; prior backups were preserved.")
                    require(shutil.disk_usage(path.parent).free >= reserve + len(chunk),
                            "Backup stream reached the disk reserve; prior backups were preserved.")
                    output.write(chunk)
                require(process.wait(timeout=max(0.001, deadline - time.monotonic())) == 0,
                        "Backup command failed; prior backups were preserved.")
            output.flush()
            os.fsync(output.fileno())
    finally:
        if process is not None:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            process.stdout.close()


def compose(root, env_file):
    files = shlex.split(os.environ.get("COMPOSE_FILES", os.environ.get("COMPOSE_FILE", str(root / "ops/compose-v2/compose.yml"))))
    require(files, "At least one Compose file is required.")
    result = ["docker", "compose", "--env-file", str(env_file)]
    for file in files:
        require(Path(file).is_file() and not Path(file).is_symlink(), "Compose file is missing or unsafe.")
        result.extend(["-f", file])
    return result


def scope(root, env_file, values):
    for key, value in values.items():
        if key.startswith("BACKUP_") or key in ("HMS_BUILD_SHA", "HMS_DEPLOYED_AT", "HMS_IMAGE_TAG"):
            continue
        require(key not in os.environ or os.environ[key] == value,
                "Shell settings conflict with the private backup deployment; no dump started.")
    slug = values.get("CLIENT_SLUG", "hms-v2")
    require(SLUG.fullmatch(slug) is not None, "Client slug must use lowercase letters, digits and hyphens.")
    environment = values.get("HMS_ENV", "production")
    require(environment in ("production", "staging", "development", "test"), "Unknown backup environment.")
    command = compose(root, env_file)
    model = json_bytes(run([*command, "config", "--format", "json"], timeout=60))
    project = model.get("name") if isinstance(model, dict) else None
    require(isinstance(project, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", project), "Invalid Compose project identity.")
    services = model.get("services", {})
    require(isinstance(services, dict) and "db" in services, "Backup requires the selected Compose Postgres service.")
    context = {"client_slug": slug, "compose_project": project,
               "scope": "production" if environment == "production" else "local-only"}
    if environment == "production":
        context["repository_sha256"] = hashlib.sha256(values.get("RESTIC_REPOSITORY", "").encode()).hexdigest()
    return context, command


def directory_owner(directory, context, create=False):
    if create:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
            "Backup directory must be an owned directory with mode 0700.")
    require(directory.resolve() == directory.absolute(), "Backup directory cannot contain symlink components.")
    path = directory / OWNER_FILE
    if not os.path.lexists(path) and create:
        publish(path, canonical({"format": FORMAT, "owner_uuid": str(uuid.uuid4()),
                                 "client_slug": context["client_slug"], "compose_project": context["compose_project"]}))
    owner = read_json(path)
    keys(owner, ("format", "owner_uuid", "client_slug", "compose_project"), "Invalid backup owner manifest.")
    try:
        require(str(uuid.UUID(owner["owner_uuid"])) == owner["owner_uuid"], "Invalid backup owner identity.")
    except (TypeError, ValueError, AttributeError) as error:
        raise BackupError("Invalid backup owner identity.") from error
    require(owner["format"] == FORMAT and owner["client_slug"] == context["client_slug"]
            and owner["compose_project"] == context["compose_project"], "Backup directory belongs to another deployment.")
    return owner


def validated_receipt(directory, name, owner):
    require(isinstance(name, str) and NAME.fullmatch(name) is not None
            and name.startswith(owner["client_slug"] + "-"), "Invalid backup filename.")
    path = directory / name
    receipt_path = directory / (name + ".json")
    receipt = read_json(receipt_path)
    keys(receipt, ("format", "owner_uuid", "client_slug", "compose_project", "file", "created_at", "size", "sha256",
                   "scope", "snapshot_id", "repository_sha256", "validation", "complete"), "Invalid completed backup receipt.")
    require(all(receipt[key] == owner[key] for key in ("owner_uuid", "client_slug", "compose_project"))
            and receipt["format"] == FORMAT and receipt["file"] == name and receipt["complete"] is True
            and receipt["validation"] == "pg_restore-list", "Backup receipt belongs to another artifact or deployment.")
    timestamp(receipt["created_at"])
    require(type(receipt["size"]) is int and receipt["size"] > 5
            and isinstance(receipt["sha256"], str) and SHA.fullmatch(receipt["sha256"]), "Invalid completed backup identity.")
    require(receipt["scope"] in ("production", "local-only"), "Unknown backup completion scope.")
    if receipt["scope"] == "production":
        require(all(isinstance(receipt[key], str) and SHA.fullmatch(receipt[key])
                    for key in ("snapshot_id", "repository_sha256")), "Production backup lacks verified off-server identity.")
    else:
        require(receipt["snapshot_id"] is None and receipt["repository_sha256"] is None,
                "Local-only receipt cannot claim off-server protection.")
    info = regular(path)
    require(info.st_size == receipt["size"] and digest(path) == receipt["sha256"], "Completed backup bytes no longer match their receipt.")
    return receipt


def hold_present(directory, receipt):
    path = directory / (receipt["file"] + ".hold")
    if not os.path.lexists(path):
        return False
    hold = read_json(path)
    keys(hold, ("format", "owner_uuid", "sha256"), "Invalid protected-backup hold.")
    require(hold == {"format": FORMAT, "owner_uuid": receipt["owner_uuid"], "sha256": receipt["sha256"]},
            "Backup hold does not match the completed backup.")
    return True


def fingerprint(path):
    info = regular(path)
    return {"device": info.st_dev, "inode": info.st_ino, "size": info.st_size,
            "mtime_ns": info.st_mtime_ns, "sha256": digest(path)}


def build_plan(directory, owner, context, limits, now):
    require(not os.path.lexists(directory / ".hms-backup-incomplete.json"),
            "An incomplete backup attempt requires review; retention was refused.")
    entries = []
    minimum_eligible = []
    prefix = owner["client_slug"] + "-"
    for receipt_path in directory.iterdir():
        if not receipt_path.name.startswith(prefix) or not receipt_path.name.endswith(".dump.json"):
            continue
        dump_path = Path(str(receipt_path)[:-5])
        if not os.path.lexists(dump_path):
            retired_path = Path(str(dump_path) + ".retired.json")
            retired = read_json(retired_path)
            receipt = read_json(receipt_path)
            keys(retired, ("format", "owner_uuid", "sha256", "plan_sha256"), "Invalid backup retirement evidence.")
            require(retired["format"] == PLAN_FORMAT and retired["owner_uuid"] == owner["owner_uuid"]
                    and retired["sha256"] == receipt.get("sha256") and isinstance(retired["plan_sha256"], str)
                    and SHA.fullmatch(retired["plan_sha256"]), "Missing dump lacks valid retirement evidence.")
    # Unknown/legacy dumps are protected capacity, never cleanup authority.
    for path in sorted(directory.iterdir()):
        if not path.name.startswith(prefix) or not path.name.endswith(".dump"):
            continue
        if not os.path.lexists(Path(str(path) + ".json")):
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid(), "Unsafe legacy dump; retention refused.")
            entries.append({"file": path.name, "size": info.st_size, "protected": "unverified-legacy"})
            continue
        receipt = validated_receipt(directory, path.name, owner)
        require(timestamp(receipt["created_at"]) <= now, "Completed backup time is in the future.")
        protected = "explicit-hold" if hold_present(directory, receipt) else None
        if os.path.lexists(Path(str(path) + ".retired.json")):
            protected = "interrupted-retirement-intent"
        if receipt["scope"] != context["scope"]:
            protected = protected or "other-completion-scope"
        elif receipt["scope"] == "production" and receipt["repository_sha256"] != context.get("repository_sha256"):
            protected = protected or "other-offsite-repository"
        entry = {"file": path.name, "size": receipt["size"], "created_at": receipt["created_at"],
                 "protected": protected, "dump": fingerprint(path),
                 "receipt": fingerprint(Path(str(path) + ".json"))}
        entries.append(entry)
        if receipt["scope"] == context["scope"] and (receipt["scope"] != "production"
                or receipt["repository_sha256"] == context.get("repository_sha256")):
            minimum_eligible.append(entry)
    eligible = sorted((entry for entry in entries if "created_at" in entry),
                      key=lambda entry: (entry["created_at"], entry["file"]), reverse=True)
    # Foreign scope/repository anchors remain protected capacity, but cannot
    # satisfy the minimum of this deployment's current verified backups.
    for entry in sorted(minimum_eligible, key=lambda item: (item["created_at"], item["file"]),
                        reverse=True)[:limits["min_count"]]:
        entry["protected"] = entry["protected"] or "minimum-newest-verified"
    count = len(entries)
    size = sum(entry["size"] for entry in entries)
    candidates = []
    for entry in reversed(eligible):
        aged = (now - timestamp(entry["created_at"])).total_seconds() > limits["days"] * 86400
        if not entry["protected"] and (aged or count > limits["max_count"] or size > limits["max_bytes"]):
            candidates.append(entry["file"])
            count -= 1
            size -= entry["size"]
    result = {"format": PLAN_FORMAT, "owner": owner, "scope": context["scope"], "policy": limits,
              "evaluated_at": now.isoformat(), "inventory": entries, "candidates": candidates,
              "retained_count": count, "retained_bytes": size,
              "blocked": count > limits["max_count"] or size > limits["max_bytes"]}
    result["plan_sha256"] = hashlib.sha256(canonical(result)).hexdigest()
    return result


def apply_plan(directory, owner, context, limits, plan, expected_digest):
    require(isinstance(expected_digest, str) and SHA.fullmatch(expected_digest), "An exact retention plan digest is required.")
    current = build_plan(directory, owner, context, limits, timestamp(plan.get("evaluated_at")))
    require(current == plan and current["plan_sha256"] == expected_digest, "Retention plan drifted; no backup was removed.")
    require(not current["blocked"], "Protected backups exceed retention caps; no backup was removed.")
    # Validate the entire set before deleting the first named artifact.
    require(all(not entry["protected"] for entry in current["inventory"] if entry["file"] in current["candidates"]),
            "Retention plan includes a protected backup.")
    operation = {"format": PLAN_FORMAT, "plan_sha256": expected_digest, "owner_uuid": owner["owner_uuid"],
                 "candidates": current["candidates"], "created_at": utc_now().isoformat()}
    publish(directory / (".retention-plan-" + uuid.uuid4().hex + ".json"), canonical(operation))
    deleted = []
    for name in current["candidates"]:
        receipt = validated_receipt(directory, name, owner)
        require(not hold_present(directory, receipt), "Backup gained a hold; remaining retention stopped.")
        entry = next(entry for entry in current["inventory"] if entry["file"] == name)
        require(fingerprint(directory / name) == entry["dump"]
                and fingerprint(directory / (name + ".json")) == entry["receipt"], "Backup changed; remaining retention stopped.")
        # The immutable receipt is kept. A deletion intent is written first so a
        # crash leaves evidence; an interrupted still-present dump stays protected.
        publish(directory / (name + ".retired.json"), canonical({"format": PLAN_FORMAT,
                "owner_uuid": owner["owner_uuid"], "sha256": receipt["sha256"], "plan_sha256": expected_digest}))
        (directory / name).unlink()
        fsync_directory(directory)
        deleted.append(name)
    return deleted


def current_completion(receipt, context):
    return receipt["scope"] == context["scope"] and (receipt["scope"] != "production"
            or receipt["repository_sha256"] == context.get("repository_sha256"))


def admit_backup(directory, owner, context, limits, *, pin, apply, peak_budget):
    """Bound physical growth before spooling; future cleanup is not free space.

    With explicit apply, a verified new artifact can replace one old minimum
    member only after offsite verification. Other scopes, legacy artifacts,
    explicit holds and interrupted retirement intents remain protected capacity.
    The temporary overage is bounded by the admitted dump/read-back peak budget.
    """
    require(not any(path.name.startswith((".hms-partial-", ".hms-readback-")) for path in directory.iterdir()),
            "An interrupted backup spool requires review; no additional dump started.")
    plan = build_plan(directory, owner, context, limits, utc_now())
    require(not plan["blocked"], "Protected backups already exceed retention caps; no additional dump started.")
    entries = plan["inventory"]
    if not apply:
        protected = entries
    else:
        permanent, current = {}, []
        for entry in entries:
            if "created_at" not in entry:
                permanent[entry["file"]] = entry
                continue
            receipt = validated_receipt(directory, entry["file"], owner)
            compatible = current_completion(receipt, context)
            if compatible:
                current.append(entry)
            if (not compatible or hold_present(directory, receipt)
                    or os.path.lexists(directory / (entry["file"] + ".retired.json"))):
                permanent[entry["file"]] = entry
        # The successfully verified new artifact will fill the final minimum
        # position. An explicit hold on it does not release any older hold.
        for entry in sorted(current, key=lambda item: (item["created_at"], item["file"]),
                            reverse=True)[:limits["min_count"] - 1]:
            permanent[entry["file"]] = entry
        protected = list(permanent.values())
    require(len(protected) + 1 <= limits["max_count"],
            "Backup count cap requires review or explicit eligible cleanup before another dump.")
    remaining = limits["max_bytes"] - sum(entry["size"] for entry in protected)
    maximum = min(peak_budget // 2, remaining)
    require(maximum > 5, "Backup byte cap leaves no admitted dump capacity; no additional dump started.")
    # pin is deliberately not a release of any prior artifact: the new dump
    # always consumes one count and its full bytes, whether held or ordinary.
    return maximum


def structural_check(path, command):
    regular(path)
    # The subprocess consumes the descriptor, so no Python read-ahead buffer
    # may leave its OS offset beyond the header after seek(0).
    with path.open("rb", buffering=0) as stream:
        require(stream.read(5) == b"PGDMP", "PostgreSQL dump header is invalid.")
        stream.seek(0)
        run([*command, "exec", "-T", "db", "pg_restore", "--list"], stdin=stream, stdout=subprocess.DEVNULL)


def restic_environment(values):
    result = {key: value for key, value in os.environ.items()
              if not key.startswith(("RESTIC_", "AWS_"))}
    for key in ("RESTIC_REPOSITORY", "RESTIC_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        value = values.get(key, "")
        require(value and not value.startswith("CHANGE_ME"), "Production backup requires configured off-server credentials.")
        result[key] = value
    result["RESTIC_PROGRESS_FPS"] = "0.1"
    return result


def offsite(path, receipt, owner, values, reserve):
    require(shutil.which("restic") is not None, "Production backup requires restic.")
    environment = restic_environment(values)
    command = ["restic", "--no-cache"]
    # A failed connection/auth check is never interpreted as an empty repository.
    # This O(1) repository probe avoids enumerating an unbounded shared snapshot
    # history. `cat config` is JSON; quiet suppresses informational prefixes.
    repository = json_bytes(run([*command, "cat", "config", "--quiet"], env=environment))
    require(isinstance(repository, dict) and type(repository.get("version")) is int
            and repository["version"] > 0 and isinstance(repository.get("id"), str)
            and SHA.fullmatch(repository["id"]), "Off-server repository configuration is invalid.")
    tags = ["hms-v2", "postgres", "hms-owner:" + owner["owner_uuid"],
            "hms-client:" + owner["client_slug"], "hms-project:" + owner["compose_project"]]
    arguments = [*command, "backup", "--json", "--quiet"]
    for tag in tags:
        arguments.extend(["--tag", tag])
    raw = run([*arguments, str(path)], env=environment)
    require(len(raw) <= MAX_JSON, "Off-server backup result was too large.")
    summaries = [json_bytes(line) for line in raw.splitlines() if line.strip()]
    summaries = [row for row in summaries if isinstance(row, dict) and row.get("message_type") == "summary"]
    require(len(summaries) == 1, "Off-server backup did not return one completed snapshot.")
    snapshot = summaries[0].get("snapshot_id")
    require(isinstance(snapshot, str) and re.fullmatch(r"[a-f0-9]{8,64}", snapshot), "Invalid off-server snapshot identity.")
    rows = json_bytes(run([*command, "snapshots", "--json", snapshot], env=environment))
    require(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict), "Off-server snapshot could not be identified exactly.")
    actual = rows[0]
    requested_snapshot = snapshot
    snapshot = actual.get("id")
    require(isinstance(snapshot, str) and SHA.fullmatch(snapshot) and snapshot.startswith(requested_snapshot)
            and set(tags).issubset(set(actual.get("tags", [])))
            and actual.get("paths") == [str(path)], "Off-server snapshot does not bind the expected backup and owner.")
    run([*command, "check"], env=environment, stdout=subprocess.DEVNULL)
    temporary = path.parent / (".hms-readback-" + uuid.uuid4().hex)
    try:
        stream_command([*command, "dump", snapshot, str(path)], temporary, receipt["size"], reserve, env=environment)
        require(temporary.stat().st_size == receipt["size"] and digest(temporary) == receipt["sha256"],
                "Off-server backup read-back did not match; prior backups were preserved.")
    finally:
        if temporary.exists():
            temporary.unlink()
    return snapshot, hashlib.sha256(environment["RESTIC_REPOSITORY"].encode()).hexdigest()


def backup(root, env_file, directory):
    values = read_env(env_file)
    limits = policy(values)
    context, command = scope(root, env_file, values)
    owner = directory_owner(directory, context, create=True)
    incomplete = directory / ".hms-backup-incomplete.json"
    require(not os.path.lexists(incomplete), "Previous incomplete backup requires review; no additional dump started.")
    pin = enabled(values, "BACKUP_PIN")
    apply = enabled(values, "BACKUP_RETENTION_APPLY")
    # The operator budget must cover the dump plus exact off-server read-back.
    budget = integer(values, "BACKUP_PEAK_BUDGET_BYTES", 4 * GIB)
    reserve = integer(values, "BACKUP_RESERVE_BYTES", 10 * GIB)
    maximum = admit_backup(directory, owner, context, limits, pin=pin, apply=apply, peak_budget=budget)
    require(shutil.disk_usage(directory).free >= budget + reserve, "Insufficient backup disk headroom; no dump started.")
    name = context["client_slug"] + "-" + utc_now().strftime("%Y%m%dT%H%M%S%fZ") + "-" + uuid.uuid4().hex + ".dump"
    partial = directory / (".hms-partial-" + uuid.uuid4().hex)
    target = directory / name
    try:
        stream_command([*command, "exec", "-T", "db", "sh", "-c",
                        'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl'],
                       partial, maximum, reserve)
        structural_check(partial, command)
        require(partial.stat().st_size * 2 <= budget, "Dump exceeds the reviewed peak backup budget; prior backups were preserved.")
        publish(incomplete, canonical({"format": FORMAT, "owner_uuid": owner["owner_uuid"],
                "file": name, "size": partial.stat().st_size, "sha256": digest(partial),
                "created_at": utc_now().isoformat()}))
        os.link(partial, target, follow_symlinks=False)
        partial.unlink()
        fsync_directory(directory)
        receipt = {"format": FORMAT, **owner, "file": name, "created_at": utc_now().isoformat(),
                   "size": target.stat().st_size, "sha256": digest(target), "scope": context["scope"],
                   "snapshot_id": None, "repository_sha256": None, "validation": "pg_restore-list", "complete": True}
        if context["scope"] == "production":
            receipt["snapshot_id"], receipt["repository_sha256"] = offsite(target, receipt, owner, values, reserve)
        publish(directory / (name + ".json"), canonical(receipt))
        if pin:
            publish(directory / (name + ".hold"), canonical({"format": FORMAT, "owner_uuid": owner["owner_uuid"], "sha256": receipt["sha256"]}))
        incomplete.unlink()
        fsync_directory(directory)
        result = build_plan(directory, owner, context, limits, utc_now())
        require(not result["blocked"], "Verified backup saved, but protected backups exceed retention caps; cleanup was refused.")
        removed = apply_plan(directory, owner, context, limits, result, result["plan_sha256"]) if apply else []
        print(json.dumps({"completed": True, "scope": context["scope"], "bytes": receipt["size"],
                          "pinned": pin, "retention_dry_run": not apply, "retention_candidates": len(result["candidates"]),
                          "removed": len(removed), "plan_sha256": result["plan_sha256"]}, sort_keys=True))
    finally:
        # Preserve a complete dump after off-server/receipt failure. It is an
        # unverified legacy anchor, not an eligible completed backup.
        if partial.exists():
            partial.unlink()


def restore_check(root, env_file, path):
    require(not os.environ.get("HMS_PREBUILT_BUNDLE"), "The legacy restore path cannot run in prebuilt mode.")
    values = read_env(env_file)
    context, command = scope(root, env_file, values)
    refuse_persistent_prebuilt_restore(root, context)
    require(os.environ.get("RESTORE_CONFIRM") == "restore-" + context["client_slug"], "Explicit destructive restore confirmation is required.")
    path = path.absolute()
    require(path.resolve() == path, "Restore source cannot contain symlink components.")
    if os.path.lexists(Path(str(path) + ".json")):
        owner = directory_owner(path.parent, context)
        validated_receipt(path.parent, path.name, owner)
    else:
        require(os.environ.get("RESTORE_ALLOW_LEGACY_DUMP") == "true", "Unverified legacy restore requires RESTORE_ALLOW_LEGACY_DUMP=true.")
    structural_check(path, command)


def refuse_persistent_prebuilt_restore(root, context):
    """A previous prebuilt mode survives the deployment shell environment."""
    if context["compose_project"] != "hms-free-test":
        return
    spec = importlib.util.spec_from_file_location("hms_restore_host_lease", root / "ops/deploy-lease.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    parent = module.LEASE_PATH.parent
    state = parent / "prebuilt/hms-free-test"
    for directory in (parent / "prebuilt", state, state / "releases"):
        if os.path.lexists(directory):
            info = directory.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                    and stat.S_IMODE(info.st_mode) == 0o700,
                    "Persistent prebuilt state requires review; legacy restore was refused.")
    if any(os.path.lexists(path) for path in (state / "schema-compatibility", state / "deploy-attempt",
                                             state / "releases/current.json")):
        raise BackupError("Persistent prebuilt deployment state forbids the legacy restore path; use reviewed matching-artifact recovery.")


def require_lease(root):
    spec = importlib.util.spec_from_file_location("hms_backup_deploy_lease", root / "ops/deploy-lease.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        module.inherited_fd()
    except (module.LeaseError, OSError, ValueError):
        os.execv(sys.executable, [sys.executable, str(root / "ops/deploy-lease.py"), "--", sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "plan", "apply", "restore-check"):
        child = commands.add_parser(name)
        child.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
        child.add_argument("--env-file", type=Path, required=True)
        if name == "restore-check":
            child.add_argument("--dump", type=Path, required=True)
        else:
            child.add_argument("--backup-dir", type=Path, required=True)
        if name == "plan":
            child.add_argument("--output", type=Path)
        if name == "apply":
            child.add_argument("--plan", type=Path, required=True)
            child.add_argument("--plan-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        os.umask(0o077)
        def interrupted(_signum, _frame):
            raise BackupError("Backup interrupted; prior backups were preserved.")
        for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, interrupted)
        if args.command in ("backup", "apply", "restore-check"):
            require_lease(args.root)
        if args.command == "backup":
            backup(args.root, args.env_file, args.backup_dir.absolute())
        elif args.command == "restore-check":
            restore_check(args.root, args.env_file, args.dump)
        else:
            values = read_env(args.env_file)
            context, _command = scope(args.root, args.env_file, values)
            directory = args.backup_dir.absolute()
            owner = directory_owner(directory, context)
            limits = policy(values)
            if args.command == "plan":
                result = build_plan(directory, owner, context, limits, utc_now())
                if args.output:
                    publish(args.output, canonical(result))
                else:
                    print(canonical(result).decode(), end="")
            else:
                result = apply_plan(directory, owner, context, limits, read_json(args.plan), args.plan_sha256)
                print(json.dumps({"removed": len(result)}, sort_keys=True))
        return 0
    except (BackupError, OSError, UnicodeError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired) as error:
        message = str(error) if isinstance(error, BackupError) else "Backup metadata or filesystem operation failed; cleanup stopped."
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
