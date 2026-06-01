# HMS V2 Production Cutover Readiness

HMS V2 production cutover uses the Rust backend in `backend-rs/`, the
maintained React/Vite frontend in `frontend/`, generated JavaScript `/api/v2`
helpers, and the current staging/performance path documented in
`ops/gcp-staging/README.md`.

The Rust V2 Compose kit in `ops/compose-v2/` remains the rollback and reusable
single-client Compose reference. Do not treat Hetzner as the current staging
authority while GCP is active.

## Required Services

- `hms-api`: Rust Axum API serving `/api/v2/*`.
- `hms-worker`: Rust worker process for background jobs and operational
  heartbeats.
- `hms-migrator`: one-shot sqlx migration and provisioning runner.
- `frontend`: Nginx-served React/Vite build from `frontend/`.
- `caddy`: public TLS edge.
- `redis`: durable Redis baseline for asynchronous/realtime infrastructure.

Current GCP staging uses Cloud SQL PostgreSQL over private IP instead of the
Compose `db` service. The Compose `db` and `pgbouncer` services are required
for the single-VM rollback shape, but they are not proof of the active
GCP staging database path.

## Cutover Gates

1. Review the current environment runbook in `ops/gcp-staging/README.md`.
2. Generate and review private runtime env from the active environment's
   approved env example.
3. Replace all `CHANGE_ME` values and keep private env mode at `0600`.
4. Validate the Compose file used by the active environment.
5. Run the active environment deploy command, including its pre-migration
   database connectivity gate.
6. Verify `/api/v2/health/ready` publicly.
7. For GCP staging, verify the redacted `HMS_DATABASE_URL` host/port inside
   `hms-api` and `hms-worker` points at Cloud SQL private IP.
8. Verify internal `/api/v2/metrics` through the private network; it must not be
   public.
9. Run or prove a successful Postgres backup.
10. Complete a restore drill before first real-client cutover.

## Deployment Proof Sequence

Run this proof from a clean, pushed branch after local backend/frontend checks
pass. Use the host, SSH path, and deploy command from the current environment
runbook. Do not paste deployment secrets into shell history or repo files.

For current staging, start with `ops/gcp-staging/README.md`. If using Hetzner as
rollback, use `ops/compose-v2/README.md` and explicitly label the run as
rollback validation.

The proof sequence is environment-independent:

1. Verify local branch and remote branch/commit.
2. Verify remote checkout branch and commit.
3. Validate Compose/env for that environment.
4. Deploy.
5. Verify public `/api/v2/health/ready`.
6. Capture container status and active image/tag/digest.
7. Capture a successful backup path.
8. Run smoke checks.
9. Run a restore drill only with explicit confirmation and a safe target.

Proof is complete only when the record contains:

- deployed Git commit and branch
- successful Compose validation
- successful pre-migration database connectivity check from the migrator
- successful environment deploy command
- public `/api/v2/health/ready` success
- `docker compose ps` showing `hms-api`, `hms-worker`, `frontend`, `caddy`,
  and `redis` healthy or running as expected. For single-VM rollback, also
  verify `db` and `pgbouncer`. For GCP staging, verify Cloud SQL is the active
  database host.
- successful Postgres backup with backup file path
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
