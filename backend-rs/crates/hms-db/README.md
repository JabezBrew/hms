# hms-db

Status: active
Owner: Database/Backend Engineering
Last reviewed: 2026-11-04
Scope: SQLx repositories, transactions, migrations support, and DB contracts.

## Purpose

`hms-db` owns database access for Rust V2. API services ask repository
interfaces for workflow projections; handlers should not run SQL directly.

## Repository Map

| File/module | Product area |
| --- | --- |
| `admin.rs` | organization, authority, permissions, staff/practitioners |
| `auth.rs` | auth/session persistence |
| `auth/assurance.rs` | bounded restricted grants, verified exact-session factor proof, key/recovery management, immutable operator retirement and ephemeral cleanup |
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
| `ward/admission_advisories.rs` | current-ward follow-up, immutable terminal decisions and closure retirement |
| `ward_rounds.rs` | ward-round persistence |
| `ward_rounds/governed.rs` | proof-bearing complete-draft CAS, atomic commit and immutable Ward Round request receipts |

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
- Facility-scoped identifiers such as staff Employee IDs are allocated inside
  repository transactions, not in frontend code or handlers.
- Forced staff reset tokens are inserted inactive and activated only inside the
  finalization transaction that revokes sessions and writes audit evidence.
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

## Reviewed medication stock basis

`clinical/stock_basis.rs` owns explicit scheduled inventory units, immutable unit
validation, active admission fences, checked quantity multiplication and shared
actor-deadline checks. Migration016 preserves unknown legacy evidence; reviewed
replacement courses provide the supported recovery. See
[scope and compatibility](../../../docs/v2/2026-10-16-scheduled-stock-basis-scope.md).
Focused tests are `scheduled_stock_basis`, `medication_lifecycle`, `prn_doses`,
`mar_outcomes`, and `prescription_courses`; inventory/standing suites cover shared
stock writers.

## Reviewed Ward Round commands

Public Ward Round reads and writes use `ward_rounds/governed.rs`, its mandatory
live authority proof and current admission/action checks. Migration019 retains
immutable original command results and human-readable reviewed source snapshots.
Legacy plain helpers remain trusted fixture/import compatibility. See the
[command scope](../../../docs/v2/2026-10-16-ward-round-command-scope.md) and focused
`ward_round_commands`, `ward_rounds` and `medication_lifecycle` tests.

## Admission follow-up

`ward/admission_advisories.rs` owns proof-bearing nonblocking case follow-up and
immutable actor-bound command recovery. Migration020 preserves separate manual
and canonical closure outcomes; cancellation/discharge retire Pending children
inside the existing parent transaction. See the
[scope and compatibility](../../../docs/v2/2026-10-16-admission-advisory-scope.md)
and focused `admission_advisories` repository tests.

## Clinical note evidence

`clinical/note_records.rs` and `clinical/note_templates.rs` own guarded UUID
commands, immutable note/template revisions and lean paged history/catalog reads.
Migration017 preserves unknown legacy authors and owners instead of inferring
provenance. Public API writers use these proof-bearing repositories; older plain
helpers are limited to trusted fixture/provisioning compatibility. See the
[note evidence scope](../../../docs/v2/2026-10-16-clinical-note-evidence-scope.md).

## Laboratory catalog epoch 033

`laboratory_catalog/` owns ordinary no-patient catalog proof, bounded current
directories/details/history and fresh UUID/CAS availability commands/own originals.
`laboratory/catalog_source.rs` retains complete active/local requested sets under
sorted panel shared gates and test SHARE locks. `laboratory/governed.rs` retains
existing CareActor clinical purposes and canonical visit/encounter context through
order publication/readback. Existing-order collection/results/verification do not
require current catalog availability.

Migration033 enforces permanent source identity, observed version/time transitions,
all-writer membership phantoms and exact existing-link no-op tuple retention.
Trusted definition maintenance clears unknown actor attribution and increments
version; it is not a public editor or a historical definition snapshot. Optional
seed lab journeys preserve original accepted graphs and skip wholly unavailable
exact defaults, recording scalar skipped counts. Missing-only defaults preserve
configured/inactive/empty/custom sources. Search repair touches catalog sources
only and retains the clinical demographics purpose.

Executed controls include `laboratory_catalog_governance`,
`laboratory_catalog_provision`, `ward_round_commands`, intrinsic source-publication
controls and the 033 schema faults. The unchanged original 17 regression tests first
compiled against accepted 032, producing 14 meaningful failures and 3 passes; all 17
then passed against the implementation. One complete final Rust workspace run
passes 1,245 tests across 170 summaries, with zero failures or ignored cases.
The compiled 549-operation contract and generated client include nine new catalog
operations. The final frontend suite passes 4,010 tests in 402 files. Operations passes 618
cases, with 25 separate canonical storage-guard cases; 643 is their combined
nonoverlapping count, not a single suite. Fresh native17/timing and 326 catalog/80
Ward browser checks pass; selected visuals were inspected and exact owned cleanup
conserves all 63 unrelated database inventory entries.

Completed Ward Round originals retain their original shape/digest. New commits
require current server-known positive versions; an old draft needs explicit
same-body save with a new UUID/current round version before completion. Baseline
provisioning preserves configured sources. In the retained upgrade fixture, its
known first 033 change is one bootstrap-owner `laboratory.catalog.manage`
permission grant; native attempt 17 records that delta separately, then proves
demo-refusal conservation.
Retained demo evidence still refuses reset, and unavailable exact sources cause a
whole optional seed laboratory journey to skip rather than a partial publication.

Epoch 033 does not retain historical ordered-definition snapshots. The optional
nested order result summary remains NULL; public result detail is separate and a
selection policy for multiple specimens is queued. Snapshot capture and normal
migrator live-layout admission before all writes remain checkpoint 28 proposals.
See the [scope](../../../docs/v2/2026-11-04-laboratory-catalog-governance-scope.md)
and [verification](../../../docs/v2/2026-11-04-checkpoint-27-verification.md).
Source-confirmed self-verification, aggregate completion and malformed result/order
facility-patient ownership gaps remain checkpoint 28 work. Reviewed source-only
repairs and regressions await compilation, genuine baseline reproduction and
correction validation. They are not resolved by availability governance. Final documentation supplements
are separate from the tested component maps.
