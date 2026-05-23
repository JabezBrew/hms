# HMS V2 Hetzner Deployment Runbook

This kit deploys the Rust HMS V2 API and the maintained React/Vite frontend in
`rust-v2` mode for one client per Hetzner VPS. It runs Caddy, the React static
frontend, `hms-api`, `hms-worker`, one-shot `hms-migrator`, Postgres,
PgBouncer, and Redis.

The stack serves only `/api/v2/*` from Rust. It does not include Django admin,
Django sessions, old API shapes, old data migration, or AI shell modules.

## Supported Profiles

Set `HMS_DEPLOYMENT_PROFILE` to one of:

| Profile | Default product surface |
| --- | --- |
| `chps_compound` | CHPS/outreach baseline. |
| `health_center` | Health-center outpatient workflows. |
| `clinic` | Clinic and waiting-room workflows. |
| `hospital` | Single hospital workflows. |
| `district_hospital` | District hospital workflows. |
| `regional_hospital` | Regional referral workflows. |
| `teaching_hospital` | Teaching hospital workflows. |
| `hospital_network` | Multi-facility network workflows. |

The backend seeds deployment-profile features and permissions from the Rust
capability registry. The frontend consumes `/api/v2/system/deployment-capabilities`
and hides routes/actions through typed route metadata and `AccessGate`.

## First Deploy

On the VPS:

```bash
sudo mkdir -p /opt/hms
sudo chown deploy:deploy /opt/hms
git clone git@github.com:JabezBrew/hms.git /opt/hms
cd /opt/hms
cp ops/hetzner-v2/env.example ops/hetzner-v2/.env
chmod 600 ops/hetzner-v2/.env
```

Fill every `CHANGE_ME` value in `ops/hetzner-v2/.env`, then validate:

```bash
docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml config -q
```

Use URL-safe values for `DB_PASSWORD` because Rust services receive Postgres as
`HMS_DATABASE_URL`; `openssl rand -hex 32` is the expected format.

Deploy:

```bash
ops/hetzner-v2/deploy.sh
```

The deploy script validates Compose, starts Postgres/Redis/PgBouncer, runs the
backup gate for production, builds images, runs `hms-migrator`, starts
`hms-api`, `hms-worker`, frontend, and Caddy, then checks:

```text
https://<client-domain>/api/v2/health/ready
```

## Migrations and Provisioning

`hms-migrator` runs sqlx migrations from `backend-rs/migrations`. When
`HMS_PROVISION_BASELINE=true`, it also provisions:

- facility row from `HMS_FACILITY_CODE` and `HMS_FACILITY_NAME`
- all supported deployment profiles, features, and permissions
- bootstrap admin from `HMS_BOOTSTRAP_ADMIN_EMAIL`,
  `HMS_BOOTSTRAP_ADMIN_NAME`, and `HMS_BOOTSTRAP_ADMIN_PASSWORD`
- minimum operational catalogs/read models required by the completed V2 slices

Production provisioning does not seed demo patients unless
`HMS_SEED_DEMO_DATA=true`.

## Health and Metrics

Public readiness:

```bash
curl -i https://<client-domain>/api/v2/health/ready
```

The Rust API exposes PHI-safe Prometheus text at `/api/v2/metrics` on the
container network. Caddy returns `404` for that path publicly, so scrape it from
inside the VPS network or through a private monitoring sidecar.

The V2 Compose stack includes a private Prometheus service that scrapes the
Rust API inside Docker at `hms-api:8080/api/v2/metrics`. It has no published
host port and must not be routed through Caddy:

```bash
docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml up -d prometheus
```

Grafana is included only as an engineer fallback/debug console. It binds to
`127.0.0.1:${GRAFANA_LOCAL_PORT:-3001}` on the VPS, uses the private
Prometheus datasource, and must be opened through SSH tunneling:

```bash
docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml up -d grafana
ssh -L 3001:127.0.0.1:3001 hms-staging
```

Then visit `http://127.0.0.1:3001` and sign in with
`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` from the private `.env` file.
Generate a unique Grafana password per client VPS; do not commit it.

The public Caddy edge can reserve an ops host for the custom HMS Ops dashboard.
Leave `OPS_DOMAIN=localhost` until DNS is ready. To enable it, set
`OPS_DOMAIN=ops.<client-domain>` or another explicit ops hostname and keep
`OPS_DASHBOARD_UPSTREAM=frontend:80` unless a future standalone ops frontend is
introduced. The ops host proxies `/api/v2/*` to `hms-api`, redirects `/` to
`/system/ops`, and serves the protected React route for everything else. The
client hospital host returns `404` for `/system/ops` and `/api/v2/ops/*`; those
paths are reserved for `OPS_DOMAIN`. The frontend receives `OPS_DOMAIN` as the
allowed ops dashboard host at container start. The dashboard must continue to
enforce HMS authentication plus `system.ops.view` before the ops DNS record is
published.
`system.ops.view` is not seeded into normal client deployment-profile
permissions, so grant it only through a platform/operator provisioning process,
not through hospital facility-admin workflows. Set `HMS_OPS_OPERATOR_EMAILS`
to a comma-separated list of existing HMS user emails in the private `.env`
file when those users should receive dashboard access during provisioning. Do
not point this route at Grafana or Prometheus.

Postgres is started with `pg_stat_statements` preloaded for staging and
production diagnostics. Existing databases still need the extension enabled
once after the Postgres container has restarted with the preload setting:

```bash
docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml exec -T db \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"'
```

Verify it privately from the VPS:

```bash
docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml exec -T db \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT queryid, calls, total_exec_time, mean_exec_time, rows FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;"'
```

Do not expose Postgres, `/api/v2/metrics`, Prometheus, or Grafana publicly.
For a Grafana slow-query table, use a private Postgres datasource or a private
postgres-exporter custom query; group by `queryid` and never display SQL text in
public screenshots. The operational SQL for private runbooks is:

```sql
SELECT queryid,
       calls,
       round(total_exec_time::numeric, 2) AS total_exec_ms,
       round(mean_exec_time::numeric, 2) AS mean_exec_ms,
       rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Useful private Grafana PromQL panels:

```promql
# Slow clinical routes p99
histogram_quantile(0.99, sum by (route_pattern, le) (
  rate(hms_api_route_request_duration_seconds_bucket{route_pattern=~"/api/v2/(patients/:id/chronicle|dashboards/.*|wards/board)"}[$__rate_interval])
))

# DB pool pressure
1 - (hms_api_postgres_pool_idle / clamp_min(hms_api_postgres_pool_size, 1))

# Browser API latency p95 by safe route
histogram_quantile(0.95, sum by (route_pattern, le) (
  rate(hms_browser_api_request_duration_seconds_bucket[$__rate_interval])
))

# Dashboard p95/p99
histogram_quantile(0.95, sum by (route_pattern, le) (rate(hms_dashboard_read_seconds_bucket[$__rate_interval])))
histogram_quantile(0.99, sum by (route_pattern, le) (rate(hms_dashboard_read_seconds_bucket[$__rate_interval])))

# Chronicle p95/p99
histogram_quantile(0.95, sum by (route_pattern, le) (rate(hms_chronicle_read_seconds_bucket[$__rate_interval])))
histogram_quantile(0.99, sum by (route_pattern, le) (rate(hms_chronicle_read_seconds_bucket[$__rate_interval])))
```

## Backups and Restore

Production deploys require encrypted off-server restic backups. Fill these
values before treating the client as production-ready:

```text
RESTIC_REPOSITORY=
RESTIC_PASSWORD=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
BACKUP_RETENTION_DAYS=30
```

Run a backup:

```bash
ops/hetzner-v2/backup-postgres.sh
```

Restore is destructive and requires explicit confirmation:

```bash
RESTORE_CONFIRM=restore-<client-slug> ops/hetzner-v2/restore-postgres.sh \
  ops/hetzner-v2/backups/<client-slug>-YYYYMMDDTHHMMSSZ.dump
```

After restore, verify `/api/v2/health/ready`, login, patient registry, billing,
and dashboard flows before returning users to the system.

## Production Checks

Before cutover:

- `cargo fmt --all --check`
- `cargo test --workspace`
- migration fresh-db/provisioning test
- `cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json`
- `npm run api:v2:generate:check`
- targeted V2 frontend tests
- `npm run build`
- `npm run perf:bundle-budget`
- `docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml config -q`
- a successful production backup and a tested restore drill
