# hms-api/src/routes

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: Axum route mounting modules for `/api/v2`.

## Role

Route files group URL paths and connect them to handler functions. They should
not own SQL, product decisions, DTO assembly, or access shortcuts.

## Invariants

- Keep route modules thin.
- Route additions/removals are HTTP contract changes and need contract tests.
- Patient identifier routes must lead to handlers/services that enforce
  `hms-access` checks.
