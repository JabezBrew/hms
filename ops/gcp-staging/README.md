# HMS GCP staging runbook

> **Open-source note:** this runbook documents one example staging topology.
> Hostnames, IPs, project names, billing figures, backup IDs, and snapshot
> names below are **example/placeholder values**. Replace them with your own
> project inventory before use. Never commit private `.env` contents,
> credentials, patient data, or production dumps.

This runbook is the source of truth for current HMS Rust V2 staging on Google
Cloud. Hetzner remains rollback, but the staging domain should not be
reasoned about from the reusable single-VM Compose file alone.

## Current decision

Use GCP for staging and performance testing during the free-trial window, with
PostgreSQL on Cloud SQL and public traffic through the GCP global external
HTTPS Load Balancer. Keep Hetzner reversible until DNS, backups, smoke tests,
and performance evidence prove the GCP path is healthy for a rollback window.

Track billing in the cloud console (budget, remaining credits, expiry, monthly
usage, top cost drivers) and review before credits run low — do not paste
live billing figures into this file.

## Example GCP lab inventory

> Placeholder inventory — replace every value with your own before deploying.

Project:

- `<gcp-project-id>` (example)

App VM:

- Name: `<app-vm-name>`
- Zone: `<region-zone>` (example: `africa-south1-a`)
- Private IP: `<app-vm-private-ip>` (RFC 1918 example range, e.g. `10.x.x.x`)
- Public IP: `<app-vm-public-ip>` (do not publish live IPs; use DNS)
- Machine type: `<machine-type>` (example: `n2-standard-4` for a perf lab)
- Disk: `<disk-size>` (example: `100G`)
- Current public URL: `https://<staging-domain>`
- Current compose project: `<compose-project>`
- Current deployment profile: `hospital`
- Current facility code: `<facility-code>`
- Current image tag observed: `<image-tag>`

Public edge:

- DNS: `<staging-domain>`
- Cloudflare state: DNS-only to the GCP load balancer.
- GCP global address: `<lb-name>` / `<lb-ip-placeholder>`
- HTTPS forwarding rule: `<https-fr-name>`
- Target proxy: `<https-proxy-name>`
- URL map: `<url-map-name>`
- App backend: `<app-backend-name>`, forwarding HTTP to Caddy on named
  port `http:80`.
- App backend health check: `<health-check-name>`, HTTP
  `/api/v2/health/ready` with host `<staging-domain>`.
- App VM web firewall: allow only GCP GFE/health-check ranges
  `35.191.0.0/16` and `130.211.0.0/22` to TCP port `80`; public clients should
  reach the VM only through the HTTPS load balancer.
- Static backend: `<static-backend-name>` with CDN enabled for
  `/assets/*` only.
- Managed certificate: `<managed-cert-name>`

Database:

- Cloud SQL instance: `<cloudsql-instance>`
- PostgreSQL major version: `16`
- Region: `<region>` (example: `africa-south1`)
- Private IP: `<cloudsql-private-ip>` (RFC 1918 example range)
- Availability: regional HA
- Automated backups: enabled
- Point-in-time recovery: enabled
- Deletion protection: enabled

Load VM:

- Name: `<load-vm-name>`
- Zone: `<region-zone>`
- Private IP: `<load-vm-private-ip>` (RFC 1918 example range)
- Public IP: `<load-vm-public-ip>` (do not publish live IPs; use DNS)
- Machine type: `<machine-type>` (example: `e2-standard-2`)
- Disk: `<disk-size>` (example: `50G`)

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

Expected redacted runtime proof (example addresses — yours will differ):

```text
HMS_DATABASE_URL host=<cloudsql-private-ip> port=5432
```

Use the root deploy front door for normal GCP staging deploys from this laptop:

```bash
./deploy staging
```

That command archives the committed checkout, uploads it to the app VM,
preserves the private env file on the VM, deploys from `/opt/hms`, and runs the
GCP edge verifier from the operator machine. The archive is streamed over SSH
instead of `gcloud compute scp`, and the wrapper verifies the remote byte count
before it starts the VM-side install. Each run gets a unique remote temp
directory and log, and the VM-side install uses `/tmp/hms-deploy.lock` so a
second deploy cannot race an active one. The install runs detached and the
wrapper polls `/tmp/hms-deploy-<run-id>.log` plus the remote PID for a final
`REMOTE_INSTALL_EXIT_STATUS` marker, so a long build, SSH session reset, or
dead remote runner does not require remembering a second deploy command. By
default it refuses dirty working trees so uncommitted local changes do not
accidentally get mistaken for a staging release. If the intended release really
is the last commit, `./deploy staging --ignore-dirty` prints the dirty file
count summary, announces the committed SHA being deployed, validates the
committed migration snapshot, and uploads the archive installer from the same
commit object.
It still deploys only the committed checkout, and it refuses the override when
the deploy control scripts themselves are dirty because local deploy machinery
would no longer match the committed release path. The full dirty path list is
omitted from deploy logs; run `git status --short` locally if you need it. The
wrapper also verifies Cloud SQL backups, PITR, and deletion
protection through GCP before allowing
migrations. The backup gate also verifies that the Cloud SQL instance private
IP matches the expected deployment database host and that there is a recent
successful backup run. The default freshness window is 36 hours and can be
adjusted with
`GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS`.

The remote deploy poll defaults to a 15-second interval and a 40-minute timeout.
Override with `GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS` or
`GCP_REMOTE_DEPLOY_TIMEOUT_SECONDS` only for unusual incident work. If the
timeout window elapses while the remote installer PID is still alive, the
wrapper keeps waiting instead of returning an ambiguous failure while staging
may still be changing. It refuses to wait forever after three live-PID timeout
windows by default; override `GCP_REMOTE_DEPLOY_MAX_ALIVE_TIMEOUTS` only during
incident work. SSH uses bounded connect and keepalive settings; override
`GCP_SSH_COMMAND_TIMEOUT_SECONDS`, `GCP_SSH_CONNECT_TIMEOUT_SECONDS`,
`GCP_SSH_ALIVE_INTERVAL_SECONDS`, or `GCP_SSH_ALIVE_COUNT_MAX` only when
debugging the IAP path itself.

When already SSH'd into `/opt/hms` on the VM, use:

```bash
./deploy --in-place
```

The in-place path is deliberately VM-only. If `gcloud` is unavailable on the VM,
use the laptop `./deploy staging` path, or pass `--assume-managed-backup` only
after manually confirming Cloud SQL backups/PITR for that deploy.

For a quick edge-only check from this laptop, use:

```bash
./deploy verify
```

GCP deploys require the public edge readiness check by default
(`PUBLIC_HEALTHCHECK_MODE=required`) and then run
`ops/gcp-staging/verify-edge.sh` when `gcloud` is available. Use
`GCP_EDGE_VERIFY=required` from an operator machine when the VM does not have
`gcloud`; use `GCP_EDGE_VERIFY=skip` only for a documented incident workaround.

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
database host against `GCP_CLOUDSQL_HOST` (your Cloud SQL private IP).

The lower-level Compose deploy also validates that every SQL migration version
prefix under `backend-rs/migrations/` is unique before it builds images or runs
`hms-migrator`. If an archive deploy fails after schema history has moved
forward, `ops/gcp-staging/install-archive.sh` restores the previous tree and
uses the rollback-only `--skip-migrations` path so runtime recreation does not
fail because the old code lacks newly applied migration files. If the restored
tree predates that flag, the archive installer rebuilds and restarts the
restored runtime services directly without invoking `hms-migrator`, then waits
for Redis, API, worker, frontend, and Caddy health. Manual use of
`--skip-migrations` is refused unless
`HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED=true` is set for this recovery path.

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

> Keep live backup IDs, snapshot names, and dump paths out of the repo.
> Record them in your private ops log; the shapes below are placeholders.

Current Cloud SQL protection:

- Automated backups: enabled.
- Point-in-time recovery: enabled.
- Deletion protection: enabled.
- On-demand Cloud SQL backup observed after the restore drill:
  `<backup-id>`.
- Restore drill to a temporary Cloud SQL instance completed successfully; the
  temporary restore instance was deleted after validation.

The following Docker dump and disk artifacts are rollback anchors from the
GCP migration and Hetzner fallback path. They are not proof that current GCP
staging uses Docker Postgres.

Hetzner source backup:

- `<backups-dir>/staging-<timestamp>.dump`

GCP pre-restore backup:

- `<backups-dir>/gcp-perf-<timestamp>.dump`

GCP post-auth-repair backup:

- `<backups-dir>/gcp-staging-postrepair-<timestamp>.dump`

GCP disk snapshot:

- `<snapshot-name>`
- Source disk: `<app-vm-disk>`
- Location: `<region>`
- Size observed after completion: `<size>`
- Status observed: available

Rollback restore command for a DB dump on a prepared single-VM Rust V2 host:

```bash
cd /opt/hms
RESTORE_CONFIRM=restore-staging \
  ops/compose-v2/restore-postgres.sh \
  <backups-dir>/<backup-file>.dump
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

This historical direct-origin result predates the current origin-lockdown
firewall. For new validation, bypass Cloudflare by targeting the GCP load
balancer with DNS-only `staging.thehms.systems`, not by calling the VM public IP
directly. Direct VM public-origin HTTP should time out by design.
- patient list p99: about `221 ms`

App-local timing from the GCP VM through local Caddy:

- login: about `34 ms`
- auth/me: about `5 ms`
- admin dashboard capacity: about `5 ms`
- patient list: about `5 ms`

The post-repair evidence shows auth/session state is healthy. The remaining
public-path tail latency is network/edge distance, not local app execution.

## Current cost guardrails

> Example values — set your own budget and thresholds in the cloud console.

The billing budget is scoped to the staging project.

- Budget amount: `<budget-amount>` (example: `$250`)
- Alert thresholds: `<t1>`, `<t2>`, `100%` (example: `20%`, `60%`, `100%`)
- Email alerts to billing admins and users: enabled

Operational cost rule:

- Keep the app VM running for staging.
- Keep the load VM stopped unless actively running tests.
- Review remaining credits before they drop below your review threshold or
  well before expiry, whichever comes first.

## Target operating model

Use three modes rather than one always-on expensive shape:

1. Staging mode
   - One always-on app VM.
   - Keep Rust API, worker, frontend, Caddy, and Redis on the VM.
   - Keep PostgreSQL on Cloud SQL over private IP.
   - Deploy from this laptop with `./deploy staging`; deploy in-place on the VM
     with `./deploy --in-place`.
   - Keep Docker Postgres/PgBouncer stopped unless explicitly validating the
     Hetzner-style rollback shape.

2. Load-test mode
   - Keep the load VM stopped by default.
   - Start it only for regression runs and frontend runtime probes.
   - Stop it again immediately after evidence is captured.

3. Perf-campaign mode
   - Temporarily resize or recreate app capacity only when a campaign needs a
     stronger origin.
   - Record machine type, region, commit, and run profile in the evidence.

## Cost guardrails

Before canceling Hetzner staging:

- Create budget alerts (example: 20% / 60% / 100% of your budget).
- Add a manual review threshold when remaining credits fall below your floor.
- Label resources with at least:
  - `app=hms`
  - `env=staging`
  - `purpose=staging` or `purpose=load-test`
- Stop the load VM outside test windows.
- Keep disks and snapshots named clearly so orphaned resources are obvious.
- Review credits well before expiry, so there is time to move back to
  Hetzner before credits run out.

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
   - Decide whether to reuse the existing app VM or create a new staging VM.
   - Prefer reusing only if the perf lab can tolerate staging naming and DNS.
   - For a cleaner setup, create a new VM (example: `hms-gcp-staging-1`).
   - Use `./deploy staging` as the normal deployment entry point.
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
   - Run `./deploy staging` from this laptop or `./deploy --in-place` when
     already on the VM in `/opt/hms`. The laptop path verifies Cloud SQL
     backups/PITR before migrations.
   - Verify Docker health and private readiness before checking public DNS.
   - Verify public readiness at `/api/v2/health/ready`.

5. Cut DNS
   - Point `staging.thehms.systems` at the GCP load-balancer IP.
   - Confirm the app backend uses protocol `HTTP`, port name `http`,
     and the HTTP readiness health check; Caddy behind the LB should
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

1. Stop the load VM when no test run is active.
2. Keep Docker `db` and `pgbouncer` stopped on GCP staging unless explicitly
   validating the Hetzner-style rollback shape.
3. Compare Cloudflare proxied versus DNS-only timing before changing the final
   edge path.
4. After the GCP path is stable, consider resizing the app VM down from
   the larger perf-lab size; run smoke and perf checks before keeping a smaller size.
5. Keep Hetzner live until the GCP public path, Cloud SQL backup/restore path,
   and rollback assumptions are proven through the agreed window.

## Public 503 triage

If the browser shows `no healthy upstream` or `remote connection failure` from
Google:

```bash
gcloud compute backend-services get-health <app-backend-name> \
  --global --project <gcp-project-id>
```

Expected healthy output is the app VM instance on port `80`. If GCP
marks the backend unhealthy and direct VM HTTP redirects to HTTPS, redeploy with
the GCP override so Caddy mounts `ops/gcp-staging/Caddyfile`. If GCP marks the
backend healthy but public requests still fail, verify the backend service did
not drift to protocol `HTTPS` or port name `https`.
