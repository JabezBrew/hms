# frontend/src/components/visits

Status: active
Owner: Frontend Care/Triage Engineering
Last reviewed: 2026-06-01
Scope: visit status, waiting-room queue, triage assignment, and checkout UI.

## Invariants

- Queue views should be backend-filtered and bounded.
- Patient names/identifiers must not enter logs or telemetry.
- Checkout/triage transitions must rely on backend validation.
