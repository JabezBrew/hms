# hms-db

Status: active
Owner: Database/Backend Engineering
Last reviewed: 2026-06-01
Scope: SQLx repositories, transactions, migrations support, and DB contracts.

## Purpose

`hms-db` owns database access for Rust V2. API services ask repository
interfaces for workflow projections; handlers should not run SQL directly.

## Repository Map

| File/module | Product area |
| --- | --- |
| `admin.rs` | organization, authority, permissions, staff/practitioners |
| `auth.rs` | auth/session persistence |
| `billing.rs` | billing, receipts, cash sessions, NHIS |
| `care.rs` | appointments, clinics, visits, triage, encounters |
| `clinical.rs` | clinical notes, problems, allergies, prescriptions, charts |
| `consent.rs` | consent grants |
| `dashboard.rs` | dashboard snapshots, notifications, realtime projections |
| `events.rs` | persisted event/job support |
| `facilities.rs` | facility lookup and deployment shape |
| `inventory/` | catalog, stock control, procurement, pharmacy, controlled substances |
| `laboratory.rs` | laboratory catalog/orders/specimens/results |
| `ops.rs` | ops dashboard DB snapshots |
| `patients.rs` | patient registry, context, Chronicle, break-glass |
| `referrals.rs` | referrals and clinic waitlist |
| `scheduling.rs` | scheduling services, sessions, templates, availability |
| `search.rs` | omni-search projections |
| `ward/` | ward admin, admissions, bed management, discharges, handoff, MAR, nursing tasks, monitoring, ward stock |
| `ward_rounds.rs` | ward-round persistence |

## Infrastructure Files

- `pool.rs`: pool creation and pool helpers.
- `transactions.rs`: transaction helpers.
- `migrate.rs`: migration support.
- `provision.rs`: baseline/demo/performance provisioning.
- `codec.rs`: DB encoding/decoding helpers.
- `test_support.rs`: test database support.

## Invariants

- Hot lists are bounded and deterministic.
- Facility scope belongs in repository predicates.
- Avoid N+1 query patterns.
- Avoid `DATE(column)` filters; use `[start, end)` ranges.
- Keep transaction scopes short.
- Repository tests should prove the same interface production services call.

## Tests

`tests/` contains repository contracts for admin, auth, billing, care,
clinical context, consent, dashboard, inventory, laboratory, migrations, ops,
patients, referrals, search, ward, and ward rounds.

Run from `backend-rs/`:

```bash
cargo test -p hms-db
```
