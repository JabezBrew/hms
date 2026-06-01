# hms-api/src/handlers

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: HTTP extractors, request validation, service calls, and response mapping.

## Role

Handlers translate Axum inputs into typed service calls and map service results
into response DTOs/OpenAPI shapes.

## Invariants

- No SQL in handlers.
- No long workflow orchestration in handlers.
- No handler-local patient-access shortcuts.
- Keep list handling bounded through shared cursor/pagination helpers.
- Response and error bodies must be PHI-safe.
