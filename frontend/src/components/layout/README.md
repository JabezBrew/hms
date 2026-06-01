# frontend/src/components/layout

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: app layout, sidebar, breadcrumbs, notifications, facility switcher, and Omni bar.

## Invariants

- Layout components should not fetch product data directly when feature hooks
  own it.
- Facility switching must invalidate or rescope authorization-sensitive queries.
- Navigation labels must not include PHI.
