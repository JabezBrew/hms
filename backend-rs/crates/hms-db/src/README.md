# hms-db/src

Status: active
Owner: Database/Backend Engineering
Last reviewed: 2026-06-01
Scope: SQLx repositories and database infrastructure.

## Repository Map

| Path/File | Owns |
| --- | --- |
| `admin.rs`, `auth.rs`, `facilities.rs` | admin, auth/session, and facility persistence. |
| `patients.rs`, `care.rs`, `clinical.rs`, `consent.rs`, `referrals.rs`, `scheduling.rs` | patient, care, clinical, consent, referral, and scheduling repositories. |
| `ward/`, `ward.rs`, `ward_rounds.rs` | inpatient/ward repository modules. |
| `inventory/`, `inventory.rs`, `laboratory.rs`, `billing.rs` | fulfillment and back-office repositories. |
| `dashboard.rs`, `events.rs`, `ops.rs`, `search.rs` | projections, events/jobs, ops, and search repositories. |
| `pool.rs`, `transactions.rs`, `migrate.rs`, `provision.rs`, `codec.rs`, `test_support.rs` | database infrastructure and testing support. |

## Invariants

- Facility scope belongs in repository predicates.
- Hot queries must be bounded, deterministic, and DTO-shaped.
- Avoid `DATE(column)`, avoid N+1 loops, and keep transactions short.
- Repository interfaces should express product intent instead of leaking SQL
  coordination to services.
