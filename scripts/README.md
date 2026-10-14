# scripts

Status: support tooling
Owner: Engineering
Last reviewed: 2026-06-01
Scope: top-level helper scripts.

## Scripts

| Script | Role |
| --- | --- |
| `../deploy` | root deploy front door; forwards to `ops/deploy.sh`. |
| `check-local.sh` | sequential frontend, Rust and operations release checks; optional area selector. |
| `seed_prod_test_users.py` | historical/support helper for seeding test users. |

## Invariants

Run `scripts/check-local.sh` before a release, or select `frontend`, `backend`,
or `ops` for focused validation. Start the documented Compose Postgres/Redis
services and supply their credentials privately for backend checks. Browser
workflow tests, dependency audits, runtime measurements and deployment
verification remain separate checks. Run deployment tests from a clean checkout;
one test deliberately verifies the clean-release guard.

- Do not run seed scripts against production PHI data unless explicitly approved
  and documented.
- Prefer Rust V2 migrator/provisioning paths for active backend seed work.
  Legacy Python seed helpers are not the default active path.
