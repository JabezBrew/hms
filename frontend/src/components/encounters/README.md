# frontend/src/components/encounters

Status: active
Owner: Frontend Care Engineering
Last reviewed: 2026-06-01
Scope: encounter detail, form, list, and workspace UI.

## Invariants

- Encounter lists should be backend-filtered and bounded.
- Encounter detail must preserve patient/facility authorization from backend
  APIs.
- Avoid logging clinical note or assessment text.
