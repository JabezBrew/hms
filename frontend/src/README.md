# frontend/src

Status: active
Owner: Frontend Engineering
Last reviewed: 2026-06-01
Scope: maintained React/Vite application source.

## Runtime Map

| Path | Owns |
| --- | --- |
| `app/` | app shell, route registry/rendering, route preload, and startup flow. |
| `features/` | product workflow modules with pages, hooks, API adapters, and route definitions. |
| `components/` | shared product components, Patient Chronicle components, and UI primitives. |
| `shared/` | shared page shells, query-key helpers, shared API adapters, constants, and hooks. |
| `lib/` | API runtime, auth provider, runtime config, observability, websocket, and compatibility adapters. |
| `hooks/` | cross-feature/domain hooks that have not moved into feature modules. |
| `contexts/` | app-level React context providers. |
| `config/` | frontend runtime/configuration constants. |
| `assets/` | static assets imported by the app. |
| `pages/` | compatibility route pages and global denied/unavailable pages. |

## Invariants

- Product workflow logic belongs in `features/<domain>/`.
- Route metadata belongs in `app/routes/`.
- Shared primitives belong in `shared/` or `components/ui/`.
- Clinical patient data belongs in Patient Chronicle routes and panels.
- Data-fetching helpers must preserve server-side pagination, `AbortSignal`,
  `AbortError`, and PHI-safe query keys.

## Verification

Run from `frontend/`:

```bash
npm run lint
npm run test:run
npm run build
npm run api:v2:generate:check
```
