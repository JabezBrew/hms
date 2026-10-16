# Scoped nursing list contract

Status: implemented source; parent integration owns checkpoint acceptance.

The existing treatment-sheet, nursing-alert and handoff read operations use typed
bounded cursor queries. All filters apply in SQL before the cursor and limit.
The response is a page, never a declaration that a facility collection is complete.

- Treatment headers support patient, admission, ward, exact sheet date, status and
  exact header ID. Their patient and admission references must agree in the same
  facility. These are daily header records, not the legacy treatment/supply-line
  workflow. The active Chronicle treatment grid remains backed by scoped MAR.
- Nursing alerts support patient, admission, ward, status, exact severity,
  high-or-critical-only and `[created_from, created_before)` UTC bounds. The
  notification monitor requests only open high/critical alerts in descending
  order. It shows one newest page; overflow and failed refresh are explicit and
  link to the ward board's urgency view. It does not load every facility record
  or report a complete count. Older acknowledged or low alerts cannot hide the
  qualifying page.
- Handoff headers support ward, shift label, status and the same UTC creation
  bounds. Existing rows have no patient/admission association or clinical
  narrative. Patient/admission query fields are rejected rather than ignored.
  Filtering creation day does not invent a dedicated clinical shift-date field.

All three retain ascending order when direction is omitted; explicit descending
order reverses both timestamp and ID. Clients use the returned opaque cursor,
include the complete normalized query plus sanitized authorization scope in the
cache identity, and reset paging when filters change. Only a process-salted hash
of request fields enters new list keys; request text is not retained in keys.
Malformed or out-of-scope pages, duplicate IDs and repeated cursors fail the read.
Later-page errors remain unavailable; no previous page is substituted as complete.
AbortSignal and AbortError are preserved.

Patient-bearing requests require Nursing, nursing task permission, demographic
permission/visibility and same-facility patient/admission access before the list
projection. Conflicting patient/admission/ward tuples are rejected. Exact treatment
ID reads resolve minimal access context before selecting patient-bearing fields.
Header-only handoffs require Nursing plus the existing facility permission and
validate explicit ward scope. They acquire no invented patient permissions.

Repository list pages use one measured query, deterministic tuple cursors and
minimal existing DTOs. Migration `202610160014_scoped_nursing_lists.sql` supplies
facility/patient/admission/ward cursor indexes plus an open high/critical alert
index. Date conversion belongs in the adapter; timestamp predicates never wrap
source columns in date functions. SQL joins fence source, patient and admission
facility consistency.

Remaining parity includes treatment medication/supply entries and lifecycle,
patient handover narratives and governed delivery/acknowledgment. This slice does
not implement those workflows or infer a patient association from current ward membership.

Verification includes 5,000 historical alerts plus open low alerts, priority
selection before limits, tied-timestamp paging, half-open bounds, coherent source
joins, foreign facility/admission denial, explicit access gates, real generated
client query serialization, cache privacy and scope/direction/cursor isolation,
malformed and failed later pages, and bounded monitor overflow/unavailability.

The owned treatment-create, alert-create/acknowledgment and handoff write paths
also require Nursing before workflow data or writes. Handoff creation locks and
validates an active local ward plus active local sender/recipient in the same
transaction as its minimal audit. Reference deactivation cannot race past the
validation. Rejected references and audit failure leave no header/audit side
effects. Header creates reject unsupported fields instead of discarding patient
narrative or medication facts silently.

Alert acknowledgment performs one atomic open-to-acknowledged transition with a
minimal actor-attributed audit in the same transaction. Later acknowledgments,
including another actor's concurrent request, return the original receipt without
changing its actor, timestamp or audit. Historical missing actors remain missing.
The client requires the exact alert ID and an acknowledged timestamp before
reporting success; ambiguous responses require refresh/review and never trigger
an automatic mutation retry.

`POST /nursing/handoffs/:id/complete` finalizes the sender's shift header. Only
`from_user_id` may finalize; it is not a recipient receipt or acknowledgment.
The source row lock serializes competing finalizations, preserves the original
`completed_at`, and produces one actor-attributed transition audit. Repeats return
the same confirmed header without changing timestamps or adding audit events.
Historical inactive recipients remain readable. Python's ShiftHandoff model/view
has narrative CRUD but no completion or acknowledgment operation; that legacy
behavior was not used to invent recipient acknowledgment here.

Generic handoff storage/commit failures use an explicit unconfirmed error code.
Header creation and finalization hooks disable automatic mutation retries. The
global opaque write-review guard preserves uncertainty across controller loss;
this slice does not invent request-key idempotency for a non-keyed create.
