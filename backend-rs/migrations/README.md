# backend-rs/migrations

Status: active
Owner: Database Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 SQL migrations.

## Purpose

This directory contains the ordered SQL migration history for the active Rust V2
backend.

## Migration Groups

| Range | Area |
| --- | --- |
| `202605100001` to `202605100018` | foundation, care, ward/admission/nursing, clinical, lab, inventory/pharmacy, billing/NHIS, admin authority, dashboards/realtime, auth hardening, patient context, features, staff, referrals, consent |
| `202605120001` to `202605130005` | visit filters, referral action fields, patient validation, stock indexes, requisition/lab/triage/inventory/session refinements |
| `202605170001` | omni search |
| `202605190101` to `202605190107` | break-glass, scheduling, discharge blockers, billing controls, inventory workflows, referrals context, passkeys |
| `202605220404` to `202605300002` | dashboard projection refresh, ops permission, scheduling indexes/templates, appointment status, hot-path performance indexes |
| `202606010001` to `202606030012` | auth session deadlines, patient-registry/search indexes, table-filter support, billing read models, audit/search indexes, auth login failure counters |
| `202606040001` to `202606060004` | care-context provenance, ward-board/discharge hot-path indexes, medication fulfillment, ward staffing, and patient identity status hardening |

## Invariants

- Migrations must be safe for fresh database provisioning.
- Migration version prefixes must be unique. Reusing a version can partially
  advance Cloud SQL and strand rollback code at schema-history validation.
- Hot-path indexes should be justified by measured query behavior.
- Avoid table-scan-prone patterns such as date functions in predicates.
- Production/demo/performance seed behavior belongs in `hms-migrator` and
  `hms-db::provision`, not ad hoc SQL scripts.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-db --test migrations
cargo test -p hms-db --test provision_demo_seed
```
