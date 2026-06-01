# frontend/src/components/nursing

Status: active
Owner: Frontend Nursing Engineering
Last reviewed: 2026-06-01
Scope: vitals, medication administration, treatment sheet, monitoring, trends, and alerts UI.

## Invariants

- Nursing clinical data belongs in Patient Chronicle or authorized ward/nursing
  contexts.
- Vitals, medication, and treatment text must not be logged.
- Long task/monitoring lists should be backend-filtered and bounded.
