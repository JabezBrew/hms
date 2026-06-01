# Frontend Architecture

Status: active
Owner: Frontend Engineering
Last reviewed: 2026-06-01
Scope: maintained React/Vite frontend structure, data flow, and performance rules.

## Core Rule

The maintained frontend is `frontend/`. Do not start a standalone rewrite or
convert the product to a new frontend stack as part of ordinary Rust V2 work.

## Feature Module Shape

Feature Modules live under:

```text
frontend/src/features/<domain>/
  api/
  hooks/
  components/
  pages/
  routes.js
  index.js optional for feature exports
```

`frontend/src/pages/*` should remain thin route wrappers when used. Product
logic belongs in feature Modules.

## Route Contract

Routes are composed from `frontend/src/app/routes/featureRoutes.js` and rendered
through `renderRoutes`.

Route entries should carry:

- `path`
- `component`
- `roles`
- `layout`
- `title`
- `breadcrumbs`
- `sidebar` when the app layout needs a specific sidebar
- `props` when the rendered component needs static props
- feature requirements where applicable

Use route validation tests to catch broken route contracts.

## Data Flow

```text
Feature page
  -> feature hook
  -> feature/shared API adapter
  -> Rust V2 generated client helper
  -> /api/v2
```

Prefer feature or shared API Modules over direct imports from
`frontend/src/lib/api.js`. Treat old compatibility APIs as adapters, not as the
place for new product rules.

## Query And Abort Contract

Interactive list pages must use server-side pagination. They must not fetch all
pages just to filter client-side.

Required behavior:

- search/filter/tab state becomes backend query params
- TanStack Query `signal` is passed through every API helper involved
- `AbortError` remains distinguishable and is not converted into a generic error
- in-flight paginated fetch chains stop immediately on unmount or navigation

## UI Placement Contract

Patient clinical data must be reachable from Patient Chronicle, not scattered
across standalone clinical pages. Clinical features should appear as Chronicle
timeline entries, panels, or slide-overs with the patient context visible.

Use the Chronicle design system for clinical surfaces:

- Fraunces for display
- DM Sans for headings
- IBM Plex Mono for data
- editorial medical journal aesthetic
- workflow-first UI with clear next actions

## Performance Contract

Assume modest client hardware by default.

Required behavior:

- defer heavy charts, calendars, and non-critical route bodies
- preload likely next-route chunks only when useful
- virtualize large lists
- avoid render-time side effects
- keep motion lightweight and honor reduced motion
- preserve route-shell-first readiness for heavy clinical routes

Use the maintained browser runtime probe when frontend-perceived performance is
part of the change:

```bash
cd frontend
node scripts/measure-runtime-perf.mjs
```

Use the current script options rather than adding local probes unless the
maintained script cannot answer the question.

## Validation

```bash
cd frontend
npm run lint
npm run test:run
npm run build
npm run api:v2:generate:check
```

For visual or interaction changes, use browser smoke evidence against the
running app and keep screenshots PHI-safe.
