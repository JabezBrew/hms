# HMS GCP staging runbook

This runbook is the source of truth for current HMS Rust V2 staging on Google
Cloud. Hetzner remains rollback, but `staging.thehms.systems` should not be
reasoned about from the reusable single-VM Compose file alone.

## Current decision

Use GCP for staging and performance testing during the free-trial window, with
PostgreSQL on Cloud SQL and public traffic through the GCP global external
HTTPS Load Balancer. Keep Hetzner reversible until DNS, backups, smoke tests,
and performance evidence prove the GCP path is healthy for a rollback window.

As of June 1, 2026, the billing console showed:

- Free trial original credit: `$300.00`.
- Remaining credit: `$285.10`.
- Credit expiry: August 29, 2026.
- May 2026 report: `$12.50` usage, fully offset by credits.
- Main May cost drivers: Compute Engine `$12.34`, Networking `$0.16`.

## Current GCP lab inventory

Project:

- `hms-perf-lab`

App VM:

- Name: `hms-gcp-app-1`
- Zone: `africa-south1-a`
- Private IP: `10.10.0.2`
- Public IP: `34.35.148.55`
- Machine type: `n2-standard-4`
- Disk: `100G`
- Current public URL: `https://staging.thehms.systems`
- Current compose project: `hms-gcp-perf`
- Current deployment profile: `hospital`
- Current facility code: `MAIN`
- Current image tag observed: `gcp-perf-288e273b61ac`

Public edge:

- DNS: `staging.thehms.systems`
- Cloudflare state: DNS-only to the GCP load balancer.
- GCP global address: `hms-staging-lb-ip` / `35.190.19.91`
- HTTPS forwarding rule: `hms-staging-https-fr`
- Target proxy: `hms-staging-https-proxy`
- URL map: `hms-staging-url-map`
- App backend: `hms-staging-app-backend`, forwarding HTTP to Caddy on named
  port `http:80`.
- App backend health check: `hms-staging-http-ready-hc`, HTTP
  `/api/v2/health/ready` with host `staging.thehms.systems`.
- App VM web firewall: allow only GCP GFE/health-check ranges
  `35.191.0.0/16` and `130.211.0.0/22` to TCP port `80`; public clients should
  reach the VM only through the HTTPS load balancer.
- Static backend: `hms-staging-static-backend` with CDN enabled for
  `/assets/*` only.
- Managed certificate: `hms-staging-managed-cert-v2`

Database:

- Cloud SQL instance: `hms-staging-pg-1`
- PostgreSQL major version: `16`
- Region: `africa-south1`
- Private IP: `10.216.13.2`
- Availability: regional HA
- Automated backups: enabled
- Point-in-time recovery: enabled
- Deletion protection: enabled

Load VM:

- Name: `hms-gcp-load-1`
- Zone: `africa-south1-a`
- Private IP: `10.10.0.3`
- Public IP: `34.35.189.72`
- Machine type: `e2-standard-2`
- Disk: `50G`

The app VM is intentionally oversized for a perf lab. The load VM should be
stopped when not running tests.

## June 1, 2026 cutover status

`staging.thehms.systems` now points at the GCP global HTTPS load balancer. The
public Rust V2 readiness endpoint returns `200` at `/api/v2/health/ready`, and
response headers include `via: 1.1 Caddy, 1.1 google`.

TLS terminates at the GCP HTTPS load balancer. The VM-local Caddy instance uses
`ops/gcp-staging/Caddyfile`, which is intentionally HTTP-only for
`CLIENT_DOMAIN` so GCP backend requests do not get redirected from port 80 to
443. The reusable `ops/compose-v2/Caddyfile` remains the direct single-VM TLS
shape for non-GCP deployments.

Current intended GCP runtime services:

- `caddy`
- `frontend`
- `hms-api`
- `hms-worker`
- `redis`

PostgreSQL is Cloud SQL, not the Docker `db` service. PgBouncer is not on the
active GCP staging request path. If old `db` or `pgbouncer` containers appear
on the VM, do not treat them as proof that staging uses Docker Postgres. Verify
the live runtime by checking the redacted database host inside `hms-api` and
`hms-worker`.

Expected redacted runtime proof:

```text
HMS_DATABASE_URL host=10.216.13.2 port=5432
```

Use the GCP staging wrapper for deploys:

```bash
EXTERNAL_DB_BACKUP_CONFIRMED=true \
  ops/gcp-staging/deploy.sh --skip-pull
```

That wrapper combines:

- `ops/compose-v2/compose.yml`
- `ops/gcp-staging/compose.cloudsql.yml`
- `ops/gcp-staging/Caddyfile` mounted into the Caddy container

Do not run bare `ops/compose-v2/deploy.sh` for current GCP staging unless
`COMPOSE_FILES` includes the Cloud SQL override and `DATABASE_MODE` is
`external-postgres`.

The wrapper blocks unsafe Cloud SQL deploys before migrations. It validates the
merged Compose contract, refuses active `db`/`pgbouncer` services in external
Postgres mode, requires `hms-api`, `hms-worker`, and `hms-migrator` to use the
external `HMS_DATABASE_URL`, requires migrator egress on the `edge` network, and
runs `hms-migrator check-db` before migrations. It also refuses stale shell
`HMS_DATABASE_URL` values that differ from the private env file and checks the
database host against `GCP_CLOUDSQL_HOST` (`10.216.13.2` by default).

The load VM is stopped and should remain stopped except during explicit
performance test windows.

`ops-staging.thehms.systems` is intentionally deferred. It still sits behind
Cloudflare Access and returns the expected Access login redirect. Do not move
the ops hostname during the app staging cutover unless Cloudflare Access, Caddy
ACME, and the ops auth mode are validated together.

Hetzner remains live as rollback. Direct SSH to the Hetzner origin is still
available, and its Rust V2 Docker stack remains running. Do not cancel the
Hetzner VPS until GCP staging has been stable through a rollback window.

## Verified backups and restore anchors

Current Cloud SQL protection:

- Automated backups: enabled.
- Point-in-time recovery: enabled.
- Deletion protection: enabled.
- On-demand Cloud SQL backup observed after the restore drill:
  `1780302451794`.
- Restore drill to a temporary Cloud SQL instance completed successfully; the
  temporary restore instance was deleted after validation.

The following Docker dump and disk artifacts are rollback anchors from the
GCP migration and Hetzner fallback path. They are not proof that current GCP
staging uses Docker Postgres.

Hetzner source backup:

- `/opt/hms/ops/compose-v2/backups/staging-20260601T054922Z.dump`

GCP pre-restore backup:

- `/opt/hms/ops/compose-v2/backups/gcp-perf-20260601T054922Z.dump`

GCP post-auth-repair backup:

- `/opt/hms/ops/compose-v2/backups/gcp-staging-postrepair-20260601T065316Z.dump`

GCP disk snapshot:

- `hms-gcp-app-1-postrepair-20260601-0653`
- Source disk: `hms-gcp-app-1`
- Location: `africa-south1`
- Size observed after completion: `8.98 GB`
- Status observed: available

Rollback restore command for a DB dump on a prepared single-VM Rust V2 host:

```bash
cd /opt/hms
RESTORE_CONFIRM=restore-staging \
  ops/compose-v2/restore-postgres.sh \
  ops/compose-v2/backups/gcp-staging-postrepair-20260601T065316Z.dump
```

The disk snapshot is the VM-level rollback anchor. The DB dumps are the
application-data rollback anchors.

## Post-repair validation evidence

Public HTTPS functional smoke after the admin credential repair:

- login: `200`
- auth/me: `200`
- admin dashboard capacity: `200`
- patient list: `200`
- omni search: `200`
- logout: `200`

Browser smoke:

- admin dashboard route: ready
- patient registry route: ready
- Chronicle route: loaded, but the selected patient was correctly blocked by
  team-based access for the admin session. No temporary patient-access grants
  were created.

Public HTTPS k6 admin-only smoke:

- checks: `117/117` passed
- HTTP failures: `0`
- app errors: `0`
- auth/me p99: about `375 ms`
- patient list p99: about `352 ms`

Direct-origin k6 admin-only smoke from this laptop, bypassing Cloudflare:

- checks: `131/131` passed
- HTTP failures: `0`
- app errors: `0`
- auth/me p99: about `255 ms`
- patient list p99: about `221 ms`

App-local timing from the GCP VM through local Caddy:

- login: about `34 ms`
- auth/me: about `5 ms`
- admin dashboard capacity: about `5 ms`
- patient list: about `5 ms`

The post-repair evidence shows auth/session state is healthy. The remaining
public-path tail latency is network/edge distance, not local app execution.

## Current cost guardrails

The billing budget `hms-perf budgets` is scoped to project `hms-perf-lab`.

- Budget amount: `$250`
- Alert thresholds: `20%`, `60%`, `100%`
- Dollar equivalents: `$50`, `$150`, `$250`
- Email alerts to billing admins and users: enabled

Operational cost rule:

- Keep `hms-gcp-app-1` running for staging.
- Keep `hms-gcp-load-1` stopped unless actively running tests.
- Review free credits before the remaining credit drops below `$50` or before
  August 15, 2026, whichever comes first.

## Target operating model

Use three modes rather than one always-on expensive shape:

1. Staging mode
   - One always-on app VM.
   - Keep Rust API, worker, frontend, Caddy, and Redis on the VM.
   - Keep PostgreSQL on Cloud SQL over private IP.
   - Deploy with `ops/gcp-staging/deploy.sh`.
   - Keep Docker Postgres/PgBouncer stopped unless explicitly validating the
     Hetzner-style rollback shape.

2. Load-test mode
   - Keep `hms-gcp-load-1` stopped by default.
   - Start it only for regression runs and frontend runtime probes.
   - Stop it again immediately after evidence is captured.

3. Perf-campaign mode
   - Temporarily resize or recreate app capacity only when a campaign needs a
     stronger origin.
   - Record machine type, region, commit, and run profile in the evidence.

## Cost guardrails

Before canceling Hetzner staging:

- Create GCP budget alerts at `$50`, `$150`, and `$250`.
- Add a manual review threshold when remaining credits fall below `$50`.
- Label resources with at least:
  - `app=hms`
  - `env=staging`
  - `purpose=staging` or `purpose=load-test`
- Stop the load VM outside test windows.
- Keep disks and snapshots named clearly so orphaned resources are obvious.
- Review credits before August 15, 2026, so there is time to move back to
  Hetzner before credits expire on August 29, 2026.

## Security and PHI rules

- Do not expose Postgres, Redis, PgBouncer, Prometheus, Grafana, or
  `/api/v2/metrics` publicly.
- Keep Cloudflare Access in front of ops surfaces.
- Keep secrets in private env files or a managed secret store; never commit
  private `.env` contents.
- Keep staging evidence PHI-safe: no request bodies, response bodies, MRNs,
  patient identifiers, raw URLs with IDs, or raw k6 exports in commits.
- Use `RequestContext`, facility scoping, reauth/session protections, bounded
  cursor lists, scoped cache keys, and no-PHI logging exactly as in Rust V2.

## Migration path

1. Preserve Hetzner as rollback
   - Confirm current Hetzner commit, branch, and health.
   - Take a fresh encrypted Postgres backup.
   - Preserve the private Hetzner env out of repo.
   - Do not cancel the VPS yet.

2. Prepare GCP staging
   - Decide whether to reuse `hms-gcp-app-1` or create a new staging VM.
   - Prefer reusing only if the perf lab can tolerate staging naming and DNS.
   - For a cleaner setup, create a new VM named `hms-gcp-staging-1`.
   - Use `ops/gcp-staging/deploy.sh` as the deployment entry
     point.
   - Use `ops/compose-v2/compose.yml` only together with
     `ops/gcp-staging/compose.cloudsql.yml` for current GCP staging.
   - Keep `ops/hetzner-client-vps/` out of the path; it is legacy Django.

3. Right-size compute
   - Initial safe target: `e2-standard-2`.
   - Possible cheaper target after proof: `e2-medium`.
   - Keep the app VM in `africa-south1-a` unless there is a specific reason to
     move regions.

4. Deploy Rust V2
   - Configure private env for the GCP staging domain and facility.
   - Set `HMS_DATABASE_URL` in the private env to the Cloud SQL private-IP
     Postgres URL.
   - Confirm Cloud SQL backups/PITR before migrations.
   - Run `EXTERNAL_DB_BACKUP_CONFIRMED=true ops/gcp-staging/deploy.sh --skip-pull`
     when deploying from an archive/copy rather than a Git checkout.
   - Verify Docker health and private readiness before checking public DNS.
   - Verify public readiness at `/api/v2/health/ready`.

5. Cut DNS
   - Point `staging.thehms.systems` at the GCP load-balancer IP.
   - Confirm `hms-staging-app-backend` uses protocol `HTTP`, port name `http`,
     and health check `hms-staging-http-ready-hc`; Caddy behind the LB should
     serve HTTP on port 80, not redirect GCP backend traffic to HTTPS.
   - Keep Cloudflare DNS-only unless the proxied-vs-DNS-only timing/security
     comparison is being run intentionally.
   - Use public readiness as the cutover gate, not as the only deploy truth.

6. Validate
   - Run a staging smoke check: health, login, dashboard, patient registry,
     Chronicle, billing, and runtime config.
   - Run the maintained Rust V2 regression reporter against:
     - localhost/app-only if needed for baseline comparison
     - GCP origin/private path
     - public HTTPS path
   - Run frontend build, bundle budget, and runtime probe against the public URL.

7. Decommission Hetzner staging
   - Keep Hetzner stopped-but-restorable for a short rollback window if possible.
   - Cancel Hetzner only after GCP staging has stable DNS, backups, smoke checks,
     and performance evidence.

## Remaining safe actions

1. Stop `hms-gcp-load-1` when no test run is active.
2. Keep Docker `db` and `pgbouncer` stopped on GCP staging unless explicitly
   validating the Hetzner-style rollback shape.
3. Compare Cloudflare proxied versus DNS-only timing before changing the final
   edge path.
4. After the GCP path is stable, consider resizing the app VM down from
   `n2-standard-4`; run smoke and perf checks before keeping a smaller size.
5. Keep Hetzner live until the GCP public path, Cloud SQL backup/restore path,
   and rollback assumptions are proven through the agreed window.

## Public 503 triage

If the browser shows `no healthy upstream` or `remote connection failure` from
Google:

```bash
gcloud compute backend-services get-health hms-staging-app-backend \
  --global --project hms-perf-lab
```

Expected healthy output is the `hms-gcp-app-1` instance on port `80`. If GCP
marks the backend unhealthy and direct VM HTTP redirects to HTTPS, redeploy with
the GCP override so Caddy mounts `ops/gcp-staging/Caddyfile`. If GCP marks the
backend healthy but public requests still fail, verify the backend service did
not drift to protocol `HTTPS` or port name `https`.
