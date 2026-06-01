# backend-rs/crates

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 workspace crates.

## Crates

| Crate | Role |
| --- | --- |
| `hms-api` | HTTP API runtime, route/handler/service layer, OpenAPI. |
| `hms-access` | request context and access decisions. |
| `hms-auth` | auth/session/password/passkey primitives. |
| `hms-domain` | domain types, DTOs, capabilities, product language. |
| `hms-db` | SQLx repositories and DB contracts. |
| `hms-events` | event and job payload contracts. |
| `hms-worker` | async worker runtime. |
| `hms-migrator` | migrations and provisioning command. |
| `hms-observability` | tracing, logging, metrics helpers. |

## Dependency Direction

`hms-api` may depend on domain/access/db/auth/events/observability crates.
`hms-db` should not depend on `hms-api`. `hms-domain` should remain free of
runtime HTTP or database dependencies.
