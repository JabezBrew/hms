# ADR 0002: Rust V2 Is The Active Backend

Status: accepted
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: active backend source of truth for HMS implementation work.

## Context

HMS has a legacy Django/DRF/Celery backend and a newer Rust V2 backend. Keeping
both as equal implementation targets causes split contracts, duplicate fixes,
and unsafe ambiguity around access control, performance, and deployment.

## Decision

`backend-rs/` is the active backend. Rust V2 code, tests, migrations, generated
OpenAPI, and runbooks define current backend behavior.

`backend/` remains legacy reference material only unless a task explicitly asks
for legacy Django maintenance, parity research, or comparison against old
behavior.

## Rejected Alternatives

- Continue feature work in both backends. Rejected because it doubles
  verification cost and weakens source-of-truth clarity.
- Treat Django docs as implementation guidance for Rust V2. Rejected because
  Rust V2 has different seams: `hms-access`, explicit DTOs, SQLx repositories,
  `hms-worker`, and `hms-migrator`.

## Consequences

- New backend behavior belongs in `backend-rs/`.
- Legacy docs must be labeled historical before they are used as guidance.
- Contract work must regenerate Rust V2 OpenAPI and frontend bridge helpers.
- Backend tests should cross Rust V2 Interfaces, not Django serializers or
  Celery tasks.
