# frontend/src/shared

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: cross-feature shared APIs, hooks, components, constants, and utilities.

## Areas

| Path | Purpose |
| --- | --- |
| `api/` | shared API adapters such as auth, consent, facilities, interop, omni search, system. |
| `components/page/` | page shell/header/state primitives. |
| `components/omni-search/` | shared omni-search UI. |
| `hooks/` | cross-feature hooks. |
| `constants/` | shared constants. |
| `lib/` | query keys, feature gating, utility helpers, and tests. |

## Invariants

- Shared APIs must preserve `AbortSignal` and `AbortError`.
- Query key helpers must include visibility-changing scope for
  authorization-sensitive data.
- Shared components should be product-neutral and avoid embedding one feature's
  workflow assumptions.
- Do not place patient clinical data views here; Chronicle/product features own
  clinical workflow composition.
