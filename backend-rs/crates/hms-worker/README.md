# hms-worker

Status: active
Owner: Backend/Operations Engineering
Last reviewed: 2026-06-01
Scope: background worker runtime.

## Purpose

`hms-worker` is the current Rust worker runtime. Today it polls and processes
dashboard projection refresh jobs from the database, exposes worker health and
metrics, and keeps dashboard projection refresh work out of the HTTP request
path.

## Entrypoint And Loop

| File/function | Role |
| --- | --- |
| `src/main.rs` | worker binary bootstrap, DB pool setup, polling loop, metrics server. |
| `process_dashboard_projection_jobs` | locks dashboard projection jobs, refreshes projections, marks jobs complete/failed. |
| `refresh_worker_metrics` | emits worker/database/job metrics. |
| `spawn_metrics_server` | serves worker health and metrics endpoints. |

## Dependencies

- `hms-db` for database connection and dashboard projection job operations.
- `hms-observability` for logging/tracing setup.
- Runtime env:
  - `HMS_DATABASE_URL`
  - `HMS_WORKER_DATABASE_MAX_CONNECTIONS`
  - `HMS_WORKER_POLL_INTERVAL_SECONDS`
  - `HMS_WORKER_JOB_BATCH_SIZE`
  - `HMS_WORKER_METRICS_LISTEN_ADDR`

## Invariants

- Dashboard projection jobs must be safe to retry through DB job state.
- Claims use a 120-second lease. Abandoned claims are recovered by the next
  worker poll, and a job is retired after three attempts. Completion and failure
  are fenced to the current worker, attempt, and unexpired lease.
- Projection refreshes time out after 60 seconds, before their claim expires.
  Refresh transactions also set PostgreSQL statement, lock, and idle transaction
  timeouts to 25, 3, and 30 seconds respectively. These are local transaction
  settings, so a dropped client future cannot leave unbounded database work and
  other pooled operations keep their own timeout policy. Metrics aggregate
  without holding a job-row lock; final snapshot persistence locks and validates
  the current claim, then persists and completes atomically.
  Failed refreshes retry after 30 seconds. Malformed payloads are retired with a
  fixed diagnostic code so they cannot block later work in the same batch.
- Worker logs must not contain PHI.
- Failing jobs should surface through ops/observability without exposing raw
  clinical payloads.
- Persisted job failures and processing logs use fixed codes/classes. Never
  persist or log arbitrary SQL, payload, serde, or error-chain text.
- Each poll also performs best-effort bounded cleanup of authentication grants,
  ceremony challenges and issue budgets expired for more than a day. Child-first
  `SKIP LOCKED` batches and local database timeouts limit work; credentials,
  sessions, audit and reviewed operator evidence are retained. See
  `docs/v2/2026-10-17-session-factor-assurance-scope.md` at the repository root.
- Add new worker job families deliberately; do not imply external side effects
  exist here until code implements them.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-worker
```
