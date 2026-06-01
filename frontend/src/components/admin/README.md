# frontend/src/components/admin

Status: active
Owner: Frontend Admin Engineering
Last reviewed: 2026-06-01
Scope: reusable admin UI components.

## Role

Contains admin-facing shared components such as audit-log tables.

## Invariants

- Admin UI must not expose secrets or PHI beyond the caller's authorized scope.
- Audit views should use backend-scoped data and avoid client-side broad fetches.
