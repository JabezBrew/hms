from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from test_prebuilt_release import Bundle, MODULE


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.skipif(shutil.which("docker") is None, reason="Docker Compose CLI unavailable")
@pytest.mark.parametrize("tunnel", [False, True])
def test_real_compose_removes_all_builds_and_matches_prepared_private_model(tmp_path, monkeypatch, tunnel):
    """Real Compose merge; image I/O and disk/host admission are separate tests."""
    bundle = Bundle(tmp_path)
    env_file = tmp_path / "compose.env"
    generated = subprocess.run([
        sys.executable, str(ROOT / "ops/free-testing/prepare-env.py"),
        "--domain", "staging.example.test", "--admin-email", "synthetic@example.test",
        "--output", str(env_file),
    ], capture_output=True, text=True)
    assert generated.returncode == 0
    values = MODULE.read_env(env_file)
    for key in list(os.environ):
        if key in values or key.startswith(("HMS_", "COMPOSE_", "DOCKER_")):
            monkeypatch.delenv(key)
    monkeypatch.setenv("HMS_BUILD_SHA", bundle.value["revision"])
    monkeypatch.setenv("HMS_DEPLOYED_AT", "2026-11-02T00:00:00Z")
    for relative in ("ops/compose-v2/compose.yml", "ops/free-testing/compose.yml"):
        shutil.copy2(ROOT / relative, bundle.root / relative)
    real_run = MODULE.run

    def run(args, **kwargs):
        if args[:3] == ["docker", "image", "load"]:
            return b""
        return real_run(args, **kwargs)

    images = {}
    for component, expected in bundle.value["images"].items():
        labels = {"org.opencontainers.image.revision": bundle.value["revision"],
                  "systems.thehms.component": component}
        if component == "rust":
            labels["systems.thehms.schema-epoch"] = bundle.value["schema_epoch"]
        images[expected["id"]] = {"Id": expected["id"], "Size": expected["size"],
                                 "Os": "linux", "Architecture": "arm64", "Config": {"Labels": labels}}
        images[expected["ref"]] = images[expected["id"]]

    def inspect(reference):
        if reference in images:
            return images[reference]
        digest = "sha256:" + hashlib.sha256(reference.encode()).hexdigest()
        images[digest] = {"Id": digest, "Size": 100, "Os": "linux", "Architecture": "arm64"}
        return images[digest]

    monkeypatch.setattr(MODULE, "run", run)
    monkeypatch.setattr(MODULE, "inspect_image", inspect)
    monkeypatch.setattr(MODULE, "verify_archives", lambda *_: None)
    monkeypatch.setattr(MODULE, "verify_source", lambda *_: 1024)
    monkeypatch.setattr(MODULE, "verify_image_archive", lambda *_: None)
    monkeypatch.setattr(MODULE, "headroom", lambda *_: [])
    MODULE.prepare(bundle.path, bundle.root, env_file, bundle.override, tunnel)
    command = ["docker", "compose", "--env-file", str(env_file),
               "-f", str(bundle.root / "ops/compose-v2/compose.yml"),
               "-f", str(bundle.root / "ops/free-testing/compose.yml"),
               "-f", str(bundle.override)]
    if tunnel:
        command.extend(["--profile", "tunnel"])
    config = real_run([*command, "config", "--format", "json"])
    bundle.config.write_bytes(config)
    bundle.config.chmod(0o600)
    _, model, services = MODULE.verified_model(bundle.path, bundle.config, bundle.override, tunnel)
    assert model["name"] == "hms-free-test"
    assert all("build" not in service for service in services.values())
    assert all(service["pull_policy"] == "never" for service in services.values())
    assert {services[name]["image"] for name in MODULE.RUST_SERVICES} == {bundle.value["images"]["rust"]["id"]}
    assert ("cloudflared" in services) is tunnel
    assert not {"prometheus", "grafana"}.intersection(services)
