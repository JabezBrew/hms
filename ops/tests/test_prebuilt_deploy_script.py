from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

import pytest

from test_compose_deploy_readiness import SimulatedDeploy


ROOT = Path(__file__).resolve().parents[2]
REVISION = "a" * 40


@pytest.fixture
def deployment(tmp_path):
    value = SimulatedDeploy(tmp_path)
    root = value.script.parents[2]
    shutil.copy2(ROOT / "ops/prebuilt_state.py", root / "ops/prebuilt_state.py")
    free = root / "ops/free-testing"
    free.mkdir()
    (free / "compose.yml").write_text("services: {}\n")
    (root / "ops/compose-v2/compose.yml").write_text("services: {}\n")
    value.env.update(HMS_PREBUILT_BUNDLE=str(tmp_path / "bundle"),
                     HMS_PREBUILT_PROFILE="free-testing", HMS_PREBUILT_TUNNEL="false",
                     HMS_BUILD_SHA=REVISION,
                     COMPOSE_FILES=f"{root}/ops/compose-v2/compose.yml {free}/compose.yml")
    state = tmp_path / ".hms-deploy-state/prebuilt/hms-free-test"
    value.env["HMS_SCHEMA_FENCE_FILE"] = str(state / "schema-compatibility")
    value.env["HMS_DEPLOY_ATTEMPT_FILE"] = str(state / "deploy-attempt")
    value.env.pop("HMS_PREBUILT_STATE_DIR", None)
    value.env.pop("HMS_PREBUILT_OVERRIDE", None)
    helper = root / "ops/prebuilt_release.py"
    helper.write_text('''import json, os, sys
from pathlib import Path
args=sys.argv[1:]
with Path(os.environ['TEST_COMMAND_LOG']).open('a') as f:
    f.write(json.dumps(['prebuilt', *args])+'\\n')
if args[0] == os.environ.get('TEST_PREBUILT_FAIL'):
    raise SystemExit('deliberate verification refusal')
if args[0] == 'revision':
    print('a'*40)
elif args[0] == 'prepare':
    output=Path(args[args.index('--override')+1])
    output.write_text('services: {}\\n')
    Path(str(output)+'.verification.json').write_text('{}')
''')
    # The process fixture must understand the reviewed profile flag; it still
    # records every original Docker argument before interpreting commands.
    docker = Path(value.env["PATH"].split(os.pathsep)[0]) / "docker"
    docker.write_text(docker.read_text().replace("('--env-file', '-f')", "('--env-file', '-f', '--profile')").replace("if command == ['config', '--services']:", "if command == ['config', '--format', 'json']:\n            print('{}')\n        elif command == ['config', '--services']:"))
    return value


def mutations(commands):
    return [item for item in commands if item[0] == "docker" and
            any(token in item for token in ("up", "run", "stop", "build", "pull"))]


def test_prebuilt_flow_never_builds_or_pulls_and_keeps_migration_fence(deployment):
    result = deployment.run()
    assert result.returncode == 0, result.stderr
    commands = deployment.commands()
    assert not any(token in command for command in commands for token in ("build", "pull"))
    phases = [command[1] for command in commands if command[0] == "prebuilt"]
    assert phases == ["revision", "prepare", "check-compose", "headroom", "verify-containers"]
    for command in mutations(commands):
        if "up" in command:
            assert "--no-build" in command and command[command.index("--pull") + 1] == "never"
        if "run" in command:
            assert "--no-deps" in command and "--no-build" not in command
            assert command[command.index("--pull") + 1] == "never"
    stop = next(index for index, item in enumerate(commands) if "stop" in item)
    migration = next(index for index, item in enumerate(commands)
                     if item[-3:] == ["run", "--rm", "hms-migrator"] or
                     ("run" in item and item[-2:] == ["--rm", "hms-migrator"]))
    assert stop < migration
    assert Path(deployment.env["HMS_SCHEMA_FENCE_FILE"]).exists()


@pytest.mark.parametrize("phase", ["revision", "prepare", "check-compose"])
def test_bad_preflight_never_changes_running_services(deployment, phase):
    deployment.env["TEST_PREBUILT_FAIL"] = phase
    result = deployment.run()
    assert result.returncode != 0
    assert not mutations(deployment.commands())
    assert not Path(deployment.env["HMS_SCHEMA_FENCE_FILE"]).exists()


def test_second_disk_check_refuses_before_quiesce(deployment):
    deployment.env["TEST_PREBUILT_FAIL"] = "headroom"
    result = deployment.run()
    assert result.returncode != 0
    commands = deployment.commands()
    assert any("up" in item for item in commands)
    assert not any("stop" in item or "run" in item for item in commands)
    assert not Path(deployment.env["HMS_SCHEMA_FENCE_FILE"]).exists()


@pytest.mark.parametrize("setting,value", [
    ("HMS_PREBUILT_PROFILE", "gcp"), ("DATABASE_MODE", "external-postgres"),
    ("DB_CONNECTIVITY_CHECK", "false"), ("SKIP_BACKUP", "true"),
    ("COMPOSE_FILES", "/unexpected.yml"), ("HMS_BUILD_SHA", "b" * 40),
])
def test_unsupported_mode_or_conflicting_identity_fails_closed(deployment, setting, value):
    deployment.env[setting] = value
    result = deployment.run()
    assert result.returncode != 0
    commands = deployment.commands() if deployment.log_file.exists() else []
    assert not mutations(commands)


def test_failed_container_identity_does_not_report_complete(deployment):
    deployment.env["TEST_PREBUILT_FAIL"] = "verify-containers"
    result = deployment.run()
    assert result.returncode != 0
    assert "Deployment complete" not in result.stdout


def test_tunnel_profile_remains_on_every_prebuilt_compose_call(deployment):
    deployment.env["HMS_PREBUILT_TUNNEL"] = "true"
    result = deployment.run()
    assert result.returncode == 0, result.stderr
    for item in deployment.commands():
        if item[:2] == ["docker", "compose"]:
            assert item[item.index("--profile") + 1] == "tunnel"
    for item in deployment.commands():
        if item[0] == "prebuilt" and item[1] in ("prepare", "check-compose", "verify-containers"):
            assert "--tunnel" in item


@pytest.mark.parametrize("script", ["ops/free-testing/deploy.sh", "ops/compose-v2/deploy.sh"])
@pytest.mark.parametrize("arguments", [
    ["--prebuilt-bundle", ""], ["--prebuilt-bundle"],
    ["--prebuilt-bundle", "--skip-pull"],
    ["--prebuilt-bundle", "first", "--prebuilt-bundle", "second"],
])
def test_explicit_bad_prebuilt_argument_cannot_fall_back_to_build(tmp_path, script, arguments):
    marker = tmp_path / "docker-was-called"
    binary = tmp_path / "docker"
    binary.write_text(f"#!/bin/sh\ntouch '{marker}'\nexit 99\n")
    binary.chmod(0o755)
    environment = dict(os.environ, PATH=f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    result = subprocess.run(["sh", str(ROOT / script), *arguments], env=environment,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 2
    assert not marker.exists()


def test_sigterm_during_preparation_exits_before_any_docker_transition(deployment):
    helper = deployment.script.parents[2] / "ops/prebuilt_release.py"
    helper.write_text(helper.read_text().replace(
        "elif args[0] == 'prepare':", "elif args[0] == 'prepare':\n    import time\n    time.sleep(0.8)"))
    process = subprocess.Popen([str(deployment.script), "--skip-pull"], env=deployment.env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if deployment.log_file.exists() and any(item[:2] == ["prebuilt", "prepare"]
                                                    for item in deployment.commands()):
                break
            assert process.poll() is None
            time.sleep(0.02)
        else:
            pytest.fail("Preparation did not start")
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=10)
        assert process.returncode == 143, stderr
        assert "Deployment complete" not in stdout
        assert not mutations(deployment.commands())
        assert not any(item[:2] == ["prebuilt", "check-compose"] for item in deployment.commands())
    finally:
        if process.poll() is None:
            process.terminate()
            process.communicate(timeout=10)


@pytest.mark.parametrize("marker", ["schema-compatibility", "deploy-attempt", "releases/current.json"])
def test_durable_prebuilt_project_cannot_fall_back_to_source_build(deployment, marker):
    deployment.env.pop("HMS_PREBUILT_BUNDLE")
    state = Path(deployment.env["HMS_SCHEMA_FENCE_FILE"]).parent
    state.mkdir(parents=True, mode=0o700)
    state.parent.chmod(0o700)
    state.parent.parent.chmod(0o700)
    target = state / marker
    target.parent.mkdir(mode=0o700, exist_ok=True)
    target.write_text("202610310031\n" if marker == "schema-compatibility" else "quiescing\n")
    target.chmod(0o600)
    deployment.env.pop("HMS_SCHEMA_FENCE_FILE")
    deployment.env.pop("HMS_DEPLOY_ATTEMPT_FILE")
    deployment.config_file.write_text(deployment.config_file.read_text().replace("name: simulated-deploy", "name: hms-free-test"))
    result = deployment.run()
    assert result.returncode != 0
    assert not mutations(deployment.commands())
    assert target.exists()


def test_source_mode_guard_preserves_unrelated_projects(deployment):
    deployment.env.pop("HMS_PREBUILT_BUNDLE")
    state = Path(deployment.env["HMS_SCHEMA_FENCE_FILE"]).parent
    state.mkdir(parents=True, mode=0o700)
    state.parent.chmod(0o700)
    state.parent.parent.chmod(0o700)
    (state / "schema-compatibility").write_text("202610310031\n")
    deployment.env.pop("HMS_SCHEMA_FENCE_FILE")
    deployment.env.pop("HMS_DEPLOY_ATTEMPT_FILE")
    result = deployment.run()
    assert result.returncode == 0, result.stderr
    assert any("build" in item for item in deployment.commands())
