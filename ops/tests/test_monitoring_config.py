from __future__ import annotations

import re
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
MONITORING_ROOT = REPO_ROOT / 'monitoring'


def test_monitoring_uses_alloy_instead_of_promtail_file_logs():
    compose_files = [
        MONITORING_ROOT / 'docker-compose.monitoring.yml',
        MONITORING_ROOT / 'docker-compose.client-telemetry.yml',
    ]
    combined = '\n'.join(path.read_text(encoding='utf-8') for path in compose_files)
    readme = (MONITORING_ROOT / 'README.md').read_text(encoding='utf-8')

    assert 'grafana/alloy' in combined
    assert 'loki.source.docker' in (MONITORING_ROOT / 'alloy' / 'docker-logs.alloy').read_text(encoding='utf-8')
    assert 'Promtail log shipping from `backend/logs/`' not in readme
    assert not (MONITORING_ROOT / 'promtail' / 'config.yml').exists()


def test_telegram_template_is_diagnostic_not_raw_log_dump():
    template = (MONITORING_ROOT / 'alertmanager' / 'templates' / 'telegram.tmpl').read_text(encoding='utf-8')

    assert 'What happened' in template
    assert 'Why it matters' in template
    assert 'Likely cause' in template
    assert 'First checks' in template
    assert 'Runbook' in template
    assert 'log dump' not in template.lower()


def test_every_prometheus_alert_has_actionable_telegram_annotations():
    alerts = (MONITORING_ROOT / 'prometheus' / 'alerts.yml').read_text(encoding='utf-8')
    alert_blocks = re.split(r'\n\s+- alert: ', alerts)
    alert_blocks = alert_blocks[1:]

    assert alert_blocks, 'expected at least one alert rule'
    for block in alert_blocks:
        alert_name = block.splitlines()[0].strip()
        for annotation in (
            'summary:',
            'what_happened:',
            'why_it_matters:',
            'likely_cause:',
            'first_checks:',
            'runbook:',
        ):
            assert annotation in block, f'{alert_name} is missing {annotation}'


def test_monitoring_yaml_files_parse():
    yaml_files = [
        MONITORING_ROOT / 'prometheus' / 'prometheus.staging.yml',
        MONITORING_ROOT / 'prometheus' / 'prometheus.ops.yml',
        MONITORING_ROOT / 'prometheus' / 'alerts.yml',
        MONITORING_ROOT / 'alertmanager' / 'alertmanager.yml.template',
        MONITORING_ROOT / 'loki' / 'local-config.yaml',
    ]

    for path in yaml_files:
        text = path.read_text(encoding='utf-8')
        if path.name.endswith('.template'):
            text = text.replace('__TELEGRAM_CHAT_ID__', '12345')
        assert yaml.safe_load(text) is not None


def test_production_client_targets_are_private_and_file_discovered():
    ops_config = (MONITORING_ROOT / 'prometheus' / 'prometheus.ops.yml').read_text(encoding='utf-8')
    staging_config = (MONITORING_ROOT / 'prometheus' / 'prometheus.staging.yml').read_text(encoding='utf-8')
    staging_compose = (MONITORING_ROOT / 'docker-compose.monitoring.yml').read_text(encoding='utf-8')
    client_compose = (MONITORING_ROOT / 'docker-compose.client-telemetry.yml').read_text(encoding='utf-8')
    metrics_proxy = (MONITORING_ROOT / 'caddy' / 'metrics-proxy.Caddyfile').read_text(encoding='utf-8')

    assert '/etc/prometheus/client-targets/hms-api*.targets.yml' in ops_config
    assert 'metrics-proxy:9188' in staging_config
    assert 'metrics-proxy:' in staging_compose
    assert '${CLIENT_WG_IP:?set CLIENT_WG_IP}:9188:9188' in client_compose
    assert '${CLIENT_WG_IP:?set CLIENT_WG_IP}:9100:9100' in client_compose
    assert '${CLIENT_WG_IP:?set CLIENT_WG_IP}:9187:9187' in client_compose
    assert '${CLIENT_WG_IP:?set CLIENT_WG_IP}:9121:9121' in client_compose
    assert 'handle /api/metrics/' in metrics_proxy
    assert 'reverse_proxy hms-api:8000' in metrics_proxy
    assert 'header_up Host {$CLIENT_DOMAIN}' in metrics_proxy
    assert 'respond 404' in metrics_proxy


def test_client_compose_defines_cross_stack_network_aliases():
    compose = (REPO_ROOT / 'ops' / 'hetzner-client-vps' / 'compose.yml').read_text(encoding='utf-8')

    assert 'hms-api' in compose
