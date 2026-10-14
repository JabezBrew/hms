"""Exercise real Nginx header inheritance with a local, synthetic origin.

Opt in with HMS_TEST_NGINX_DOCKER=1 after pulling nginx:alpine.
"""
from __future__ import annotations

import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(
    os.environ.get('HMS_TEST_NGINX_DOCKER') != '1',
    reason='requires explicit local Docker Nginx validation',
)


@pytest.fixture(scope='module')
def nginx_origin(tmp_path_factory):
    directory = tmp_path_factory.mktemp('hms-nginx-headers')
    assets = directory / 'assets'
    assets.mkdir()
    assets.chmod(0o755)
    (assets / 'index.html').write_text('<!doctype html><title>Synthetic fixture</title>')
    (assets / 'runtime-config.js').write_text('window.synthetic = true;')
    (assets / 'fixture.js').write_text('export const synthetic = true;')
    for asset in assets.iterdir():
        asset.chmod(0o644)
    config = directory / 'default.conf'
    config.write_text((REPO_ROOT / 'frontend/nginx.conf').read_text().replace('PORT_PLACEHOLDER', '80'))
    container = subprocess.check_output([
        'docker', 'run', '-d', '--rm', '-p', '127.0.0.1::80',
        '-v', f'{config}:/etc/nginx/conf.d/default.conf:ro',
        '-v', f'{REPO_ROOT / "frontend/nginx-security-headers.conf"}:/etc/nginx/hms-security-headers.conf:ro',
        '-v', f'{assets}:/usr/share/nginx/html:ro', 'nginx:alpine',
    ], text=True).strip()
    try:
        address = subprocess.check_output(['docker', 'port', container, '80/tcp'], text=True).strip()
        base_url = f'http://{address}'
        deadline = time.monotonic() + 10
        while True:
            try:
                with urllib.request.urlopen(f'{base_url}/health', timeout=1):
                    break
            except (OSError, urllib.error.URLError):
                if time.monotonic() >= deadline:
                    pytest.fail('local Nginx fixture did not become ready')
                time.sleep(0.1)
        yield {'base_url': base_url, 'container': container, 'assets': assets}
    finally:
        subprocess.run(['docker', 'stop', container], check=True, capture_output=True)


@pytest.mark.parametrize('path', ['/', '/settings', '/runtime-config.js', '/fixture.js', '/missing.js'])
def test_headers_survive_location_cache_headers_and_errors(nginx_origin, path):
    try:
        response = urllib.request.urlopen(f'{nginx_origin["base_url"]}{path}', timeout=2)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        assert response.status == (404 if path == '/missing.js' else 200)
        assert response.headers['X-Frame-Options'] == 'DENY'
        assert response.headers['X-Content-Type-Options'] == 'nosniff'
        assert response.headers['Referrer-Policy'] == 'strict-origin-when-cross-origin'
        assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
        if path == '/runtime-config.js':
            assert 'no-store' in response.headers['Cache-Control']
        if path == '/fixture.js':
            assert 'immutable' in ','.join(response.headers.get_all('Cache-Control'))


def test_origin_logs_do_not_contain_reset_tokens_patient_paths_or_referrers(nginx_origin):
    sentinel = f'SYNTHETIC_PRIVATE_{uuid.uuid4().hex}'
    base_url = nginx_origin['base_url']
    # An existing directory without an index exercises Nginx's error logger;
    # a try_files 404 alone does not necessarily emit an error-log entry.
    denied_directory = nginx_origin['assets'] / f'private-{sentinel}'
    denied_directory.mkdir(mode=0o755)
    paths = [
        (f'/reset-password/confirm?token={sentinel}', 200),
        (f'/patients/{sentinel}/chronicle', 200),
        (f'/missing-{sentinel}.js?token={sentinel}', 404),
        (f'/{denied_directory.name}/?token={sentinel}', 403),
    ]
    for path, expected_status in paths:
        request = urllib.request.Request(
            f'{base_url}{path}',
            headers={'Referer': f'{base_url}/reset-password/confirm?token={sentinel}'},
        )
        try:
            response = urllib.request.urlopen(request, timeout=2)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == expected_status
    logs = subprocess.run(
        ['docker', 'logs', nginx_origin['container']],
        text=True, capture_output=True, check=True,
    )
    assert sentinel not in logs.stdout
    assert sentinel not in logs.stderr
