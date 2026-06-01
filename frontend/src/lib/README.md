# frontend/src/lib

Status: active support library
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: frontend library helpers.

## Areas

| Path | Role |
| --- | --- |
| `api/` | compatibility API adapters and Rust V2 generated client runtime. |
| `auth/` | auth/session helper code. |
| `observability/` | browser/runtime observability helpers. |
| `__tests__/` | library-level tests. |

## Invariants

- Cross-cutting helpers belong here only when they are not owned by a feature or
  `src/shared`.
- API code must preserve cancellation, scoped query keys, and V2 contract
  behavior.
- Observability helpers must be PHI-safe.
