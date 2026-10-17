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
- `hms-migrator schema-compatibility`: print only the committed, explicitly
  registered breaking-schema epoch (`0` or `202610170023`). The bounded read-only
  probe takes SQLx's actual migration lock and fails closed on concurrent
  migration, incoherent metadata or timeout. It does not apply migrations,
  provision identities or declare a runtime compatible. Deployment compares this
  result with the release's explicit runtime declaration before starting writers
  or restoring an old runtime. See
  `docs/v2/2026-10-17-runtime-schema-compatibility-scope.md`.
- `hms-migrator configure-network`: explicitly bootstrap/recover a facility
  network policy after migrations. Requires `--facility-code`, repeated
  `--onsite-cidr`, `--offsite-mode`, `--expected-version`, `--request-id`, and
  `--reason-stdin`; none has an implicit access-granting default. Output contains
  only version, range count, and replay status. See
  `docs/v2/2026-10-16-trusted-network-policy-scope.md` at the repository root for
  the full reviewed operator contract.
- `hms-migrator auth-readiness --facility-code ...`: report aggregate enrollment,
  structural-key and RP/origin readiness facts. This cannot prove that a person
  can use a stored key.
- `hms-migrator bootstrap-factor`: issue a named user's one-time setup token only
  after explicit `--identity-checked`, with the raw token written to a new private
  `--token-file`. It creates no ordinary session or factor assurance.
- `hms-migrator retire-factor`: logically retire a named user's credential after
  explicit identity-check acknowledgment and a bounded reason on stdin. Original
  key material and immutable operator-review evidence remain stored. See
  `docs/v2/2026-10-17-session-factor-assurance-scope.md` for rollout and identity
  boundaries; no account is repaired or enrolled automatically at startup.

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
