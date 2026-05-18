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
