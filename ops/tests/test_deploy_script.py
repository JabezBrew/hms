from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = REPO_ROOT / 'ops' / 'hetzner-client-vps' / 'deploy.sh'


def test_deploy_script_help_does_not_require_server_context():
    result = subprocess.run(
        [str(DEPLOY_SCRIPT), '--help'],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert 'Usage: ops/hetzner-client-vps/deploy.sh' in result.stdout
    assert '--skip-backup' in result.stdout


def test_deploy_script_shell_syntax_is_valid():
    result = subprocess.run(
        ['sh', '-n', str(DEPLOY_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_deploy_script_recreates_caddy_after_starting_services():
    script = DEPLOY_SCRIPT.read_text(encoding='utf-8')

    start_index = script.index("step 'Starting application services'")
    caddy_index = script.index("compose up -d --no-deps --force-recreate caddy")
    health_index = script.index("step 'Checking public readiness endpoint'")

    assert start_index < caddy_index < health_index
    assert 'wait_for_service caddy "$HEALTH_TIMEOUT"' in script
