# frontend/src/components/patient

Status: active
Owner: Frontend Patient Engineering
Last reviewed: 2026-06-01
Scope: shared single-patient header components.

## Invariants

- Patient identifiers and names are PHI; do not place them in logs, query keys,
  or browser event names.
- Clinical actions should route back through Patient Chronicle.
