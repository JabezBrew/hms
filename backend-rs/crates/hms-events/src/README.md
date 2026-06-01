# hms-events/src

Status: active
Owner: Backend/Worker Engineering
Last reviewed: 2026-06-01
Scope: domain event and job payload contracts.

## Module Map

| File | Owns |
| --- | --- |
| `lib.rs` | public event/job contracts. |

## Invariants

- Event payloads must be safe to persist and retry.
- Do not put unnecessary PHI in job/event payloads.
- Payload changes should be coordinated with `hms-worker` and repository tests.
