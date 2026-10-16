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
- MAR lists accept patient/admission scope, effective status, `[scheduled_from,
  scheduled_before)` UTC bounds, and a deterministic schedule/id cursor.
  Patient/admission filters must be authorized and applied before pagination;
  mismatched patient/admission pairs are rejected. Unspecified ordering remains
  ascending; history may explicitly request descending order.
- MAR `/outcome` requires an explicit typed decision. Actual sourced
  administration requires pharmacy supply; nonadministration requires a bounded
  reason and retains distinct server actor/time evidence. Prescription-before-
  dose locks serialize competing decisions; exact replay cannot rewrite history.
  Independent nurse holds never acquire the reversible prescription-hold marker.
  A generic persistence/commit failure is unconfirmed, not proof of no write.
- Fluid lists use patient/admission scope and `[recorded_from, recorded_before)`
  bounds before schedule/id pagination. Summary and daily-trend reads require a
  patient or admission, authorize that scope, and reject mismatched pairs.
  Summary totals aggregate all scoped rows independently of list limits; daily
  aggregates are complete per UTC day and cursor-paginated. Date expressions
  belong in aggregation only, never in the indexed timestamp range predicates.
- External side effects belong in worker jobs or later async paths, not inside
  open DB transactions.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test ward_contract
cargo test -p hms-db ward -- --nocapture
```

The MAR service exposes admission-scoped `prn-orders` and `prn-dose-requests`.
Patient access is checked before repository reads/writes; DTOs require an explicit
source, stable UUID and actual indication. Typed clinical denials are definite;
generic storage/commit failures use `prn_request_unconfirmed` for refresh/review.
PRN administration uses the existing explicit outcome workflow and recorded supply.
See `docs/v2/2026-10-15-prn-scope.md` for lifecycle and compatibility boundaries.

`fluid.rs` owns rich fluid observations, source/history authorization,
correction/void commands, complete category summaries, server assessments, and
versioned facility rules. Patient operations require the nursing workflow gate;
facility rule publication requires `AdminAuthorityManage`. Generic write errors
have an explicit unconfirmed code so clients retain their exact command.

Treatment-header and nursing-alert reads use typed patient/admission/ward scope
before bounded cursor pages. Handoff-header queries support only actual ward,
shift, status and creation-time fields; no patient association is inferred.
The critical alert preview filters open high/critical state in SQL before LIMIT.
See `docs/v2/2026-10-16-scoped-nursing-lists.md` for access and paging semantics.
