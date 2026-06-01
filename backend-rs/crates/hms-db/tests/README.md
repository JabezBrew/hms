# hms-db/tests

Status: active
Owner: Database/Backend Engineering
Last reviewed: 2026-06-01
Scope: SQLx repository contract tests.

## Purpose

These tests prove repository behavior for admin, auth, billing, care, clinical
context, consent, dashboard, inventory, laboratory, migrations, ops, patients,
referrals, search, ward, and ward rounds.

## Invariants

- Tests should cross repository interfaces used by production services.
- Fixtures must be synthetic and PHI-safe.
- Hot-path tests should prove bounded list behavior, deterministic sort, and
  facility scope.

## Run

```bash
cargo test -p hms-db
```
