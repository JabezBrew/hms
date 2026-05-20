from __future__ import annotations

import json
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
MONITORING_ROOT = REPO_ROOT / 'monitoring'


REQUIRED_ALERT_ANNOTATIONS = (
    'summary',
    'what_happened',
    'why_it_matters',
    'likely_cause',
    'first_checks',
    'runbook',
)


def _prometheus_alert_rules():
    alerts = yaml.safe_load((MONITORING_ROOT / 'prometheus' / 'alerts.yml').read_text(encoding='utf-8'))
    return [
        rule
        for group in alerts.get('groups', [])
        for rule in group.get('rules', [])
        if 'alert' in rule
    ]


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
    alert_rules = _prometheus_alert_rules()

    assert alert_rules, 'expected at least one alert rule'
    for rule in alert_rules:
        annotations = rule.get('annotations') or {}
        for annotation in REQUIRED_ALERT_ANNOTATIONS:
            assert annotations.get(annotation), f"{rule['alert']} is missing {annotation}"


def test_observability_alerts_cover_api_rum_and_tracing_signals():
    rules = {rule['alert']: rule for rule in _prometheus_alert_rules()}

    for alert_name in (
        'HMSApiHigh5xxRate',
        'HMSApiHighP95Latency',
        'HMSRumIngestionMissing',
        'HMSTempoTargetDown',
    ):
        assert alert_name in rules
        annotations = rules[alert_name]['annotations']
        for annotation in REQUIRED_ALERT_ANNOTATIONS:
            assert annotations.get(annotation), f'{alert_name} is missing {annotation}'

    assert 'hms_api_http_requests_total' in rules['HMSApiHigh5xxRate']['expr']
    assert 'status=~"5.."' in rules['HMSApiHigh5xxRate']['expr']
    assert 'histogram_quantile' in rules['HMSApiHighP95Latency']['expr']
    assert 'hms_api_http_request_duration_seconds_bucket' in rules['HMSApiHighP95Latency']['expr']
    assert 'hms_rum_enabled' in rules['HMSRumIngestionMissing']['expr']
    assert 'hms_browser_rum_events_total' in rules['HMSRumIngestionMissing']['expr']
    assert 'tempo' in rules['HMSTempoTargetDown']['expr']


def test_monitoring_yaml_files_parse():
    yaml_files = [
        MONITORING_ROOT / 'prometheus' / 'prometheus.staging.yml',
        MONITORING_ROOT / 'prometheus' / 'prometheus.ops.yml',
        MONITORING_ROOT / 'prometheus' / 'alerts.yml',
        MONITORING_ROOT / 'alertmanager' / 'alertmanager.yml.template',
        MONITORING_ROOT / 'loki' / 'local-config.yaml',
        MONITORING_ROOT / 'tempo' / 'tempo-local.yaml',
        MONITORING_ROOT / 'grafana' / 'provisioning' / 'datasources' / 'datasources.yml',
    ]

    for path in yaml_files:
        text = path.read_text(encoding='utf-8')
        if path.name.endswith('.template'):
            text = text.replace('__TELEGRAM_CHAT_ID__', '12345')
        assert yaml.safe_load(text) is not None


def test_grafana_dashboard_provisioning_and_json_parse():
    provider = yaml.safe_load(
        (MONITORING_ROOT / 'grafana' / 'provisioning' / 'dashboards' / 'dashboards.yml').read_text(encoding='utf-8')
    )
    datasource = yaml.safe_load(
        (MONITORING_ROOT / 'grafana' / 'provisioning' / 'datasources' / 'datasources.yml').read_text(encoding='utf-8')
    )
    dashboard_files = sorted((MONITORING_ROOT / 'grafana' / 'dashboards').glob('*.json'))

    assert dashboard_files, 'expected at least one provisioned Grafana dashboard JSON file'
    assert provider['providers'][0]['options']['path'] == '/etc/grafana/dashboards'
    assert any(item['name'] == 'Prometheus' for item in datasource['datasources'])
    assert any(item['name'] == 'Loki' for item in datasource['datasources'])

    for path in dashboard_files:
        dashboard = json.loads(path.read_text(encoding='utf-8'))
        assert dashboard.get('title'), f'{path.name} is missing a dashboard title'
        assert isinstance(dashboard.get('panels'), list), f'{path.name} is missing panels'


def test_production_client_targets_are_private_and_file_discovered():
    ops_config = (MONITORING_ROOT / 'prometheus' / 'prometheus.ops.yml').read_text(encoding='utf-8')
    staging_config = (MONITORING_ROOT / 'prometheus' / 'prometheus.staging.yml').read_text(encoding='utf-8')
    staging_compose = (MONITORING_ROOT / 'docker-compose.monitoring.yml').read_text(encoding='utf-8')
    client_compose = (MONITORING_ROOT / 'docker-compose.client-telemetry.yml').read_text(encoding='utf-8')
    metrics_proxy = (MONITORING_ROOT / 'caddy' / 'metrics-proxy.Caddyfile').read_text(encoding='utf-8')

    assert '/etc/prometheus/client-targets/hms-api*.targets.yml' in ops_config
    assert '/etc/prometheus/client-targets/hms-worker*.targets.yml' in ops_config
    assert 'metrics-proxy:9188' in staging_config
    assert 'job_name: hms-worker' in staging_config
    assert 'job_name: tempo' in staging_config
    assert 'tempo:3200' in staging_config
    assert 'job_name: tempo' in ops_config
    assert 'tempo:3200' in ops_config
    assert 'metrics-proxy:' in staging_compose
    assert '${CLIENT_WG_IP:?set CLIENT_WG_IP}:9188:9188' in client_compose
    assert '${CLIENT_WG_IP:?set CLIENT_WG_IP}:9100:9100' in client_compose
    assert '${CLIENT_WG_IP:?set CLIENT_WG_IP}:9187:9187' in client_compose
    assert '${CLIENT_WG_IP:?set CLIENT_WG_IP}:9121:9121' in client_compose
    assert 'handle /api/metrics/' in metrics_proxy
    assert 'rewrite * /api/v2/metrics' in metrics_proxy
    assert 'reverse_proxy hms-api:8080' in metrics_proxy
    assert 'handle /worker/metrics' in metrics_proxy
    assert 'reverse_proxy hms-worker:8081' in metrics_proxy
    assert 'header_up Host {$CLIENT_DOMAIN}' in metrics_proxy
    assert 'respond 404' in metrics_proxy


def test_tempo_and_otlp_are_private_and_provisioned():
    staging_compose = yaml.safe_load((MONITORING_ROOT / 'docker-compose.monitoring.yml').read_text(encoding='utf-8'))
    ops_compose = yaml.safe_load((MONITORING_ROOT / 'docker-compose.ops.yml').read_text(encoding='utf-8'))
    client_compose = yaml.safe_load((MONITORING_ROOT / 'docker-compose.client-telemetry.yml').read_text(encoding='utf-8'))
    datasources = yaml.safe_load(
        (MONITORING_ROOT / 'grafana' / 'provisioning' / 'datasources' / 'datasources.yml').read_text(encoding='utf-8')
    )
    alloy_config = (MONITORING_ROOT / 'alloy' / 'docker-logs.alloy').read_text(encoding='utf-8')
    tempo_config = yaml.safe_load((MONITORING_ROOT / 'tempo' / 'tempo-local.yaml').read_text(encoding='utf-8'))

    assert staging_compose['services']['tempo']['image'].startswith('grafana/tempo:')
    assert ops_compose['services']['tempo']['image'].startswith('grafana/tempo:')
    assert staging_compose['services']['tempo']['ports'] == ['127.0.0.1:3200:3200']
    assert ops_compose['services']['tempo']['ports'] == ['127.0.0.1:3200:3200']

    assert '4317:4317' not in '\n'.join(staging_compose['services']['alloy'].get('ports', []))
    assert ops_compose['services']['alloy']['ports'] == [
        '${OPS_WG_IP:?set OPS_WG_IP}:4317:4317',
        '${OPS_WG_IP:?set OPS_WG_IP}:4318:4318',
    ]
    assert client_compose['services']['alloy']['networks']['hms_internal']['aliases'] == ['hms-telemetry-alloy']
    assert client_compose['services']['alloy']['environment']['TEMPO_OTLP_ENDPOINT'] == (
        '${TEMPO_OTLP_ENDPOINT:?set TEMPO_OTLP_ENDPOINT}'
    )

    assert 'otelcol.receiver.otlp "hms"' in alloy_config
    assert 'otelcol.exporter.otlp "tempo"' in alloy_config
    assert tempo_config['compactor']['compaction']['block_retention'] == '72h'

    tempo_datasource = next(
        datasource for datasource in datasources['datasources'] if datasource['name'] == 'Tempo'
    )
    assert tempo_datasource['type'] == 'tempo'
    assert tempo_datasource['url'] == 'http://tempo:3200'
    assert tempo_datasource['access'] == 'proxy'


def test_client_compose_defines_cross_stack_network_aliases():
    compose = (REPO_ROOT / 'ops' / 'hetzner-client-vps' / 'compose.yml').read_text(encoding='utf-8')

    assert 'hms-api' in compose
