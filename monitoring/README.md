# HMS Self-Hosted Observability

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Prometheus, Grafana, Loki, Tempo, Alertmanager, metrics proxy, and telemetry sidecars.

This bundle provides the self-hosted observability stack used by the Rust V2
Compose deployment profile. Current staging/performance validation is on GCP;
use the current GCP runbook for that environment. The single-VM Compose path
remains rollback/reference, and the legacy Django Hetzner kit is historical only.

The monitoring bundle contains:

- Prometheus metrics and alert rules.
- Grafana dashboards backed by Prometheus and Loki.
- Loki log storage.
- Grafana Alloy Docker log shipping from container stdout/stderr.
- Alertmanager Telegram notifications with diagnosis-oriented messages.
- Host, container, Postgres, and Redis exporters.

The Telegram alerts intentionally do not dump raw logs. Every alert must explain
what happened, why it matters, likely cause, first checks, and the runbook path.

## Open Grafana Dashboards

For current GCP staging, open Grafana through the access path documented in
`ops/gcp-staging/README.md`.

For a single-VM Compose rollback/reference host from this laptop, open Grafana
through an SSH tunnel:

```bash
ssh -L 3001:127.0.0.1:3001 hms-staging
```

Then visit `http://127.0.0.1:3001` and open the `HMS` folder.

Use the dashboards in this order during incidents:

- `HMS Operability`: process readiness, dependency readiness, Rust worker
  visibility, queue depth, uptime, and basic infrastructure health.
- API/request dashboard, when provisioned: request rate, 5xx rate, p95 latency,
  slow routes, and status-code breakdowns.
- RUM/browser dashboard, when provisioned: browser page loads, frontend API
  errors, client-side latency, and ingestion health.
- Tracing/Tempo dashboard, when provisioned: representative traces for slow or
  failing API calls and cross-service timing.

If a dashboard is missing from the `HMS` folder, check
`monitoring/grafana/provisioning/dashboards/dashboards.yml`, then check the
Grafana container logs for dashboard JSON parse errors.

## Signal Guide

- Readiness tells you whether the API believes required dependencies are safe
  enough to serve traffic. A ready API can still be slow or returning 5xxs.
- Dependency readiness identifies database, PgBouncer, Redis, or other required
  service failures from the API's point of view.
- Request rate shows traffic volume. A sudden drop can mean users cannot reach
  HMS; a sudden spike can explain saturation.
- 5xx rate shows server-side failures. Treat sustained 5xxs as clinical workflow
  impact until proven otherwise.
- p95 API latency shows the slow experience for real users. HMS targets clinical
  views below 200 ms p99; sustained p95 above alert threshold needs route-level
  investigation.
- RUM events show browser-side experience. Missing RUM after it is enabled means
  frontend failures may be invisible.
- Tempo traces show where time is spent across a request path. Tempo target
  alerts only fire when Tempo scrape targets are configured in Prometheus.
- Loki logs provide event context. Logs must remain PHI-safe and should be
  filtered by service, environment, client, route, status, and request id.

## PHI Safety Rules

- Do not paste request bodies, clinical note text, patient identifiers, names,
  phone numbers, addresses, accession numbers, or free-text clinical fields into
  Telegram, GitHub, or tickets.
- Use route templates, status codes, request ids, container names, and aggregate
  counts for incident notes.
- Prefer Grafana screenshots that show aggregate panels. Crop or redact any log
  line that might include PHI before sharing.
- Never change logging to dump request bodies while investigating an incident.
- Treat browser telemetry as operational metadata only. RUM must not include page
  text, form values, patient names, or raw URLs containing identifiers.

## Metrics Proxy

`monitoring/caddy/metrics-proxy.Caddyfile` exposes a private scrape surface on
port `9188` inside the telemetry network:

- `/api/metrics/` rewrites to `/api/v2/metrics` and proxies to `hms-api:8080`.
- `/worker/metrics` rewrites to `/metrics` and proxies to `hms-worker:8081`.
- all other paths return `404`.

Do not expose this proxy on the public interface.

## Compose Staging Or Rollback

Run this after the main Rust V2 stack is healthy. For current GCP staging, use
the GCP runbook first. For a Rust V2 Compose staging/rollback host, the
monitoring bundle joins the HMS Docker networks and scrapes the private metrics
proxy instead of public API endpoints.
```bash
cd /opt/hms
mkdir -p monitoring/alertmanager/secrets
printf '%s' '<telegram-bot-token>' > monitoring/alertmanager/secrets/telegram_bot_token
chmod 600 monitoring/alertmanager/secrets/telegram_bot_token

GF_SECURITY_ADMIN_USER=admin \
GF_SECURITY_ADMIN_PASSWORD='<strong-password>' \
TELEGRAM_CHAT_ID='<telegram-chat-id>' \
HMS_EDGE_NETWORK="${COMPOSE_PROJECT_NAME:-hms-v2-client}_edge" \
HMS_INTERNAL_NETWORK="${COMPOSE_PROJECT_NAME:-hms-v2-client}_internal" \
docker compose --env-file ops/compose-v2/.env \
  -f monitoring/docker-compose.monitoring.yml up -d
```

Open dashboards through an SSH tunnel on a single-VM Compose
rollback/reference host:

```bash
ssh -L 3001:127.0.0.1:3001 hms-staging
```

Then visit `http://127.0.0.1:3001`.

## Validate Staging

After deploying monitoring changes to staging:

1. Confirm the monitoring stack is running:
   `docker compose -f monitoring/docker-compose.monitoring.yml ps`.
2. Open Grafana through the SSH tunnel and confirm the `HMS` folder contains the
   expected dashboards.
3. In Prometheus, check `Status > Targets` and confirm `hms-api`, `hms-worker`,
   `node`, `cadvisor`, `postgres`, and `redis` are up.
4. Load `/api/v2/health/ready`, `/api/metrics/`, and `/worker/metrics` through
   the private metrics proxy from the monitoring container or host.
5. Generate one authenticated staging page load and one normal API request, then
   confirm request metrics move on the API dashboard when that dashboard is
   provisioned.
6. If RUM is enabled, generate a staging page load and confirm
   `hms_browser_rum_events_total` increases without sending PHI fields.
7. If Tempo is enabled, confirm the Tempo scrape target is up and one staging API
   request produces a trace.
8. Check Alertmanager logs for template errors before relying on Telegram.

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
cp monitoring/prometheus/client-targets/hms-worker.example.yml \
  monitoring/prometheus/client-targets/hms-worker-acme.targets.yml
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
HMS_EDGE_NETWORK="${COMPOSE_PROJECT_NAME:-hms-v2-client}_edge" \
HMS_INTERNAL_NETWORK="${COMPOSE_PROJECT_NAME:-hms-v2-client}_internal" \
docker compose --env-file ops/compose-v2/.env \
  -f monitoring/docker-compose.client-telemetry.yml up -d
```

The client telemetry stack exposes:

- `CLIENT_WG_IP:9188` for `/api/metrics/` and `/worker/metrics` through a private metrics proxy.
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

## First-Response Workflow

1. Read the Telegram fields in order: `what_happened`, `why_it_matters`,
   `likely_cause`, `first_checks`, then `runbook`.
2. Open Grafana through the SSH tunnel and inspect the dashboard named by the
   alert. Confirm whether the symptom is still active.
3. Determine blast radius: one client or all clients, one service or several,
   one route or global API degradation.
4. Check Prometheus targets before chasing application causes. A scrape failure
   can mean observability is broken rather than HMS itself.
5. Use Loki with labels first, for example
   `{client="<client>", environment="<env>", service="api"}`. Narrow by route,
   status, and request id; do not search for patient names or clinical text.
6. SSH to the VPS only after metrics/logs identify the affected host or
   container. Start with `docker compose ps`, targeted service logs, disk,
   memory, and recent deploy history.
7. If API latency or 5xxs are route-specific, inspect query count, database
   panels, and recent backend changes for that route before restarting services.
8. Record the incident using aggregate facts: time window, client, environment,
   affected service, alert name, route template, status code class, and fix.

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
curl -fsS http://10.90.0.11:9188/worker/metrics | head
```

For alert rules, every Prometheus alert must keep the Telegram annotation
contract: `summary`, `what_happened`, `why_it_matters`, `likely_cause`,
`first_checks`, and `runbook`.
