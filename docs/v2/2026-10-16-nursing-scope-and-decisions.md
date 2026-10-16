# Nursing observations and task decisions

Status: implemented scope, focused acceptance recorded separately
Owner: Backend/Ward Engineering

This slice governs the existing general nursing task, scalar vital, alert and
monitoring-event operations. It does not implement admission/discharge advisory
case tasks, priority, acknowledgement/escalation of general tasks, completion
notes, clinical signing, or a patient-specific standalone workspace.

## Access and ward relationship

All eleven task/vital/alert/event HTTP operations require the actual Nursing
feature, `nursing.task.manage`, demographics workflow access and the relevant
clinical data class. Scalar vital reads allow ClinicalSummary or FullClinical.
Task titles/instructions, alert titles, monitoring summaries and every write
require FullClinical. A role name never supplies missing data visibility.
Operational ward-board counts remain separate from these narrative projections.

An ordinary caller needs an active ward staff assignment through an active local
practitioner/staff/user chain. The existing `ward_board.view_all`, admin staff or
admin authority permission supplies explicit all-ward scope; FullClinical alone
does not. An unscoped list is limited to the caller's assigned wards. An explicit
unassigned ward is forbidden. Same-facility patient/admission joins, actual ward
scope and every filter execute before cursor comparison and LIMIT.

Tasks use their persisted original `nursing_tasks.ward_id`. A transfer does not
rewrite that history or give the destination ward authority over the old task.
Vitals, alerts and monitoring events have no historical ward snapshot; their
relationship is explicitly the admission's current ward. The implementation does
not claim or backfill a historical ward for those records. Patient/admission
filters must identify the same care context. For captured tasks a selected ward
refers to the task ward, so it can differ from the admission's current ward.

## Paging and projections

Existing operation names and paths remain. Task queries accept patient,
admission, ward, stored `task_type`, stored `status`, `due_from`, `due_before`,
`descending`, cursor and limit. Vital queries accept patient, admission, ward,
`recorded_from`, `recorded_before`, `descending`, cursor, limit and the existing
`hours` lower bound. The later of hours and recorded_from wins. Monitoring queries
accept patient, admission, ward, event_kind, the recorded range, order and page.
Alert queries retain their existing typed severity/status/critical/time fields.
Unknown fields receive a generic typed 400 without echoing submitted values.

Timestamp ranges are UTC `[from, before)`. Default order remains ascending;
descending is explicit. Cursor comparison follows that order. Pages default to25,
cap at100 and fetch one extra row for completeness. Scalar vital DTOs contain no
narrative. Task responses additionally expose the actual captured ward, optional
assignee and saved completed/cancelled actor/time. Old missing provenance stays
null; no historical clinician or time is inferred.

## Authority lifetime and care context

Every production operation carries a mandatory server-derived actor/session/
profile/version/authority deadline into the transaction. There is no public
optional-proof mode. Facility, current user, exact live refresh session and
assignment evidence are locked; database clock checks after waits and immediately
before commit reject expired authority. Current profile/version/session and actual
effective Nursing entitlement are reread under that proof. Mutation audits contain
only event types and opaque identifiers.

The two existing facility-entitlement update/delete repositories now take the
facility parent FOR UPDATE before publication. Nursing holds that parent FOR SHARE
through its protected transaction, so an override insertion/removal cannot race an
unlocked missing-row read. The existing API writer paths use those two functions.
Raw SQL imports/operator writes outside these repositories are outside this
publication guarantee. Existing handover and other workflows are not rewritten.

Task and vital creates accept an optional reviewed patient_id and reject a mismatch
against the selected admission before calling persistence. Admission-only callers
remain compatible. Creates revalidate and hold the actual same-patient active admission/current ward
(`admitted` or `discharge_pending`) through commit. New vitals require at least one
real measurement; existing numeric range rules are preserved. Migration018 leaves
old empty imported rows readable while rejecting new empty rows. Optional task
assignees must have actual active local ward membership; assigning a task does not
grant the recipient access.

Task commands take the source task row before actor proof, then assignment and,
for completion, the active admission. Other nursing writes take actor/assignment
proof before admission. Existing discharge/transfer paths do not take reverse
nursing child locks. Lists use one shaped data query plus a constant proof cost,
without per-row lookups: seven observed queries for explicit all-ward authority,
nine for an assignment-scoped page, excluding transaction framing. Explicit scope
validation adds a constant number of preliminary lookups.

## Terminal decisions and uncertain results

General tasks move only Open→Completed or Open→Cancelled. Source-row locking
serializes competitors. A different terminal decision returns409; a same-state
request under current authority returns preserved evidence without changing the
original actor/time or adding another audit. Completion requires the current
active admission to remain in the task's captured ward. Cancellation may retire an
old task after care closure/transfer under captured-ward authority and does not
claim care was performed. Existing historical terminal records remain readable
without fabricating missing evidence.

Alert acknowledgement preserves the existing first open→acknowledged actor/time
and audit. It uses current-admission ward authority, including historical review;
it does not reopen an alert or rewrite a prior acknowledgement.

These bodyless task commands reject additional request bodies, including unsupported
completion notes; they are not UUID command receipts. A generic write or
commit failure returns `nursing_write_unconfirmed`: the client must retain its
uncertain result and refresh/review before another action. There is no automatic
retry or promise of an immutable exact-command lookup. Typed authority/context/
assignee/terminal denials are definite. Create responses are persisted records,
not guarantees that later care context or authority remains unchanged.

## Acceptance

Focused tests call the production repositories and real HTTP router. They cover
Summary scalar reads vs Full narrative/writes, missing Nursing feature, strict
shape/value rejection, disjoint ward paging/cursors, malformed legacy tuples,
captured-vs-current ward semantics, optional assignee eligibility, concurrent
terminal decisions, audit rollback, current care closure, assignment retirement,
real source/facility lock waits followed by session revocation or natural managed
permission expiry, and both publication orders for feature update/delete.

## Separate ward-round producer

`hms-db/src/ward_rounds.rs::commit_nursing_task_action` is a separate active task
producer. The service's commit path requires FullClinical, evaluated Chronicle
access, writable clinical authority and Nursing workflow permission for a nursing
action. The repository locks the round and admission, checks draft/version and
admission state, then inserts the task from the saved action. It does not yet use
this slice's mandatory live nursing proof, ward-assignment or optional-assignee
validation. Those exact commit-lifetime/eligibility seams remain a separate next
slice; this document does not claim every task producer is repaired.
