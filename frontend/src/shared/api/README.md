# frontend/src/shared/api

Status: active
Owner: Frontend/Backend Integration
Last reviewed: 2026-06-01
Scope: shared API adapters that are not owned by a single product feature.

## Module Map

| File | Owns |
| --- | --- |
| `auth.js` | shared auth-facing API helpers. |
| `system.js` | deployment capability and system-status API helpers. |
| `facilities.js` | shared facility lookup helpers. |
| `omniSearch.js` | global search bridge. |
| `consent.js`, `interop.js`, `drugSafety.js`, `aiAssistant.js` | cross-feature clinical/support adapters and deferred surfaces. |
| `__tests__/` | Rust V2 bridge and deferral tests. |

## Invariants

- Prefer generated Rust V2 clients where available.
- Preserve `AbortSignal` and `AbortError`.
- Do not put PHI, raw URLs, names, MRNs, or free text in browser telemetry or
  query keys.
- Adapters should return UI-friendly shapes without making components know
  generated-client internals.
