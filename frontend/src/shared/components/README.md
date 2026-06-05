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
| `charts/HmsEChart.jsx` | shared ECharts wrapper and HMS chart interaction defaults. |
| `omni-search/` | global Omni search provider, dialog, actions, and page index. |

## Invariants

- Feature pages should use shared page primitives instead of rebuilding page
  chrome.
- Omni search must route through scoped backend APIs and avoid logging/searching
  PHI by raw name or MRN.
- Omni search may keep the active draft query in memory for short session
  resume, but must not persist patient search drafts to browser storage and
  must clear drafts when user, role, or facility scope changes.
- Patient search duplicates should be presented as a single identity notice per
  result group; rows should emphasize MRN, DOB, sex, status, and location for
  disambiguation.
- Shared components should not own domain-specific data fetching.
- HMS ECharts surfaces should use `charts/HmsEChart.jsx`; its shared option
  normalizer keeps hover, blur, and select states from hiding rendered data.
