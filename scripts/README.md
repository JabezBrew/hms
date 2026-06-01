# scripts

Status: support tooling
Owner: Engineering
Last reviewed: 2026-06-01
Scope: top-level helper scripts.

## Scripts

| Script | Role |
| --- | --- |
| `seed_prod_test_users.py` | historical/support helper for seeding test users. |

## Invariants

- Do not run seed scripts against production PHI data unless explicitly approved
  and documented.
- Prefer Rust V2 migrator/provisioning paths for active backend seed work.
  Legacy Python seed helpers are not the default active path.
