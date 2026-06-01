# hms-api/src/bin

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: auxiliary API binaries.

## File Map

| File | Owns |
| --- | --- |
| `openapi.rs` | OpenAPI generation binary for `backend-rs/openapi/hms-v2.openapi.json`. |

## Invariants

- Generated OpenAPI must match Rust source.
- Frontend generated-client checks should run after contract changes.
