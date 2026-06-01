# frontend/src/lib/__tests__

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: tests for frontend runtime helpers.

## Invariants

- Runtime/auth/observability tests must not store secrets or PHI.
- RUM tests should assert sanitized route/metadata behavior.
- API-client tests should preserve cancellation and error semantics.
