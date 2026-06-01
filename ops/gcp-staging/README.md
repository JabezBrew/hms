# HMS GCP staging preparation

This runbook prepares a reversible move of HMS Rust V2 staging and performance
testing from the current Hetzner staging VPS to Google Cloud while the free
trial credits are available.

## Current decision

Use GCP for staging and performance testing during the free-trial window, but
keep the migration reversible until DNS, backups, smoke tests, and performance
evidence prove the GCP path is healthy.

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
- Current public URL: `https://34.35.148.55.sslip.io`
- Current compose project: `hms-gcp-perf`
- Current deployment profile: `hospital`
- Current facility code: `MAIN`
- Current image tag observed: `gcp-perf-288e273b61ac`

Load VM:

- Name: `hms-gcp-load-1`
- Zone: `africa-south1-a`
- Private IP: `10.10.0.3`
- Public IP: `34.35.189.72`
- Machine type: `e2-standard-2`
- Disk: `50G`

The app VM is intentionally oversized for a perf lab. At idle, the Docker stack
was healthy and the HMS containers were using well under the available memory.
The load VM should be stopped when not running tests.

## June 1, 2026 cutover status

`staging.thehms.systems` now points at the GCP app VM through Cloudflare and the
public Rust V2 readiness endpoint returns `200` at
`/api/v2/health/ready`.

The GCP app stack is running:

- `caddy`
- `db`
- `frontend`
- `hms-api`
- `hms-worker`
- `pgbouncer`
- `redis`

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

Hetzner source backup:

- `/opt/hms/ops/hetzner-v2/backups/staging-20260601T054922Z.dump`

GCP pre-restore backup:

- `/opt/hms/ops/hetzner-v2/backups/gcp-perf-20260601T054922Z.dump`

GCP post-auth-repair backup:

- `/opt/hms/ops/hetzner-v2/backups/gcp-staging-postrepair-20260601T065316Z.dump`

GCP disk snapshot:

- `hms-gcp-app-1-postrepair-20260601-0653`
- Source disk: `hms-gcp-app-1`
- Location: `africa-south1`
- Size observed after completion: `8.98 GB`
- Status observed: available

Restore command for a DB dump on a prepared Rust V2 host:

```bash
cd /opt/hms
RESTORE_CONFIRM=restore-staging \
  ops/hetzner-v2/restore-postgres.sh \
  ops/hetzner-v2/backups/gcp-staging-postrepair-20260601T065316Z.dump
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
   - Start with `e2-standard-2` for safety.
   - Trial `e2-medium` later only if deploy/build and smoke checks stay stable.
   - Keep Postgres, Redis, PgBouncer, Rust API, worker, frontend, and Caddy on
     the same VM using `ops/hetzner-v2/compose.yml`.

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
   - Use `ops/hetzner-v2/compose.yml` as the deployment stack.
   - Keep `ops/hetzner-client-vps/` out of the path; it is legacy Django.

3. Right-size compute
   - Initial safe target: `e2-standard-2`.
   - Possible cheaper target after proof: `e2-medium`.
   - Keep the app VM in `africa-south1-a` unless there is a specific reason to
     move regions.

4. Deploy Rust V2
   - Configure private env for the GCP staging domain and facility.
   - Run `ops/hetzner-v2/deploy.sh`.
   - Verify Docker health and private readiness before checking public DNS.
   - Verify public readiness at `/api/v2/health/ready`.

5. Cut DNS
   - Point `staging.thehms.systems` at the GCP app public IP.
   - Keep Cloudflare proxy/access policy consistent with current staging.
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

## First safe actions

These can be done before DNS cutover:

1. Stop `hms-gcp-load-1` when no test run is active.
2. Create GCP budget alerts.
3. Decide whether staging should reuse `hms-gcp-app-1` or get a clean
   `hms-gcp-staging-1` VM.
4. If reusing the current app VM, snapshot the disk before resizing.
5. Resize the app VM from `n2-standard-4` to `e2-standard-2`, then run smoke
   and perf checks.
6. Keep Hetzner live until the GCP public path is proven.
