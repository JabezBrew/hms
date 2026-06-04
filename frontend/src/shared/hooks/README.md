# frontend/src/shared/hooks

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: shared UI, page metadata, search, visibility, and first-paint hooks.

## Module Map

| File | Owns |
| --- | --- |
| `usePageMeta.jsx` | page title and breadcrumb metadata. |
| `useAfterInitialPaint.js` | route-shell-first deferral helper. |
| `usePageVisibility.js` | browser visibility state. |
| `useListFilters.js` | shared list filter state helpers. |
| `useUrlEnumParam.js` | URL-backed enum state for refresh-stable tabs and selectors. |
| `useOmniSearchResults.js`, `useOmniIntentPreview.js` | Omni search query and preview behavior. |
| `__tests__/` | shared hook coverage. |

## Invariants

- Hooks that influence data fetching must preserve cancellation.
- URL-backed state must use safe enum or opaque values only; never store PHI,
  MRNs, names, accessions, raw URLs, or clinical free text in query params.
- First-paint deferral should improve perceived performance without hiding
  access-denied or critical safety states.
- Page metadata must not include PHI.
