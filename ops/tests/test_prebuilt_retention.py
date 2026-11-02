from __future__ import annotations

from argparse import Namespace
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

import pytest

from deployment_fixtures import copy_lease_helper
from test_prebuilt_release import model


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("prebuilt_retention", ROOT / "ops/prebuilt_retention.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
EPOCH = "202610300030"


def tar(path, members, revision=None):
    with tarfile.open(path, "w:gz", format=tarfile.PAX_FORMAT,
                      pax_headers={"comment": revision} if revision else {}) as stream:
        for name, payload, mode in members:
            item = tarfile.TarInfo(name)
            item.mode, item.size = mode, len(payload)
            stream.addfile(item, io.BytesIO(payload))


class Docker:
    def __init__(self):
        self.images, self.containers, self.commands = {}, [], []

    def run(self, args, **_kwargs):
        self.commands.append(args)
        assert args[0] == "docker"
        command = args[1:]
        if command[:2] == ["context", "inspect"]:
            return b'[{"Endpoints":{"docker":{"Host":"unix:///fixture.sock"}}}]'
        if command[:2] == ["image", "load"]:
            return b""
        if command[:2] == ["image", "inspect"]:
            if command[2] not in self.images:
                raise MODULE.prebuilt.VerificationError("Fixture image is missing.")
            return json.dumps([self.images[command[2]]]).encode()
        if command and command[0] == "ps":
            if "--all" in command:
                return ("\n".join(item["Id"] for item in self.containers) + "\n").encode()
            filters = [command[index + 1] for index, value in enumerate(command) if value == "--filter"]
            services = [value.split("service=", 1)[1] for value in filters if "service=" in value]
            found = [item["Id"] for item in self.containers
                     if item["State"]["Running"] and item["Config"]["Labels"].get("com.docker.compose.service") in services]
            return ("\n".join(found) + "\n").encode()
        if command and command[0] == "inspect":
            return json.dumps([next(item for item in self.containers if item["Id"] == identifier)
                               for identifier in command[1:]]).encode()
        if command[:2] == ["image", "rm"]:
            assert len(command) == 3 and not command[2].startswith("sha256:")
            assert not any(item["Image"] == self.images[command[2]]["Id"] for item in self.containers)
            del self.images[command[2]]
            return b""
        raise AssertionError(f"Unexpected Docker command: {command[:2]}")

    def activate(self, value, pinned):
        self.containers = []
        for index, service in enumerate(("hms-api", "hms-worker", "frontend")):
            component = "frontend" if service == "frontend" else "rust"
            self.containers.append({"Id": f"{index + 1:064x}", "Image": value["images"][component]["id"],
                "Config": {"Env": [key + "=" + entry for key, entry in pinned["services"][service].get("environment", {}).items()],
                           "Labels": {"com.docker.compose.project": "hms-free-test",
                           "com.docker.compose.service": service, "com.docker.compose.oneoff": "False"}},
                "State": {"Running": True}})


class Host:
    def __init__(self, directory, monkeypatch):
        self.directory, self.monkeypatch = directory, monkeypatch
        self.docker = Docker()
        self.roots = []
        self.lease_path = directory / ".hms-deploy-state/deploy.lock"
        monkeypatch.setattr(MODULE.prebuilt, "run", self.docker.run)
        monkeypatch.setattr(MODULE.prebuilt, "headroom", lambda *_args: [])
        monkeypatch.setattr(MODULE.prebuilt, "compose_model", lambda _root, _env, tunnel=False: model(tunnel))
        self.fd = None

    def release(self, letter, epoch=EPOCH, nonce=""):
        number = len(self.roots)
        root = self.directory / f"source-{number}"
        (root / "ops").mkdir(parents=True)
        for name in ("prebuilt_release.py", "prebuilt_retention.py", "prebuilt_state.py"):
            shutil.copy2(ROOT / "ops" / name, root / "ops" / name)
        helper = copy_lease_helper(root, self.lease_path)
        if self.fd is None:
            spec = importlib.util.spec_from_file_location("retention_test_lease", helper)
            lease = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(lease)
            self.fd = lease.acquire_fd()
            self.monkeypatch.setenv("HMS_DEPLOY_LEASE_FD", str(self.fd))
        files = {"ops/compose-v2/runtime-schema-epoch": epoch + "\n",
                 "ops/compose-v2/deploy.sh": "# fixture\n", "ops/free-testing/deploy.sh": "# fixture\n",
                 "ops/compose-v2/compose.yml": "services: {}\n", "ops/free-testing/compose.yml": "services: {}\n"}
        for name, content in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            path.chmod(0o644)
        bundle = self.directory / f"bundle-{number}"
        bundle.mkdir(mode=0o700)
        revision = letter * 40
        tar(bundle / "source.tar.gz", [(str(path.relative_to(root)), path.read_bytes(), 0o644)
            for path in sorted(root.rglob("*")) if path.is_file()], revision)
        images, members, saved = {}, [], []
        for component in ("rust", "frontend"):
            labels = {"org.opencontainers.image.revision": revision, "systems.thehms.component": component}
            if component == "rust": labels["systems.thehms.schema-epoch"] = epoch
            raw = json.dumps({"os": "linux", "architecture": "arm64", "config": {"Labels": labels},
                              "created": nonce, "rootfs": {"type": "layers", "diff_ids": ["sha256:" + hashlib.sha256(b"fixture").hexdigest()]}}, sort_keys=True).encode()
            image_id = "sha256:" + hashlib.sha256(raw).hexdigest()
            ref = f"hms-prebuilt-{component}:{revision}"
            images[component] = {"ref": ref, "id": image_id, "config_id": image_id,
                                 "component": component, "size": 10000, "unpacked_size": 7}
            item = {"Id": image_id, "Os": "linux", "Architecture": "arm64", "Size": 10000,
                    "Config": {"Labels": labels}, "RepoTags": [ref], "RepoDigests": []}
            self.docker.images[ref] = item
            self.docker.images[image_id] = item
            members.append((image_id[7:] + ".json", raw, 0o644))
            saved.append({"Config": image_id[7:] + ".json", "RepoTags": [ref], "Layers": ["layer.tar"]})
        tar(bundle / "images.tar.gz", [*members, ("layer.tar", b"fixture", 0o644),
            ("manifest.json", json.dumps(saved).encode(), 0o644)])
        value = {"format": MODULE.prebuilt.FORMAT, "revision": revision, "schema_epoch": epoch,
                 "platform": "linux/arm64", "images": images}
        for field, name in (("source", "source.tar.gz"), ("images_archive", "images.tar.gz")):
            path = bundle / name
            value[field] = {"file": name, "size": path.stat().st_size, "sha256": MODULE.prebuilt.digest_file(path)}
        (bundle / "manifest.json").write_text(json.dumps(value))
        env = self.directory / f"private-{number}.env"
        env.write_text("COMPOSE_PROJECT_NAME=hms-free-test\nHMS_ENV=staging\nHMS_SEED_DEMO_DATA=true\n"
                       "HMS_DEMO_SEED_PROFILE=smoke\nHMS_COOKIE_SECURE=true\n")
        env.chmod(0o600)
        override = self.directory / f"override-{number}.yml"
        MODULE.prebuilt.prepare(bundle, root, env, override)
        sidecar = MODULE.prebuilt.json_file(Path(str(override) + ".verification.json"))
        config = self.directory / f"config-{number}.json"
        pinned = MODULE.prebuilt.pinned_model(model(), value, sidecar["infra_ids"], sidecar["image_ids"])
        config.write_text(json.dumps(pinned))
        config.chmod(0o600)
        info = self.directory / f"build-info-{number}.json"
        info.write_text(json.dumps({"commit": revision, "mode": "production"}))
        info.chmod(0o600)
        self.docker.activate(value, pinned)
        state = self.lease_path.parent / "prebuilt/hms-free-test/releases"
        args = Namespace(root=root, bundle=bundle, config=config, override=override,
                         build_info=info, state=state, tunnel=False, exposure="local-only")
        self.roots.append(args)
        return args

    def add(self, letter, epoch=EPOCH, nonce=""):
        args = self.release(letter, epoch, nonce)
        MODULE.record(args)
        return args

    def infra(self):
        for index, name in enumerate(MODULE.prebuilt.INFRA):
            image_id = "sha256:" + str(index + 1) * 64
            item = {"Id": image_id, "Os": "linux", "Architecture": "arm64", "Size": 1000}
            self.docker.images[name + ":fixture"] = item
            self.docker.images[image_id] = item


@pytest.fixture
def host(tmp_path, monkeypatch):
    for key in list(os.environ):
        if key.startswith(("HMS_", "COMPOSE_", "DOCKER_")):
            monkeypatch.delenv(key)
    value = Host(tmp_path, monkeypatch)
    value.infra()
    try:
        yield value
    finally:
        if value.fd is not None:
            os.close(value.fd)


def test_record_uses_real_model_container_source_proofs_and_keeps_immutable_audit(host):
    args = host.add("a")
    receipt = next((args.state / "receipts").iterdir())
    original = receipt.read_bytes()
    MODULE.record(args)
    assert receipt.read_bytes() == original
    assert len(list((args.state / "events").iterdir())) == 2
    assert len(list((args.state / "receipts").iterdir())) == 1
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in args.state.rglob("*.json"))
    assert args.state.stat().st_mode & 0o777 == 0o700
    assert MODULE.plan(args.root, args.state)["proposals"] == []


def test_current_and_newest_same_schema_rollback_are_retained(host):
    first, second, current = [host.add(letter) for letter in "abc"]
    result = MODULE.plan(current.root, current.state)
    key = lambda args: MODULE.prebuilt.digest_file(args.bundle / "manifest.json")
    assert result["retained"] == [key(current), key(second)]
    assert {item["receipt"] for item in result["proposals"]} == {key(first)}
    assert len(result["proposals"]) == 2
    assert not any(command[1:3] == ["image", "rm"] for command in host.docker.commands)


def test_new_breaking_epoch_without_compatible_rollback_proposes_nothing(host):
    host.add("a")
    current = host.add("b", epoch="202611020031")
    result = MODULE.plan(current.root, current.state)
    assert result["rollback"] is None and result["proposals"] == [] and result["blocked"]


def test_corrupt_newest_previous_source_cannot_be_selected_as_rollback(host):
    oldest, broken, current = [host.add(letter) for letter in "abc"]
    with (broken.bundle / "source.tar.gz").open("ab") as stream: stream.write(b"changed")
    result = MODULE.plan(current.root, current.state)
    assert result["rollback"] == MODULE.prebuilt.digest_file(oldest.bundle / "manifest.json")
    assert result["current"] == MODULE.prebuilt.digest_file(current.bundle / "manifest.json")


@pytest.mark.parametrize("fault", ["source", "manifest", "missing_image", "current_runtime", "newer_fence", "image_archive"])
def test_current_release_or_schema_drift_refuses_cleanup(host, fault):
    host.add("a")
    current = host.add("b")
    if fault == "source": (current.bundle / "source.tar.gz").write_bytes(b"corrupt")
    if fault == "manifest": (current.bundle / "manifest.json").write_text("{}")
    if fault == "image_archive": (current.bundle / "images.tar.gz").write_bytes(b"corrupt")
    if fault == "missing_image": del host.docker.images[f"hms-prebuilt-rust:{'b' * 40}"]
    if fault == "current_runtime": host.docker.containers[0]["Image"] = "sha256:" + "f" * 64
    if fault == "newer_fence":
        path = current.state.parent / "schema-compatibility"
        path.write_text("202611020031\n")
        path.chmod(0o600)
    with pytest.raises((MODULE.RetentionError, MODULE.prebuilt.VerificationError)):
        MODULE.plan(current.root, current.state)


@pytest.mark.parametrize("fault", ["missing", "corrupt"])
def test_rollback_requires_the_intact_image_archive_accepted_by_deployment(host, fault):
    previous = host.add("a")
    current = host.add("b")
    archive = previous.bundle / "images.tar.gz"
    if fault == "missing": archive.unlink()
    else: archive.write_bytes(b"corrupt")
    result = MODULE.plan(current.root, current.state)
    assert result["rollback"] is None and result["proposals"] == [] and result["blocked"]
    assert not any(command[1:3] == ["image", "rm"] for command in host.docker.commands)


@pytest.mark.parametrize("fault", ["foreign_tag", "registry_digest", "stopped_container", "foreign_running_container", "unlabeled_container"])
def test_old_image_with_foreign_ownership_or_any_container_reference_is_protected(host, fault):
    first = host.add("a")
    host.add("b")
    current = host.add("c")
    old = json.loads((first.bundle / "manifest.json").read_text())["images"]["rust"]
    if fault == "foreign_tag": host.docker.images[old["ref"]]["RepoTags"].append("other-application:keep")
    if fault == "registry_digest": host.docker.images[old["ref"]]["RepoDigests"] = ["other@" + old["id"]]
    if fault in ("stopped_container", "foreign_running_container", "unlabeled_container"):
        host.docker.containers.append({"Id": "f" * 64, "Image": old["id"], "Config": {"Labels": None if fault == "unlabeled_container" else {}},
                                       "State": {"Running": fault == "foreign_running_container"}})
    result = MODULE.plan(current.root, current.state)
    assert old["ref"] not in {item["ref"] for item in result["proposals"]}
    assert len(result["proposals"]) == 1


@pytest.mark.parametrize("fault", ["symlink", "hardlink", "permissions"])
def test_unsafe_current_pointer_is_rejected(host, fault):
    args = host.add("a")
    current = args.state / "current.json"
    if fault == "symlink":
        preserved = current.with_suffix(".preserved")
        current.rename(preserved)
        current.symlink_to(preserved)
    if fault == "hardlink": os.link(current, args.state / "keep")
    if fault == "permissions": current.chmod(0o644)
    with pytest.raises((MODULE.RetentionError, MODULE.prebuilt.VerificationError)):
        MODULE.plan(args.root, args.state)


def test_incorrect_served_frontend_identity_cannot_publish_current_pointer(host):
    args = host.release("a")
    args.build_info.write_text('{"commit":"wrong","mode":"production"}')
    with pytest.raises(MODULE.RetentionError, match="frontend identity"):
        MODULE.record(args)
    assert not (args.state / "current.json").exists()


def test_same_commit_rebuilds_are_separate_immutable_release_identities(host):
    first = host.add("a", nonce="first-build")
    first_key = json.loads((first.state / "current.json").read_text())["receipt"]
    second = host.add("a", nonce="second-build")
    second_key = json.loads((second.state / "current.json").read_text())["receipt"]
    assert first_key != second_key
    assert len(list((second.state / "receipts").iterdir())) == 2


def test_apply_requires_exact_fresh_plan_and_removes_only_obsolete_tags(host):
    first = host.add("a")
    host.add("b")
    current = host.add("c")
    proposed = MODULE.plan(current.root, current.state)
    with pytest.raises(MODULE.RetentionError, match="plan changed"):
        MODULE.apply(current.root, current.state, "0" * 64)
    MODULE.apply(current.root, current.state, proposed["digest"])
    removed = [command for command in host.docker.commands if command[1:3] == ["image", "rm"]]
    assert {command[3] for command in removed} == {f"hms-prebuilt-{component}:{'a' * 40}" for component in ("rust", "frontend")}
    assert all(len(command) == 4 and "--force" not in command for command in removed)
    assert first.bundle.exists() and len(list((current.state / "receipts").iterdir())) == 3
    assert len(list((current.state / "cleanup").iterdir())) == 1


def test_apply_rechecks_new_container_reference_immediately_before_deletion(host, monkeypatch):
    first = host.add("a")
    host.add("b")
    current = host.add("c")
    proposed = MODULE.plan(current.root, current.state)
    original, count = MODULE.all_containers, 0
    old = json.loads((first.bundle / "manifest.json").read_text())["images"]["rust"]
    def changed():
        nonlocal count
        count += 1
        if count == 2:
            host.docker.containers.append({"Id": "f" * 64, "Image": old["id"], "Config": {"Labels": {}}, "State": {"Running": False}})
        return original()
    monkeypatch.setattr(MODULE, "all_containers", changed)
    with pytest.raises(MODULE.RetentionError, match="ownership or container references"):
        MODULE.apply(current.root, current.state, proposed["digest"])
    assert not any(command[1:3] == ["image", "rm"] for command in host.docker.commands)


def test_shared_ledger_namespace_cannot_be_redirected(host):
    args = host.release("a")
    args.state = host.directory / "arbitrary"
    with pytest.raises(MODULE.RetentionError, match="cannot be redirected"):
        MODULE.record(args)
    assert not args.state.exists()


def test_real_cli_without_canonical_lease_never_writes_ledger(host):
    args = host.release("a")
    environment = os.environ.copy()
    environment.pop("HMS_DEPLOY_LEASE_FD", None)
    result = subprocess.run([sys.executable, str(args.root / "ops/prebuilt_retention.py"), "plan",
        "--root", str(args.root), "--state", str(args.state)], capture_output=True, text=True, env=environment, timeout=10)
    assert result.returncode != 0
    assert "retention refused" in result.stderr
    assert not args.state.exists()


def test_real_cli_record_and_plan_verify_actual_interfaces_without_cleanup(host):
    args = host.release("a")
    tools = host.directory / "bin"
    tools.mkdir()
    data = host.directory / "docker-state.json"
    data.write_text(json.dumps({"images": host.docker.images, "containers": host.docker.containers}))
    data.chmod(0o600)
    commands = host.directory / "docker-commands.jsonl"
    tool = tools / "docker"
    tool.write_text(f"#!{sys.executable}\n" + '''import json, os, pathlib, sys
os.fstat(int(os.environ["HMS_DEPLOY_LEASE_FD"]))
args = sys.argv[1:]
with pathlib.Path(os.environ["FIXTURE_COMMANDS"]).open("a") as stream: stream.write(json.dumps(args)+"\\n")
state = json.loads(pathlib.Path(os.environ["FIXTURE_DOCKER_STATE"]).read_text())
if args[:2] == ["context","inspect"]:
    print('[{"Endpoints":{"docker":{"Host":"unix:///fixture.sock"}}}]')
elif args[:2] == ["image","inspect"]:
    if args[2] not in state["images"]: sys.exit(1)
    print(json.dumps([state["images"][args[2]]]))
elif args[0] == "ps":
    values = state["containers"]
    if "--all" not in args:
        services = [part.split("service=",1)[1] for part in args if "service=" in part]
        values = [item for item in values if item["State"]["Running"] and item["Config"]["Labels"].get("com.docker.compose.service") in services]
    print("\\n".join(item["Id"] for item in values))
elif args[0] == "inspect":
    print(json.dumps([next(item for item in state["containers"] if item["Id"] == identifier) for identifier in args[1:]]))
else: sys.exit(99)
''')
    tool.chmod(0o755)
    environment = os.environ.copy()
    environment.update(PATH=str(tools) + os.pathsep + environment["PATH"],
                       FIXTURE_COMMANDS=str(commands), FIXTURE_DOCKER_STATE=str(data))
    common = ["--root", str(args.root), "--state", str(args.state)]
    arguments = ["record", *common, "--bundle", str(args.bundle), "--config", str(args.config),
                 "--override", str(args.override), "--build-info", str(args.build_info)]
    invoke = lambda extra: subprocess.run([sys.executable, str(args.root / "ops/deploy-lease.py"), "--",
        sys.executable, str(args.root / "ops/prebuilt_retention.py"), *extra], capture_output=True, text=True,
        env=environment, pass_fds=(host.fd,), timeout=15)
    recorded = invoke(arguments)
    assert recorded.returncode == 0, recorded.stderr
    planned = invoke(["plan", *common])
    assert planned.returncode == 0, planned.stderr
    result = json.loads(planned.stdout)
    assert result["current"] and result["proposals"] == [] and result["rollback"] is None
    observed = [json.loads(row) for row in commands.read_text().splitlines()]
    assert observed and all(row[0] in ("context", "image", "ps", "inspect") for row in observed)
    assert not any(row[:2] in (["image", "rm"], ["image", "load"]) or row[0] in ("build", "pull") for row in observed)


def test_apply_stops_if_foreign_tag_appears_after_plan(host, monkeypatch):
    first = host.add("a")
    host.add("b")
    current = host.add("c")
    proposed = MODULE.plan(current.root, current.state)
    original, count = MODULE.all_containers, 0
    old = json.loads((first.bundle / "manifest.json").read_text())["images"]["rust"]
    def changed():
        nonlocal count
        count += 1
        if count == 2:
            host.docker.images[old["ref"]]["RepoTags"].append("other-application:keep")
        return original()
    monkeypatch.setattr(MODULE, "all_containers", changed)
    with pytest.raises(MODULE.RetentionError, match="ownership or container references"):
        MODULE.apply(current.root, current.state, proposed["digest"])
    assert not any(command[1:3] == ["image", "rm"] for command in host.docker.commands)


def test_new_success_event_invalidates_an_older_reviewed_plan(host):
    host.add("a")
    host.add("b")
    current = host.add("c")
    proposed = MODULE.plan(current.root, current.state)
    MODULE.record(current)
    with pytest.raises(MODULE.RetentionError, match="plan changed"):
        MODULE.apply(current.root, current.state, proposed["digest"])


def test_ledger_receipts_and_event_counts_are_bounded_before_publication(host, monkeypatch):
    current = host.add("a")
    monkeypatch.setattr(MODULE, "MAX_RECORDS", 1)
    with pytest.raises(MODULE.RetentionError, match="capacity"):
        MODULE.record(current)
    assert len(list((current.state / "events").iterdir())) == 1


def test_cleanup_audit_capacity_is_checked_before_any_image_delete(host, monkeypatch):
    host.add("a")
    host.add("b")
    current = host.add("c")
    proposed = MODULE.plan(current.root, current.state)
    for index in range(3):
        path = current.state / "cleanup" / str(index)
        path.write_text("preserve")
    monkeypatch.setattr(MODULE, "MAX_RECORDS", 3)
    with pytest.raises(MODULE.RetentionError, match="audit capacity"):
        MODULE.apply(current.root, current.state, proposed["digest"])
    assert not any(command[1:3] == ["image", "rm"] for command in host.docker.commands)


@pytest.mark.parametrize("key", ["DOCKER_HOST", "DOCKER_CONTEXT"])
def test_retention_rejects_remote_endpoint_overrides_before_inventory_or_cleanup(host, monkeypatch, key):
    current = host.add("a")
    host.docker.commands.clear()
    monkeypatch.setenv(key, "remote-fixture")
    with pytest.raises(MODULE.RetentionError, match="local Docker endpoint"):
        MODULE.plan(current.root, current.state)
    assert not host.docker.commands


@pytest.mark.parametrize("endpoint", ["ssh://fixture", "tcp://fixture:2376"])
def test_persisted_remote_context_cannot_target_another_hosts_images(host, monkeypatch, endpoint):
    current = host.add("a")
    original = host.docker.run
    def remote(args, **kwargs):
        if args[1:3] == ["context", "inspect"]:
            return json.dumps([{"Endpoints": {"docker": {"Host": endpoint}}}]).encode()
        return original(args, **kwargs)
    monkeypatch.setattr(MODULE.prebuilt, "run", remote)
    with pytest.raises(MODULE.RetentionError, match="remote Docker endpoint"):
        MODULE.plan(current.root, current.state)


@pytest.mark.parametrize("canonical", [False, True])
def test_containerd_owned_repository_digest_does_not_prevent_scoped_tag_cleanup(host, canonical):
    first = host.add("a")
    host.add("b")
    current = host.add("c")
    old = json.loads((first.bundle / "manifest.json").read_text())["images"]["rust"]
    repo = old["ref"].split(":", 1)[0]
    reference = ("docker.io/library/" if canonical else "") + repo + "@" + old["id"]
    host.docker.images[old["ref"]]["RepoDigests"] = [reference]
    result = MODULE.plan(current.root, current.state)
    assert old["ref"] in {item["ref"] for item in result["proposals"]}
    MODULE.apply(current.root, current.state, result["digest"])
    assert old["ref"] not in host.docker.images


@pytest.mark.parametrize("foreign", ["repository", "digest"])
def test_foreign_repository_or_unbound_digest_remains_protected(host, foreign):
    first = host.add("a")
    host.add("b")
    current = host.add("c")
    old = json.loads((first.bundle / "manifest.json").read_text())["images"]["rust"]
    repo = old["ref"].split(":", 1)[0]
    reference = ("foreign-application" if foreign == "repository" else repo) + "@" + (old["id"] if foreign == "repository" else "sha256:" + "f" * 64)
    host.docker.images[old["ref"]]["RepoDigests"] = [reference]
    result = MODULE.plan(current.root, current.state)
    assert old["ref"] not in {item["ref"] for item in result["proposals"]}


def test_partial_cleanup_keeps_audit_and_fresh_plan_can_remove_only_the_remaining_tag(host, monkeypatch):
    first = host.add("a")
    host.add("b")
    current = host.add("c")
    proposed = MODULE.plan(current.root, current.state)
    old = json.loads((first.bundle / "manifest.json").read_text())["images"]
    original = host.docker.run
    def fail_second(args, **kwargs):
        if args[1:3] == ["image", "rm"] and args[3] == old["frontend"]["ref"]:
            raise MODULE.prebuilt.VerificationError("Fixture second deletion failed.")
        return original(args, **kwargs)
    monkeypatch.setattr(MODULE.prebuilt, "run", fail_second)
    with pytest.raises(MODULE.prebuilt.VerificationError):
        MODULE.apply(current.root, current.state, proposed["digest"])
    assert old["rust"]["ref"] not in host.docker.images
    assert old["frontend"]["ref"] in host.docker.images
    audit = json.loads(next((current.state / "cleanup").iterdir()).read_text())
    assert [item["ref"] for item in audit["removed"]] == [old["rust"]["ref"]]
    monkeypatch.setattr(MODULE.prebuilt, "run", original)
    fresh = MODULE.plan(current.root, current.state)
    assert [item["ref"] for item in fresh["proposals"]] == [old["frontend"]["ref"]]
    MODULE.apply(current.root, current.state, fresh["digest"])
    assert old["frontend"]["ref"] not in host.docker.images
    assert len(list((current.state / "cleanup").iterdir())) == 2


def test_later_cleared_container_reference_can_be_cleaned_after_its_sibling_tag_is_gone(host):
    first = host.add("a")
    host.add("b")
    current = host.add("c")
    old = json.loads((first.bundle / "manifest.json").read_text())["images"]
    host.docker.containers.append({"Id": "f" * 64, "Image": old["rust"]["id"],
                                   "Config": {"Labels": {}}, "State": {"Running": False}})
    proposed = MODULE.plan(current.root, current.state)
    assert [item["ref"] for item in proposed["proposals"]] == [old["frontend"]["ref"]]
    MODULE.apply(current.root, current.state, proposed["digest"])
    host.docker.containers.pop()
    fresh = MODULE.plan(current.root, current.state)
    assert [item["ref"] for item in fresh["proposals"]] == [old["rust"]["ref"]]
