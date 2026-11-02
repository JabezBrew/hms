from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import shutil
import subprocess
import sys
import tarfile
from types import SimpleNamespace

import pytest
from deployment_fixtures import copy_lease_helper


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("prebuilt_release", ROOT / "ops/prebuilt_release.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
REVISION = "a" * 40
EPOCH = "202610300030"


def archive(path, members, comment=None):
    with tarfile.open(path, "w:gz", format=tarfile.PAX_FORMAT,
                      pax_headers={"comment": comment} if comment else {}) as stream:
        for name, content, kind in members:
            item = tarfile.TarInfo(name)
            item.mode = 0o664
            if kind == "symlink":
                item.type = tarfile.SYMTYPE
                item.linkname = content.decode()
                stream.addfile(item)
            elif kind == "hardlink":
                item.type = tarfile.LNKTYPE
                item.linkname = content.decode()
                stream.addfile(item)
            elif kind == "directory":
                item.type = tarfile.DIRTYPE
                stream.addfile(item)
            else:
                item.size = len(content)
                stream.addfile(item, io.BytesIO(content))


def model(tunnel=False):
    services = {}
    for name in MODULE.APP_SERVICES:
        services[name] = {"image": "ordinary-image:tag", "build": {"context": "/source"},
                          "environment": {"HMS_ENV": "staging", "HMS_COOKIE_SECURE": "true",
                                          "HMS_DEPLOYMENT_PROFILE": "hospital", "HMS_AUTO_MIGRATE": "false"}}
    for name in MODULE.INFRA:
        services[name] = {"image": f"{name}:fixture"}
    services["caddy"]["ports"] = [{"host_ip": "127.0.0.1", "published": "8088", "target": 80}]
    services["hms-migrator"]["environment"].update(HMS_SEED_DEMO_DATA="true", HMS_DEMO_SEED_PROFILE="smoke")
    services["hms-api"]["environment"]["HMS_ACCOUNT_SETUP_DELIVERY_MODE"] = "disabled"
    services["frontend"]["environment"].update(HMS_API_MODE="rust-v2", V2_API_BASE_URL="/api/v2")
    if tunnel:
        services["cloudflared"] = {"image": "cloudflared:fixture"}
    return {"name": MODULE.PROJECT, "services": services}


class Bundle:
    def __init__(self, directory):
        self.root = directory / "source"
        self.root.mkdir()
        self.path = directory / "bundle"
        self.path.mkdir()
        files = {"ops/compose-v2/runtime-schema-epoch": (EPOCH + "\n").encode(),
                 "ops/prebuilt_release.py": b"# fixture\n", "ops/compose-v2/deploy.sh": b"# fixture\n",
                 "ops/free-testing/deploy.sh": b"# fixture\n", "ops/compose-v2/compose.yml": b"services: {}\n",
                 "ops/free-testing/compose.yml": b"services: {}\n", "backend-rs/Cargo.toml": b"# fixture\n"}
        self.members = []
        for name, content in files.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(0o644)
            self.members.append((name, content, "file"))
        archive(self.path / "source.tar.gz", self.members, REVISION)
        self.env = directory / "private.env"
        self.env.write_text("COMPOSE_PROJECT_NAME=hms-free-test\nHMS_ENV=staging\nHMS_SEED_DEMO_DATA=true\n"
                            "HMS_DEMO_SEED_PROFILE=smoke\nHMS_COOKIE_SECURE=true\n")
        self.env.chmod(0o600)
        images, members = {}, []
        for component in ("rust", "frontend"):
            labels = {"org.opencontainers.image.revision": REVISION, "systems.thehms.component": component}
            if component == "rust":
                labels["systems.thehms.schema-epoch"] = EPOCH
            raw = json.dumps({"os": "linux", "architecture": "arm64", "config": {"Labels": labels},
                              "rootfs": {"type": "layers", "diff_ids": ["sha256:" + hashlib.sha256(b"fixture").hexdigest()]}}, sort_keys=True).encode()
            digest = hashlib.sha256(raw).hexdigest()
            filename = digest + ".json"
            reference = f"hms-prebuilt-{component}:{REVISION}"
            images[component] = {"ref": reference, "id": "sha256:" + digest, "config_id": "sha256:" + digest, "component": component, "size": 10000, "unpacked_size": 7}
            members.append((filename, raw, "file"))
        self.image_members = members + [("layer.tar", b"fixture", "file"),
            ("manifest.json", json.dumps([{"Config": item["id"][7:] + ".json", "RepoTags": [item["ref"]],
                                            "Layers": ["layer.tar"]} for item in images.values()]).encode(), "file")]
        archive(self.path / "images.tar.gz", self.image_members)
        self.value = {"format": MODULE.FORMAT, "revision": REVISION, "platform": "linux/arm64",
                      "schema_epoch": EPOCH, "images": images}
        self.refresh()
        self.override = directory / "prebuilt.yml"
        self.config = directory / "config.json"

    def refresh(self):
        for field, filename in (("source", "source.tar.gz"), ("images_archive", "images.tar.gz")):
            path = self.path / filename
            self.value[field] = {"file": filename, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size": path.stat().st_size}
        self.write_manifest()

    def write_manifest(self):
        (self.path / "manifest.json").write_text(json.dumps(self.value))


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    for key in list(os.environ):
        if key.startswith(("HMS_", "COMPOSE_", "DOCKER_")):
            monkeypatch.delenv(key)
    return Bundle(tmp_path)


class FakeDocker:
    def __init__(self, bundle, monkeypatch, tunnel=False):
        self.bundle, self.commands = bundle, []
        self.base_model = model(tunnel)
        self.images = {}
        self.containers = {}
        self.loaded = False
        for component, expected in bundle.value["images"].items():
            labels = {"org.opencontainers.image.revision": REVISION, "systems.thehms.component": component}
            if component == "rust":
                labels["systems.thehms.schema-epoch"] = EPOCH
            actual = {"Id": expected["id"], "Size": expected["size"], "Os": "linux", "Architecture": "arm64",
                      "Config": {"Labels": labels}}
            self.images[expected["id"]] = actual
            self.images[expected["ref"]] = actual
        for index, name in enumerate((*MODULE.INFRA, *(("cloudflared",) if tunnel else ())), 1):
            identity = "sha256:" + str(index) * 64
            actual = {"Id": identity, "Size": 1000, "Os": "linux", "Architecture": "arm64"}
            self.images[f"{name}:fixture"] = actual
            self.images[identity] = actual
        monkeypatch.setattr(MODULE, "run", self.run)
        monkeypatch.setattr(MODULE.platform, "system", lambda: "Linux")
        monkeypatch.setattr(MODULE.os, "statvfs", lambda _: SimpleNamespace(f_blocks=1000 * MODULE.GIB,
                                                                         f_bavail=900 * MODULE.GIB, f_frsize=1))

    def run(self, args, timeout=120, env=None):
        self.commands.append(args)
        if args[:3] == ["docker", "context", "inspect"]:
            result = [{"Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}}}]
        elif args[:2] == ["docker", "info"]:
            result = {"OSType": "linux", "Architecture": "aarch64", "DockerRootDir": str(self.bundle.root), "Driver": "overlay2"}
        elif args[:3] == ["docker", "image", "inspect"]:
            if args[3] not in self.images:
                raise MODULE.VerificationError("Required image is not locally available.")
            result = [self.images[args[3]]]
        elif args[:3] == ["docker", "image", "load"]:
            self.loaded = True
            return b"Loaded image\n"
        elif args[:2] == ["docker", "compose"]:
            result = self.base_model
        elif args[:2] == ["docker", "ps"]:
            service = next(arg.split("=")[-1] for arg in args if arg.startswith("label=com.docker.compose.service="))
            return self.containers.get(service, {}).get("id", "").encode()
        elif args[:2] == ["docker", "inspect"]:
            result = [next(item["inspect"] for item in self.containers.values() if item["id"] == args[2])]
        else:
            raise AssertionError(args)
        return json.dumps(result).encode()

    def final_model(self, tunnel=False):
        final = copy.deepcopy(self.base_model)
        sidecar = json.loads(Path(str(self.bundle.override) + ".verification.json").read_text())
        for name, service in final["services"].items():
            service.pop("build", None)
            service.update(platform="linux/arm64", pull_policy="never")
            if name in MODULE.APP_SERVICES:
                service["image"] = sidecar["image_ids"]["frontend" if name == "frontend" else "rust"]
            else:
                service["image"] = sidecar["infra_ids"][name]
            if name in MODULE.RUST_SERVICES:
                service["environment"].update(HMS_BUILD_SHA=REVISION, HMS_IMAGE_TAG=REVISION)
        self.bundle.config.write_text(json.dumps(final))
        self.bundle.config.chmod(0o600)
        return final


def test_manifest_and_source_identity_and_mode(bundle):
    value = MODULE.manifest(bundle.path)
    MODULE.verify_archives(bundle.path, value)
    assert MODULE.verify_source(bundle.path, value, bundle.root) > 0
    MODULE.verify_image_archive(bundle.path, value)
    target = bundle.root / "backend-rs/Cargo.toml"
    target.chmod(0o755)
    with pytest.raises(MODULE.VerificationError, match="mode or size"):
        MODULE.verify_source(bundle.path, value, bundle.root)


@pytest.mark.parametrize("change", [
    lambda value: value.update(unknown=True),
    lambda value: value.update(revision="short"),
    lambda value: value.update(platform="linux/amd64"),
    lambda value: value.update(schema_epoch=202610300030),
    lambda value: value["source"].update(file="../source.tar.gz"),
    lambda value: value["images_archive"].update(size=True),
    lambda value: value["images"]["rust"].update(size=0),
    lambda value: value["images"]["frontend"].update(ref="mutable:latest"),
    lambda value: value["images"]["rust"].update(id="sha256:short"),
    lambda value: value["images"]["frontend"].update(id=value["images"]["rust"]["id"]),
])
def test_manifest_refuses_ambiguous_or_mismatched_input(bundle, change):
    change(bundle.value)
    bundle.write_manifest()
    with pytest.raises(MODULE.VerificationError):
        MODULE.manifest(bundle.path)


@pytest.mark.parametrize("raw", [b'{"revision":"a","revision":"b"}', b'{"size":NaN}', b'{"size":Infinity}', b'{'])
def test_json_parser_refuses_duplicates_nonnumbers_and_bad_json(raw):
    with pytest.raises(MODULE.VerificationError):
        MODULE.strict_json(raw)


@pytest.mark.parametrize("extra", [
    ("../escape", b"bad", "file"), ("/escape", b"bad", "file"),
    ("ops/link", b"../../outside", "symlink"), ("ops/link", b"ops/file", "hardlink"),
    ("backend-rs/Cargo.toml", b"duplicate", "file"), (".git/config", b"private", "file"),
])
def test_source_archive_refuses_unsafe_members_without_extraction(bundle, extra):
    archive(bundle.path / "source.tar.gz", bundle.members + [extra], REVISION)
    bundle.refresh()
    with pytest.raises(MODULE.VerificationError):
        MODULE.verify_source(bundle.path, bundle.value, bundle.root)
    assert not (bundle.root.parent / "escape").exists()


def test_source_refuses_wrong_commit_epoch_modified_bytes_and_symlink(bundle):
    archive(bundle.path / "source.tar.gz", bundle.members, "b" * 40)
    with pytest.raises(MODULE.VerificationError, match="commit identity"):
        MODULE.verify_source(bundle.path, bundle.value, bundle.root)
    archive(bundle.path / "source.tar.gz", bundle.members, REVISION)
    bundle.value["schema_epoch"] = "202610310031"
    with pytest.raises(MODULE.VerificationError, match="epoch"):
        MODULE.verify_source(bundle.path, bundle.value, bundle.root)
    bundle.value["schema_epoch"] = EPOCH
    target = bundle.root / "backend-rs/Cargo.toml"
    target.write_bytes(b"# fixturE\n")
    with pytest.raises(MODULE.VerificationError, match="bytes"):
        MODULE.verify_source(bundle.path, bundle.value, bundle.root)
    target.unlink()
    target.symlink_to(bundle.root / "ops/prebuilt_release.py")
    with pytest.raises(MODULE.VerificationError, match="symlinks"):
        MODULE.verify_source(bundle.path, bundle.value, bundle.root)


@pytest.mark.parametrize("field", ["source", "images_archive"])
def test_archive_transfer_integrity_and_symlinks(bundle, field):
    path = bundle.path / bundle.value[field]["file"]
    path.write_bytes(path.read_bytes() + b"corruption")
    with pytest.raises(MODULE.VerificationError, match="size"):
        MODULE.verify_archives(bundle.path, bundle.value)
    bundle.value[field]["size"] = path.stat().st_size
    with pytest.raises(MODULE.VerificationError, match="checksum"):
        MODULE.verify_archives(bundle.path, bundle.value)
    original = path.with_suffix(".saved")
    path.rename(original)
    path.symlink_to(original)
    with pytest.raises(MODULE.VerificationError, match="regular"):
        MODULE.verify_archives(bundle.path, bundle.value)


def test_image_archive_config_digest_and_transport_reference_are_bound(bundle):
    altered = list(bundle.image_members)
    manifest = json.loads(altered[-1][1])
    manifest[0]["RepoTags"] = ["attacker:latest"]
    altered[-1] = ("manifest.json", json.dumps(manifest).encode(), "file")
    archive(bundle.path / "images.tar.gz", altered)
    with pytest.raises(MODULE.VerificationError, match="transport tag"):
        MODULE.verify_image_archive(bundle.path, bundle.value)


def test_preparation_removes_all_builds_and_pins_every_service_without_pull(bundle, monkeypatch):
    docker = FakeDocker(bundle, monkeypatch, tunnel=True)
    MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override, True)
    assert docker.loaded
    output = bundle.override.read_text()
    assert output.count("build: !reset null") == 4
    assert output.count("pull_policy: never") == 9
    assert stat.S_IMODE(bundle.override.stat().st_mode) == 0o600
    sidecar = Path(str(bundle.override) + ".verification.json")
    assert stat.S_IMODE(sidecar.stat().st_mode) == 0o600
    docker.final_model(True)
    MODULE.verified_model(bundle.path, bundle.config, bundle.override, True)
    assert not any("build" in command or "pull" in command for command in docker.commands)


@pytest.mark.parametrize("fault", ["bad-checksum", "bad-source", "wrong-architecture", "missing-infra", "low-disk", "shell-override", "active-profile"])
def test_preflight_failure_never_loads_or_mutates_production(bundle, monkeypatch, fault):
    docker = FakeDocker(bundle, monkeypatch)
    if fault == "bad-checksum":
        bundle.value["images_archive"]["sha256"] = "0" * 64
        bundle.write_manifest()
    elif fault == "bad-source":
        (bundle.root / "ops/prebuilt_release.py").write_text("changed")
    elif fault == "wrong-architecture":
        monkeypatch.setattr(MODULE.platform, "system", lambda: "Darwin")
    elif fault == "missing-infra":
        del docker.images["redis:fixture"]
    elif fault == "low-disk":
        monkeypatch.setattr(MODULE.os, "statvfs", lambda _: SimpleNamespace(f_blocks=100 * MODULE.GIB,
                                                                         f_bavail=3 * MODULE.GIB, f_frsize=1))
    elif fault == "shell-override":
        monkeypatch.setenv("HMS_ENV", "production")
    else:
        monkeypatch.setenv("COMPOSE_PROFILES", "monitoring-disabled")
    with pytest.raises(MODULE.VerificationError):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert not docker.loaded
    assert not bundle.override.exists()
    assert not any(command[:2] == ["docker", "compose"] and any(action in command for action in ("up", "stop", "run", "build", "pull"))
                   for command in docker.commands)


@pytest.mark.parametrize("field,replacement", [("Id", "sha256:" + "f" * 64), ("Size", 32 * 1024 * 1024), ("Architecture", "amd64")])
def test_loaded_image_identity_is_checked_before_override_publication(bundle, monkeypatch, field, replacement):
    docker = FakeDocker(bundle, monkeypatch)
    docker.images[bundle.value["images"]["rust"]["id"]][field] = replacement
    with pytest.raises(MODULE.VerificationError):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert docker.loaded
    assert not bundle.override.exists()


@pytest.mark.parametrize("label", ["org.opencontainers.image.revision", "systems.thehms.component", "systems.thehms.schema-epoch"])
def test_loaded_rust_label_mismatch_fails_closed(bundle, monkeypatch, label):
    docker = FakeDocker(bundle, monkeypatch)
    docker.images[bundle.value["images"]["rust"]["id"]]["Config"]["Labels"][label] = "wrong"
    with pytest.raises(MODULE.VerificationError):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert not bundle.override.exists()


@pytest.mark.parametrize("fault", ["build", "mixed-rust", "wrong-project", "pull", "platform", "runtime-sha", "runtime-mode", "monitoring", "published-port", "infra-drift"])
def test_final_compose_model_refuses_identity_and_configuration_drift(bundle, monkeypatch, fault):
    docker = FakeDocker(bundle, monkeypatch)
    MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    final = docker.final_model()
    service = final["services"]["hms-worker"]
    if fault == "build":
        service["build"] = {}
    elif fault == "mixed-rust":
        service["image"] = bundle.value["images"]["frontend"]["id"]
    elif fault == "wrong-project":
        final["name"] = "other-app"
    elif fault == "pull":
        service["pull_policy"] = "missing"
    elif fault == "platform":
        service["platform"] = "linux/amd64"
    elif fault == "runtime-sha":
        service["environment"]["HMS_BUILD_SHA"] = "wrong"
    elif fault == "runtime-mode":
        service["environment"]["HMS_ENV"] = "production"
    elif fault == "monitoring":
        final["services"]["prometheus"] = {"image": "monitoring"}
    elif fault == "published-port":
        final["services"]["caddy"]["ports"][0]["host_ip"] = "0.0.0.0"
    else:
        final["services"]["redis"]["image"] = "sha256:" + "9" * 64
    bundle.config.write_text(json.dumps(final))
    with pytest.raises(MODULE.VerificationError):
        MODULE.verified_model(bundle.path, bundle.config, bundle.override)


@pytest.mark.parametrize("fault", ["override", "receipt", "public-config", "missing-image"])
def test_preparation_receipt_and_private_config_remain_bound(bundle, monkeypatch, fault):
    docker = FakeDocker(bundle, monkeypatch)
    MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    docker.final_model()
    if fault == "override":
        bundle.override.write_text(bundle.override.read_text() + "# changed\n")
    elif fault == "receipt":
        sidecar = Path(str(bundle.override) + ".verification.json")
        value = json.loads(sidecar.read_text())
        value["manifest_sha256"] = "0" * 64
        sidecar.write_text(json.dumps(value))
    elif fault == "public-config":
        bundle.config.chmod(0o644)
    else:
        del docker.images[bundle.value["images"]["rust"]["id"]]
    with pytest.raises(MODULE.VerificationError):
        MODULE.verified_model(bundle.path, bundle.config, bundle.override)


def test_actual_container_labels_and_image_not_mutable_tag_prove_release(bundle, monkeypatch):
    docker = FakeDocker(bundle, monkeypatch)
    MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    final = docker.final_model()
    for index, name in enumerate(("hms-api", "hms-worker", "frontend"), 1):
        docker.containers[name] = {"id": str(index) * 12,
            "inspect": {"Image": final["services"][name]["image"], "State": {"Running": True},
                        "Config": {"Env": [key + "=" + value for key, value in final["services"][name]["environment"].items()], "Labels": {"com.docker.compose.project": MODULE.PROJECT,
                                               "com.docker.compose.service": name, "com.docker.compose.oneoff": "False"}}}}
    MODULE.verify_containers(bundle.path, bundle.config, bundle.override)
    good_config = copy.deepcopy(docker.containers["frontend"]["inspect"]["Config"])
    for field, altered in (("Env", ["PRIVATE_SENTINEL=private-value"]), ("Cmd", ["unreviewed-command"]),
                           ("Entrypoint", ["unreviewed-entrypoint"])):
        docker.containers["frontend"]["inspect"]["Config"] = copy.deepcopy(good_config)
        docker.containers["frontend"]["inspect"]["Config"][field] = altered
        with pytest.raises(MODULE.VerificationError) as failure:
            MODULE.verify_containers(bundle.path, bundle.config, bundle.override)
        assert "private-value" not in str(failure.value)
    docker.containers["frontend"]["inspect"]["Config"] = good_config
    docker.containers["frontend"]["inspect"]["Image"] = "sha256:" + "f" * 64
    with pytest.raises(MODULE.VerificationError, match="container identity"):
        MODULE.verify_containers(bundle.path, bundle.config, bundle.override)


def test_headroom_budgets_are_additive_and_fail_at_eighty_five_percent(bundle, monkeypatch):
    FakeDocker(bundle, monkeypatch)
    monkeypatch.setattr(MODULE.os, "statvfs", lambda _: SimpleNamespace(f_blocks=100 * MODULE.GIB,
                                                                     f_bavail=22 * MODULE.GIB, f_frsize=1))
    with pytest.raises(MODULE.VerificationError, match="85%"):
        MODULE.headroom(bundle.path, bundle.value, bundle.root, bundle.env)
    monkeypatch.setattr(MODULE.os, "statvfs", lambda _: SimpleNamespace(f_blocks=100 * MODULE.GIB,
                                                                     f_bavail=50 * MODULE.GIB, f_frsize=1))
    assert MODULE.headroom(bundle.path, bundle.value, bundle.root, bundle.env)[0]["reserve_bytes"] == 10 * MODULE.GIB
    monkeypatch.setenv("HMS_DEPLOY_RESERVE_GIB", "0")
    with pytest.raises(MODULE.VerificationError, match="positive"):
        MODULE.headroom(bundle.path, bundle.value, bundle.root, bundle.env)


def test_revision_cli_has_no_docker_dependency_and_errors_do_not_echo_input(bundle):
    result = subprocess.run([sys.executable, str(ROOT / "ops/prebuilt_release.py"), "revision", "--bundle", str(bundle.path)],
                            capture_output=True, text=True)
    assert result.returncode == 0 and result.stdout.strip() == REVISION
    bundle.value["revision"] = "private-credential-sentinel"
    bundle.write_manifest()
    result = subprocess.run([sys.executable, str(ROOT / "ops/prebuilt_release.py"), "revision", "--bundle", str(bundle.path)],
                            capture_output=True, text=True)
    assert result.returncode == 1
    assert "private-credential-sentinel" not in result.stdout + result.stderr
    assert "No build or pull fallback" in result.stderr


def commit_source(bundle):
    subprocess.run(['git', '-C', str(bundle.root), 'init', '-q'], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(bundle.root), 'add', '.'], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(bundle.root), '-c', 'user.name=Synthetic Operator',
                    '-c', 'user.email=operator@example.test', 'commit', '-qm', 'Fixture'],
                   check=True, capture_output=True)
    revision = subprocess.run(['git', '-C', str(bundle.root), 'rev-parse', 'HEAD'],
                              check=True, capture_output=True, text=True).stdout.strip()
    bundle.value['revision'] = revision
    archive(bundle.path / 'source.tar.gz', bundle.members, revision)
    return revision


def test_git_checkout_archive_is_bound_to_actual_commit_blobs_not_staged_index(bundle, monkeypatch):
    revision = commit_source(bundle)
    monkeypatch.setenv('GIT_DIR', '/nonexistent/redirect')
    monkeypatch.setenv('GIT_WORK_TREE', '/nonexistent/redirect')
    assert MODULE.verify_source(bundle.path, bundle.value, bundle.root) > 0
    monkeypatch.delenv('GIT_DIR')
    monkeypatch.delenv('GIT_WORK_TREE')
    path = bundle.root / 'backend-rs/Cargo.toml'
    changed = b'# changed\n'
    path.write_bytes(changed)
    subprocess.run(['git', '-C', str(bundle.root), 'add', '.'], check=True, capture_output=True)
    members = [(name, changed if name == 'backend-rs/Cargo.toml' else content, kind)
               for name, content, kind in bundle.members]
    archive(bundle.path / 'source.tar.gz', members, revision)
    with pytest.raises(MODULE.VerificationError, match='actual commit object'):
        MODULE.verify_source(bundle.path, bundle.value, bundle.root)


def test_git_checkout_refuses_missing_archive_member_even_when_required_controls_present(bundle):
    revision = commit_source(bundle)
    archive(bundle.path / 'source.tar.gz', [member for member in bundle.members
                                          if member[0] != 'backend-rs/Cargo.toml'], revision)
    with pytest.raises(MODULE.VerificationError, match='Committed source set'):
        MODULE.verify_source(bundle.path, bundle.value, bundle.root)


def test_final_compose_binds_all_private_environment_commands_and_mounts(bundle, monkeypatch):
    docker = FakeDocker(bundle, monkeypatch)
    MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    final = docker.final_model()
    for setting, value in [('environment', {'HMS_ENV': 'staging', 'DB_PASSWORD': 'private-sentinel'}),
                           ('command', ['unreviewed-command']), ('volumes', [{'source': '/unreviewed'}])]:
        altered = copy.deepcopy(final)
        altered['services']['db'][setting] = value
        bundle.config.write_text(json.dumps(altered))
        with pytest.raises(MODULE.VerificationError, match='Final Compose settings differ'):
            MODULE.verified_model(bundle.path, bundle.config, bundle.override)


@pytest.mark.parametrize('target', ['directory', 'manifest', 'archive'])
def test_bundle_cannot_be_modified_by_other_users(bundle, target):
    path = {'directory': bundle.path, 'manifest': bundle.path / 'manifest.json',
            'archive': bundle.path / 'images.tar.gz'}[target]
    path.chmod(0o777 if target == 'directory' else 0o666)
    with pytest.raises(MODULE.VerificationError, match='writable'):
        value = MODULE.manifest(bundle.path)
        MODULE.verify_archives(bundle.path, value)


def test_output_requires_private_directory_and_never_overwrites_existing_artifact(bundle, monkeypatch):
    docker = FakeDocker(bundle, monkeypatch)
    parent = bundle.root / 'public-output'
    parent.mkdir(mode=0o755)
    with pytest.raises(MODULE.VerificationError, match='private directory'):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, parent / 'override.yml')
    assert not docker.loaded
    assert not (parent / 'override.yml').exists()
    bundle.override.write_text('existing protected artifact')
    with pytest.raises(MODULE.VerificationError, match='already exists'):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert bundle.override.read_text() == 'existing protected artifact'


def test_image_load_failure_leaves_no_published_override_or_sidecar(bundle, monkeypatch):
    docker = FakeDocker(bundle, monkeypatch)
    underlying = docker.run
    def failing_load(args, **kwargs):
        if args[:3] == ['docker', 'image', 'load']:
            raise MODULE.VerificationError('Local image load failed.')
        return underlying(args, **kwargs)
    monkeypatch.setattr(MODULE, 'run', failing_load)
    with pytest.raises(MODULE.VerificationError, match='image load failed'):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert not bundle.override.exists()
    assert not Path(str(bundle.override) + '.verification.json').exists()


def oci_bundle(bundle, nested=False):
    members, saved, descriptors = [], [], []
    layer = b'fixture'
    layer_id = 'sha256:' + hashlib.sha256(layer).hexdigest()
    layer_path = 'blobs/sha256/' + layer_id[7:]
    members.append((layer_path, layer, 'file'))
    for component, image in bundle.value['images'].items():
        raw = next(content for name, content, _ in bundle.image_members if name == image['id'][7:] + '.json')
        config_path = 'blobs/sha256/' + image['id'][7:]
        members.append((config_path, raw, 'file'))
        document = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                    'config': {'mediaType': 'application/vnd.oci.image.config.v1+json',
                               'digest': image['id'], 'size': len(raw)},
                    'layers': [{'mediaType': 'application/vnd.oci.image.layer.v1.tar',
                                'digest': layer_id, 'size': len(layer)}]}
        manifest_raw = json.dumps(document, sort_keys=True).encode()
        manifest_id = 'sha256:' + hashlib.sha256(manifest_raw).hexdigest()
        members.append(('blobs/sha256/' + manifest_id[7:], manifest_raw, 'file'))
        descriptor = {'mediaType': document['mediaType'], 'digest': manifest_id, 'size': len(manifest_raw),
                      'platform': {'os': 'linux', 'architecture': 'arm64', 'variant': 'v8'}}
        if nested:
            index_doc = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json',
                         'manifests': [descriptor, {'digest': 'sha256:' + 'f' * 64,
                                                   'mediaType': document['mediaType'], 'size': 100,
                                                   'platform': {'os': 'linux', 'architecture': 'amd64'}}]}
            index_raw = json.dumps(index_doc).encode()
            index_id = 'sha256:' + hashlib.sha256(index_raw).hexdigest()
            members.append(('blobs/sha256/' + index_id[7:], index_raw, 'file'))
            descriptor = {'mediaType': index_doc['mediaType'], 'digest': index_id, 'size': len(index_raw)}
        descriptor['annotations'] = {'io.containerd.image.name': 'docker.io/library/' + image['ref'],
                                     'org.opencontainers.image.ref.name': bundle.value['revision']}
        descriptors.append(descriptor)
        saved.append({'Config': config_path, 'Layers': [layer_path], 'RepoTags': [image['ref']]})
    members += [('manifest.json', json.dumps(saved).encode(), 'file'),
                ('index.json', json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json',
                                          'manifests': descriptors}).encode(), 'file'),
                ('oci-layout', b'{"imageLayoutVersion":"1.0.0"}', 'file')]
    archive(bundle.path / 'images.tar.gz', members)
    return members


@pytest.mark.parametrize('nested', [False, True])
def test_modern_oci_save_graph_binds_exact_configs_layers_tags_and_sparse_foreign_descriptors(bundle, nested):
    oci_bundle(bundle, nested)
    MODULE.verify_image_archive(bundle.path, bundle.value)


@pytest.mark.parametrize('fault', ['tag', 'extra-top-image', 'orphan-blob', 'blob-hash', 'layout', 'manifest-layers'])
def test_oci_save_never_imports_extra_tags_or_unverified_content(bundle, fault):
    members = oci_bundle(bundle)
    if fault in ('tag', 'extra-top-image'):
        index = json.loads(next(content for name, content, _ in members if name == 'index.json'))
        if fault == 'tag':
            index['manifests'][0]['annotations']['io.containerd.image.name'] = 'other-application:latest'
        else:
            index['manifests'].append(copy.deepcopy(index['manifests'][0]))
        members = [(name, json.dumps(index).encode() if name == 'index.json' else content, kind)
                   for name, content, kind in members]
    elif fault == 'orphan-blob':
        raw = b'orphaned unreviewed content'
        members.append(('blobs/sha256/' + hashlib.sha256(raw).hexdigest(), raw, 'file'))
    elif fault == 'blob-hash':
        name, content, kind = members[0]
        members[0] = (name, b'tampered', kind)
    elif fault == 'layout':
        members = [(name, b'{"imageLayoutVersion":"unknown"}' if name == 'oci-layout' else content, kind)
                   for name, content, kind in members]
    else:
        saved = json.loads(next(content for name, content, _ in members if name == 'manifest.json'))
        saved[0]['Layers'] = []
        members = [(name, json.dumps(saved).encode() if name == 'manifest.json' else content, kind)
                   for name, content, kind in members]
    archive(bundle.path / 'images.tar.gz', members)
    with pytest.raises(MODULE.VerificationError):
        MODULE.verify_image_archive(bundle.path, bundle.value)


def test_headroom_charges_backup_peak_to_its_actual_filesystem(bundle, monkeypatch, tmp_path):
    FakeDocker(bundle, monkeypatch)
    backup = tmp_path / 'separate-backup-mount'
    backup.mkdir()
    monkeypatch.setenv('BACKUP_DIR', str(backup / 'not-created-yet'))
    original_stat = Path.stat
    def stat_with_mount(path, *args, **kwargs):
        result = original_stat(path, *args, **kwargs)
        if path == backup:
            return SimpleNamespace(**{name: (999999 if name == 'st_dev' else getattr(result, name))
                                      for name in dir(result) if name.startswith('st_')})
        return result
    monkeypatch.setattr(Path, 'stat', stat_with_mount)
    inspected = []
    def available(path):
        inspected.append(path)
        return SimpleNamespace(f_blocks=1000 * MODULE.GIB, f_bavail=(12 if path == backup else 900) * MODULE.GIB,
                               f_frsize=1)
    monkeypatch.setattr(MODULE.os, 'statvfs', available)
    with pytest.raises(MODULE.VerificationError, match='headroom'):
        MODULE.headroom(bundle.path, bundle.value, bundle.root, bundle.env)
    assert backup in inspected
    assert not (backup / 'not-created-yet').exists()


def test_real_process_cli_preparation_binds_model_without_build_pull_or_runtime_commands(bundle, tmp_path):
    # Exercise main/subprocess/JSON serialization end-to-end. Only host-platform
    # and filesystem capacity are deterministic fixtures; every Docker command
    # crosses the actual process Interface into an isolated executable.
    lease = copy_lease_helper(bundle.root, tmp_path / 'lease-state/deploy.lock')
    candidate_module = bundle.root / 'ops/prebuilt_release.py'
    shutil.copy2(ROOT / 'ops/prebuilt_release.py', candidate_module)
    bundle.members = [(name, (bundle.root / name).read_bytes(), kind) for name, _, kind in bundle.members]
    bundle.members.append(('ops/deploy-lease.py', lease.read_bytes(), 'file'))
    archive(bundle.path / 'source.tar.gz', bundle.members, REVISION)
    bundle.refresh()
    tool_dir = tmp_path / 'tools'
    tool_dir.mkdir()
    state = tmp_path / 'docker-state.json'
    commands = tmp_path / 'docker-commands.jsonl'
    images = {}
    infra = {}
    for component, expected in bundle.value['images'].items():
        labels = {'org.opencontainers.image.revision': REVISION, 'systems.thehms.component': component}
        if component == 'rust':
            labels['systems.thehms.schema-epoch'] = EPOCH
        record = {'Id': expected['id'], 'Size': expected['size'], 'Os': 'linux', 'Architecture': 'arm64',
                  'Config': {'Labels': labels}}
        images[expected['id']] = images[expected['ref']] = record
    for index, name in enumerate(MODULE.INFRA, 1):
        identity = 'sha256:' + str(index) * 64
        record = {'Id': identity, 'Size': 1000, 'Os': 'linux', 'Architecture': 'arm64'}
        images[name + ':fixture'] = images[identity] = record
        infra[name] = identity
    state.write_text(json.dumps({'model': model(), 'images': images, 'root': str(bundle.root)}))
    fake = tool_dir / 'docker'
    fake.write_text('#!' + sys.executable + '\n' + '''import json,sys,os
from pathlib import Path
state=json.loads(Path(STATE).read_text())
args=sys.argv[1:]
with Path(COMMANDS).open('a') as stream:stream.write(json.dumps(args)+'\\n')
if args[:2]==['context','inspect']:value=[{'Endpoints':{'docker':{'Host':'unix:///var/run/docker.sock'}}}]
elif args[:1]==['info']:value={'OSType':'linux','Architecture':'aarch64','DockerRootDir':state['root'],'Driver':'overlay2'}
elif args[:2]==['image','inspect']:
 if args[2] not in state['images']:sys.exit(1)
 value=[state['images'][args[2]]]
elif args[:2]==['image','load']:
 os.fstat(int(os.environ['HMS_DEPLOY_LEASE_FD']))
 print('Loaded isolated fixture');sys.exit(0)
elif args[:1]==['compose'] and args[-3:]==['config','--format','json']:value=state['model']
else:sys.exit(99)
print(json.dumps(value))
'''.replace('STATE', repr(str(state))).replace('COMMANDS', repr(str(commands))))
    fake.chmod(0o755)
    launcher = tmp_path / 'launch.py'
    launcher.write_text('''import importlib.util,sys
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('verifier',MODULE_PATH)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.platform.system=lambda:'Linux'
module.os.statvfs=lambda _:SimpleNamespace(f_blocks=1000*module.GIB,f_bavail=900*module.GIB,f_frsize=1)
raise SystemExit(module.main(sys.argv[1:]))
'''.replace('MODULE_PATH', repr(str(candidate_module))))
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('HMS_', 'COMPOSE_', 'DOCKER_'))}
    environment['PATH'] = str(tool_dir) + os.pathsep + environment['PATH']
    denied = subprocess.run([sys.executable, str(launcher), 'prepare', '--bundle', str(bundle.path),
                             '--root', str(bundle.root), '--env-file', str(bundle.env),
                             '--override', str(bundle.override)], env=environment, capture_output=True, text=True)
    assert denied.returncode == 1 and 'canonical host deployment lease' in denied.stderr
    assert not commands.exists()
    result = subprocess.run([sys.executable, str(lease), '--', sys.executable, str(launcher), 'prepare', '--bundle', str(bundle.path),
                             '--root', str(bundle.root), '--env-file', str(bundle.env),
                             '--override', str(bundle.override)], env=environment, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    final = MODULE.pinned_model(model(), bundle.value, infra)
    bundle.config.write_text(json.dumps(final))
    bundle.config.chmod(0o600)
    result = subprocess.run([sys.executable, str(launcher), 'check-compose', '--bundle', str(bundle.path),
                             '--config', str(bundle.config), '--override', str(bundle.override)],
                            env=environment, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    actual = [json.loads(line) for line in commands.read_text().splitlines()]
    assert ['image', 'load', '--input', str(bundle.path / 'images.tar.gz')] in actual
    assert not any(any(action in item for action in ('build', 'pull', 'up', 'run', 'stop')) for item in actual)
    assert not any('private' in output for output in (result.stdout, result.stderr))


def test_git_replace_refs_cannot_substitute_committed_source_objects(bundle):
    revision = commit_source(bundle)
    path = bundle.root / 'backend-rs/Cargo.toml'
    path.write_text('# unrelated replacement commit\n')
    subprocess.run(['git', '-C', str(bundle.root), 'add', '.'], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(bundle.root), '-c', 'user.name=Synthetic Operator',
                    '-c', 'user.email=operator@example.test', 'commit', '-qm', 'Replacement fixture'],
                   check=True, capture_output=True)
    replacement = subprocess.run(['git', '-C', str(bundle.root), 'rev-parse', 'HEAD'],
                                 check=True, capture_output=True, text=True).stdout.strip()
    subprocess.run(['git', '-C', str(bundle.root), 'reset', '--hard', revision], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(bundle.root), 'replace', revision, replacement], check=True, capture_output=True)
    assert MODULE.verify_source(bundle.path, bundle.value, bundle.root) > 0


def engine_manifest_bundle(bundle):
    members = oci_bundle(bundle)
    top = json.loads(next(content for name, content, _ in members if name == 'index.json'))
    for descriptor in top['manifests']:
        component = next(component for component, image in bundle.value['images'].items()
                         if image['ref'] in descriptor['annotations']['io.containerd.image.name'])
        bundle.value['images'][component]['id'] = descriptor['digest']
    bundle.refresh()


@pytest.mark.parametrize('server_store', ['containerd', 'classic'])
def test_prebuilt_identity_and_compose_pins_are_portable_across_docker_image_stores(bundle, monkeypatch, server_store):
    engine_manifest_bundle(bundle)
    docker = FakeDocker(bundle, monkeypatch)
    for component, image in bundle.value['images'].items():
        actual = docker.images[image['ref']]
        actual['Descriptor'] = {'digest': image['id'], 'annotations': {'config.digest': image['config_id']}}
        if server_store == 'classic':
            del docker.images[image['id']]
            actual['Id'] = image['config_id']
            actual['Size'] = image['unpacked_size']
            docker.images[actual['Id']] = actual
    MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    final = docker.final_model()
    sidecar = json.loads(Path(str(bundle.override) + '.verification.json').read_text())
    for component, image in bundle.value['images'].items():
        assert sidecar['image_ids'][component] == image['config_id' if server_store == 'classic' else 'id']
    assert final['services']['hms-api']['image'] == sidecar['image_ids']['rust']
    assert final['services']['frontend']['image'] == sidecar['image_ids']['frontend']
    MODULE.verified_model(bundle.path, bundle.config, bundle.override)


def test_platform_object_must_resolve_to_canonical_config_and_not_an_index(bundle, monkeypatch):
    engine_manifest_bundle(bundle)
    docker = FakeDocker(bundle, monkeypatch)
    for component, image in bundle.value['images'].items():
        docker.images[image['ref']]['Descriptor'] = {
            'digest': image['id'], 'annotations': {'config.digest': 'sha256:' + 'f' * 64}}
    with pytest.raises(MODULE.VerificationError, match='canonical image config'):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert docker.loaded and not bundle.override.exists()


def test_archive_object_digest_cannot_name_unrelated_oci_metadata(bundle):
    engine_manifest_bundle(bundle)
    bundle.value['images']['rust']['id'] = 'sha256:' + 'f' * 64
    with pytest.raises(MODULE.VerificationError, match='Producer object ID'):
        MODULE.verify_image_archive(bundle.path, bundle.value)


def test_layer_expansion_is_measured_independently_and_compared_to_declared_budget(bundle):
    value = copy.deepcopy(bundle.value)
    for image in value['images'].values():
        image.pop('unpacked_size')
    assert MODULE.measure_image_archive(bundle.path, value) == {'rust': 7, 'frontend': 7}
    bundle.value['images']['rust']['unpacked_size'] = 8
    with pytest.raises(MODULE.VerificationError, match='unpacked image size'):
        MODULE.verify_image_archive(bundle.path, bundle.value)


def test_gzip_layer_bomb_is_bounded_before_load_by_total_declared_expansion(bundle):
    import gzip
    members = [(name, gzip.compress(b'changed layer' * 100) if name == 'layer.tar' else content, kind)
               for name, content, kind in bundle.image_members]
    archive(bundle.path / 'images.tar.gz', members)
    with pytest.raises(MODULE.VerificationError, match='declared storage limit'):
        MODULE.verify_image_archive(bundle.path, bundle.value)


@pytest.mark.parametrize('field,replacement', [('config_id', 'sha256:short'), ('unpacked_size', True), ('unpacked_size', 0)])
def test_manifest_requires_canonical_config_and_bounded_expanded_storage(bundle, field, replacement):
    bundle.value['images']['rust'][field] = replacement
    bundle.write_manifest()
    with pytest.raises(MODULE.VerificationError):
        MODULE.manifest(bundle.path)


def storage_metadata(docker, monkeypatch, *, driver='overlayfs', status=None, directory=None):
    underlying = docker.run
    def run(args, **kwargs):
        raw = underlying(args, **kwargs)
        if args[:2] == ['docker', 'info']:
            value = json.loads(raw)
            value['Driver'] = driver
            if status is not None:
                value['DriverStatus'] = status
            if directory is not None:
                value['DockerRootDir'] = str(directory)
            raw = json.dumps(value).encode()
        return raw
    monkeypatch.setattr(MODULE, 'run', run)


def test_containerd_explicit_reviewed_root_on_same_filesystem_aggregates_all_budgets(bundle, monkeypatch, tmp_path):
    docker = FakeDocker(bundle, monkeypatch)
    image_root = tmp_path / 'reviewed-containerd'
    image_root.mkdir()
    bundle.env.write_text(bundle.env.read_text() + 'HMS_CONTAINERD_ROOT=' + str(image_root) + '\n')
    storage_metadata(docker, monkeypatch, status=[['driver-type', 'io.containerd.snapshotter.v1']])
    facts = MODULE.headroom(bundle.path, bundle.value, bundle.root, bundle.env, expanded_source=123)
    expected = sum(max(image['size'], 2 * image['unpacked_size']) + MODULE.GIB
                   for image in bundle.value['images'].values())
    expected += 8 * MODULE.GIB + bundle.value['images_archive']['size'] + bundle.value['source']['size'] + 123
    assert len(facts) == 1 and facts[0]['budget_bytes'] == expected
    assert not docker.loaded


@pytest.mark.parametrize('fault', ['missing', 'empty', 'relative', 'nonexistent', 'file', 'symlink', 'parent-symlink', 'filesystem-root'])
def test_containerd_unreviewed_or_unsafe_image_root_refuses_before_load(bundle, monkeypatch, tmp_path, fault):
    docker = FakeDocker(bundle, monkeypatch)
    storage_metadata(docker, monkeypatch, status=[['driver-type', 'io.containerd.snapshotter.v1']])
    real = tmp_path / 'real-containerd'
    real.mkdir()
    if fault == 'empty':
        monkeypatch.setenv('HMS_CONTAINERD_ROOT', '')
    elif fault == 'relative':
        monkeypatch.setenv('HMS_CONTAINERD_ROOT', 'relative-containerd')
    elif fault == 'nonexistent':
        monkeypatch.setenv('HMS_CONTAINERD_ROOT', str(tmp_path / 'missing'))
    elif fault == 'file':
        file = tmp_path / 'regular-file'
        file.write_text('not storage')
        monkeypatch.setenv('HMS_CONTAINERD_ROOT', str(file))
    elif fault == 'symlink':
        link = tmp_path / 'linked-containerd'
        link.symlink_to(real, target_is_directory=True)
        monkeypatch.setenv('HMS_CONTAINERD_ROOT', str(link))
    elif fault == 'parent-symlink':
        child = real / 'child'
        child.mkdir()
        link = tmp_path / 'linked-parent'
        link.symlink_to(real, target_is_directory=True)
        monkeypatch.setenv('HMS_CONTAINERD_ROOT', str(link / 'child'))
    elif fault == 'filesystem-root':
        monkeypatch.setenv('HMS_CONTAINERD_ROOT', '/')
    with pytest.raises(MODULE.VerificationError, match='HMS_CONTAINERD_ROOT'):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert not docker.loaded and not bundle.override.exists()


@pytest.mark.parametrize('driver,status', [
    ('unknown-store', []), ('overlayfs', []),
    ('overlay2', [['driver-type', 'unreviewed.store']]),
    ('overlayfs', [['driver-type', 'io.containerd.snapshotter.v1'], ['driver-type', 'io.containerd.snapshotter.v1']]),
    ('overlay2', {'driver-type': 'io.containerd.snapshotter.v1'}),
    ('unreviewed-snapshotter', [['driver-type', 'io.containerd.snapshotter.v1']]),
])
def test_unknown_or_ambiguous_image_storage_refuses_before_load(bundle, monkeypatch, driver, status):
    docker = FakeDocker(bundle, monkeypatch)
    storage_metadata(docker, monkeypatch, driver=driver, status=status)
    with pytest.raises(MODULE.VerificationError, match='storage|driver|snapshotter'):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert not docker.loaded


def separated_store_devices(image_root, monkeypatch):
    original = Path.stat
    def stat(path, *args, **kwargs):
        result = original(path, *args, **kwargs)
        if path == image_root:
            return SimpleNamespace(**{name: (999999 if name == 'st_dev' else getattr(result, name))
                                      for name in dir(result) if name.startswith('st_')})
        return result
    monkeypatch.setattr(Path, 'stat', stat)


@pytest.mark.parametrize('low', ['images', 'docker-volumes'])
def test_containerd_and_docker_volume_filesystems_require_independent_headroom(bundle, monkeypatch, tmp_path, low):
    docker = FakeDocker(bundle, monkeypatch)
    image_root = tmp_path / 'separate-containerd-volume'
    image_root.mkdir()
    monkeypatch.setenv('HMS_CONTAINERD_ROOT', str(image_root))
    storage_metadata(docker, monkeypatch, status=[['driver-type', 'io.containerd.snapshotter.v1']])
    separated_store_devices(image_root, monkeypatch)
    seen = []
    def available(path):
        seen.append(path)
        selected = path == image_root if low == 'images' else path != image_root
        return SimpleNamespace(f_blocks=1000 * MODULE.GIB, f_bavail=(11 if selected else 900) * MODULE.GIB, f_frsize=1)
    monkeypatch.setattr(MODULE.os, 'statvfs', available)
    with pytest.raises(MODULE.VerificationError, match='headroom'):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert image_root in seen
    if low == 'docker-volumes':
        assert any(path != image_root for path in seen)
    assert not docker.loaded


@pytest.mark.parametrize('driver', ['overlay2', 'fuse-overlayfs', 'vfs'])
def test_explicit_classic_drivers_keep_images_and_database_on_docker_root(bundle, monkeypatch, driver):
    docker = FakeDocker(bundle, monkeypatch)
    storage_metadata(docker, monkeypatch, driver=driver, status=[])
    facts = MODULE.headroom(bundle.path, bundle.value, bundle.root, bundle.env)
    assert len(facts) == 1


def test_unsafe_docker_volume_root_is_not_used_as_capacity_proof(bundle, monkeypatch, tmp_path):
    docker = FakeDocker(bundle, monkeypatch)
    link = tmp_path / 'alias-docker-root'
    link.symlink_to(bundle.root, target_is_directory=True)
    storage_metadata(docker, monkeypatch, driver='overlay2', directory=link)
    with pytest.raises(MODULE.VerificationError, match='Docker volume storage'):
        MODULE.prepare(bundle.path, bundle.root, bundle.env, bundle.override)
    assert not docker.loaded
