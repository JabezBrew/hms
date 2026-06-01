# hms-migrator/src

Status: active
Owner: Database/Operations Engineering
Last reviewed: 2026-06-01
Scope: migration and provisioning command source.

## Module Map

| File | Owns |
| --- | --- |
| `main.rs` | migrator CLI bootstrap and command execution. |

## Invariants

- Migrations should be safe on fresh databases and repeatable deploy paths.
- Provisioning/seed output must be PHI-safe.
- Schema changes require rollback/restore consideration in runbooks.
