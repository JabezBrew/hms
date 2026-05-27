# HMS React Implementation Contract

## Safety

- Treat PHI as toxic. Do not log patient names, identifiers, free-text clinical notes, tokens, request bodies, or authorization context.
- Keep clinical patient data inside PatientChroniclePage surfaces unless an existing route already owns a non-clinical workflow.
- Do not use `dangerouslySetInnerHTML`, `eval`, dynamic function construction, or untrusted URL navigation without a traced, reviewed reason.
- Do not expose broad objects to the browser when a list DTO or feature-specific projection is enough.

## Data Fetching

- Prefer feature/shared API modules over `src/lib/api.js` for new work.
- Use Rust V2 bridges when `apiMode` is `rust-v2`.
- Centralize query keys in `shared/lib/queryKeys.js` or feature key modules.
- Thread TanStack Query `signal` through list API helpers.
- Preserve `AbortError`; do not wrap it as a generic failure.
- Invalidate exact query-key families after mutations. Avoid blanket invalidation unless the workflow truly changes broad state.
- Route-level list pages must use backend pagination/filter params. Do not fetch full datasets to filter, sort, or search client-side.

## Components

- Pages orchestrate route state and layout. Extract workflow sections, tables, dialogs, and action panels into focused components.
- Custom hooks own reusable state machines, data derivation, and query/mutation wiring.
- Compute derived values during render or with `useMemo` only when the work is meaningfully expensive.
- Effects synchronize with external systems. Do not simulate event handlers or derive simple state in effects.
- Define child components at module scope unless they need closure state and are deliberately not React components.
- Use stable keys from domain identifiers. Avoid array indexes except for static, never-reordered decorative lists.

## Accessibility

- Prefer semantic elements over role patches.
- Every form control needs an accessible label.
- Non-button clickable elements need keyboard support and a role, but the first choice is usually `<button>`.
- Combobox/listbox/menu controls must satisfy required ARIA props and keyboard behavior.
- Avoid `autoFocus` unless there is a documented workflow reason.

## Performance

- Defer heavy charts, calendars, drag/drop, and analytics surfaces when not first-screen critical.
- Avoid repeated `find`, `filter`, `includes`, or chained array walks in render hot paths. Precompute `Map` or `Set` where it matters.
- Keep context values and props stable when passed to broad subtrees.
- Virtualize large lists and keep page size bounded server-side.
- Do not add larger initial bundles without a clear workflow reason.
