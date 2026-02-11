# HMS Frontend Deep Dive

This document describes the current frontend implementation in `/Users/jebre/Desktop/hms/frontend`.

It is based on source inspection of the active React codebase.

## 1. Runtime Stack

Core stack:

- React 18
- Vite 6
- React Router
- TanStack Query
- Tailwind CSS + Radix UI primitives
- Vitest + Testing Library

Primary entry files:

- `/Users/jebre/Desktop/hms/frontend/src/main.jsx`
- `/Users/jebre/Desktop/hms/frontend/src/App.jsx`
- `/Users/jebre/Desktop/hms/frontend/src/app/AuthenticatedApp.jsx`
- `/Users/jebre/Desktop/hms/frontend/src/app/PublicAuthApp.jsx`

## 2. App Boot and Provider Composition

`App.jsx` composes providers in this order:

1. `QueryClientProvider`
2. `ThemeProvider`
3. `HelmetProvider`
4. `AuthProvider`
5. `BrowserRouter`
6. `BreadcrumbProvider`
7. `ViewModeProvider`
8. `WorkflowProvider`

Boot behavior:

- Auth bootstraps user/session from storage.
- App chooses between public auth routes and authenticated app shell.
- Lazy loaded auth/public route trees reduce initial startup work.

## 3. Route Architecture and Authorization

### 3.1 Route composition

All feature route definitions are merged by:

- `/Users/jebre/Desktop/hms/frontend/src/app/routes/featureRoutes.js`

Routes are rendered by:

- `/Users/jebre/Desktop/hms/frontend/src/app/routes/renderRoutes.jsx`

Layout strategy:

- `ROUTE_LAYOUTS.APP` -> wrapped in shared `Layout`
- `ROUTE_LAYOUTS.BARE` -> raw page surface

### 3.2 Role gate model

`RoleBasedRoute` enforces:

- authenticated user required
- `allowedRoles` array match against `user.role`

Role constants/groups live in:

- `/Users/jebre/Desktop/hms/frontend/src/shared/constants/roles.js`

### 3.3 Feature route groups (current)

Route groups include:

- appointments
- patients
- encounters
- wards
- admissions
- inventory
- billing
- laboratory
- pharmacy
- nursing
- dashboards
- admin
- settings
- charts
- clinics
- triage
- referrals
- inbox
- staff
- workflows
- clinical-notes

Public auth routes:

- `/login`
- `/reset-password`
- `/reset-password/confirm`

## 4. Feature Module Shape

Feature code lives in:

- `/Users/jebre/Desktop/hms/frontend/src/features/<feature>/`

Typical folders:

- `pages/`
- `api/`
- `hooks/`
- `components/`
- `routes.js`

Current-state note:

- Many feature `api/index.js` files are thin re-exports over legacy central APIs in `/src/lib/api/*`.
- Some features do not yet have a local `api/` implementation and still rely entirely on central lib API modules.

## 5. Data Layer

## 5.1 API client

Core API transport is in:

- `/Users/jebre/Desktop/hms/frontend/src/lib/api-client.js`

Key behavior:

- base URL resolution from `VITE_API_BASE_URL`, with dev `/api` proxy fallback
- automatic JWT attachment
- facility header attachment (`X-Facility-Code`)
- proactive token refresh for near-expiry access tokens
- centralized refresh deduplication (single-flight)
- retry path for 401 via refresh + replay
- typed helpers for paginated and blob responses

## 5.2 Auth context

Auth state logic is in:

- `/Users/jebre/Desktop/hms/frontend/src/lib/auth.jsx`

Important behaviors:

- access token is held in memory
- refresh token is cookie-driven
- session metadata persisted for absolute timeout checks
- facility switch clears query cache to prevent cross-scope stale data
- MFA enrollment/challenge state is supported in the login path

## 5.3 Query caching

QueryClient defaults (`/src/lib/react-query.js`):

- `staleTime`: 5 minutes
- `gcTime`: 30 minutes
- retry: 1
- no refetch-on-window-focus by default

Query key utilities:

- `/Users/jebre/Desktop/hms/frontend/src/shared/lib/queryKeys.js`

## 6. Realtime Layer

Client websocket implementation:

- `/Users/jebre/Desktop/hms/frontend/src/lib/websocket.js`

Key capabilities:

- WS base URL resolution from `VITE_WS_URL` / API base / env fallback
- preferred JWT auth via websocket subprotocols (`hms.jwt`, token)
- optional query token fallback
- auto reconnect with backoff
- ping/pong keepalive

Supported client classes:

- `AlertWebSocket`
- `VitalsWebSocket`
- `NotificationWebSocket`
- dashboard websocket clients (`Admin`, `Doctor`, `Clinic`, `Nurse`, `Inpatient`, `Reception`)

React hooks around websocket clients:

- `/Users/jebre/Desktop/hms/frontend/src/hooks/useWebSocket.js`
- dashboard-specific hooks under `/src/features/dashboards/hooks/`

## 7. Shared UX Infrastructure

Notable shared surfaces:

- page shell/state primitives in `/src/shared/components/page/`
- breadcrumb/page metadata plumbing
- omnisearch provider and dialog (`/src/shared/components/omni-search/`)
- read-only mode context based on backend access context (`ReadOnlyModeContext`)

## 8. Build and Performance Architecture

Vite config:

- `/Users/jebre/Desktop/hms/frontend/vite.config.js`

Implemented performance strategy:

- manual chunking by dependency domains (`vendor-core`, `vendor-query`, `vendor-recharts`, etc.)
- optional bundle visualization in analyze mode
- dev and preview API proxying to backend
- optimized dependency exclusions for icon package behavior

## 9. Testing and Linting

Test stack:

- Vitest + Testing Library + jsdom

Examples of covered areas:

- route type validation
- role-based route behavior
- auth behavior
- component-level workflows (nursing, inventory, omni-search, page primitives)

Linting:

- flat ESLint config at `/Users/jebre/Desktop/hms/frontend/eslint.config.js`

## 10. Frontend API Surface (Practical Overview)

Central API modules under `/src/lib/api/` include domain clients for:

- auth, patients, encounters, appointments, wards, admissions
- dashboards, laboratory, referrals, billing, inventory
- clinical-notes, consent, interop, facilities, notifications

Pattern:

- domain method wrappers over `apiClient` with consistent error translation.

## 11. Current-State Architecture Observations

1. Feature route modularization is in place and broadly consistent.
2. API modularization is partially complete; many feature modules still proxy to central `/lib/api`.
3. Auth/session/facility handling is robust and centralized in `auth.jsx` + `api-client.js`.
4. Realtime support exists for alerts/vitals/referrals/dashboards with reconnect logic.
5. Performance-conscious build chunking is configured at the bundler layer.

## 12. Practical Extension Guide

### 12.1 Add a new feature page

1. add page component under `features/<feature>/pages`
2. register route in `features/<feature>/routes.js` with explicit `roles` and `layout`
3. ensure route metadata includes title/breadcrumbs
4. expose route in `app/routes/featureRoutes.js`

### 12.2 Add a new API interaction

1. define domain method in `lib/api/<domain>.js` or feature api module
2. use `apiClient` (not raw fetch) for auth/facility/refresh handling
3. add React Query hook with stable query key
4. handle loading/error via shared page state primitives

### 12.3 Add realtime invalidation

1. create websocket client event mapping in `lib/websocket.js`
2. add hook wrapper for lifecycle and cache invalidation
3. keep websocket payload minimal and refetch full data via API

## 13. File Index (High-Value Read Order)

1. `/Users/jebre/Desktop/hms/frontend/src/App.jsx`
2. `/Users/jebre/Desktop/hms/frontend/src/app/AuthenticatedApp.jsx`
3. `/Users/jebre/Desktop/hms/frontend/src/app/routes/featureRoutes.js`
4. `/Users/jebre/Desktop/hms/frontend/src/app/routes/renderRoutes.jsx`
5. `/Users/jebre/Desktop/hms/frontend/src/lib/auth.jsx`
6. `/Users/jebre/Desktop/hms/frontend/src/lib/api-client.js`
7. `/Users/jebre/Desktop/hms/frontend/src/lib/react-query.js`
8. `/Users/jebre/Desktop/hms/frontend/src/shared/constants/roles.js`
9. `/Users/jebre/Desktop/hms/frontend/src/lib/websocket.js`
10. `/Users/jebre/Desktop/hms/frontend/vite.config.js`
