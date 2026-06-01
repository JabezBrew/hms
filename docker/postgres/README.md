# docker/postgres

Status: legacy/local database reference
Owner: Database/Operations Engineering
Last reviewed: 2026-06-01
Scope: Postgres primary/replica helper configuration.

## Directory Map

| Path | Owns |
| --- | --- |
| `primary/` | primary Postgres config and init script. |
| `replica/` | replica Postgres config and setup script. |

## Invariants

- Treat these as database infrastructure helpers, not application migrations.
- Do not hard-code production passwords or client-specific secrets.
- Active Rust V2 schema changes belong in `backend-rs/migrations/`.
