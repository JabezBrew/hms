# frontend/src/hooks/__tests__

Status: active
Owner: Frontend Platform/Product Engineering
Last reviewed: 2026-06-01
Scope: cross-feature hook tests.

## Invariants

- Query tests must preserve `AbortSignal`, `AbortError`, and scoped query keys.
- Fixtures must be synthetic and PHI-safe.
- Invalidation tests should include facility/user/profile scope when relevant.
