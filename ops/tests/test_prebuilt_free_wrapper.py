from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

import pytest

from deployment_fixtures import copy_lease_helper


ROOT = Path(__file__).resolve().parents[2]
REVISION = "a" * 40


@pytest.fixture
def wrapper(tmp_path):
    root = tmp_path / "candidate"
    kit = root / "ops/free-testing"
    kit.mkdir(parents=True)
    base = root / "ops/compose-v2"
    base.mkdir()
    for relative in ("ops/free-testing/deploy.sh", "ops/free-testing/prepare-env.py", "ops/prebuilt_state.py", "ops/compose-v2/env.example"):
        shutil.copy2(ROOT / relative, root / relative)
    copy_lease_helper(root, tmp_path / ".hms-deploy-state/deploy.lock")
    env_file = kit / ".env"
    generated = subprocess.run([sys.executable, str(kit / "prepare-env.py"),
                                "--domain", "staging.example.test", "--admin-email", "synthetic@example.test",
                                "--output", str(env_file)], capture_output=True, text=True)
    assert generated.returncode == 0
    env_file.write_text(env_file.read_text().replace("CLOUDFLARE_TUNNEL_TOKEN=", "CLOUDFLARE_TUNNEL_TOKEN=fixture-token"))
    log = tmp_path / "commands.jsonl"
    delegate = base / "deploy.sh"
    delegate.write_text(f'''#!{sys.executable}
import json, os, time
from pathlib import Path
output=Path(os.environ['HMS_PREBUILT_OVERRIDE'])
with Path(os.environ['TEST_LOG']).open('a') as f:
    f.write(json.dumps(['delegate',os.environ['HMS_PREBUILT_BUNDLE'],str(output),os.environ['HMS_PREBUILT_STATE_DIR']])+'\\n')
if os.environ.get('TEST_BLOCK_DELEGATE'):
    time.sleep(0.8)
for suffix in ('','.verification.json','.compose.json'):
    path=Path(str(output)+suffix)
    path.write_text('{{}}')
    path.chmod(0o600)
''')
    delegate.chmod(0o755)
    verifier = root / "ops/prebuilt_release.py"
    verifier.write_text('''import json, os, sys
from pathlib import Path
class VerificationError(ValueError): pass
def manifest(path): return {'revision': 'a'*40}
def strict_json(raw): return json.loads(raw)
if __name__ == '__main__':
    with Path(os.environ['TEST_LOG']).open('a') as f:
        f.write(json.dumps(['verifier',*sys.argv[1:]])+'\\n')
''')
    (root / "ops/prebuilt_retention.py").write_text('''import json, os, sys
from pathlib import Path
with Path(os.environ['TEST_LOG']).open('a') as f:
    f.write(json.dumps(['ledger',*sys.argv[1:]])+'\\n')
''')
    tools = tmp_path / "bin"
    tools.mkdir()
    for name in ("curl", "docker"):
        tool = tools / name
        tool.write_text(f'''#!{sys.executable}
import json, os, sys
from pathlib import Path
with Path(os.environ['TEST_LOG']).open('a') as f:
    f.write(json.dumps([Path(sys.argv[0]).name,*sys.argv[1:]])+'\\n')
if Path(sys.argv[0]).name == 'curl':
    url=sys.argv[-1]
    if url.endswith('/build-info.json'):
        print(json.dumps({{'commit':os.environ.get('TEST_FRONTEND_SHA','a'*40)}}))
    elif '/api/v2/health/ready' not in url:
        print('200' if os.environ.get('TEST_BAD_EDGE_AUTH') and url.startswith('https://') else '401')
''')
        tool.chmod(0o755)
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(("HMS_", "COMPOSE_")) or key == "ENV_FILE":
            env.pop(key)
    env.update(PATH=f"{tools}{os.pathsep}{env['PATH']}", ENV_FILE=str(env_file), TEST_LOG=str(log))
    bundle = tmp_path / "bundle with spaces"
    bundle.mkdir()
    command = ["sh", str(kit / "deploy.sh"), "--public", "--prebuilt-bundle", str(bundle)]
    return command, env, log, bundle, tmp_path


def commands(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_bundle_override_and_verified_identity_survive_tunnel_and_ledger(wrapper):
    command, env, log, bundle, directory = wrapper
    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    rows = commands(log)
    delegate = next(item for item in rows if item[0] == "delegate")
    assert delegate[1] == str(bundle)
    assert delegate[3] == str(directory / ".hms-deploy-state/prebuilt/hms-free-test")
    override = Path(delegate[2])
    assert not override.parent.exists()
    up = next(item for item in rows if item[0] == "docker" and "up" in item)
    assert str(override) in up and "--no-build" in up and "--no-deps" in up
    assert up[up.index("--pull") + 1] == "never"
    assert not any("build" in row or "pull" in row for row in rows)
    ledger_index = next(index for index, item in enumerate(rows) if item[0] == "ledger")
    assert rows[ledger_index - 1][0] == "verifier"
    ledger = rows[ledger_index]
    assert ledger[ledger.index("--exposure") + 1] == "public" and "--tunnel" in ledger
    assert ledger[ledger.index("--state") + 1] == str(directory / ".hms-deploy-state/prebuilt/hms-free-test/releases")


def test_wrong_frontend_identity_never_connects_tunnel_or_records_release(wrapper):
    command, env, log, _, _ = wrapper
    env["TEST_FRONTEND_SHA"] = "b" * 40
    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode != 0
    rows = commands(log)
    assert not any(item[0] in ("docker", "ledger") for item in rows)
    assert not Path(next(item[2] for item in rows if item[0] == "delegate")).parent.exists()


def test_bad_public_edge_auth_stops_tunnel_and_never_records_release(wrapper):
    command, env, log, _, _ = wrapper
    env["TEST_BAD_EDGE_AUTH"] = "true"
    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode != 0
    rows = commands(log)
    assert any(item[-2:] == ["stop", "cloudflared"] for item in rows)
    assert not any(item[0] == "ledger" for item in rows)


def test_sigterm_during_delegate_cannot_continue_publication(wrapper):
    command, env, log, _, _ = wrapper
    env["TEST_BLOCK_DELEGATE"] = "true"
    process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if log.exists() and any(item[0] == "delegate" for item in commands(log)):
                break
            assert process.poll() is None
            time.sleep(0.02)
        else:
            pytest.fail("Delegate did not start")
        process.send_signal(signal.SIGTERM)
        _, stderr = process.communicate(timeout=10)
        assert process.returncode == 143, stderr
        rows = commands(log)
        assert not any(item[0] in ("curl", "docker", "ledger") for item in rows)
        assert not Path(next(item[2] for item in rows if item[0] == "delegate")).parent.exists()
    finally:
        if process.poll() is None:
            process.terminate()
            process.communicate(timeout=10)
