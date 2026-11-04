"""Check the deployment trust boundary; opt-in Docker tests use synthetic headers only."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
import uuid

import pytest

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "ops/free-testing"
SPEC = importlib.util.spec_from_file_location("network_test_env", KIT / "prepare-env.py")
ENV = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENV)


def test_proxy_link_defaults_are_narrow_distinct_and_valid():
    ENV.validate_proxy_links({})
    config = (KIT / "compose.yml").read_text()
    assert "HMS_TRUSTED_PROXY_CIDRS: ${HMS_API_PROXY_CADDY_IPV4:-172.30.241.2}/32,${HMS_TUNNEL_PROXY_IPV4:-172.30.242.3}/32" in config
    assert "ipv4_address: ${HMS_API_PROXY_API_IPV4:-172.30.241.3}" in config
    assert "private_ranges" not in (KIT / "Caddyfile").read_text()
    assert "trusted_proxies_strict" in (KIT / "Caddyfile").read_text()


@pytest.mark.parametrize("values", [
    {"HMS_API_PROXY_SUBNET": "0.0.0.0/0"},
    {"HMS_API_PROXY_SUBNET": "127.0.0.0/24"},
    {"HMS_API_PROXY_SUBNET": "169.254.1.0/24"},
    {"HMS_API_PROXY_SUBNET": "172.30.242.0/29"},
    {"HMS_TUNNEL_PROXY_SUBNET": "172.30.242.0/30"},
    {"HMS_TUNNEL_PROXY_IPV4": "172.30.242.7"},
    {"HMS_TUNNEL_PROXY_IPV4": "172.30.242.0"},
    {"HMS_API_PROXY_API_IPV4": "172.30.241.2"},
    {"HMS_API_PROXY_CADDY_IPV4": "172.30.242.2"},
    {"HMS_TUNNEL_PROXY_IPV4": "172.30.242.3/0 0.0.0.0"},
])
def test_invalid_or_ambiguous_proxy_links_fail_without_echoing_values(values):
    with pytest.raises(ValueError, match="Proxy links require") as error:
        ENV.validate_proxy_links(values)
    assert all(value not in str(error.value) for value in values.values())


def test_operator_can_choose_non_overlapping_host_networks():
    ENV.validate_proxy_links({
        "HMS_API_PROXY_SUBNET": "10.251.1.0/29",
        "HMS_API_PROXY_CADDY_IPV4": "10.251.1.2",
        "HMS_API_PROXY_API_IPV4": "10.251.1.3",
        "HMS_TUNNEL_PROXY_SUBNET": "10.251.2.0/29",
        "HMS_TUNNEL_PROXY_CADDY_IPV4": "10.251.2.2",
        "HMS_TUNNEL_PROXY_IPV4": "10.251.2.3",
    })


@pytest.fixture(scope="module")
def proxy_runtime(tmp_path_factory):
    if os.environ.get("HMS_RUN_PROXY_RUNTIME_TESTS") != "1" or not shutil.which("docker"):
        pytest.skip("Set HMS_RUN_PROXY_RUNTIME_TESTS=1 for isolated local Docker HTTP tests")
    directory = tmp_path_factory.mktemp("proxy-runtime")
    name = "hms-proxy-test-" + uuid.uuid4().hex[:10]
    containers = [name + "-echo", name + "-caddy"]
    label = "hms.test.proxy.owner"
    owner = os.environ.get("HMS_PROXY_RUNTIME_OWNER_TOKEN", uuid.uuid4().hex)
    if not re.fullmatch("[0-9a-f]{32}", owner):
        raise RuntimeError("Invalid synthetic proxy ownership token")
    docker_host = os.environ.get("HMS_PROXY_RUNTIME_DOCKER_HOST")
    if docker_host is not None and docker_host != "unix:///Users/jebre/.docker/run/docker.sock":
        raise RuntimeError("Synthetic proxy requires the declared local Docker endpoint")
    journal_path = os.environ.get("HMS_PROXY_RUNTIME_JOURNAL")
    journal = None
    if journal_path:
        journal_path = Path(journal_path)
        if not journal_path.is_absolute() or journal_path.resolve() != journal_path or not journal_path.is_relative_to(ROOT / "results") or stat.S_IMODE(journal_path.stat().st_mode) != 0o600:
            raise RuntimeError("Invalid synthetic proxy ownership journal")
        journal = json.loads(journal_path.read_text())
        if journal.get("schema") != "hms-proxy-runtime-ownership-v1" or journal.get("owner_token") != owner or journal.get("plan") is not None or journal.get("docker_endpoint") != docker_host:
            raise RuntimeError("Invalid synthetic proxy ownership header")
    plan = {"planned_at_epoch": time.time(), "network": name, "containers": containers, "owner_label": label}
    immutable_header = {key: journal[key] for key in ("schema", "owner_token", "runner_created_at_epoch", "docker_endpoint")} if journal else None
    def journal_update(**values):
        if journal is None:
            return
        current = json.loads(journal_path.read_text())
        if any(current.get(key) != value for key, value in immutable_header.items()) or current.get("plan") not in (None, plan):
            raise RuntimeError("Synthetic proxy ownership changed")
        journal.update(plan=plan, **values)
        temporary = journal_path.with_name(journal_path.name + ".tmp")
        with temporary.open("x") as stream:
            os.chmod(temporary, 0o600)
            json.dump(journal, stream, sort_keys=True)
            stream.write("\n")
        temporary.replace(journal_path)
    request_plans = []
    journal_update(preexisting_absence_verified=False, request_plans=request_plans)
    # No published ports or credentials. This test-only network contains three peers.
    network = "172.31.247.0/29"
    echo = directory / "EchoCaddyfile"
    echo.write_text('''{
    auto_https off
}
:8080 {
    respond `{ "forwarded": "{http.request.header.X-Forwarded-For}", "offsite": "{http.request.header.X-HMS-Offsite}", "real_ip": "{http.request.header.X-Real-IP}", "cf_ip": "{http.request.header.CF-Connecting-IP}", "forwarded_alt": "{http.request.header.Forwarded}" }`
}
''')

    def docker(*arguments, check=True):
        environment = os.environ.copy()
        if docker_host is not None:
            for key in list(environment):
                if key.startswith("DOCKER_"):
                    environment.pop(key)
            environment["DOCKER_HOST"] = docker_host
        try:
            result = subprocess.run(["docker", *arguments], capture_output=True, text=True,
                                    check=False, timeout=25, env=environment)
        except subprocess.TimeoutExpired:
            raise subprocess.TimeoutExpired(["docker", "synthetic-proxy-operation"], 25) from None
        if check and result.returncode:
            raise subprocess.CalledProcessError(result.returncode, ["docker", "synthetic-proxy-operation"]) from None
        return result

    def names(kind):
        args = ("network", "ls", "--format", "{{json .Name}}") if kind == "network" else ("ps", "-a", "--format", "{{json .Names}}")
        return {value.strip() for line in docker(*args).stdout.splitlines() for value in json.loads(line).split(",")}

    absent = name not in names("network") and not set(containers) & names("container")
    if not absent:
        raise RuntimeError("Synthetic proxy resource name already exists")
    journal_update(preexisting_absence_verified=True, preflight_recorded_at_epoch=time.time())

    try:
        journal_update(creation_attempted=True)
        docker("network", "create", "--label", label + "=" + owner, "--subnet", network, name)
        docker("run", "-d", "--name", containers[0], "--network", name,
               "--label", label + "=" + owner,
               "--ip", "172.31.247.5", "--network-alias", "hms-api",
               "-v", f"{echo}:/etc/caddy/Caddyfile:ro", "caddy:2-alpine")
        docker("run", "-d", "--name", containers[1], "--network", name,
               "--label", label + "=" + owner,
               "--ip", "172.31.247.2", "-e", "HMS_TUNNEL_PROXY_IPV4=172.31.247.3",
               "-v", f"{KIT / 'Caddyfile'}:/etc/caddy/Caddyfile:ro", "caddy:2-alpine")
        journal_update(creation_complete=True)

        def request(peer, *headers, path="/api/v2/proxy-test"):
            args = []
            for header in headers:
                args.extend(["--header", header])
            request_name = name + "-request-" + uuid.uuid4().hex[:8]
            if request_name in names("container"):
                raise RuntimeError("Synthetic proxy request name already exists")
            entry = {"name": request_name, "planned_at_epoch": time.time(), "preexisting_absence_verified": True, "operation_returned": False}
            request_plans.append(entry)
            journal_update(request_plans=request_plans)
            try:
                completed = docker("run", "--rm", "--name", request_name, "--label", label + "=" + owner,
                                   "--network", name, "--ip", peer,
                                   "--entrypoint", "wget", "caddy:2-alpine", "-qO-",
                                   "-T", "3", *args, "http://172.31.247.2" + path)
            except subprocess.CalledProcessError:
                entry["operation_returned"] = True
                journal_update(request_plans=request_plans)
                raise
            entry["operation_returned"] = True
            journal_update(request_plans=request_plans)
            return json.loads(completed.stdout)

        request.logs = lambda: docker("logs", containers[1]).stderr

        for attempt in range(15):
            try:
                request("172.31.247.4")
                break
            except (subprocess.CalledProcessError, json.JSONDecodeError):
                if attempt == 14:
                    raise
                time.sleep(0.1)
        yield request
    finally:
        journal_update(fixture_finally_reached=True)
        # Root-journalled runs are cleaned by the outer supervisor even on TERM.
        # Standalone opt-in runs retain fixture cleanup, guarded by exact labels.
        if journal is None:
            all_containers = [entry["name"] for entry in request_plans] + containers
            for kind, resource in [("container", value) for value in reversed(all_containers)] + [("network", name)]:
                if resource not in names(kind):
                    continue
                value = json.loads(docker(kind, "inspect", resource).stdout)[0]
                labels = value.get("Labels", {}) if kind == "network" else value.get("Config", {}).get("Labels", {})
                if labels.get(label) != owner:
                    raise RuntimeError("Refusing unowned synthetic proxy cleanup")
                docker("network", "rm", value["Id"]) if kind == "network" else docker("rm", "-f", value["Id"])


def test_real_proxy_ignores_untrusted_forwarding_and_strips_location_flags(proxy_runtime):
    result = proxy_runtime("172.31.247.4", "X-Forwarded-For: 127.0.0.1",
                           "X-HMS-Offsite: false", "CF-Connecting-IP: 127.0.0.1",
                           "X-Real-IP: 127.0.0.1", "Forwarded: for=127.0.0.1")
    assert result["forwarded"] == "172.31.247.4"
    assert all(result[field] == "" for field in ("offsite", "real_ip", "cf_ip", "forwarded_alt"))


def test_real_proxy_preserves_rightmost_observed_client_and_full_malformed_chain(proxy_runtime):
    result = proxy_runtime("172.31.247.3", "X-Forwarded-For: 127.0.0.1, 203.0.113.42")
    assert result["forwarded"] == "127.0.0.1, 203.0.113.42, 172.31.247.3"
    malformed = proxy_runtime("172.31.247.3", "X-Forwarded-For: invalid, 203.0.113.42")
    # The API can reject the complete malformed evidence; Caddy must not launder it.
    assert malformed["forwarded"] == "invalid, 203.0.113.42, 172.31.247.3"


def test_real_proxy_does_not_invent_client_when_trusted_connector_has_no_chain(proxy_runtime):
    result = proxy_runtime("172.31.247.3")
    # This chain is entirely trusted; the API resolver must return Unknown.
    assert result["forwarded"] == "172.31.247.3"


def test_proxy_failure_logs_keep_status_without_request_identifiers(proxy_runtime):
    sentinel = "SYNTHETIC-PRIVATE-REQUEST-SENTINEL"
    with pytest.raises(subprocess.CalledProcessError):
        proxy_runtime("172.31.247.4", "X-Synthetic-Note: " + sentinel,
                      path="/" + sentinel + "?clinical_note=" + sentinel)
    entries = [json.loads(line) for line in proxy_runtime.logs().splitlines()
               if line.startswith("{")]
    errors = [entry for entry in entries if entry.get("logger") == "http.log.error"]
    assert errors and errors[-1]["status"] == 502
    assert "request" not in errors[-1]
    assert sentinel not in json.dumps(entries)
