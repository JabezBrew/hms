# frontend/src/contexts

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: shared React context providers.

## Contexts

| File | Role |
| --- | --- |
| `ReadOnlyModeContext.jsx` | read-only mode state shared across UI surfaces. |
| `ViewModeContext.jsx` | view-mode state. |
| `WorkflowContext.jsx` | workflow state shared by guided workflow components. |

## Invariants

- Contexts should not become hidden data-fetching layers.
- Do not store PHI or secrets in durable browser storage through these contexts.
- Prefer feature-local state unless multiple areas genuinely share the same
  product state.
