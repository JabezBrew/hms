# hms-worker/src

Status: active
Owner: Backend/Operations Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 background worker source.

## Module Map

| File | Owns |
| --- | --- |
| `main.rs` | worker bootstrap, DB pool setup, dashboard projection polling, health, and metrics server. |

## Invariants

- Jobs must be retry-safe and state-backed.
- Worker logs and metrics must be PHI-safe.
- New external side effects should be introduced deliberately with job
  contracts and tests.
