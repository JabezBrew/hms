"""Check the deployment trust boundary; opt-in Docker tests use synthetic headers only."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
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
        return subprocess.run(["docker", *arguments], capture_output=True, text=True,
                              check=check, timeout=25)

    docker("network", "create", "--subnet", network, name)
    try:
        docker("run", "-d", "--name", containers[0], "--network", name,
               "--ip", "172.31.247.5", "--network-alias", "hms-api",
               "-v", f"{echo}:/etc/caddy/Caddyfile:ro", "caddy:2-alpine")
        docker("run", "-d", "--name", containers[1], "--network", name,
               "--ip", "172.31.247.2", "-e", "HMS_TUNNEL_PROXY_IPV4=172.31.247.3",
               "-v", f"{KIT / 'Caddyfile'}:/etc/caddy/Caddyfile:ro", "caddy:2-alpine")

        def request(peer, *headers, path="/api/v2/proxy-test"):
            args = []
            for header in headers:
                args.extend(["--header", header])
            completed = docker("run", "--rm", "--network", name, "--ip", peer,
                               "--entrypoint", "wget", "caddy:2-alpine", "-qO-",
                               "-T", "3", *args, "http://172.31.247.2" + path)
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
        for container in reversed(containers):
            docker("rm", "-f", container, check=False)
        docker("network", "rm", name, check=False)


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
