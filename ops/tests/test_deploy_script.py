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
