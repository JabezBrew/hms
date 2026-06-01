# frontend/src/shared/constants

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: shared constants used across frontend features.

## Module Map

| File | Owns |
| --- | --- |
| `roles.js` | frontend role identifiers used by route metadata and UI guards. |

## Invariants

- Role constants mirror backend authorization language; they do not replace
  backend access checks.
- Adding a role or capability should include route, feature, and backend access
  review.
