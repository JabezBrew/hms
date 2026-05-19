# HMS V2 Production Cutover Readiness

HMS V2 production cutover uses the Rust backend in `backend-rs/`, the
maintained React/Vite frontend in `frontend/`, generated JavaScript `/api/v2`
helpers, and the Hetzner kit in `ops/hetzner-v2/`.

## Required Services

- `hms-api`: Rust Axum API serving `/api/v2/*`.
- `hms-worker`: Rust worker process for background jobs and operational
  heartbeats.
- `hms-migrator`: one-shot sqlx migration and provisioning runner.
- `frontend`: Nginx-served React/Vite build from `frontend/`.
- `caddy`: public TLS edge.
- `db`: Postgres with checksums.
- `pgbouncer`: transaction-pool Postgres ingress for runtime services.
- `redis`: durable Redis baseline for asynchronous/realtime infrastructure.

## Cutover Gates

1. Generate and review `ops/hetzner-v2/.env` from `env.example`.
2. Replace all `CHANGE_ME` values and keep the file mode at `0600`.
3. Validate Compose with `docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml config -q`.
4. Run `ops/hetzner-v2/deploy.sh`.
5. Verify `/api/v2/health/ready` publicly.
6. Verify internal `/api/v2/metrics` through the private Docker network; it is blocked by Caddy publicly.
7. Run a successful `ops/hetzner-v2/backup-postgres.sh`.
8. Complete a restore drill with `ops/hetzner-v2/restore-postgres.sh` before first real-client cutover.

## Deployment Proof Sequence

Run this proof from a clean, pushed branch after local backend/frontend checks
pass. The laptop should only use the SSH aliases documented in `AGENTS.md`;
do not paste deployment secrets into shell history or repo files.

From the laptop:

```bash
git status --branch --short
git push
ssh -o BatchMode=yes hms-staging 'cd /opt/hms && git status --branch --short'
ssh hms-staging 'cd /opt/hms && git fetch origin && git checkout rust-v2-integration && git pull --ff-only'
ssh hms-staging 'cd /opt/hms && docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml config -q'
```

Deploy the V2 stack from `/opt/hms`:

```bash
ssh hms-staging 'cd /opt/hms && ops/hetzner-v2/deploy.sh'
curl -i https://staging.thehms.systems/api/v2/health/ready
```

Capture container status and the Rust API image digest after the deploy:

```bash
ssh hms-staging 'cd /opt/hms && docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml ps'
ssh hms-staging 'cd /opt/hms && docker compose --env-file ops/hetzner-v2/.env -f ops/hetzner-v2/compose.yml images hms-api'
```

Run the backup gate and record the produced dump path:

```bash
ssh hms-staging 'cd /opt/hms && ops/hetzner-v2/backup-postgres.sh'
ssh hms-staging 'cd /opt/hms && ls -1t ops/hetzner-v2/backups/*.dump | head -1'
```

Restore drills are destructive. Do not run a restore against a live client
database unless the service window and rollback owner are explicit. For staging,
restore the latest staging backup with the required confirmation token and then
rerun health and smoke checks:

```bash
ssh hms-staging 'cd /opt/hms && client_slug="$(awk -F= '\''$1=="CLIENT_SLUG"{gsub(/^["'\'']|["'\'']$/,"",$2); print $2; exit}'\'' ops/hetzner-v2/.env)" && latest="$(ls -1t ops/hetzner-v2/backups/*.dump | head -1)" && RESTORE_CONFIRM="restore-${client_slug:-hms-v2}" ops/hetzner-v2/restore-postgres.sh "$latest"'
curl -i https://staging.thehms.systems/api/v2/health/ready
```

Proof is complete only when the record contains:

- deployed Git commit and branch
- successful Compose validation
- successful `ops/hetzner-v2/deploy.sh`
- public `/api/v2/health/ready` success
- `docker compose ps` showing `hms-api`, `hms-worker`, `frontend`, `caddy`,
  `db`, `pgbouncer`, and `redis` healthy or running as expected
- successful `ops/hetzner-v2/backup-postgres.sh` with backup file path
- staging restore drill completion and post-restore readiness check

## Contract Boundary

The production V2 path must not call Django endpoints or preserve Django auth,
session, admin, or old data shapes. Frontend route-level list fetching must
continue to use generated `/api/v2` clients, bounded cursor pagination, and
AbortSignal-aware calls.

## Removed From First Cutover

- No standalone `frontend-v2` TypeScript application. `frontend/` remains the
  product UI runtime.
- No FHIR endpoints, record export bundles, consent access tokens, or
  cross-facility record exchange.
- No AI/copilot workflows.
- No onboarding runtime.

FHIR/export/cross-facility work must not be added to the cutover path until a
later approved spec defines recipient identity, consent linkage, minimum export
payloads, retention/expiry, revocation behavior, audit review, alerting, and
breach-response ownership.

## Future Stub Boundary

These areas are named only to keep fail-closed product boundaries visible. Do
not add routes, generated clients, or deployment checklist items until a
separate approved spec exists.

- FHIR interoperability: resource subset, trust model, validation, async sync,
  conflict handling, PHI minimization, retries, and audit review.
- Export bundles: recipient identity, consent linkage, payload minimums,
  expiry, revocation, approvals, download controls, and breach ownership.
- Cross-facility exchange: facility trust, patient matching, grant lifecycle,
  emergency exceptions, routing, revocation, and audit escalation.
- AI/copilot: provider, data residency, retention, clinical review, liability,
  safety controls, and cost ceilings.
- Onboarding runtime: tenant bootstrap authority, first-admin proofing, seed
  data limits, billing handoff, rollback, and deprovisioning.
