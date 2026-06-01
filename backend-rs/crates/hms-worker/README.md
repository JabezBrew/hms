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
- Worker logs must not contain PHI.
- Failing jobs should surface through ops/observability without exposing raw
  clinical payloads.
- Add new worker job families deliberately; do not imply external side effects
  exist here until code implements them.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-worker
```
