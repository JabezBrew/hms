# docker/postgres/replica

Status: legacy/local database reference
Owner: Database/Operations Engineering
Last reviewed: 2026-06-01
Scope: replica Postgres helper config.

## File Map

| File | Owns |
| --- | --- |
| `setup-replica.sh` | replica setup helper. |
| `postgresql.conf` | replica Postgres config reference. |

## Invariants

- Do not store replication passwords or production secrets here.
- Treat this as infrastructure reference, not application schema.
