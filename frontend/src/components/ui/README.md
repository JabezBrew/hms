# frontend/src/components/ui

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: shared UI primitives and performance-aware list/table components.

## Component Map

| Area | Components |
| --- | --- |
| Core controls | `button`, `input`, `textarea`, `select`, `checkbox`, `switch`, `radio-group`, `combobox`, `search-bar`. |
| Structure | `card`, `table`, `tabs`, `accordion`, `collapsible`, `resizable`, `scroll-area`, `separator`, `breadcrumb`, `sidebar`. |
| Overlays | `dialog`, `alert-dialog`, `sheet`, `popover`, `dropdown-menu`, `tooltip`, `SlideOver`. |
| Feedback | `alert`, `badge`, `progress`, `skeleton`, `loading-spinner`, `sonner`, `avatar`. |
| Date/time | `calendar`, `date-picker`, `date-range-picker`, `date-time-picker`, `time-picker`. |
| Performance | `DeferredMount`, `VirtualizedList`, `VirtualizedTable`, `VirtualizedGrid`, `virtual-list`. |
| Workflow | `workflow-steps`, `table-pagination`. |

## Invariants

- Prefer these primitives over feature-local copies.
- Large tables/lists should use virtualization or server-side pagination.
- Dialogs and slide-overs must preserve focus behavior and accessibility.
- UI primitives should not know domain data or fetch from APIs.
