# hms-api/src

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 HTTP API source.

## Runtime Map

| Path/File | Owns |
| --- | --- |
| `main.rs` | API binary bootstrap. |
| `lib.rs` | crate module exports used by tests and auxiliary binaries. |
| `app.rs` | Axum app construction. |
| `auth.rs`, `passwords.rs` | API-layer auth helpers and password-policy behavior. |
| `config.rs` | environment-backed runtime config. |
| `error.rs`, `response.rs` | API error and response helpers. |
| `ops_auth.rs` | ops authorization helpers. |
| `state.rs` | runtime adapter for pools, config, auth helpers, capabilities, and services. |
| `routes/` | URL mounting only. |
| `handlers/` | HTTP extraction, service invocation, response mapping. |
| `services/` | workflow orchestration and service interfaces. |
| `extractors.rs` | authenticated session and request context extraction. |
| `cursor_list.rs` | bounded cursor-list parsing and response helpers. |
| `middleware/` | request id, telemetry, and tracing middleware. |
| `openapi.rs`, `bin/openapi.rs` | OpenAPI registration and generation. |

## Invariants

- No SQL in handlers.
- No workflow implementation in `state.rs`.
- Patient identifier endpoints must enforce access before returning or mutating
  data.
- Hot lists must use bounded pagination helpers and lightweight DTOs.
- Logs, metrics, and errors must remain PHI-safe.
