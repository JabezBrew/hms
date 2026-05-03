# HMS Self-Hosted Observability

This bundle provides self-hosted observability for Hetzner VPS deployments:

- Prometheus metrics and alert rules.
- Grafana dashboards backed by Prometheus and Loki.
- Loki log storage.
- Grafana Alloy Docker log shipping from container stdout/stderr.
- Alertmanager Telegram notifications with diagnosis-oriented messages.
- Host, container, Postgres, and Redis exporters.

The Telegram alerts intentionally do not dump raw logs. Every alert must explain
what happened, why it matters, likely cause, first checks, and the runbook path.

## Staging on the Same VPS

Run this after the main HMS stack is healthy. The staging bundle joins the HMS
Docker networks and scrapes the API privately at `api:8000`.

```bash
cd /opt/hms
mkdir -p monitoring/alertmanager/secrets
printf '%s' '<telegram-bot-token>' > monitoring/alertmanager/secrets/telegram_bot_token
chmod 600 monitoring/alertmanager/secrets/telegram_bot_token

GF_SECURITY_ADMIN_USER=admin \
GF_SECURITY_ADMIN_PASSWORD='<strong-password>' \
TELEGRAM_CHAT_ID='<telegram-chat-id>' \
HMS_EDGE_NETWORK="${COMPOSE_PROJECT_NAME:-hms-client}_edge" \
HMS_INTERNAL_NETWORK="${COMPOSE_PROJECT_NAME:-hms-client}_internal" \
docker compose --env-file ops/hetzner-client-vps/.env \
  -f monitoring/docker-compose.monitoring.yml up -d
```

Open dashboards through an SSH tunnel:

```bash
ssh -L 3001:127.0.0.1:3001 deploy@staging-vps
```

Then visit `http://127.0.0.1:3001`.

## Production Ops VPS

Use one small ops VPS for Grafana, Prometheus, Loki, and Alertmanager. Connect
the ops VPS and each client VPS over WireGuard. Bind Loki only to the ops
WireGuard IP for client log pushes.

```bash
cd /opt/hms
mkdir -p monitoring/alertmanager/secrets
printf '%s' '<telegram-bot-token>' > monitoring/alertmanager/secrets/telegram_bot_token
chmod 600 monitoring/alertmanager/secrets/telegram_bot_token

GF_SECURITY_ADMIN_USER=admin \
GF_SECURITY_ADMIN_PASSWORD='<strong-password>' \
TELEGRAM_CHAT_ID='<telegram-chat-id>' \
OPS_WG_IP='10.90.0.1' \
docker compose -f monitoring/docker-compose.ops.yml up -d
```

Create one target file per job and client. Use the examples in
`monitoring/prometheus/client-targets/*.example.yml` and copy them to names
ending in `.targets.yml`, for example:

```bash
cp monitoring/prometheus/client-targets/hms-api.example.yml \
  monitoring/prometheus/client-targets/hms-api-acme.targets.yml
```

Replace the sample IP with the client VPS WireGuard IP. The tracked
`*.empty.targets.yml` files exist only to keep a fresh ops Prometheus config
valid before the first client target is added.

## Production Client Telemetry

On each client VPS, run the telemetry sidecars beside the main HMS Compose
stack. These services bind exporter ports only to the client WireGuard IP.

```bash
cd /opt/hms
CLIENT_WG_IP='10.90.0.11' \
LOKI_WRITE_URL='http://10.90.0.1:3100/loki/api/v1/push' \
OBS_ENVIRONMENT=production \
HMS_EDGE_NETWORK="${COMPOSE_PROJECT_NAME:-hms-client}_edge" \
HMS_INTERNAL_NETWORK="${COMPOSE_PROJECT_NAME:-hms-client}_internal" \
docker compose --env-file ops/hetzner-client-vps/.env \
  -f monitoring/docker-compose.client-telemetry.yml up -d
```

The client telemetry stack exposes:

- `CLIENT_WG_IP:9188` for `/api/metrics/` through a private metrics proxy.
- `CLIENT_WG_IP:9100` for node exporter.
- `CLIENT_WG_IP:8080` for cAdvisor.
- `CLIENT_WG_IP:9187` for Postgres exporter.
- `CLIENT_WG_IP:9121` for Redis exporter.

Do not expose these ports on the public interface.

## Telegram Alerts

Alertmanager reads the bot token from
`monitoring/alertmanager/secrets/telegram_bot_token`. The chat ID is passed as
`TELEGRAM_CHAT_ID` because it is environment-specific.

Each alert is rendered by `monitoring/alertmanager/templates/telegram.tmpl` and
must include:

- `what_happened`
- `why_it_matters`
- `likely_cause`
- `first_checks`
- `runbook`

This keeps Telegram useful during incidents without sending PHI or noisy log
blocks into the chat.

## Troubleshooting

Check targets:

```bash
docker compose -f monitoring/docker-compose.ops.yml exec prometheus \
  wget -qO- http://127.0.0.1:9090/api/v1/targets
```

Check Alertmanager config generation:

```bash
docker compose -f monitoring/docker-compose.ops.yml logs --tail=80 alertmanager
```

Check Docker log shipping:

```bash
docker compose -f monitoring/docker-compose.client-telemetry.yml logs --tail=80 alloy
```

Check private API metrics from the ops VPS:

```bash
curl -fsS http://10.90.0.11:9188/api/metrics/ | head
```

Useful first response pattern:

1. Read the Telegram alert fields, especially `first_checks`.
2. Open Grafana through SSH tunnel and inspect the affected target.
3. Query Loki by `{client="<client>", environment="<env>", service="<service>"}`.
4. SSH to the affected VPS only if metrics/logs identify a host or container
   issue.
