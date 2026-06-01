# hms-api/src/middleware

Status: active
Owner: Backend/Observability Engineering
Last reviewed: 2026-06-01
Scope: request middleware for Rust V2 API.

## Role

Middleware provides cross-cutting HTTP behavior such as request IDs, telemetry,
and tracing.

## Invariants

- Middleware must not log request bodies or PHI.
- Metrics should use route templates and stable operational labels.
- Middleware failures must not weaken access enforcement.
