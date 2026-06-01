# frontend/src/shared/lib

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: shared frontend utilities for access, features, query keys, invalidation, and Omni search keys.

## Module Map

| File | Owns |
| --- | --- |
| `access.js` | frontend access helper utilities for UI gating. |
| `features.js` | feature/capability helpers. |
| `queryKeys.js`, `privateQueryKey.js`, `omniSearchKeys.js` | shared query-key factories. |
| `queryInvalidation.js` | invalidation helpers. |
| `__tests__/` | utility contract coverage. |

## Invariants

- Frontend access helpers are UI affordances only; backend access remains
  authoritative.
- Authorization-sensitive query keys must include opaque/sanitized scope values
  that change visibility.
- Do not place MRNs, names, raw URLs, or free-text clinical values in query keys.
