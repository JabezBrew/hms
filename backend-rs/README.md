# HMS Rust V2 Backend

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: active Rust backend workspace under `backend-rs/`.

## Purpose

`backend-rs/` is the active HMS backend. It owns `/api/v2`, Rust V2 OpenAPI,
PostgreSQL persistence, Redis-backed runtime concerns, background jobs,
authorization, migrations, and provisioning.

The legacy Django backend under `../backend/` is reference only unless a task is
explicitly legacy Django work.

## Workspace Crates

| Crate | Role |
| --- | --- |
| `crates/hms-api` | Axum API server, route mounting, HTTP handlers, service interfaces, middleware, OpenAPI. |
| `crates/hms-access` | Request context, feature/permission checks, patient/facility visibility, reauth facts. |
| `crates/hms-auth` | JWT/session/password reset/passkey primitives. |
| `crates/hms-domain` | Domain records, DTOs, capability/deployment types, product vocabulary. |
| `crates/hms-db` | SQLx repositories, transaction helpers, migrations/provisioning support. |
| `crates/hms-events` | Event and job payload contracts. |
| `crates/hms-worker` | Background job runner for work that must not block request paths. |
| `crates/hms-migrator` | Migrations, baseline provisioning, demo/performance seeding. |
| `crates/hms-observability` | PHI-safe route normalization, tracing/logging/metrics setup. |

## Request Flow

```text
routes/* -> handlers/* -> services/* -> hms-access
                                      -> hms-domain
                                      -> hms-db
                                      -> hms-events / hms-worker
```

- `routes/*` mounts URLs only.
- `handlers/*` extracts HTTP inputs and maps OpenAPI responses.
- `services/*` owns workflow orchestration and should be the first place to put
  new complex backend behavior.
- `hms-access` owns access decisions; do not recreate patient/facility checks in
  handlers.
- `hms-db` owns SQL and repository interfaces; handlers should not run SQL.

## Runtime Entrypoints

| Entrypoint | File | Use |
| --- | --- | --- |
| `hms-api` | `crates/hms-api/src/main.rs` | HTTP API runtime. |
| `hms-openapi` | `crates/hms-api/src/bin/openapi.rs` | Regenerates `openapi/hms-v2.openapi.json`. |
| `hms-worker` | `crates/hms-worker/src/main.rs` | Background worker runtime. |
| `hms-migrator` | `crates/hms-migrator/src/main.rs` | Migrations and provisioning. |

## Schema And Generated Contracts

- SQL migrations live in `migrations/`.
- Rust OpenAPI output lives in `openapi/hms-v2.openapi.json`.
- Frontend generated-client tooling lives in
  `../frontend/scripts/generate-v2-api-client.mjs`.

Regenerate OpenAPI from `backend-rs/` after HTTP contract changes:

```bash
cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json
```

## Safety Rules

- Patient identifiers require access checks before returning or mutating data.
- List endpoints must be bounded and cursor-paginated.
- Hot list DTOs must be lightweight projections.
- Cache/realtime keys must include facility/user/profile/visibility-changing
  scope.
- Do not log PHI, request bodies, raw URLs with patient IDs, MRNs, or free-text
  clinical data.
- Do not block request paths or dashboards on FHIR/external I/O.
- Do not hold DB transactions while waiting on external I/O.

## Validation

```bash
cd backend-rs
cargo fmt --all --check
cargo test --workspace
```

Focused suites:

```bash
cargo test -p hms-access
cargo test -p hms-db admission -- --nocapture
cargo test -p hms-db inventory -- --nocapture
cargo test -p hms-db billing -- --nocapture
cargo test -p hms-db laboratory -- --nocapture
cargo test -p hms-api --test auth_contract --test patients_contract --test ward_contract
```
