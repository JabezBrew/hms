from __future__ import annotations

from pathlib import Path


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
