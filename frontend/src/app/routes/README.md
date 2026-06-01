# frontend/src/app/routes

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: route registry, route rendering, and route contract tests.

## Module Map

| File | Owns |
| --- | --- |
| `featureRoutes.js` | product route registry: path, component, roles, layout, title, breadcrumbs, sidebar, and props. |
| `renderRoutes.jsx` | route rendering and layout/guard composition. |
| `routeTypes.js` | route validation helpers and route shape definitions. |
| `*.test.*` | route contract coverage. |

## Invariants

- Route entries must use `component`, not ad-hoc element construction.
- Product pages should come from `features/<domain>/pages`.
- Feature and role gates belong in route metadata or backend capability checks,
  not scattered through page bodies.
- Breadcrumb/title metadata should stay route-owned unless it is dynamic and
  page-specific.

## Verification

Run from `frontend/`:

```bash
npm run test -- routeTypes renderRoutes
```
