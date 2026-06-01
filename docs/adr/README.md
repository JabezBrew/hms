# docs/adr

Status: active
Owner: Engineering Leadership
Last reviewed: 2026-06-01
Scope: accepted architecture decisions for HMS.

## Decision Map

| ADR | Decision |
| --- | --- |
| `0002-rust-v2-active-backend.md` | Rust V2 under `backend-rs/` is the active backend; Django is legacy reference. |
| `0003-gcp-staging-hetzner-rollback.md` | GCP is current staging/performance validation; Hetzner V2 is rollback/reusable Compose reference. |
| `0004-patient-chronicle-clinical-data-home.md` | Patient Chronicle is the home for patient clinical data. |

## Invariants

- ADRs capture product/architecture decisions that outlive one change.
- Do not use legacy Django or historical deploy decisions to override current
  Rust V2/GCP/Chronicle decisions.
