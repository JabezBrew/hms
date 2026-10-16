# Ward Repositories

Status: active
Owner: Database/Ward Engineering
Last reviewed: 2026-06-06
Scope: ward, admission, bed, discharge, handoff, MAR, nursing, monitoring, and ward-stock persistence.

## Purpose

`hms-db::ward` owns SQLx repository behavior for inpatient workflows. API
services call these repository interfaces; handlers should not know table or
query details.

## Module Map

| Module | Owns |
| --- | --- |
| `mod.rs` | public ward repository exports. |
| `admin.rs` | ward, section, and bed persistence. |
| `analytics.rs` | ward report aggregate queries for occupancy trends, LOS buckets, admissions, discharges, utilization, and turnover. |
| `bed_management.rs` | bed status, assignment, layout, transfer, and occupancy queries. |
| `admission_cases.rs` | admission-case state, active admissions, and admission workflow queries. |
| `discharge_cases.rs` | discharge planning and discharge completion persistence. |
| `handoff.rs` | ward shift headers and immutable sender finalization. |
| `patient_handover.rs` | protected patient narrative roots, revisions, exact commands and scoped recipient pages. |
| `mar.rs` | medication administration record persistence. |
| `nursing_task_board.rs` | nursing tasks and board projections. |
| `observations_monitoring.rs` | observation/vital monitoring projections. |
| `staff_assignments.rs` | active/inactive ward staff assignments and assignment-based ward-board scope checks. |
| `ward_stock.rs` | ward stock request and movement persistence. |

## Query Rules

- Facility scope must be part of predicates for ward, bed, admission, nursing,
  and stock queries.
- Hot list projections must select only fields used by DTOs.
- Avoid per-row existence/count follow-up queries; use joins, `EXISTS`, or
  projection queries.
- Use `[start, end)` timestamp ranges for date filters.
- Keep admission/bed transition writes atomic and auditable.
- Ward analytics should calculate bed-days from admission interval overlap
  rather than deriving report data from current bed state alone.
- Ward staff assignment queries must join practitioner profiles back to active
  users and remain facility-scoped. Active assignment uniqueness and primary
  ward selection are enforced in the database with partial indexes, and
  assignment rows must keep ward/practitioner/user references in the same
  facility.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-db ward -- --nocapture
```

`prn.rs` owns explicitly indicated source-linked PRN requests. It shares the
prescription-before-dose lock order with generation, pharmacy supply and outcomes;
one unresolved dose, actual rolling limits, active admission, immutable policy and
captured inventory units are enforced transactionally. No legacy four-dose limit
or phantom supply is inferred. Request audits contain identifiers/event types only.

Fluid evidence revisions and monitoring live in `fluid.rs` and `fluid/`. New
commands append immutable paired observations/actions, reserve exact client
requests, lock the source root, and update effective daily projections with the
audit in one transaction. `include_closed` is a bounded review mode for voided
roots; aggregates always use effective rows. See
`docs/v2/2026-10-16-fluid-observation-scope.md` for policy and acceptance boundaries.

Scoped treatment-header, nursing-alert and handoff queries apply typed predicates
before deterministic timestamp/ID cursors. Patient-bearing source joins require
same-facility patient/admission consistency. Priority alert status/severity is a
SQL predicate, never a filter of a truncated facility preview. One repository
query supplies each page; migration014 adds matching scoped cursor indexes.

Patient narratives use migration015 separate from shift headers. Root→actor/session
→ward-assignment locks fence protected reads and revisions; all API reads carry a
DB-clock deadline. Root/revision/hashed command/PHI-free audit persist atomically.
Selected-patient and recipient pages use one shaped data query plus a constant
proof cost. See `docs/v2/2026-10-16-patient-handover-scope.md`.
