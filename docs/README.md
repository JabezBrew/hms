# HMS Codebase Map

Status: active
Owner: Engineering
Last reviewed: 2026-06-01
Scope: concrete map of the HMS repository.

## Active Code

- Root app overview: [`../README.md`](../README.md)
- Product/system context: [`../CONTEXT.md`](../CONTEXT.md)
- Active backend: [`../backend-rs/README.md`](../backend-rs/README.md)
- Backend crates: [`../backend-rs/crates/README.md`](../backend-rs/crates/README.md)
- Backend migrations: [`../backend-rs/migrations/README.md`](../backend-rs/migrations/README.md)
- Backend OpenAPI: [`../backend-rs/openapi/README.md`](../backend-rs/openapi/README.md)
- Backend scripts: [`../backend-rs/scripts/README.md`](../backend-rs/scripts/README.md)
- Active frontend: [`../frontend/README.md`](../frontend/README.md)
- Frontend feature map: [`../frontend/src/features/README.md`](../frontend/src/features/README.md)
- Frontend app shell: [`../frontend/src/app/README.md`](../frontend/src/app/README.md)
- Frontend components: [`../frontend/src/components/README.md`](../frontend/src/components/README.md)
- Frontend shared primitives: [`../frontend/src/shared/README.md`](../frontend/src/shared/README.md)
- Frontend library/API layer: [`../frontend/src/lib/README.md`](../frontend/src/lib/README.md)
- Frontend scripts: [`../frontend/scripts/README.md`](../frontend/scripts/README.md)
- Frontend E2E tests: [`../frontend/e2e/README.md`](../frontend/e2e/README.md)
- Frontend public assets: [`../frontend/public/README.md`](../frontend/public/README.md)
- Operations/deploy map: [`../ops/README.md`](../ops/README.md)
- Monitoring map: [`../monitoring/README.md`](../monitoring/README.md)
- Test/load map: [`../tests/README.md`](../tests/README.md)
- CI workflows: [`../.github/README.md`](../.github/README.md)
- Docker legacy reference: [`../docker/README.md`](../docker/README.md)
- Kubernetes legacy reference: [`../k8s/README.md`](../k8s/README.md)
- Top-level scripts: [`../scripts/README.md`](../scripts/README.md)
- Legacy backend reference: [`../backend/README.md`](../backend/README.md)

## Backend Crates

- [`hms-api`](../backend-rs/crates/hms-api/README.md): HTTP routes, handlers,
  extractors, service interfaces, OpenAPI, middleware, runtime state.
  - Service internals:
    [`ward`](../backend-rs/crates/hms-api/src/services/ward/README.md),
    [`billing`](../backend-rs/crates/hms-api/src/services/billing/README.md),
    [`inventory`](../backend-rs/crates/hms-api/src/services/inventory/README.md),
    [`laboratory`](../backend-rs/crates/hms-api/src/services/laboratory/README.md),
    [`ops`](../backend-rs/crates/hms-api/src/services/ops/README.md).
- [`hms-access`](../backend-rs/crates/hms-access/README.md): request context,
  facility/profile/permission/patient visibility and reauth decisions.
- [`hms-auth`](../backend-rs/crates/hms-auth/README.md): JWT, refresh sessions,
  password reset, passkeys, and privileged-session primitives.
- [`hms-domain`](../backend-rs/crates/hms-domain/README.md): domain DTOs,
  capability keys, product language, policies, and projection types.
- [`hms-db`](../backend-rs/crates/hms-db/README.md): sqlx repositories,
  transaction helpers, migrations/provisioning support, and DB tests.
  - Deep repository internals:
    [`ward`](../backend-rs/crates/hms-db/src/ward/README.md),
    [`inventory`](../backend-rs/crates/hms-db/src/inventory/README.md).
- [`hms-events`](../backend-rs/crates/hms-events/README.md): event and job
  payload contracts.
- [`hms-worker`](../backend-rs/crates/hms-worker/README.md): async background
  job execution.
- [`hms-migrator`](../backend-rs/crates/hms-migrator/README.md): migration,
  baseline provisioning, demo seeding, and performance seeding entry point.
- [`hms-observability`](../backend-rs/crates/hms-observability/README.md):
  PHI-safe route normalization, logging, tracing, and metrics helpers.

## Frontend Areas

- [`frontend/src/app`](../frontend/src/app/README.md): app shells, auth/public
  boot flow, route rendering, runtime guards, route preload.
- [`frontend/src/features`](../frontend/src/features/README.md): domain feature
  modules and route ownership.
  - Patient Chronicle internals:
    [`chronicle`](../frontend/src/features/patients/chronicle/README.md) and
    [`ward-round`](../frontend/src/features/patients/chronicle/ward-round/README.md).
- [`frontend/src/components`](../frontend/src/components/README.md): shared
  legacy/product component library, Chronicle components, shadcn-style UI.
  - Chronicle components:
    [`frontend/src/components/chronicle`](../frontend/src/components/chronicle/README.md).
- [`frontend/src/shared`](../frontend/src/shared/README.md): shared API,
  query-key, hook, page-shell, and utility primitives.
- [`frontend/src/lib/api`](../frontend/src/lib/api/README.md): legacy-compatible
  API adapters and generated Rust V2 client runtime.
- [`frontend/src/hooks`](../frontend/src/hooks/README.md): cross-feature data
  hooks and websocket hooks.

## Product Workflow Docs

- [`architecture/backend-rust-v2.md`](architecture/backend-rust-v2.md): Rust V2
  request lifecycle and backend module rules.
- [`architecture/frontend.md`](architecture/frontend.md): React/Vite data flow,
  route metadata, query/abort behavior, and Chronicle placement.
- [`contracts/README.md`](contracts/README.md): active contracts for HTTP,
  access, realtime, persistence, frontend bridge, external I/O, and metrics.
- [`v2/README.md`](v2/README.md): Rust V2 spec, seed, cutover scope, and
  production-readiness files.
- [`performance/README.md`](performance/README.md): performance budgets,
  baseline evidence, slow-SQL follow-up, and realtime UI policy.
- [`ownership/README.md`](ownership/README.md): path ownership and review
  triggers.
- [`runbooks/README.md`](runbooks/README.md): current staging, rollback, smoke,
  performance, and incident entry points.

## Current Direction

- Rust V2 in `backend-rs/` is active.
- React/Vite in `frontend/` is active.
- Django in `backend/` is legacy reference only.
- GCP is the current staging/performance-validation path.
- Hetzner remains rollback and reusable Rust V2 Compose reference.
- Patient Chronicle is the product home for patient clinical data.
