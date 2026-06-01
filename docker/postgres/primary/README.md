# docker/postgres/primary

Status: legacy/local database reference
Owner: Database/Operations Engineering
Last reviewed: 2026-06-01
Scope: primary Postgres helper config.

## File Map

| File | Owns |
| --- | --- |
| `init-primary.sh` | primary initialization helper. |
| `postgresql.conf` | primary Postgres config reference. |

## Invariants

- Do not store production passwords or client secrets here.
- Active Rust V2 schema belongs in `backend-rs/migrations/`.
