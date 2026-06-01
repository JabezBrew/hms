# frontend/src/components/drug-safety

Status: active
Owner: Frontend Clinical Safety Engineering
Last reviewed: 2026-06-01
Scope: medication autocomplete and drug-safety dialog UI.

## Invariants

- Drug-safety warnings must not be bypassed by local-only UI state.
- Medication searches should use scoped API adapters and avoid logging query
  free text when it can contain clinical context.
