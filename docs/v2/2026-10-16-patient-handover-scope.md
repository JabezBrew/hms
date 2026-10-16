# Patient narrative handover

Status: implemented source; parent checkpoint acceptance and release remain separate.

Patient handover is a nursing narrative launched from Patient Chronicle. The
existing ward shift header remains a separate sender-finalized operational
record. Neither workflow sends a message or records recipient acknowledgment.
Legacy Django `ShiftHandoff` supplies the patient, shift and seven narrative
concepts; its mutable CRUD behavior is not copied into clinical evidence.

## Contract and access

The new `/api/v2/nursing/patient-handovers` family exposes nine operations:

- `GET /` returns lean patient-scoped metadata, with optional admission, shift
  date and voided-record filters applied before cursor pagination.
- `POST /` records a handover for an active admission in its locked current ward.
- `GET /recipients` pages active same-facility nursing assignments for the
  specified patient/admission. Optional `handover_id` uses the original captured
  ward for a historical correction, rather than a later transferred ward.
- `GET /{id}` returns the current evidence.
- `GET /{id}/history` pages lean revision metadata; `GET
  /{id}/revisions/{revision_id}` expands one exact immutable revision.
- `POST /{id}/amend` appends a full reviewed replacement narrative, shift and
  intended recipient with expected revision and reason.
- `POST /{id}/void` appends a terminal void revision with a reason. It preserves
  the preceding text and does not physically delete evidence.
- `GET /requests/{request_id}?patient_id=…` retrieves the original actor's
  immutable saved command receipt. Current detail is a separate read.

Every route requires the Nursing feature, `nursing.task.manage`, demographics
visibility, FullClinical patient access and facility scope. FullClinical alone
is not ward authorization: the caller must have existing all-ward authority
(`ward_board.view_all` or the established admin staff/authority rule), or an
actual active ward assignment. Lists filter each record's original ward before
LIMIT. Detail, revisions and receipts check that original ward again inside the
transaction. The author has no implicit visibility bypass after losing ward
access. A discharged admission remains readable and author-correctable while
current patient and original-ward authority remains valid.

The author is always the current server identity. Only that author may amend or
void; there is no broad edit permission or recipient edit grant. Optional intended
recipient is documentation, never a permission grant, delivery promise or inbox
receipt. Newly selected recipients must still be active local ward nurses.
Unchanged retired recipients remain in historical corrections and never prevent
voiding an obsolete report.

## Evidence and transaction behavior

The strict DTO requires all seven string keys: current condition (required,
4000 characters maximum), ongoing issues, pending tasks, medication changes,
key events, care-plan updates and family updates (each explicit, at most 2000
characters and permitted empty). Shift is explicitly day/evening/night and the
calendar shift date is displayed as UTC. Correction/void reason is required and
bounded at 2000 characters. Unsupported fields are rejected with generic typed
400 responses without echoing values.

Migration015 introduces separate roots, immutable revisions and hashed-UUID
commands; no ward headers are inferred or backfilled. Scope and original author
are immutable. A root lock serializes amendments and voids; expected revision
rejects a competing stale edit. Root update, revision, minimal audit and completed
receipt commit atomically. Audit metadata contains revision numbers only, not
narratives, change reasons or recipient names.

A nonzero request UUID is bound to the actor, patient, operation, target and
normalized payload digest. Exact replay returns its original saved revision even
if another correction/void or discharge happened later. A different payload or
actor cannot reuse the request. Failed transactions leave no reservation,
revision or partial audit. Database constraints prevent committed incomplete
commands and mutation of completed receipts or clinical revisions.

All HTTP operations carry the server's authorization deadline. Protected root
reads lock root → current actor/session → original ward assignment, then check the
DB clock before returning. Writes use the same proof after source/context waits
and before commit. Active facility/profile, user/session/permission versions,
unrevoked session expiry, natural managed-authority expiry and any required
fresh offsite proof bound that deadline. Lean list and recipient queries run on
the verified transaction connection with a final deadline check. No transaction
spans external I/O or borrows a second pooled connection for protected data.

## Bounded reads and UI

Lists and recipient/history pages default to 25 rows and cap at 100. Each page
uses one shaped data query plus a constant number of access/proof queries;
there are no per-row existence or count queries. Patient/admission indexes and
stable timestamp/UUID cursors bound the selected data; history expands one
revision at a time. No whole-facility client sweep, invented total or complete
history claim is made. Date filters compare calendar date fields directly;
no timestamp `DATE(column)` range filter is introduced.

The lazily loaded Chronicle panel requires authoritative current
`startup.permissions.can_view_full_clinical`, plus its own Nursing/capability
guards and server-confirmed reads. Summary-only direct query navigation mounts
a denied explanation. The selected Chronicle admission (current admission fallback) and all authorized patient history are
explicit scopes; voided reports remain reachable through the review toggle.
Original ward and earlier-admission context are shown without exposing raw IDs.

All fields and the patient identifier are reviewed before saving. The controller
retains the exact frozen command across ordinary close/reopen, while the closed
portal is absent from the DOM and its queries are disabled. Pending Escape,
outside click and close cannot discard the command. Patient/admission,
authority/capability or current access-proof changes unmount copied clinical
state. Current read denial hides cached evidence immediately. No global toast
contains the narrative or stale patient result.

Writes never automatically retry. Lost/invalid replies and generic commit
failures remain unconfirmed; only the exact original request can be retried or
looked up. Missing recovery results do not authorize another request. Typed
receipt validation compares the exact patient/admission, author/recording actor,
request, revision, shift, recipient and all fields. An exact selected revision ID
is required before displaying historical evidence. A known save followed by a
read failure stays saved, while protected receipt content remains hidden until
access is reconfirmed. The shared opaque uncertainty barrier survives controller
remount/reload, blocks a different write and stores no narrative, patient ID,
raw URL or token. Only validated original recovery acknowledges that attempt;
manual workflow-review acknowledgment follows the shared policy separately.

## Verification and remaining scope

Focused contracts cover concurrent identical creates, competing revisions, audit
rollback, discharge and recipient/assignment waits, immutable history/recovery,
121 unrelated rows before selected-patient pagination, bounded recipient pages,
ward assignment denial despite FullClinical, disabled Nursing, demographics-only
denial, unsupported fields and mismatched/foreign admission tuples.

Actual HTTP lock tests queue all four protected evidence GETs and a write while
managed Nursing authority is live, then naturally expire it or revoke the session
before releasing the row. They require typed403 and unchanged evidence/audit.
The initial read regression returned200; the mandatory proof repair makes it403.

Generated-client tests verify actual flat payloads/options, query scopes and
AbortSignal, malformed receipt and wrong historical revision rejection, uncertain
409/network behavior and opaque durable recovery. Actual panel/Host tests cover
review, seven fields, pending dismissal, known save/read failure, exact UUID
close/reopen/recovery, failed lookup, voided history, scope/proof changes (including selected Chronicle admission), closed
DOM/read behavior, and real adapted Chronicle identifiers. Browser validation
and checkpoint-wide test/build/migration acceptance are parent-owned release
gates; focused source results alone are not a live deployment claim.

Delivery, recipient acknowledgment, inbox routing, shift task execution, medication
ordering from narrative text, imports of unassociated ward headers and external
integrations remain outside this slice. No unsupported completion claim is shown.
