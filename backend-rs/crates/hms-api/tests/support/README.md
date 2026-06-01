# hms-api/tests/support

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: shared test support for API contract tests.

## Invariants

- Support utilities should build realistic request context without bypassing
  production access paths.
- Do not introduce fixture PHI or secrets.
- Keep test setup deterministic and isolated.
