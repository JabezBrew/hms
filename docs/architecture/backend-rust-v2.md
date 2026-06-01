# Rust V2 Backend Architecture

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: active backend Module ownership, seams, and implementation rules.

## Core Rule

The active backend is `backend-rs/`. Treat `backend/` as legacy reference only
unless the task explicitly asks for Django maintenance or parity research.

## Crate Responsibilities

| Crate | Owns | Does not own |
| --- | --- | --- |
| `hms-api` | HTTP routes, handlers, extractors, workflow service Interfaces, OpenAPI | SQL details, raw auth/session primitives, domain-only policy definitions |
| `hms-access` | RequestContext and access decisions | HTTP response mapping, SQL persistence |
| `hms-auth` | Session/auth primitives | Facility/patient access policy |
| `hms-domain` | Typed product language and DTO contracts | Database access, request extraction |
| `hms-db` | Repository Interfaces and SQL Implementation | HTTP, UI-specific envelopes, product orchestration |
| `hms-events` | Event/job payload contracts | Worker scheduling policy |
| `hms-worker` | Background job execution | Request-path side effects |
| `hms-migrator` | Migration/provisioning execution | Runtime request handling |
| `hms-observability` | PHI-safe logging and metrics helpers | Product workflow policy |

## `hms-api` Internal Shape

```text
routes/*      mounts URLs
handlers/*    translates HTTP into typed service calls
services/*    owns workflow Interfaces and orchestration
extractors.rs builds authenticated request context
cursor_list.rs owns bounded cursor-list behavior
state.rs      runtime Adapter/facade for pools, config, auth, capabilities
```

New workflow behavior should usually enter through `services/<domain>/`.
Create a new service submodule when it gives callers a smaller Interface and
better Locality. Do not split files just because they are long.

## Handler Contract

A handler may:

- extract typed path, query, body, and `RequestContext`
- call access guards or a service Interface that calls them
- call one workflow service Interface
- map service output to an OpenAPI response

A handler must not:

- run SQL
- coordinate multiple repository calls when a service Interface should own the
  workflow
- invent local access checks instead of using `hms-access`
- return full rows from list endpoints
- log request bodies or free-text clinical data

## Persistence Contract

Repository Interfaces in `hms-db` should express workflow intent, not SQL
mechanics. A caller should ask for a bounded projection like "list ward board"
or "load Chronicle initial view" rather than coordinate per-row follow-up
queries.

Repository tests should prove:

- facility scope
- access-relevant filters
- bounded page size
- stable cursor ordering
- deterministic DTO projection
- query count that does not grow with page size

## Access Contract

Patient identifiers are high-risk inputs. Any route that accepts one must prove
patient access before exposing or mutating patient data.

Use `hms-access::RequestContext` for:

- user/session identity
- facility scope
- active profile
- enabled features
- permissions
- patient visibility
- offsite facts
- reauthentication state

Do not recreate these facts in handlers, frontend code, or ad hoc repository
filters.

## Contract Change Checklist

For backend contract changes:

1. Add or update access/repository/API tests at the same Interface production
   callers use.
2. Keep handlers thin and persistence in `hms-db`.
3. Regenerate `backend-rs/openapi/hms-v2.openapi.json`.
4. Regenerate or verify frontend V2 bridge helpers.
5. Add migration/provisioning checks when schema changes.
6. Run focused tests first, then broader workspace tests when the change affects
   shared behavior.

## Verification

Default active-backend validation:

```bash
cd backend-rs
cargo fmt --all --check
cargo test --workspace
```

High-risk focused suites:

```bash
cargo test -p hms-access
cargo test -p hms-db admission -- --nocapture
cargo test -p hms-db inventory -- --nocapture
cargo test -p hms-db billing -- --nocapture
cargo test -p hms-db laboratory -- --nocapture
cargo test -p hms-api --test auth_contract --test patients_contract --test ward_contract
```
