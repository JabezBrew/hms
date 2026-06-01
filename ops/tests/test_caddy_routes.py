from __future__ import annotations

from pathlib import Path


# Legacy Django Hetzner route test. Active Rust V2 deployment lives under
# ops/compose-v2/.
REPO_ROOT = Path(__file__).resolve().parents[2]
CADDYFILE = REPO_ROOT / 'ops' / 'hetzner-client-vps' / 'Caddyfile'
URLS_FILE = REPO_ROOT / 'backend' / 'hms_backend' / 'urls.py'


def test_public_admin_routes_are_served_by_spa_not_django_admin():
    caddyfile = CADDYFILE.read_text(encoding='utf-8')
    urls = URLS_FILE.read_text(encoding='utf-8')

    assert '/django-admin/*' in caddyfile
    assert '/admin/*' not in caddyfile
    assert "path('django-admin/', admin.site.urls)" in urls
    assert "path('admin/', admin.site.urls)" not in urls


def test_caddy_disables_http3_until_udp_edge_is_supported():
    caddyfile = CADDYFILE.read_text(encoding='utf-8')

    assert 'protocols h1 h2' in caddyfile
    assert 'protocols h1 h2 h3' not in caddyfile


def test_public_caddy_route_does_not_expose_prometheus_metrics():
    caddyfile = CADDYFILE.read_text(encoding='utf-8')

    metrics_index = caddyfile.index('@publicMetrics path /api/metrics/')
    backend_index = caddyfile.index('@backend path /api/*')

    assert metrics_index < backend_index
    assert 'respond @publicMetrics 404' in caddyfile
