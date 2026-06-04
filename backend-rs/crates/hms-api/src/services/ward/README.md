# Ward API Services

Status: active
Owner: Backend/Ward Engineering
Last reviewed: 2026-06-01
Scope: ward, bed, admission, discharge, nursing, MAR, handoff, monitoring, and ward-stock workflow services.

## Purpose

`services/ward/` is the API-layer workflow seam for inpatient work. Handlers in
`handlers/ward.rs` translate HTTP shape into these service calls; persistence
lives in `hms-db::ward`.

## Module Map

| Module | Owns |
| --- | --- |
| `mod.rs` | public service exports and shared ward service assembly. |
| `common.rs` | shared request/response helpers, scope translation, and workflow utilities. |
| `admin.rs` | ward, section, bed, amenity, and staff-assignment administration. |
| `bed_management.rs` | bed layout, bed status, assignment, hold, and movement workflows. |
| `admission_cases.rs` | admission-case creation, status transitions, and active inpatient context. |
| `discharge_cases.rs` | discharge planning, discharge completion, and discharge summaries. |
| `handoff.rs` | shift handoff creation, review, and acknowledgement. |
| `mar.rs` | medication administration record workflows. |
| `nursing_task_board.rs` | nursing task list, assignment, status, and board projections. |
| `observations_monitoring.rs` | vitals/observation monitoring and alert-facing projections. |
| `ward_stock.rs` | ward stock requests, availability, and transfer-facing workflow. |

## Invariants

- Patient-bearing ward operations must use `hms-access::RequestContext` and
  patient or ward visibility checks before service data is returned.
- Lists must stay bounded and use deterministic cursor or server-side
  pagination behavior.
- Operational bed maps are complete ward snapshots. Keep them separate from
  paginated bed-management lists and return only bed state, section placement,
  and operational occupancy timestamps after patient-workflow access is
  authorized.
- Admission and bed state transitions must be coordinated through the service
  interface; callers should not assemble them with independent repository calls.
- MAR, observation, and handoff paths must keep PHI out of logs and metric
  labels.
- External side effects belong in worker jobs or later async paths, not inside
  open DB transactions.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test ward_contract
cargo test -p hms-db ward -- --nocapture
```
