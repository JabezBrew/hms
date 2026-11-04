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
| `202606080001` | staff onboarding identifier sequence allocation |
| `202610150001` | atomic login admission budgets shared by API instances; additive table, compatible with older API code during rollback |
| `202610160013` | protected prescription documentation, single-successor provenance, immutable command receipts and patient/facility-bound PRN safety groups |

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

## Category epoch031

`202610310031_inventory_category_governance.sql` introduces current category CAS,
nullable description/direct parent, immutable UUID receipts, intrinsic parent and
lifecycle guards, indexed administration/history/references and a mandatory
producer-backed item search projection repair. Deploy matching API, worker and
migrator with all writers quiesced and no old-runtime restart. New runtime31
refuses older schemas before provisioning. Accepted runtime030 cannot know a
future031 epoch; its observed startup/write behavior is a separate diagnostic,
not a supported rollback policy. Do not modify accepted030 migration bytes.

## Supplier epoch032

`202611020032_inventory_supplier_governance.sql` adds nullable plain-text address,
current supplier CAS/provenance, immutable command/audit completeness guards,
retained item-source locks, global reference lookup and bounded own-document
publication. Existing supplier text/state/timestamps and malformed retained item
pointers are preserved; unknown provenance stays NULL. Mandatory producer-backed
supplier document repair requires demographics, excludes address and preserves
document identities/unrelated JSON without rewriting other families or orphans.

Deploy matching 032 API/worker/migrator under the quiesce/no-old-restart fence.
The new runtime refuses 031 before provisioning. Actual older 031 behavior on 032 is
a separate diagnostic, not supported rollback. Accepted 031 bytes remain immutable.
