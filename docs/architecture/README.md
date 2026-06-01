# HMS Architecture

Status: active
Owner: Engineering Architecture
Last reviewed: 2026-06-01
Scope: high-level HMS architecture, Module map, and request lifecycle.

## System Shape

HMS is a modular monolith with an active Rust V2 backend and a maintained
React/Vite frontend.

```text
Browser
  |
  | React routes, feature Modules, TanStack Query
  v
frontend/
  |
  | generated Rust V2 client helpers, feature API adapters
  v
/api/v2
  |
  | axum routes and handlers
  v
backend-rs/crates/hms-api
  |
  | workflow service Interfaces
  v
hms-access  hms-domain  hms-db  hms-auth  hms-events
  |
  | SQL repositories, sessions, jobs, metrics
  v
PostgreSQL  Redis  hms-worker  Prometheus-compatible metrics
```

The system is intentionally not a microservice split. Split only when an
operational seam is proven. Inside the modular monolith, design for deep
Modules: small Interfaces that hide meaningful Implementation detail and own
product invariants.

## Primary References

`CONTEXT.md` owns the canonical source-of-truth order. This section lists the
architecture references used by this map.

- Backend architecture: [`../v2/rust-v2-backend-spec.md`](../v2/rust-v2-backend-spec.md).
- Cutover scope: [`../v2/v2-cutover-scope.md`](../v2/v2-cutover-scope.md).
- Frontend routes: `frontend/src/app/routes/featureRoutes.js`.
- Backend routes: `backend-rs/crates/hms-api/src/routes/`.
- Backend handlers: `backend-rs/crates/hms-api/src/handlers/`.
- Backend workflow Modules: `backend-rs/crates/hms-api/src/services/`.
- Persistence: `backend-rs/crates/hms-db/`.
- Access decisions: `backend-rs/crates/hms-access/`.
- Generated contract: `backend-rs/openapi/hms-v2.openapi.json`.

## Backend Module Map

| Module | Interface role | Implementation ownership |
| --- | --- | --- |
| `hms-api` | HTTP request handling, route mounting, workflow service Interfaces, OpenAPI generation | Axum routes, handlers, extractors, service Modules, middleware, API errors |
| `hms-access` | RequestContext and authorization decisions | Facility scope, permissions, features, patient visibility, reauth facts |
| `hms-auth` | Auth/session primitives | JWT, refresh sessions, password reset, privileged auth rules |
| `hms-domain` | Product language, DTOs, policies, capability model | Typed domain records, commands, projections, feature keys |
| `hms-db` | Persistence Interfaces | SQLx repositories, transaction helpers, provisioning, query contracts |
| `hms-events` | Domain event and job contracts | Event payload types used by API and worker paths |
| `hms-worker` | Async job execution | Background processing outside request threads |
| `hms-migrator` | Schema migration and provisioning entry point | Database migrations, baseline/demo/perf seeding |
| `hms-observability` | Logging, tracing, metrics helpers | PHI-safe route labels, metrics setup, tracing setup |

## Frontend Module Map

| Module | Interface role | Implementation ownership |
| --- | --- | --- |
| `frontend/src/app/routes/` | Route metadata and rendering Interface | Role/layout/title/breadcrumb contracts, route validation |
| `frontend/src/features/<domain>/` | Product workflow Interface for each UI domain | Feature API adapters, hooks, pages, components, route exports |
| `frontend/src/shared/` | Cross-cutting UI and data primitives | Page shells, query keys, shared hooks, constants, shared APIs |
| `frontend/src/lib/api/v2/` | Generated Rust V2 client runtime | Generated client, session handling, runtime config, error mapping |
| `frontend/src/lib/api/*.js` | Compatibility adapters | Legacy-compatible feature API surfaces that call Rust V2 in V2 mode |

## Request Lifecycle

1. Browser route metadata selects a feature route and role/layout guard.
2. Feature page calls a feature hook or API adapter.
3. Adapter uses generated Rust V2 client helpers when `rust-v2` mode is active.
4. Axum route mounts the URL only.
5. Handler extracts `RequestContext`, path/query/body values, and typed input.
6. Handler calls a workflow service Interface.
7. Service coordinates access, domain policy, persistence, events, and response
   shape.
8. `hms-access` enforces facility, permission, feature, patient visibility, and
   reauth facts.
9. `hms-db` runs bounded SQL through repository Interfaces.
10. Handler maps the service result into the OpenAPI response contract.

Routes should not contain workflow logic. Handlers should not contain SQL,
product-state transitions, or handler-local access shortcuts. Persistence should
not leak SQL coordination into handlers.

## Data Placement

Patient clinical data belongs in Patient Chronicle. Patient Registry can expose
identity and workflow discovery, but not full clinical records. Clinical
features should open inside Chronicle or as panels launched from Chronicle.

## Performance Shape

Clinical hot paths must keep p99 latency predictable. The architecture assumes:

- bounded cursor lists
- lightweight list DTOs
- O(1) query count per page
- no external I/O in open DB transactions
- cached dashboard projections with async refresh
- PHI-safe metrics and browser events
- frontend route-shell-first rendering for heavy clinical routes

Use [`../performance/performance-budget.md`](../performance/performance-budget.md)
as the metric and evidence contract.

## Related Docs

- [`backend-rust-v2.md`](backend-rust-v2.md)
- [`frontend.md`](frontend.md)
- [`../contracts/README.md`](../contracts/README.md)
- [`../runbooks/README.md`](../runbooks/README.md)
