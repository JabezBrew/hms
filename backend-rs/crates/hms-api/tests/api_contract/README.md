# hms-api/tests/api_contract

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: shared API contract helper modules.

## Role

These modules organize shared contract fixtures and domain-specific assertions
used by the top-level `*_contract.rs` tests.

## Invariants

- Keep fixtures synthetic and PHI-safe.
- Helpers should make access and response-shape assertions easier, not hide
  missing authorization checks.
