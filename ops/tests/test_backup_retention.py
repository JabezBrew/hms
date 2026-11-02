from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time

import pytest

from deployment_fixtures import copy_lease_helper


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("hms_backup_retention", ROOT / "ops/backup_retention.py")
BACKUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKUP)
NOW = dt.datetime(2026, 11, 2, tzinfo=dt.timezone.utc)
CONTEXT = {"client_slug": "fixture", "compose_project": "fixture-project", "scope": "local-only"}
LIMITS = {"days": 7, "min_count": 2, "max_count": 3, "max_bytes": 10 ** 9}


def write_private(path, data):
    path.write_bytes(data if isinstance(data, bytes) else data.encode())
    path.chmod(0o600)


@pytest.fixture
def store(tmp_path):
    directory = tmp_path / "backups"
    directory.mkdir(mode=0o700)
    owner = BACKUP.directory_owner(directory, CONTEXT, create=True)
    return directory, owner


def completed(directory, owner, age, *, scope="local-only", hold=False, extra=b""):
    created = NOW - dt.timedelta(days=age)
    name = "fixture-" + created.strftime("%Y%m%dT%H%M%S%fZ") + "-" + f"{age:032x}" + ".dump"
    path = directory / name
    write_private(path, b"PGDMPfixture archive" + extra)
    receipt = {**owner, "file": name, "created_at": created.isoformat(), "size": path.stat().st_size,
               "sha256": BACKUP.digest(path), "scope": scope, "snapshot_id": "1" * 64 if scope == "production" else None,
               "repository_sha256": "2" * 64 if scope == "production" else None,
               "validation": "pg_restore-list", "complete": True}
    write_private(Path(str(path) + ".json"), BACKUP.canonical(receipt))
    if hold:
        write_private(Path(str(path) + ".hold"), BACKUP.canonical({"format": BACKUP.FORMAT,
                      "owner_uuid": owner["owner_uuid"], "sha256": receipt["sha256"]}))
    return path


def test_retention_dry_run_preserves_all_bytes_and_newest_minimum(store):
    directory, owner = store
    paths = [completed(directory, owner, age) for age in (0, 1, 2, 10)]
    before = {path.name: path.read_bytes() for path in directory.iterdir()}
    result = BACKUP.build_plan(directory, owner, CONTEXT, LIMITS, NOW)
    assert result["candidates"] == [paths[-1].name]
    assert result["retained_count"] == 3
    assert result["blocked"] is False
    assert before == {path.name: path.read_bytes() for path in directory.iterdir()}
    minimum = {entry["file"] for entry in result["inventory"] if entry["protected"] == "minimum-newest-verified"}
    assert minimum == {paths[0].name, paths[1].name}


def test_exact_digest_apply_removes_only_named_completed_dump_and_preserves_evidence(store):
    directory, owner = store
    paths = [completed(directory, owner, age) for age in (0, 1, 2, 10)]
    unrelated = directory / "other-client-legacy.dump"
    write_private(unrelated, b"unrelated")
    result = BACKUP.build_plan(directory, owner, CONTEXT, LIMITS, NOW)
    assert BACKUP.apply_plan(directory, owner, CONTEXT, LIMITS, result, result["plan_sha256"]) == [paths[-1].name]
    assert not paths[-1].exists()
    assert Path(str(paths[-1]) + ".json").exists()
    assert Path(str(paths[-1]) + ".retired.json").exists()
    assert all(path.exists() for path in paths[:-1]) and unrelated.read_bytes() == b"unrelated"
    assert BACKUP.build_plan(directory, owner, CONTEXT, LIMITS, NOW)["retained_count"] == 3


@pytest.mark.parametrize("mutation", ["digest", "bytes", "inode", "hold", "new-backup", "policy"])
def test_apply_refuses_drift_before_any_deletion(store, mutation):
    directory, owner = store
    paths = [completed(directory, owner, age) for age in (0, 1, 2, 10)]
    result = BACKUP.build_plan(directory, owner, CONTEXT, LIMITS, NOW)
    expected = result["plan_sha256"]
    limits = dict(LIMITS)
    if mutation == "digest":
        expected = "0" * 64
    elif mutation == "bytes":
        paths[-1].write_bytes(b"PGDMPchanged archive")
    elif mutation == "inode":
        data = paths[-1].read_bytes()
        paths[-1].unlink()
        write_private(paths[-1], data)
    elif mutation == "hold":
        receipt = BACKUP.read_json(Path(str(paths[-1]) + ".json"))
        write_private(Path(str(paths[-1]) + ".hold"), BACKUP.canonical({"format": BACKUP.FORMAT,
                      "owner_uuid": owner["owner_uuid"], "sha256": receipt["sha256"]}))
    elif mutation == "new-backup":
        completed(directory, owner, 3)
    else:
        limits["days"] = 8
    with pytest.raises(BACKUP.BackupError):
        BACKUP.apply_plan(directory, owner, CONTEXT, limits, result, expected)
    assert all(path.exists() for path in paths)


def test_holds_legacy_and_other_scope_are_protected_even_above_cap(store):
    directory, owner = store
    paths = [completed(directory, owner, age, hold=True) for age in (0, 1, 10)]
    paths.append(completed(directory, owner, 11, scope="production"))
    legacy = directory / "fixture-old-unverified.dump"
    write_private(legacy, b"PGDMPlegacy")
    limits = {**LIMITS, "max_count": 2, "max_bytes": 1}
    result = BACKUP.build_plan(directory, owner, CONTEXT, limits, NOW)
    assert result["blocked"] is True and result["candidates"] == []
    with pytest.raises(BACKUP.BackupError, match="Protected backups"):
        BACKUP.apply_plan(directory, owner, CONTEXT, limits, result, result["plan_sha256"])
    assert legacy.exists() and all(path.exists() for path in paths)


def test_old_repository_cannot_supply_deletion_authority(store):
    directory, owner = store
    paths = [completed(directory, owner, age, scope="production") for age in (0, 1, 10)]
    context = {**CONTEXT, "scope": "production", "repository_sha256": "3" * 64}
    result = BACKUP.build_plan(directory, owner, context, {**LIMITS, "max_count": 2}, NOW)
    assert result["blocked"] is True and result["candidates"] == []
    assert all(path.exists() for path in paths)


@pytest.mark.parametrize("switch", ["completion-scope", "repository"])
@pytest.mark.parametrize("foreign_hold", [False, True])
def test_foreign_newest_backups_cannot_fulfill_current_verified_minimum(store, switch, foreign_hold):
    directory, owner = store
    foreign = [completed(directory, owner, age,
                         scope="local-only" if switch == "completion-scope" else "production", hold=foreign_hold)
               for age in (0, 1)]
    current = [completed(directory, owner, age, scope="production") for age in (10, 11, 12)]
    current_repository = "2" * 64
    if switch == "repository":
        current_repository = "3" * 64
        for path in current:
            receipt_path = Path(str(path) + ".json")
            receipt = BACKUP.read_json(receipt_path)
            receipt["repository_sha256"] = current_repository
            write_private(receipt_path, BACKUP.canonical(receipt))
    context = {**CONTEXT, "scope": "production", "repository_sha256": current_repository}
    limits = {**LIMITS, "max_count": 2}
    before = {path: path.read_bytes() for path in directory.iterdir()}
    result = BACKUP.build_plan(directory, owner, context, limits, NOW)
    assert result["candidates"] == [current[-1].name]
    assert result["retained_count"] == 4 and result["blocked"] is True
    minimum = {entry["file"] for entry in result["inventory"] if entry["protected"] == "minimum-newest-verified"}
    assert minimum == {current[0].name, current[1].name}
    assert all(next(entry for entry in result["inventory"] if entry["file"] == path.name)["protected"] for path in foreign)
    with pytest.raises(BACKUP.BackupError, match="Protected backups"):
        BACKUP.apply_plan(directory, owner, context, limits, result, result["plan_sha256"])
    assert before == {path: path.read_bytes() for path in directory.iterdir()}


def test_missing_backup_without_retirement_evidence_blocks_planning(store):
    directory, owner = store
    path = completed(directory, owner, 1)
    path.unlink()
    with pytest.raises((BACKUP.BackupError, FileNotFoundError)):
        BACKUP.build_plan(directory, owner, CONTEXT, LIMITS, NOW)


@pytest.mark.parametrize("mutation", ["symlink", "hardlink", "mode", "hash", "owner", "incomplete", "no-offsite", "duplicate-json", "future"])
def test_unsafe_or_unverified_completed_artifact_refuses_retention(store, mutation):
    directory, owner = store
    path = completed(directory, owner, 10)
    receipt_path = Path(str(path) + ".json")
    receipt = BACKUP.read_json(receipt_path)
    if mutation == "symlink":
        original = directory / "other-copy"
        path.rename(original)
        path.symlink_to(original)
    elif mutation == "hardlink":
        os.link(path, directory / "extra-link")
    elif mutation == "mode":
        path.chmod(0o644)
    elif mutation == "hash":
        path.write_bytes(b"PGDMPwrong archive")
    elif mutation == "owner":
        receipt["owner_uuid"] = "11111111-1111-1111-1111-111111111111"
    elif mutation == "incomplete":
        receipt["complete"] = False
    elif mutation == "no-offsite":
        receipt["scope"] = "production"
    elif mutation == "duplicate-json":
        write_private(receipt_path, b'{"format":"one","format":"two"}')
    else:
        receipt["created_at"] = (NOW + dt.timedelta(days=1)).isoformat()
    if mutation not in ("symlink", "hardlink", "mode", "hash", "duplicate-json"):
        write_private(receipt_path, BACKUP.canonical(receipt))
    with pytest.raises(BACKUP.BackupError):
        BACKUP.build_plan(directory, owner, CONTEXT, LIMITS, NOW)
    assert path.exists()


def test_owner_and_directory_cannot_be_adopted_silently(store, tmp_path):
    directory, owner = store
    with pytest.raises(BACKUP.BackupError, match="another deployment"):
        BACKUP.directory_owner(directory, {**CONTEXT, "compose_project": "other"})
    directory.chmod(0o755)
    with pytest.raises(BACKUP.BackupError, match="0700"):
        BACKUP.directory_owner(directory, CONTEXT)
    directory.chmod(0o700)
    link = tmp_path / "linked-backups"
    link.symlink_to(directory)
    with pytest.raises(BACKUP.BackupError):
        BACKUP.directory_owner(link, CONTEXT)


@pytest.mark.parametrize("key,value", [
    ("BACKUP_MIN_COUNT", "1"), ("BACKUP_MAX_COUNT", "1"), ("BACKUP_MAX_BYTES", "0"),
    ("BACKUP_RETENTION_DAYS", "7;exit"), ("BACKUP_MAX_BYTES", "NaN"),
])
def test_invalid_policy_fails_closed(key, value):
    with pytest.raises(BACKUP.BackupError):
        BACKUP.policy({key: value})


class BackupProcess:
    def __init__(self, tmp_path):
        self.root = tmp_path / "release"
        self.root.mkdir()
        for relative in ("ops/backup_retention.py", "ops/compose-v2/backup-postgres.sh", "ops/compose-v2/restore-postgres.sh"):
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        copy_lease_helper(self.root, tmp_path / ".hms-deploy-state/deploy.lock")
        self.env_file = self.root / "private.env"
        self.compose_file = self.root / "compose.yml"
        self.compose_file.write_text("services: {}\n")
        self.override = self.root / "override.yml"
        self.override.write_text("services: {}\n")
        self.directory = self.root / "backups"
        self.log = tmp_path / "commands.jsonl"
        self.remote = tmp_path / "remote"
        self.remote.mkdir()
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        script = f"#!{sys.executable}\n" + '''import json, os, sys
from pathlib import Path
args = sys.argv[1:]
tool = Path(sys.argv[0]).name
with Path(os.environ["TEST_COMMAND_LOG"]).open("a") as stream:
    stream.write(json.dumps([tool, *args]) + "\\n")
failure = os.environ.get("TEST_FAILURE", "")
if tool == "docker":
    index = 1
    while args[index] in ("--env-file", "-f"):
        index += 2
    action = args[index:]
    if action == ["config", "--format", "json"]:
        print(json.dumps({"name":"fixture-project","services":{"db":{"image":"postgres:16"}}}))
    elif action[:4] == ["exec", "-T", "db", "sh"] and "pg_dump" in action[-1]:
        sys.stdout.buffer.write(b"PGDMPfixture archive" if failure != "header" else b"bad archive")
        sys.exit(1 if failure == "dump" else 0)
    elif action == ["exec", "-T", "db", "pg_restore", "--list"]:
        assert sys.stdin.buffer.read().startswith(b"PGDMP")
        sys.exit(1 if failure == "list" else 0)
    elif action[0] in ("stop", "up", "run"):
        pass
    elif action[:4] == ["exec", "-T", "db", "sh"] and "dropdb" in action[-1]:
        sys.stdin.buffer.read()
    else:
        sys.exit(99)
elif tool == "restic":
    assert args.pop(0) == "--no-cache"
    remote = Path(os.environ["TEST_REMOTE"])
    snapshot = "a" * 64
    if args == ["cat", "config", "--quiet"]:
        if failure == "repository": sys.exit(1)
        if failure == "oversized-config":
            sys.stdout.write("x" * (1024 * 1024 + 1)); sys.exit(0)
        print(json.dumps({"version":2,"id":"c"*64,"chunker_polynomial":"fixture"}))
    elif args[0] == "backup":
        if failure == "upload": sys.exit(1)
        if failure == "oversized-summary":
            sys.stdout.write("x" * (1024 * 1024 + 1)); sys.exit(0)
        source = Path(args[-1])
        (remote / "data").write_bytes(source.read_bytes())
        tags = [args[i+1] for i, arg in enumerate(args) if arg == "--tag"]
        metadata = {"id":snapshot,"paths":[str(source)],"tags":tags}
        (remote / "metadata.json").write_text(json.dumps(metadata))
        print(json.dumps({"message_type":"summary","snapshot_id":snapshot}))
    elif args[:2] == ["snapshots", "--json"]:
        if failure == "oversized-snapshot":
            sys.stdout.write("x" * (1024 * 1024 + 1)); sys.exit(0)
        metadata = json.loads((remote / "metadata.json").read_text())
        if failure == "identity": metadata["id"] = "b" * 64
        if failure == "tags": metadata["tags"] = []
        if failure == "path": metadata["paths"] = ["/other/file"]
        print(json.dumps([metadata]))
    elif args[0] == "check":
        if failure == "check": sys.exit(1)
    elif args[0] == "dump":
        if failure == "readback": sys.exit(1)
        data = (remote / "data").read_bytes()
        sys.stdout.buffer.write(b"PGDMPcorrupt archive" if failure == "corrupt" else data)
    else:
        sys.exit(99)
else:
    sys.exit(99)
'''
        for tool in ("docker", "restic"):
            path = bin_dir / tool
            path.write_text(script)
            path.chmod(0o755)
        self.env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
                    "ENV_FILE": str(self.env_file), "BACKUP_DIR": str(self.directory),
                    "COMPOSE_FILES": str(self.compose_file) + " " + str(self.override),
                    "TEST_COMMAND_LOG": str(self.log), "TEST_REMOTE": str(self.remote)}
        for key in tuple(self.env):
            if key.startswith(("BACKUP_", "RESTORE_", "HMS_DEPLOY_LEASE")) and key != "BACKUP_DIR":
                self.env.pop(key)
        self.write_env()

    def write_env(self, production=False, extra=""):
        write_private(self.env_file, "CLIENT_SLUG=fixture\nHMS_ENV=" + ("production" if production else "staging") + "\n"
                      "BACKUP_PEAK_BUDGET_BYTES=1048576\nBACKUP_RESERVE_BYTES=1\n"
                      "RESTIC_REPOSITORY=s3:fixture/offsite\nRESTIC_PASSWORD=fixture-private-password\n"
                      "AWS_ACCESS_KEY_ID=fixture-private-key\nAWS_SECRET_ACCESS_KEY=fixture-private-secret\n" + extra)

    def run(self, failure=None):
        env = dict(self.env)
        if failure:
            env["TEST_FAILURE"] = failure
        return subprocess.run(["sh", str(self.root / "ops/compose-v2/backup-postgres.sh")],
                              env=env, capture_output=True, text=True, timeout=20)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]


def test_shell_backup_local_completion_private_files_and_compose_override(tmp_path):
    process = BackupProcess(tmp_path)
    result = process.run()
    assert result.returncode == 0, result.stderr
    receipt_path = next(process.directory.glob("*.dump.json"))
    receipt = BACKUP.read_json(receipt_path)
    assert receipt["scope"] == "local-only" and receipt["snapshot_id"] is None
    assert receipt["repository_sha256"] is None
    assert stat.S_IMODE(process.directory.stat().st_mode) == 0o700
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in process.directory.iterdir())
    assert not list(process.directory.glob(".hms-partial-*"))
    commands = process.commands()
    assert all(command[0] == "docker" for command in commands)
    assert all(str(process.override) in command for command in commands)
    assert "fixture-private" not in result.stdout + result.stderr
    assert '"retention_dry_run": true' in result.stdout


def test_production_completion_requires_exact_snapshot_full_readback_before_retention(tmp_path):
    process = BackupProcess(tmp_path)
    process.write_env(True, "BACKUP_PIN=true\n")
    result = process.run()
    assert result.returncode == 0, result.stderr
    receipt = BACKUP.read_json(next(process.directory.glob("*.dump.json")))
    assert receipt["scope"] == "production" and receipt["snapshot_id"] == "a" * 64
    assert receipt["repository_sha256"] == hashlib.sha256(b"s3:fixture/offsite").hexdigest()
    assert next(process.directory.glob("*.dump.hold")).exists()
    restic = [command for command in process.commands() if command[0] == "restic"]
    assert [command[2] for command in restic] == ["cat", "backup", "snapshots", "check", "dump"]
    assert restic[0][2:] == ["cat", "config", "--quiet"]
    assert all(command[2:] != ["snapshots", "--json"] for command in restic)
    assert not list(process.directory.glob(".hms-readback-*"))
    assert all(command[2] not in ("init", "forget", "prune") for command in restic)


@pytest.mark.parametrize("failure", ["dump", "header", "list", "repository", "upload", "identity", "tags", "path", "check", "readback", "corrupt", "oversized-config", "oversized-summary", "oversized-snapshot"])
def test_every_backup_failure_preserves_prior_anchors_and_hides_sensitive_output(tmp_path, failure):
    process = BackupProcess(tmp_path)
    assert process.run().returncode == 0
    before = {path: path.read_bytes() for path in process.directory.iterdir()}
    process.write_env(True, "BACKUP_RETENTION_APPLY=true\nBACKUP_MAX_COUNT=2\n")
    result = process.run(failure)
    assert result.returncode != 0
    assert all(path.read_bytes() == data for path, data in before.items())
    assert not list(process.directory.glob(".hms-partial-*"))
    assert not list(process.directory.glob(".hms-readback-*"))
    assert len(list(process.directory.glob("*.dump.json"))) == 1
    assert "fixture-private" not in result.stdout + result.stderr
    assert "Traceback" not in result.stderr
    assert all("init" not in command and "forget" not in command and "prune" not in command for command in process.commands())


def test_low_headroom_stops_before_dump_or_restic(tmp_path, monkeypatch):
    process = BackupProcess(tmp_path)
    values = BACKUP.read_env(process.env_file)
    monkeypatch.setenv("COMPOSE_FILES", process.env["COMPOSE_FILES"])
    monkeypatch.setattr(BACKUP, "scope", lambda *_args: (CONTEXT, ["docker"]))
    monkeypatch.setattr(BACKUP.shutil, "disk_usage", lambda _path: shutil._ntuple_diskusage(100, 99, 1))
    with pytest.raises(BACKUP.BackupError, match="headroom"):
        BACKUP.backup(process.root, process.env_file, process.directory)
    assert not list(process.directory.glob("*.dump"))


def test_conflicting_shell_environment_is_rejected_before_docker(tmp_path):
    process = BackupProcess(tmp_path)
    process.env["HMS_ENV"] = "production"
    result = process.run()
    assert result.returncode != 0 and "Shell settings conflict" in result.stderr
    assert not process.log.exists()


def test_failed_offsite_attempt_cannot_create_repeated_unverified_dumps(tmp_path):
    process = BackupProcess(tmp_path)
    process.write_env(True)
    assert process.run("upload").returncode != 0
    assert (process.directory / ".hms-backup-incomplete.json").exists()
    before = {path: path.read_bytes() for path in process.directory.iterdir()}
    result = process.run()
    assert result.returncode != 0 and "Previous incomplete backup requires review" in result.stderr
    assert before == {path: path.read_bytes() for path in process.directory.iterdir()}


def test_bounded_dump_stream_and_timeout_preserve_reserve(tmp_path):
    path = tmp_path / "partial"
    with pytest.raises(BACKUP.BackupError, match="byte budget"):
        BACKUP.stream_command([sys.executable, "-c", "import sys;sys.stdout.buffer.write(b'x'*10000)"], path, 100, 1)
    assert path.stat().st_size <= 100
    path.unlink()
    with pytest.raises(BACKUP.BackupError, match="timed out"):
        BACKUP.stream_command([sys.executable, "-c", "import time;time.sleep(2)"], path, 100, 1, timeout=0.1)


def test_metadata_capture_stops_at_limit_and_reaps_the_writer(tmp_path, monkeypatch):
    monkeypatch.setattr(BACKUP, "MAX_JSON", 128)
    marker = tmp_path / "writer-pid"
    code = "from pathlib import Path;import os,sys,time;Path(" + repr(str(marker)) + ").write_text(str(os.getpid()));sys.stdout.buffer.write(b'x'*10000000);sys.stdout.flush();time.sleep(10)"
    with pytest.raises(BACKUP.BackupError, match="metadata stdout limit"):
        BACKUP.run([sys.executable, "-c", code], timeout=2)
    with pytest.raises(ProcessLookupError):
        os.kill(int(marker.read_text()), 0)


def test_metadata_capture_limits_timeout_and_nonzero_exit():
    assert BACKUP.run([sys.executable, "-c", "print('small JSON metadata')"]) == b"small JSON metadata\n"
    with pytest.raises(BACKUP.BackupError, match="timed out"):
        BACKUP.run([sys.executable, "-c", "import time;time.sleep(2)"], timeout=0.1)
    with pytest.raises(BACKUP.BackupError, match="command failed"):
        BACKUP.run([sys.executable, "-c", "raise SystemExit(1)"])


def test_pathologically_nested_json_is_a_safe_metadata_error():
    depth = max(10000, sys.getrecursionlimit() + 100)
    with pytest.raises(BACKUP.BackupError, match="Invalid backup metadata"):
        BACKUP.json_bytes(b"[" * depth + b"]" * depth)


def test_restore_checks_before_stop_and_requires_explicit_legacy_override(tmp_path):
    process = BackupProcess(tmp_path)
    legacy = process.root / "legacy.dump"
    write_private(legacy, b"PGDMPfixture legacy archive")
    env = {**process.env, "RESTORE_CONFIRM": "restore-fixture"}
    command = ["sh", str(process.root / "ops/compose-v2/restore-postgres.sh"), str(legacy)]
    result = subprocess.run(command, env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert "RESTORE_ALLOW_LEGACY_DUMP=true" in result.stderr
    assert not any("stop" in command for command in process.commands())
    env["RESTORE_ALLOW_LEGACY_DUMP"] = "true"
    result = subprocess.run(command, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    commands = process.commands()
    validation = next(i for i, command in enumerate(commands) if command[-2:] == ["pg_restore", "--list"])
    stop = next(i for i, command in enumerate(commands) if "stop" in command)
    assert validation < stop


def test_prebuilt_restore_is_refused_before_any_docker_call(tmp_path):
    process = BackupProcess(tmp_path)
    legacy = process.root / "legacy.dump"
    write_private(legacy, b"PGDMPfixture legacy archive")
    result = subprocess.run(["sh", str(process.root / "ops/compose-v2/restore-postgres.sh"), str(legacy)],
                            env={**process.env, "RESTORE_CONFIRM": "restore-fixture", "HMS_PREBUILT_BUNDLE": "/bundle"},
                            capture_output=True, text=True)
    assert result.returncode != 0 and "prebuilt mode" in result.stderr
    assert not process.log.exists()


def test_verified_receipt_hash_failure_cannot_be_bypassed_as_legacy_restore(tmp_path):
    process = BackupProcess(tmp_path)
    assert process.run().returncode == 0
    dump = next(process.directory.glob("*.dump"))
    dump.write_bytes(b"PGDMPdifferent archive")
    result = subprocess.run(["sh", str(process.root / "ops/compose-v2/restore-postgres.sh"), str(dump)],
                            env={**process.env, "RESTORE_CONFIRM": "restore-fixture", "RESTORE_ALLOW_LEGACY_DUMP": "true"},
                            capture_output=True, text=True)
    assert result.returncode != 0 and "no longer match" in result.stderr
    assert not any("stop" in command for command in process.commands())


def test_restore_failure_does_not_log_untrusted_source_names_or_env_values(tmp_path):
    process = BackupProcess(tmp_path)
    private_name = process.root / "sensitive-untrusted-source.dump"
    command = ["sh", str(process.root / "ops/compose-v2/restore-postgres.sh"), str(private_name)]
    result = subprocess.run(command, env=process.env, capture_output=True, text=True)
    assert result.returncode != 0 and private_name.name not in result.stdout + result.stderr
    write_private(private_name, b"PGDMPfixture archive")
    process.write_env(extra="")
    process.env_file.write_text(process.env_file.read_text().replace("CLIENT_SLUG=fixture", "CLIENT_SLUG=sensitive-untrusted-setting"))
    result = subprocess.run(command, env=process.env, capture_output=True, text=True)
    assert result.returncode != 0 and "sensitive-untrusted-setting" not in result.stdout + result.stderr
    assert not process.log.exists()


def test_cli_apply_requires_exact_plan_under_real_lease(tmp_path):
    process = BackupProcess(tmp_path)
    process.directory.mkdir(mode=0o700)
    owner = BACKUP.directory_owner(process.directory, CONTEXT, create=True)
    paths = [completed(process.directory, owner, age) for age in (0, 1, 2, 10)]
    limits = BACKUP.policy(BACKUP.read_env(process.env_file))
    plan = BACKUP.build_plan(process.directory, owner, CONTEXT, limits, NOW)
    plan_path = process.root / "approved-plan.json"
    write_private(plan_path, BACKUP.canonical(plan))
    command = [sys.executable, str(process.root / "ops/backup_retention.py"), "apply", "--root", str(process.root),
               "--env-file", str(process.env_file), "--backup-dir", str(process.directory),
               "--plan", str(plan_path), "--plan-sha256", "0" * 64]
    result = subprocess.run(command, env=process.env, capture_output=True, text=True)
    assert result.returncode != 0 and all(path.exists() for path in paths)
    command[-1] = plan["plan_sha256"]
    result = subprocess.run(command, env=process.env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert not paths[-1].exists() and all(path.exists() for path in paths[:-1])
    assert all(command[0] == "docker" and command[-3:] == ["config", "--format", "json"] for command in process.commands())


def test_backup_cannot_overlap_another_host_writer(tmp_path):
    process = BackupProcess(tmp_path)
    marker = tmp_path / "lease-held"
    owner = subprocess.Popen([sys.executable, str(process.root / "ops/deploy-lease.py"), "--", sys.executable, "-c",
                              "from pathlib import Path;import time;Path(" + repr(str(marker)) + ").touch();time.sleep(10)"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert marker.exists()
        result = process.run()
        assert result.returncode == 75
        assert not process.log.exists() and not process.directory.exists()
    finally:
        owner.terminate()
        owner.wait(timeout=5)


def test_monitoring_has_separate_time_and_size_retention():
    compose = (ROOT / "ops/compose-v2/compose.yml").read_text()
    assert "--storage.tsdb.retention.time=${PROMETHEUS_RETENTION:-7d}" in compose
    assert "--storage.tsdb.retention.size=${PROMETHEUS_RETENTION_SIZE:-3GB}" in compose


def dump_commands(process):
    return [command for command in process.commands() if any('pg_dump' in arg for arg in command)]


def test_held_count_cap_refuses_repeated_new_dumps_before_spooling(tmp_path):
    process = BackupProcess(tmp_path)
    process.write_env(extra='BACKUP_PIN=true\nBACKUP_MIN_COUNT=2\nBACKUP_MAX_COUNT=2\nBACKUP_RETENTION_APPLY=true\n')
    assert process.run().returncode == 0
    assert process.run().returncode == 0
    before = {path.name: path.read_bytes() for path in process.directory.iterdir()}
    count = len(dump_commands(process))
    for _ in range(2):
        result = process.run()
        assert result.returncode != 0 and 'count cap' in result.stderr
        assert len(dump_commands(process)) == count
        assert {path.name: path.read_bytes() for path in process.directory.iterdir()} == before
    assert len(list(process.directory.glob('*.dump'))) == 2


def test_explicit_apply_rotates_new_current_minimum_without_exceeding_final_cap(tmp_path):
    process = BackupProcess(tmp_path)
    process.write_env(extra='BACKUP_MIN_COUNT=2\nBACKUP_MAX_COUNT=2\nBACKUP_RETENTION_APPLY=true\n')
    artifacts = []
    for _ in range(4):
        result = process.run()
        assert result.returncode == 0, result.stderr
        dumps = list(process.directory.glob('*.dump'))
        assert len(dumps) <= 2
        artifacts.extend(path.name for path in dumps)
    assert len(list(process.directory.glob('*.dump'))) == 2
    assert len(list(process.directory.glob('*.retired.json'))) == 2
    assert len(set(artifacts)) == 4


def test_dry_run_cap_uses_physical_files_instead_of_proposed_deletions(tmp_path):
    process = BackupProcess(tmp_path)
    process.write_env(extra='BACKUP_MIN_COUNT=2\nBACKUP_MAX_COUNT=2\nBACKUP_RETENTION_APPLY=false\n')
    assert process.run().returncode == 0
    assert process.run().returncode == 0
    count = len(dump_commands(process))
    result = process.run()
    assert result.returncode != 0 and 'count cap' in result.stderr
    assert len(dump_commands(process)) == count
    assert len(list(process.directory.glob('*.dump'))) == 2
    assert not list(process.directory.glob('*.retired.json'))


def test_byte_admission_bounds_spool_and_preserves_all_prior_artifacts(tmp_path):
    process = BackupProcess(tmp_path)
    process.write_env(extra='BACKUP_PIN=true\nBACKUP_MAX_BYTES=100\nBACKUP_RETENTION_APPLY=true\n')
    assert process.run().returncode == 0
    dump = next(process.directory.glob('*.dump'))
    limit = dump.stat().st_size + 10
    process.write_env(extra=f'BACKUP_PIN=true\nBACKUP_MAX_BYTES={limit}\nBACKUP_RETENTION_APPLY=true\n')
    before = {path.name: path.read_bytes() for path in process.directory.iterdir()}
    result = process.run()
    assert result.returncode != 0 and 'byte budget' in result.stderr
    assert {path.name: path.read_bytes() for path in process.directory.iterdir()} == before
    assert not list(process.directory.glob('.hms-partial-*'))
    assert not list(process.directory.glob('.hms-readback-*'))


@pytest.mark.parametrize('name', ['.hms-partial-interrupted', '.hms-readback-interrupted'])
def test_orphan_spool_refuses_new_backup_without_erasing_evidence(tmp_path, name):
    process = BackupProcess(tmp_path)
    process.directory.mkdir(mode=0o700)
    orphan = process.directory / name
    write_private(orphan, b'PRIVATE_INTERRUPTED_EVIDENCE')
    result = process.run()
    assert result.returncode != 0 and 'interrupted backup spool' in result.stderr
    assert not dump_commands(process)
    assert orphan.read_bytes() == b'PRIVATE_INTERRUPTED_EVIDENCE'
    assert 'PRIVATE_INTERRUPTED_EVIDENCE' not in result.stdout + result.stderr


def persistent_prebuilt_state(process, base, marker):
    parent = base / '.hms-deploy-state'
    for path in (parent, parent / 'prebuilt', parent / 'prebuilt/hms-free-test',
                 parent / 'prebuilt/hms-free-test/releases'):
        path.mkdir(mode=0o700, exist_ok=True)
    path = parent / 'prebuilt/hms-free-test' / marker
    write_private(path, b'synthetic prebuilt state, deliberately not interpreted')
    return path


@pytest.mark.parametrize('marker', ['schema-compatibility', 'deploy-attempt', 'releases/current.json'])
def test_persistent_prebuilt_state_refuses_legacy_restore_when_shell_flag_is_absent(tmp_path, marker):
    process = BackupProcess(tmp_path)
    tool = tmp_path / 'bin/docker'
    tool.write_text(tool.read_text().replace('fixture-project', 'hms-free-test'))
    process.env_file.write_text(process.env_file.read_text() + 'COMPOSE_PROJECT_NAME=hms-free-test\n')
    state = persistent_prebuilt_state(process, tmp_path, marker)
    original = state.read_bytes()
    legacy = process.root / 'legacy.dump'
    write_private(legacy, b'PGDMPfixture legacy archive')
    environment = {**process.env, 'RESTORE_CONFIRM': 'restore-fixture', 'RESTORE_ALLOW_LEGACY_DUMP': 'true'}
    assert 'HMS_PREBUILT_BUNDLE' not in environment
    result = subprocess.run(['sh', str(process.root / 'ops/compose-v2/restore-postgres.sh'), str(legacy)],
                            env=environment, capture_output=True, text=True)
    assert result.returncode != 0 and 'Persistent prebuilt deployment state' in result.stderr
    assert not any('stop' in command or any('dropdb' in arg for arg in command) for command in process.commands())
    assert state.read_bytes() == original


def test_other_project_prebuilt_state_does_not_block_explicit_legacy_restore(tmp_path):
    process = BackupProcess(tmp_path)
    persistent_prebuilt_state(process, tmp_path, 'releases/current.json')
    legacy = process.root / 'legacy.dump'
    write_private(legacy, b'PGDMPfixture legacy archive')
    result = subprocess.run(['sh', str(process.root / 'ops/compose-v2/restore-postgres.sh'), str(legacy)],
                            env={**process.env, 'RESTORE_CONFIRM': 'restore-fixture', 'RESTORE_ALLOW_LEGACY_DUMP': 'true'},
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert any(any('dropdb' in arg for arg in command) for command in process.commands())


@pytest.mark.parametrize('fault', ['unsafe-mode', 'symlink-directory', 'symlink-marker', 'redirect-env'])
def test_persistent_prebuilt_restore_guard_cannot_be_redirected_or_bypassed_by_unsafe_state(tmp_path, fault):
    process = BackupProcess(tmp_path)
    tool = tmp_path / 'bin/docker'
    tool.write_text(tool.read_text().replace('fixture-project', 'hms-free-test'))
    process.env_file.write_text(process.env_file.read_text() + 'COMPOSE_PROJECT_NAME=hms-free-test\n')
    marker = persistent_prebuilt_state(process, tmp_path, 'releases/current.json')
    state = marker.parent.parent
    environment = {**process.env, 'RESTORE_CONFIRM': 'restore-fixture', 'RESTORE_ALLOW_LEGACY_DUMP': 'true'}
    if fault == 'unsafe-mode':
        state.chmod(0o755)
    elif fault == 'symlink-directory':
        retained = state.with_name('retained-state')
        state.rename(retained)
        state.symlink_to(retained, target_is_directory=True)
    elif fault == 'symlink-marker':
        external = tmp_path / 'preserved-private-state'
        write_private(external, b'PRIVATE_PERSISTENT_STATE')
        marker.unlink()
        marker.symlink_to(external)
    else:
        environment['HMS_PREBUILT_STATE_DIR'] = str(tmp_path / 'unrelated-empty-state')
    legacy = process.root / 'legacy.dump'
    write_private(legacy, b'PGDMPfixture legacy archive')
    result = subprocess.run(['sh', str(process.root / 'ops/compose-v2/restore-postgres.sh'), str(legacy)],
                            env=environment, capture_output=True, text=True)
    assert result.returncode != 0 and 'prebuilt' in result.stderr
    assert not any('stop' in command or any('dropdb' in arg for arg in command) for command in process.commands())
    assert 'PRIVATE_PERSISTENT_STATE' not in result.stdout + result.stderr
