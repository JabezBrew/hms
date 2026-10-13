from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / 'ops' / 'free-testing'
SPEC = importlib.util.spec_from_file_location('free_testing_env', KIT / 'prepare-env.py')
ENV_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENV_MODULE)


def generate(path):
    return subprocess.run(
        [sys.executable, str(KIT / 'prepare-env.py'), '--domain', 'staging.example.test',
         '--admin-email', 'tester@example.test', '--output', str(path)],
        capture_output=True, text=True, check=False,
    )


def test_generation_protects_credentials_and_preserves_existing_settings(tmp_path):
    first, second = tmp_path / '.env', tmp_path / 'other.env'
    result = generate(first)
    assert result.returncode == 0, result.stderr
    assert stat.S_IMODE(first.stat().st_mode) == 0o600
    values = ENV_MODULE.read_env(first)
    ENV_MODULE.validate(first, False)
    assert generate(second).returncode == 0
    other_values = ENV_MODULE.read_env(second)
    for key in ('DB_PASSWORD', 'HMS_JWT_SECRET', 'HMS_BOOTSTRAP_ADMIN_PASSWORD'):
        assert values[key] != other_values[key]
        assert values[key] not in result.stdout + result.stderr
    before = first.read_bytes()
    assert generate(first).returncode != 0
    assert first.read_bytes() == before


@pytest.mark.parametrize('setting', [
    'HMS_ENV=production', 'HMS_SEED_DEMO_DATA=false',
    'COMPOSE_PROJECT_NAME=production', 'HMS_COOKIE_SECURE=false',
    'DB_PASSWORD=CHANGE_ME', 'HMS_TEST_HTTP_PORT=80',
])
def test_unsafe_or_non_synthetic_env_is_rejected(tmp_path, setting):
    path = tmp_path / '.env'
    assert generate(path).returncode == 0
    key = setting.split('=')[0]
    path.write_text('\n'.join(setting if line.startswith(key + '=') else line
                              for line in path.read_text().splitlines()))
    with pytest.raises(ValueError):
        ENV_MODULE.validate(path, False)


def test_public_deploy_requires_tunnel_credentials_and_access_team(tmp_path):
    path = tmp_path / '.env'
    assert generate(path).returncode == 0
    with pytest.raises(ValueError, match='CLOUDFLARE_TUNNEL_TOKEN'):
        ENV_MODULE.validate(path, True)
    content = path.read_text().replace('CLOUDFLARE_TUNNEL_TOKEN=', 'CLOUDFLARE_TUNNEL_TOKEN=fixture-token')
    path.write_text(content)
    with pytest.raises(ValueError, match='HMS_TEST_ACCESS_TEAM_DOMAIN'):
        ENV_MODULE.validate(path, True)


@pytest.mark.skipif(shutil.which('docker') is None, reason='Docker CLI not installed')
def test_effective_compose_is_private_staging_with_same_domain_and_no_monitoring(tmp_path):
    path = tmp_path / '.env'
    assert generate(path).returncode == 0
    env = os.environ.copy()
    # Test the private-file contract independently of the operator's shell.
    for key in ENV_MODULE.read_env(path):
        env.pop(key, None)
    env.pop('COMPOSE_PROFILES', None)
    result = subprocess.run([
        'docker', 'compose', '--env-file', str(path),
        '-f', str(ROOT / 'ops/compose-v2/compose.yml'), '-f', str(KIT / 'compose.yml'),
        'config', '--format', 'json',
    ], capture_output=True, text=True, check=False, env=env)
    assert result.returncode == 0, result.stderr
    config = json.loads(result.stdout)
    services = config['services']
    assert config['name'] == 'hms-free-test'
    assert {'prometheus', 'grafana', 'cloudflared'}.isdisjoint(services)
    for name, service in services.items():
        for port in service.get('ports', []):
            assert name == 'caddy'
            assert port['host_ip'] == '127.0.0.1'
            assert port['published'] == '8088'
        if name.startswith('hms-'):
            assert service['environment']['HMS_ENV'] == 'staging'
    api = services['hms-api']['environment']
    assert api['HMS_COOKIE_SECURE'] == 'true'
    assert api['HMS_ACCOUNT_SETUP_DELIVERY_MODE'] == 'disabled'
    assert api['HMS_WEBAUTHN_RP_ID'] == 'staging.example.test'
    assert api['HMS_WEBAUTHN_RP_ORIGIN'] == 'https://staging.example.test'
    assert services['hms-migrator']['environment']['HMS_DEMO_SEED_PROFILE'] == 'smoke'
    assert 'log_min_duration_statement=-1' in services['db']['command']
    assert 'log_parameter_max_length_on_error=0' in services['db']['command']


def test_missing_access_challenge_prevents_any_docker_mutation(tmp_path):
    path = tmp_path / '.env'
    assert generate(path).returncode == 0
    path.write_text(path.read_text()
                    .replace('CLOUDFLARE_TUNNEL_TOKEN=', 'CLOUDFLARE_TUNNEL_TOKEN=fixture-token')
                    .replace('HMS_TEST_ACCESS_TEAM_DOMAIN=', 'HMS_TEST_ACCESS_TEAM_DOMAIN=fixture.cloudflareaccess.com'))
    tools = tmp_path / 'bin'
    tools.mkdir()
    marker = tmp_path / 'docker-called'
    for name, content in {
        'curl': '#!/bin/sh\nprintf "200 "\n',
        'docker': f'#!/bin/sh\ntouch "{marker}"\nexit 1\n',
    }.items():
        script = tools / name
        script.write_text(content)
        script.chmod(0o755)
    env = os.environ.copy()
    env['ENV_FILE'] = str(path)
    env['PATH'] = str(tools) + os.pathsep + env['PATH']
    result = subprocess.run(['sh', str(KIT / 'deploy.sh')],
                            capture_output=True, text=True, check=False, env=env)
    assert result.returncode != 0
    assert 'Access login challenge is missing' in result.stderr
    assert not marker.exists()


def test_env_generation_rejects_shell_or_dotenv_injection(tmp_path):
    path = tmp_path / '.env'
    result = subprocess.run([
        sys.executable, str(KIT / 'prepare-env.py'), '--domain', 'host.test\nDB_PASSWORD=bad',
        '--admin-email', 'tester@example.test', '--output', str(path),
    ], capture_output=True, text=True)
    assert result.returncode != 0
    assert not path.exists()
