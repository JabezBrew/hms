# Ward API Services

Status: active
Owner: Backend/Ward Engineering
Last reviewed: 2026-06-06
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
| `admin.rs` | ward, section, and bed administration. |
| `analytics.rs` | ward occupancy, length-of-stay, admission, discharge, and utilization aggregate reporting. |
| `bed_management.rs` | bed layout, bed status, assignment, hold, and movement workflows. |
| `admission_cases.rs` | admission-case creation, status transitions, and active inpatient context. |
| `discharge_cases.rs` | discharge planning, discharge completion, and discharge summaries. |
| `handoff.rs` | shift handoff creation, review, and acknowledgement. |
| `mar.rs` | medication administration record workflows. |
| `nursing_task_board.rs` | nursing task list, assignment, status, and board projections. |
| `observations_monitoring.rs` | vitals/observation monitoring and alert-facing projections. |
| `staff_assignments.rs` | ward staff assignments, role catalog, and current-user ward-board context. |
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
- Ward analytics must be backed by aggregate admission/bed projections. Do not
  expose placeholder zeros for unavailable measures such as ward transfers or
  ward-attributed revenue until a real source table/contract exists.
- Ward analytics date filters are calendar dates, interpreted as an inclusive
  start/end range and converted inside the service to `[start, end)` timestamps.
- Ward-board reads are assignment-scoped unless the user has
  `ward_board.view_all` or admin staff/authority permission. Keep
  `/api/v2/wards/my-board-context` aligned with the same assignment source used
  by staff-assignment management, and do not treat the plain Wards feature as
  permission to load the house board.
- Ward-board rows are sourced operational projections, not placeholders. Keep
  the list DTO limited to admission/census fields plus lightweight counts and
  timestamps from nursing tasks, MAR, alerts, vitals, lab review/order state,
  and discharge blockers. Do not expose free-text blocker reasons, result
  values, note bodies, or broad patient clinical records in the hot board list.
- Discharge blocker sources must match the current discharge/admission by
  `admission_case_id`, inherited `encounter_id`, or inherited `visit_id`; do not
  clear or block a current discharge from patient-wide legacy notes, invoices,
  or dispenses that lack care-journey provenance.
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
