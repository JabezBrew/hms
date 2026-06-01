# HMS Frontend

Status: active
Owner: Frontend Engineering
Last reviewed: 2026-06-01
Scope: React/Vite frontend under `frontend/`.

## Purpose

`frontend/` is the active HMS user interface. It renders the clinical and
operational workflows against the Rust V2 `/api/v2` backend through generated
client helpers and feature API adapters.

## Runtime Stack

- React 18
- Vite
- React Router
- TanStack Query
- Tailwind CSS
- React Hook Form
- Zod
- lucide-react
- sonner
- Playwright/Vitest for tests

## Source Map

| Path | Owns |
| --- | --- |
| `src/App.jsx` | top-level app entry. |
| `src/app/` | app shells, auth/public boot flow, route chunk warmup, runtime failure states. |
| `src/app/routes/` | route metadata, validation, and rendering. |
| `src/features/` | domain feature modules and route exports. |
| `src/components/` | shared product components, Chronicle components, and UI primitives. |
| `src/shared/` | shared API adapters, query keys, hooks, page shell components, constants, utilities. |
| `src/lib/api/` | compatibility API modules and Rust V2 generated client runtime. |
| `src/hooks/` | cross-feature data hooks and websocket hooks. |
| `src/pages/` | thin legacy route wrappers where still present. |
| `src/contexts/` | read-only, view-mode, and workflow contexts. |
| `scripts/` | generated client, bundle budget, runtime perf, and quality scripts. |
| `e2e/` | Playwright end-to-end tests. |
| `tests/` | frontend test support. |
| `public/runtime-config.js` | runtime config served with frontend assets. |

## Feature Modules

Feature documentation starts at [`src/features/README.md`](src/features/README.md).

Feature code should keep this shape:

```text
src/features/<domain>/
  api/
  hooks/
  components/
  pages/
  routes.js
  index.js optional for feature exports
```

`src/pages/*` should stay as thin compatibility wrappers when still used.

## Data Flow

```text
Route -> feature page -> feature hook -> feature/shared API adapter
      -> src/lib/api/v2 generated client -> /api/v2
```

The UI should not hand-code Rust V2 response shapes that already exist in the
generated client. Feature adapters translate backend envelopes into UI-facing
objects.

## Safety And Performance Rules

- Patient clinical data belongs in Patient Chronicle or panels launched from it.
- List/search pages must use backend pagination and pass `AbortSignal`.
- Authorization-sensitive query keys include facility/user/profile/feature/
  permission-version scope and query parameters.
- Preserve `AbortError`; do not convert cancelled list requests into generic
  errors.
- Keep PHI out of browser events, query keys, route labels, local storage, and
  screenshots.
- Defer heavy widgets and keep route shells responsive on modest hardware.

## Commands

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Validation:

```bash
npm run lint
npm run test:run
npm run api:v2:generate:check
npm run build
npm run perf:bundle-budget
```
