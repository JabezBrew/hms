# frontend/src/components/readonly

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: read-only state UI.

## Invariants

- Read-only banners should make write restrictions visible.
- UI read-only state must not be treated as a backend permission control.
- The notice sits inside the authenticated layout flow and offers credential
  confirmation when the server requires it. Unknown/unconfigured origins are
  described truthfully rather than labelled as verified offsite connections.
