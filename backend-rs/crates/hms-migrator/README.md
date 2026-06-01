# hms-migrator

Status: active
Owner: Database/Operations Engineering
Last reviewed: 2026-06-01
Scope: migration and provisioning command entrypoint.

## Purpose

`hms-migrator` applies Rust V2 migrations and runs provisioning/seed paths used
for local development, staging, demo data, and performance data.

## Entrypoint

- `src/main.rs`: command binary.

## Commands

- `hms-migrator`: apply migrations and optional provisioning/seed work.
- `hms-migrator check-db`: connect with `HMS_DATABASE_URL`, run `SELECT 1`, and
  print only a redacted target summary. Deploy scripts use this before
  migrations.

## Related Code

- `../../migrations/`: SQL migration files.
- `../hms-db/src/migrate.rs`: migration helper logic.
- `../hms-db/src/provision.rs`: baseline, demo, and performance provisioning.

## Seed Modes

- Baseline provisioning is controlled by HMS provisioning env.
- Demo seeding uses `HMS_DEMO_SEED_PROFILE`.
- Performance seeding uses `HMS_PERF_SEED_SCALE`.

Do not treat `HMS_LOAD_DATA_SCALE` as the seed-size control; it is a load-run
label.

## Invariants

- Production safety checks must block unsafe demo/performance seeding.
- Migrations should be forward-safe and accompanied by restore/rollback notes
  when deploy risk is meaningful.
- Fresh database provisioning should stay testable.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-db --test migrations
cargo test -p hms-db --test provision_demo_seed
```
