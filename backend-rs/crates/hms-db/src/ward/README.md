# Ward Repositories

Status: active
Owner: Database/Ward Engineering
Last reviewed: 2026-06-01
Scope: ward, admission, bed, discharge, handoff, MAR, nursing, monitoring, and ward-stock persistence.

## Purpose

`hms-db::ward` owns SQLx repository behavior for inpatient workflows. API
services call these repository interfaces; handlers should not know table or
query details.

## Module Map

| Module | Owns |
| --- | --- |
| `mod.rs` | public ward repository exports. |
| `admin.rs` | ward, section, bed, amenity, and staff-assignment persistence. |
| `bed_management.rs` | bed status, assignment, layout, transfer, and occupancy queries. |
| `admission_cases.rs` | admission-case state, active admissions, and admission workflow queries. |
| `discharge_cases.rs` | discharge planning and discharge completion persistence. |
| `handoff.rs` | shift handoff records and acknowledgement state. |
| `mar.rs` | medication administration record persistence. |
| `nursing_task_board.rs` | nursing tasks and board projections. |
| `observations_monitoring.rs` | observation/vital monitoring projections. |
| `ward_stock.rs` | ward stock request and movement persistence. |

## Query Rules

- Facility scope must be part of predicates for ward, bed, admission, nursing,
  and stock queries.
- Hot list projections must select only fields used by DTOs.
- Avoid per-row existence/count follow-up queries; use joins, `EXISTS`, or
  projection queries.
- Use `[start, end)` timestamp ranges for date filters.
- Keep admission/bed transition writes atomic and auditable.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-db ward -- --nocapture
```
