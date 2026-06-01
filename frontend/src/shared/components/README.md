# frontend/src/shared/components

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: shared page shell and global UI providers.

## Module Map

| Path | Owns |
| --- | --- |
| `page/PageShell.jsx` | standard route page shell. |
| `page/PageHeader.jsx` | standard page header/title/action area. |
| `page/PageState.jsx` | loading, empty, and error states. |
| `omni-search/` | global Omni search provider, dialog, actions, and page index. |

## Invariants

- Feature pages should use shared page primitives instead of rebuilding page
  chrome.
- Omni search must route through scoped backend APIs and avoid logging/searching
  PHI by raw name or MRN.
- Shared components should not own domain-specific data fetching.
