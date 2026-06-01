# frontend/tests

Status: active
Owner: Frontend QA
Last reviewed: 2026-06-01
Scope: frontend test setup, mocks, and utilities.

## Map

| Path | Role |
| --- | --- |
| `setup.js` | Vitest/test environment setup. |
| `mocks/handlers.js` | MSW request handlers. |
| `mocks/server.js` | MSW server setup. |
| `utils/test-utils.jsx` | render/test helpers. |

## Invariants

- Test fixtures must be synthetic and PHI-safe.
- Mock handlers should preserve Rust V2 envelope/error behavior when testing V2
  paths.
- Avoid broad mocks that hide missing access or pagination behavior.
