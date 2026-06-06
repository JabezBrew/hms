# frontend/src/components/encounters

Status: active
Owner: Frontend Care Engineering
Last reviewed: 2026-06-06
Scope: encounter detail, form, list, and workspace UI.

## Invariants

- Encounter lists should be backend-filtered and bounded.
- Encounter list tabs and type filters must be capability-scoped before
  backend requests are sent; avoid broad `All Encounters` requests when not all
  encounter-type modules are enabled.
- Encounter detail must preserve patient/facility authorization from backend
  APIs.
- Avoid logging clinical note or assessment text.
