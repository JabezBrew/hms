# Ward Round reviewed commands

Status: local implementation and focused verification; release acceptance is
recorded separately. This scope covers Patient Chronicle Ward Round workflows,
not general admission advisory tasks or a new signing policy.

## Reviewed workflow

The current-workspace GET accepts an optional explicit `admission_case_id` and
returns the authorized patient/admission/ward, actual admission status, current
permissions and `ward_round: draft | null`. A previous committed round is never
presented as an editable current draft. Exact detail and original request receipt
reads require current Full Clinical visibility and Chronicle patient access.

`POST /api/v2/patients/{patient_id}/chronicle/ward-rounds/draft` saves one complete
snapshot: stable `client_request_id`, nullable `ward_round_id`, `expected_version`,
selected admission, structured note sections, independently reviewed rendered note
and the complete ordered action list. Version zero applies only to a new draft;
an existing admission draft must be loaded and reviewed. Existing draft saves use
an exact version and atomically replace only draft actions. No client delete/add
loop or silent overwrite is required.

`POST .../ward-rounds/{round_id}/commit` accepts a stable request UUID and exact
version. It atomically revalidates and commits the note snapshot, every selected
action, artifact links, round signer/time, minimal audit evidence and an immutable
original result. A failure rolls the entire transaction back. The committed
Ward Round remains its own Chronicle evidence; this command does not create a
separate clinical note revision or claim additional signature governance.

`GET .../ward-rounds/requests/{request_id}` recovers the original actor-bound
result. Exact same-key/payload replay returns that immutable snapshot even if the
admission later closes or the source later changes, but current read authority is
still required. Saved receipt permissions are read-only evidence; a fresh
workspace/detail supplies current controls. There is no automatic retry with a
new key after an uncertain write.

Previous individual draft/action HTTP mutations perform access checks and return
`ward_round_atomic_draft_required`. Protected historical detail remains readable
when its evidence is complete and bounded. Compatible explicit legacy note/task
drafts can be freshly reviewed through detail and exact version; ambiguous legacy
payloads require an aggregate save. More than 100 children or inconsistent
facility/patient/admission tuples return a review-required response, without
truncation, foreign narrative or deletion of the original evidence. Legacy plain
repository helpers remain trusted fixture/import compatibility, not public write
interfaces; this slice does not certify arbitrary direct database writers.

Cancelled action rows remain historical evidence and are never queued or executed
again. A Draft parent with already-Committed children or existing artifact links
is ambiguous prior work and returns review-required rather than treating it as a
fresh complete draft. Its rows are preserved for reconciliation; an aggregate
save cannot silently erase or certify those prior outcomes.

## Supported actions

- Scheduled prescription starts require explicit medication, clinical dose,
  route, frequency, start date, instructions and reason. Optional duration and
  first-dose time are validated. These starts are unlinked to stock and generate
  no MAR automatically. PRN, stock-linked treatment, renewal and replacement use
  the existing prescription panel and its reviewed safety policies.
- Prescription status decisions pin the canonical prescription detail token and
  actual requested status. Terminal courses cannot be resurrected, generated
  regimen/history guards remain in force, and a same-state decision does not
  rewrite the source lifecycle evidence.
- A laboratory action selects every explicit local active test/panel. The saved
  review includes panel names/codes and all expanded tests; commit rechecks the
  selection, labels and membership. Maximums are 100 selected references and
  500 expanded tests. Each indexed panel membership read is capped at 501 before
  materialization, so imported oversized panels cannot produce an unbounded
  response.
- Nursing tasks use explicit title, instruction, due time, existing task type
  and optional assignee. The actual current admission ward, Nursing feature,
  task permission and active same-ward practitioner eligibility are checked
  inside the transaction. The resulting task captures that ward under the same
  admission lock.
- A discharge action creates/reuses only a requested discharge case and marks
  the selected admission discharge-pending. It does not bypass discharge
  blockers, complete discharge or reopen a cancelled/completed case. Narrative
  readiness notes do not alter the canonical discharge blocker assessment.

Action payloads retain the normalized reviewed input, including prescription
operation and expected source token. `reviewed_targets` retains human-readable
source snapshots for saved-draft review instead of requiring opaque IDs as labels.
Commit refuses substituted catalog/source evidence. The review rail is refreshed
from actual sources; its legacy `discharge_blocker_count` field counts requested
discharge cases, not the canonical number of blockers, and must not be presented
as a readiness assessment.

## Authorization and transaction ordering

New public reads and commands carry mandatory resolved actor/session/profile,
version and authority-deadline proof. After lock waits the repository verifies
the active local facility, actor and exact live session, actual feature
entitlements, Chronicle relationship source and current Full Clinical request
authority. Effective permission/delegation expiry, session revocation and
offsite-freshness deadlines cannot be extended by waiting on a source row.
Relationship rows are retained under shared locks, and break-glass expiry caps
the final deadline. No role implies clinical visibility.

Commands serialize their stable request reference, then lock the round parent
before mutable children. Existing prescriptions are locked in sorted order before
actor proof. PRN groups are locked in sorted order after actor proof and before
discharge/admission, preserving sibling-course request/supply/outcome ordering.
Discharge cases precede admission locks, matching canonical discharge writers.
Admission/ward, optional care parents and clinical child writes follow. Actual
features and authority deadlines are checked after waits and before commit.

Audit entries contain IDs, action enums and version only; clinical note text,
instructions, names, credentials and submitted bodies are not logged. Bulk
prescription review and bounded laboratory selection avoid per-action metadata
fetches. These focused tests establish transaction behavior, not a p99 benchmark.

## Verification

`hms-db --test ward_round_commands` covers exact CAS/receipt recovery,
immutable results, ward/assignee/features, current active admission, complete lab
selection, human target changes, oversized/inconsistent legacy children, atomic
audit rollback, aggregate edit/commit races, canonical supply versus round
stop/discharge in both orders, sibling PRN group concurrency and canonical
discharge cancellation.

`hms-api --test ward_round_commands_contract` exercises actual protected routes,
strict generic input errors without clinical echoes, Full visibility, ward and
assignee denial, foreign-child refusal, session revocation and natural managed
clinical/nursing authority expiry while commands/reads wait on a real row lock.
Existing `ward_rounds` and `medication_lifecycle` suites retain compatibility and
lifecycle evidence checks.
