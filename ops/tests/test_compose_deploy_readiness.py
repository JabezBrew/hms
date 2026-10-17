from __future__ import annotations

import json
import os
import subprocess
import sys
import shutil
from pathlib import Path

import pytest
from deployment_fixtures import copy_lease_helper


REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = REPO_ROOT / 'ops' / 'compose-v2' / 'deploy.sh'


class SimulatedDeploy:
    """Exercise the deploy interface without containers, networking, or secrets."""

    def __init__(self, directory: Path):
        release = directory / 'release'
        self.script = release / 'ops/compose-v2/deploy.sh'
        self.script.parent.mkdir(parents=True)
        for relative in ['ops/compose-v2/deploy.sh', 'ops/schema-compatibility.sh', 'ops/compose-v2/runtime-schema-epoch']:
            shutil.copy2(REPO_ROOT / relative, release / relative)
        migrations = release / 'backend-rs/migrations'
        migrations.mkdir(parents=True)
        (migrations / '202610170023_treatment_course_windows.sql').write_text('-- fixture\n')
        (migrations / '202610170024_referral_response_records.sql').write_text('-- fixture\n')
        (migrations / '202610170025_admission_moves.sql').write_text('-- fixture\n')
        (migrations / '202610170026_referral_consultation_starts.sql').write_text('-- fixture\n')
        copy_lease_helper(release, directory / '.hms-deploy-state/deploy.lock')
        self.env_file = directory / 'deploy.env'
        self.compose_file = directory / 'compose.yml'
        self.config_file = directory / 'rendered-compose.yml'
        self.log_file = directory / 'commands.jsonl'
        self.clock_file = directory / 'clock'
        self.clock_file.write_text('100', encoding='utf-8')
        self.compose_file.write_text('services: {}\n', encoding='utf-8')
        self.write_env()
        self.config_file.write_text(
            '''name: simulated-deploy
services:
  hms-api:
    environment:
      HMS_DATABASE_URL: postgres://synthetic:fixture@remote.example.test:5432/synthetic
  hms-migrator:
    environment:
      HMS_DATABASE_URL: postgres://synthetic:fixture@remote.example.test:5432/synthetic
    networks:
      edge: null
      internal: null
  hms-worker:
    environment:
      HMS_DATABASE_URL: postgres://synthetic:fixture@remote.example.test:5432/synthetic
  redis:
    image: redis:7-alpine
''',
            encoding='utf-8',
        )
        bin_dir = directory / 'bin'
        bin_dir.mkdir()
        fake_tool = f'#!{sys.executable}\n' + '''import json
import os
import sys
from pathlib import Path

tool = Path(sys.argv[0]).name
args = sys.argv[1:]
with Path(os.environ['TEST_COMMAND_LOG']).open('a', encoding='utf-8') as log:
    log.write(json.dumps([tool, *args]) + '\\n')
clock = Path(os.environ['TEST_CLOCK_FILE'])

if tool == 'date':
    print(clock.read_text() if args == ['+%s'] else '2026-10-13T00:00:00Z')
elif tool == 'sleep':
    clock.write_text(str(int(clock.read_text()) + int(args[0])))
elif tool == 'curl':
    advance = os.environ.get('TEST_CURL_ADVANCE_SECONDS', '0')
    if advance == 'max-time':
        advance = args[args.index('--max-time') + 1]
    clock.write_text(str(int(clock.read_text()) + int(advance)))
    sys.exit(int(os.environ.get('TEST_CURL_STATUS', '0')))
elif tool == 'docker':
    if args[0] == 'inspect':
        service = args[-1]
        print(os.environ.get('TEST_WORKER_HEALTH', 'healthy') if service == 'hms-worker' else 'healthy')
    elif args[0] == 'ps':
        pass  # No stale local containers for the external-database tests.
    elif args[0] == 'compose':
        index = 1
        while args[index] in ('--env-file', '-f'):
            index += 2
        command = args[index:]
        if command == ['config', '--services']:
            print('hms-api\\nhms-worker\\nhms-migrator\\nredis')
        elif command == ['config']:
            print(Path(os.environ['TEST_COMPOSE_CONFIG']).read_text())
        elif command[:2] == ['ps', '-q']:
            print(command[-1])
        elif command[-2:] == ['hms-migrator', 'schema-compatibility']:
            print('202610170026')
        elif command[0] == 'build':
            rust_services = {'hms-api', 'hms-worker', 'hms-migrator'}
            if len(rust_services.intersection(command[1:])) > 1:
                sys.exit('multiple exporters selected for the shared Rust image')
        elif command[0] not in ('up', 'build', 'run', 'ps', 'logs', 'stop'):
            sys.exit('unexpected Compose operation')
    else:
        sys.exit('unexpected Docker operation')
'''
        for tool in ('docker', 'curl', 'date', 'sleep'):
            path = bin_dir / tool
            path.write_text(fake_tool, encoding='utf-8')
            path.chmod(0o755)

        self.env = os.environ.copy()
        for key in (
            'PUBLIC_HEALTHCHECK_MODE', 'PUBLIC_HEALTH_TIMEOUT',
            'EXTERNAL_DB_BACKUP_CONFIRMED', 'EXTERNAL_DB_BACKUP_TARGET_HOST',
            'ALLOW_UNSAFE_SKIP_EXTERNAL_DB_BACKUP', 'HMS_DATABASE_URL',
            'SKIP_MIGRATIONS', 'SKIP_BACKUP', 'SKIP_HEALTHCHECK', 'HEALTHCHECK_URL',
            'DB_CONNECTIVITY_CHECK', 'EXTERNAL_DB_STOP_LOCAL_SERVICES',
            'HMS_SCHEMA_FENCE_FILE', 'HMS_DEPLOY_ATTEMPT_FILE',
        ):
            self.env.pop(key, None)
        self.env.update(
            {
                'PATH': f'{bin_dir}{os.pathsep}{self.env["PATH"]}',
                'ENV_FILE': str(self.env_file),
                'COMPOSE_FILES': str(self.compose_file),
                'DATABASE_MODE': 'compose-postgres',
                'HMS_BUILD_SHA': 'simulated123',
                'HEALTH_TIMEOUT': '0',
                'HEALTH_INTERVAL': '4',
                'TEST_COMMAND_LOG': str(self.log_file),
                'TEST_CLOCK_FILE': str(self.clock_file),
                'TEST_COMPOSE_CONFIG': str(self.config_file),
                'HMS_SCHEMA_FENCE_FILE': str(directory / 'schema-fence'),
                'HMS_DEPLOY_ATTEMPT_FILE': str(directory / 'deploy-attempt'),
            }
        )

    def write_env(self, **values: str) -> None:
        config = {
            'CLIENT_DOMAIN': 'synthetic.example.test',
            'CLIENT_SLUG': 'synthetic',
            'HMS_ENV': 'staging',
            'PUBLIC_HEALTHCHECK_MODE': 'required',
            'PUBLIC_HEALTH_TIMEOUT': '10',
        }
        config.update(values)
        self.env_file.write_text(
            '\n'.join(f'{key}={value}' for key, value in config.items()) + '\n',
            encoding='utf-8',
        )

    def run(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(self.script), '--skip-pull'],
            env=self.env,
            check=False,
            capture_output=True,
            text=True,
            # Fake-clock assertions prove product deadlines. Allow process
            # startup overhead while local Rust verification is running.
            timeout=30,
        )

    def commands(self) -> list[list[str]]:
        return [json.loads(line) for line in self.log_file.read_text().splitlines()]


@pytest.fixture
def deployment(tmp_path: Path) -> SimulatedDeploy:
    return SimulatedDeploy(tmp_path)


def test_deploy_waits_for_worker_before_refreshing_edge(deployment):
    result = deployment.run()

    assert result.returncode == 0, result.stderr
    assert 'hms-worker is healthy' in result.stdout
    commands = deployment.commands()
    worker_check = next(i for i, command in enumerate(commands)
                        if command[:2] == ['docker', 'inspect'] and command[-1] == 'hms-worker')
    edge_refresh = next(i for i, command in enumerate(commands)
                        if command[-5:] == ['up', '-d', '--no-deps', '--force-recreate', 'caddy'])
    assert worker_check < edge_refresh


def test_shared_rust_runtime_is_built_once_and_runs_worker_and_migrator(deployment):
    result = deployment.run()

    assert result.returncode == 0, result.stderr
    commands = deployment.commands()
    builds = [command for command in commands if 'build' in command]
    assert len(builds) == 1
    assert builds[0][-3:] == ['build', 'hms-api', 'frontend']
    assert any(command[-5:] == ['run', '--rm', 'hms-migrator', 'hms-migrator', 'check-db']
               for command in commands)
    assert any(command[-3:] == ['run', '--rm', 'hms-migrator'] for command in commands)
    assert any(command[-6:] == ['up', '-d', '--no-deps', 'hms-api', 'hms-worker', 'frontend']
               for command in commands)


def test_unhealthy_worker_blocks_deploy_success_and_edge_refresh(deployment):
    deployment.env['TEST_WORKER_HEALTH'] = 'unhealthy'

    result = deployment.run()

    assert result.returncode == 1
    assert 'hms-worker did not become ready' in result.stderr
    assert 'Deployment complete' not in result.stdout
    commands = deployment.commands()
    assert any(command[-3:] == ['logs', '--tail=80', 'hms-worker'] for command in commands)
    assert not any('--force-recreate' in command for command in commands)
    assert not any(command[0] == 'curl' for command in commands)


def test_public_probe_uses_file_timeout_and_accounts_for_curl_time(deployment):
    deployment.env.update({'TEST_CURL_STATUS': '28', 'TEST_CURL_ADVANCE_SECONDS': '3'})

    result = deployment.run()

    assert result.returncode == 1
    assert 'Public edge health check failed after 10 seconds' in result.stderr
    probes = [command for command in deployment.commands() if command[0] == 'curl']
    assert probes == [
        ['curl', '-fsS', '--connect-timeout', '5', '--max-time', '10',
         'https://synthetic.example.test/api/v2/health/ready'],
        ['curl', '-fsS', '--connect-timeout', '3', '--max-time', '3',
         'https://synthetic.example.test/api/v2/health/ready'],
    ]
    assert deployment.clock_file.read_text() == '110'


def test_hanging_public_probe_is_bounded_by_remaining_deadline(deployment):
    deployment.env.update({'TEST_CURL_STATUS': '28', 'TEST_CURL_ADVANCE_SECONDS': 'max-time'})

    result = deployment.run()

    assert result.returncode == 1
    commands = deployment.commands()
    assert len([command for command in commands if command[0] == 'curl']) == 1
    assert not any(command[0] == 'sleep' for command in commands)
    assert deployment.clock_file.read_text() == '110'


def test_public_retry_sleep_does_not_exceed_deadline(deployment):
    deployment.env['TEST_CURL_STATUS'] = '22'
    deployment.env['HEALTH_INTERVAL'] = '60'

    result = deployment.run()

    assert result.returncode == 1
    assert [command for command in deployment.commands() if command[0] == 'sleep'] == [['sleep', '10']]
    assert deployment.clock_file.read_text() == '110'


def test_public_mode_skip_from_private_env_prevents_probe(deployment):
    deployment.write_env(PUBLIC_HEALTHCHECK_MODE='skip')

    result = deployment.run()

    assert result.returncode == 0, result.stderr
    assert 'PUBLIC_HEALTHCHECK_MODE=skip' in result.stdout
    assert not any(command[0] == 'curl' for command in deployment.commands())


def test_shell_public_mode_and_timeout_override_private_env(deployment):
    deployment.env.update({
        'PUBLIC_HEALTHCHECK_MODE': 'auto',
        'PUBLIC_HEALTH_TIMEOUT': '2',
        'TEST_CURL_STATUS': '6',
    })

    result = deployment.run()

    assert result.returncode == 0, result.stderr
    assert 'hostname does not resolve yet' in result.stderr
    probes = [command for command in deployment.commands() if command[0] == 'curl']
    assert probes[0][2:6] == ['--connect-timeout', '2', '--max-time', '2']


@pytest.mark.parametrize('timeout', ['0', '-1', 'invalid'])
def test_invalid_public_timeout_is_rejected_without_network_probe(deployment, timeout):
    deployment.env['PUBLIC_HEALTH_TIMEOUT'] = timeout

    result = deployment.run()

    assert result.returncode == 1
    assert 'must be positive whole seconds' in result.stderr
    assert not any(command[0] == 'curl' for command in deployment.commands())


def test_external_backup_confirmation_and_target_are_read_from_private_env(deployment):
    deployment.env['DATABASE_MODE'] = 'external-postgres'
    deployment.write_env(
        HMS_ENV='production',
        HMS_DATABASE_URL='postgres://synthetic:fixture@remote.example.test:5432/synthetic',
        EXTERNAL_DB_BACKUP_CONFIRMED='true',
        EXTERNAL_DB_BACKUP_TARGET_HOST='remote.example.test',
    )

    result = deployment.run()

    assert result.returncode == 0, result.stderr
    assert 'External database backup/PITR confirmation accepted' in result.stdout


def test_shell_external_backup_target_override_still_requires_matching_host(deployment):
    deployment.env.update({
        'DATABASE_MODE': 'external-postgres',
        'EXTERNAL_DB_BACKUP_TARGET_HOST': 'wrong.example.test',
    })
    deployment.write_env(
        HMS_ENV='production',
        HMS_DATABASE_URL='postgres://synthetic:fixture@remote.example.test:5432/synthetic',
        EXTERNAL_DB_BACKUP_CONFIRMED='true',
        EXTERNAL_DB_BACKUP_TARGET_HOST='remote.example.test',
    )

    result = deployment.run()

    assert result.returncode == 1
    assert 'does not match effective HMS_DATABASE_URL host' in result.stderr
    assert not any('build' in command for command in deployment.commands())


def test_shell_external_backup_confirmation_override_preserves_gate(deployment):
    deployment.env.update({
        'DATABASE_MODE': 'external-postgres',
        'EXTERNAL_DB_BACKUP_CONFIRMED': 'false',
    })
    deployment.write_env(
        HMS_ENV='production',
        HMS_DATABASE_URL='postgres://synthetic:fixture@remote.example.test:5432/synthetic',
        EXTERNAL_DB_BACKUP_CONFIRMED='true',
        EXTERNAL_DB_BACKUP_TARGET_HOST='remote.example.test',
    )

    result = deployment.run()

    assert result.returncode == 1
    assert 'Refusing production deploy with DATABASE_MODE=external-postgres' in result.stderr
    assert not any('build' in command for command in deployment.commands())
