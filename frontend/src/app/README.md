# frontend/src/app

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: application shells, boot flow, route rendering, startup guards, and route preloading.

## Owns

| File/area | Purpose |
| --- | --- |
| `AuthenticatedApp.jsx` | main authenticated application shell. |
| `PublicAuthApp.jsx`, `PublicAuthLoader.jsx` | unauthenticated/public auth surface. |
| `PasswordChangeRequiredApp.jsx` | forced password-change shell. |
| `OpsDashboardApp.jsx` | ops dashboard shell. |
| `AppStartupServices.jsx` | startup services and app readiness behavior. |
| `RuntimeErrorGuard.jsx`, `AppFailureState.jsx` | runtime failure handling. |
| `RouteChunkWarmup.jsx`, `preloadCriticalRoute.js` | route chunk preload/warmup. |
| `routes/featureRoutes.js` | imports and composes feature route modules. |
| `routes/renderRoutes.jsx` | renders validated route metadata. |
| `routes/routeTypes.js` | route metadata schema and validation. |

## Invariants

- Feature routes must be defined through `src/features/*/routes.js` and composed
  in `routes/featureRoutes.js`.
- Route metadata carries layout, title, roles, breadcrumbs, and feature gates.
- App shell readiness should not wait for heavy route bodies when a shell can be
  safely shown first.
- Runtime errors should fail to controlled states without leaking PHI.

## Tests

- `routes/renderRoutes.test.jsx`
- `routes/routeTypes.test.jsx`
- `__tests__/RuntimeErrorGuard.test.jsx`
