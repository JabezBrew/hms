# HMS Engineering Contracts

Status: active
Owner: Engineering
Last reviewed: 2026-10-17
Scope: durable Interfaces that code, tests, deploys, and frontend integrations rely on.

## Contract Registry

| Contract | Source of truth | Owner | Consumers | Verification |
| --- | --- | --- | --- | --- |
| Rust V2 HTTP contract | `backend-rs/openapi/hms-v2.openapi.json` generated from `hms-api` | Backend owner | frontend V2 bridge, smoke scripts, ops checks | from `backend-rs/`: `cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json` |
| Frontend V2 bridge | `frontend/src/lib/api/v2/` and bridge tests under `frontend/src/lib/api/__tests__/` | Frontend/backend integration owner | feature APIs, pages, hooks | from `frontend/`: `npm run api:v2:generate:check`, targeted bridge tests |
| Request context and access | `backend-rs/crates/hms-access/` | Security/backend owner | handlers, services, repositories, audits | from `backend-rs/`: `cargo test -p hms-access` |
| Repository behavior | `backend-rs/crates/hms-db/` | Database owner | services, migrator, worker | focused `hms-db` tests |
| API handler/DTO behavior | `backend-rs/crates/hms-api/tests/` | Backend owner | frontend bridge, external clients, smoke checks | focused `hms-api` contract tests |
| Migrations and provisioning | `backend-rs/migrations/`, `hms-migrator` | Database/operations owner | deploys, seeds, restores | fresh-database migration/provisioning checks |
| Events and jobs | `backend-rs/crates/hms-events/`, `hms-worker` | Backend/worker owner | async workflows, projections, audits | worker tests and event contract tests |
| Realtime subscriptions | Rust V2 WebSocket/realtime modules and `hms-access` guards | Security/backend owner | frontend realtime hooks, ward/patient dashboards, alerts | subscription authorization tests and PHI-safe channel tests |
| Performance metrics | `docs/performance/performance-budget.md` | Performance owner | load harness, ops dashboard, deploy gates | `tests/load/scripts/run-rust-v2-regression.sh` |
| Deployment runtime | `ops/free-testing/README.md`, `ops/gcp-staging/README.md`, `ops/compose-v2/README.md`, compose/env files | Operations owner | synthetic testing with optional public login, staging, rollback, smoke, incident response | config/ops tests, local readiness, public or Access-protected health, anonymous API denial, authenticated workflow smoke, rollback evidence |

## HTTP Contract Rules

- OpenAPI is generated from Rust V2 source.
- Frontend callers should not hand-code endpoint shapes that already exist in
  the generated client.
- List endpoints must return lightweight DTOs, not full domain rows.
- Hot list endpoints must be bounded and cursor-paginated.
- Contract tests should assert access behavior, response shape, pagination, and
  error mode.
- Patient Directory, My Work, Outpatient, Inpatient, and Emergency are distinct
  surfaces. A global patient list must not be used as a frontend substitute for
  care-area work queues.
- Patient identity lookup uses `POST /api/v2/patients/identity/lookup`. The
  request may contain identity search fields, but the backend stores only a
  lookup fingerprint, candidate ids, timestamps, and reviewer facts. Raw names,
  DOBs, MRNs, phones, or free-text identity input must not be logged, cached, or
  used as metric/query-key labels.
- Lookup results may be rehydrated with
  `GET /api/v2/patients/identity/lookups/:lookup_id`. The lookup id is opaque
  and scoped to the same facility, user, and unexpired lookup session. This
  endpoint must return only bounded candidate projections and must not expose
  the original raw identity search fields.
- Patient creation through `POST /api/v2/patients` is guarded by backend
  duplicate detection. Possible matches require `duplicate_review.lookup_id`,
  `decision=new_distinct_patient`, and a reason. The write path must rerun
  duplicate detection under a write-path identity lock and reject stale,
  mismatched, or different-reviewer lookup sessions. Duplicate-candidate
  disclosure requires patient demographics visibility.
- Current care context projection uses
  `GET /api/v2/patients/:id/current-contexts` and returns lightweight OPD, IPD,
  and Emergency context rows for intake warnings and reuse. Current Emergency
  context means waiting or assigned triage, not completed triage.
- Care-area intake uses resolved patient ids:
  `/api/v2/care-areas/outpatient/intake`,
  `/api/v2/care-areas/inpatient/intake`, and
  `/api/v2/care-areas/emergency/intake`. These endpoints create or reuse
  bounded scoped care contexts and must not search or create broad patient
  lists. They require idempotency keys; the backend stores only key hashes and
  request fingerprints. Outpatient intake requires an explicit clinic context,
  and inpatient intake must reuse or redirect any current admission instead of
  creating a second current admission.
- Care-area work uses `/api/v2/care-areas/my-work` for bounded landing previews,
  `/api/v2/visits` with server-side `clinic_id`, `practitioner_user_id`,
  `status`, or `active_only` filters for OPD, `/api/v2/triage` with server-side
  `status`, `acuity`, or `assigned_to_user_id` filters for Emergency, and
  `/api/v2/wards/my-board-context` plus `/api/v2/wards/board` for Inpatient.
- Staff creation uses `POST /api/v2/admin/staff` with identity, employment,
  and optional practitioner facts only. The request must not accept
  administrator-entered Employee IDs or passwords, and the action requires
  fresh high-risk admin reauthentication. Rust V2 allocates the facility-scoped
  Employee ID server-side and creates a short-lived setup/reset token plus a
  PHI-safe account-setup event. The raw setup token is delivered only through
  the configured account-setup delivery channel while it is in memory; it must
  not be persisted in domain events, audit logs, or response bodies. Forced
  reset tokens must remain unusable until the finalization transaction commits
  session revocation, audit, and token activation.
- Public password-reset requests use the configured trusted account-setup
  delivery adapter with purpose `password_reset`. Disabled delivery accepts
  generically without issuing unreachable tokens. Webhook delivery is off the
  request path, has four admitted in-flight sends, a separate persistent
  ten-per-fifteen-minute account budget, a configured timeout and no redirects.
  Tokens exist only in the transient delivery link; persistence receives hashes
  and events contain no recipient/link/token. This in-process dispatch is not a
  durable delivery queue: provider failure or process termination requires a new
  request. Actual delivery requires operator configuration and sandbox evidence.
  Completing a reset or signed-in password change locks the account, fences
  stale password verification, invalidates all outstanding reset links and
  revokes sessions atomically. Password history preserves the previous hash.
- Ward-board list rows are lightweight sourced projections: census, alert
  counts, nursing-task counts/due timestamps, due MAR counts/timestamps, last
  vitals timestamp, unverified-result and pending-order counts, and discharge
  blocker counts/status. Do not put placeholder risk labels, result values,
  note bodies, discharge hold reasons, or broad patient clinical records in the
  hot board DTO.
- Discharge blocker source checks must be tied to the current discharge or
  admission care journey. A patient-wide legacy discharge summary, invoice, or
  dispense without `admission_case_id`, `encounter_id`, or `visit_id`
  provenance must not clear or block the current admission's discharge state.
- Clinical note template history uses bounded descending version cursors and
  metadata-only rows. Exact revision reads bind facility, template and revision;
  they never replace a missing selection with the latest revision. Recorded
  availability remains separate from current root availability. Scoped identity
  joins redact both foreign creator/owner IDs and names. Imported malformed
  content remains readable evidence without becoming an active copy source.
  A reviewed shared copy uses the existing new-template UUID command, fresh
  management authority and current ownership; it does not grant management of
  its source or establish private-sharing/copy-lineage semantics. Exact body
  copies preserve original text; structured edits must not round unknown JSON
  numbers or collapse duplicate metadata keys. Unsupported lossy structures
  require exact-content mode rather than silent reserialization.

## Access Contract Rules

Any endpoint that accepts a patient identifier must prove patient access before
returning or mutating data.

Access behavior belongs in `hms-access` and request context guards. It should be
covered through tests that call the same Interface production code uses.

Protected business and rich-read transactions retain the exact server-resolved
network-policy version through result construction and commit. An absent
version-zero policy may acquire its unchanged readonly sentinel; configured
proof is SELECT-only. A missing or superseded proof is a definite typed 403,
not an unknown write outcome. This proof grants no patient, ward, permission or
feature access. Own-account authentication and the policy writer's exclusive
compare-and-set protocol remain separate. Commands reviewing other users lock
only the facility and sorted reviewed actor/target users before their first
policy proof, retaining the later active/local eligibility checks.

Patient administrative profile access and Patient Chronicle access are separate
surfaces. Registration/front-desk/billing users may need demographics,
insurance, MRN/NHIS/contact, registration status, and current-context facts, but
they must not receive clinical notes, diagnoses, medications, lab results,
nursing documentation, or clinical timeline access merely because they can
confirm patient identity.

Ward-board access is scoped. Ordinary clinical users need `ward.view`, patient
demographics visibility, the Wards feature, and an active ward staff assignment
for the requested `ward_id`. Loading `/api/v2/wards/board` without a `ward_id`
is the house-board path and requires `ward_board.view_all` or admin
staff/authority permission; enabling the Wards feature alone must not grant
house-board access. The `/api/v2/wards/my-board-context` resolver is the
frontend source of truth for redirects and assigned-ward choices.

Authorization-sensitive cache keys must include all visibility-changing scope:
facility, user/profile, patient or ward scope, feature set, permission version,
and query parameters. Use opaque or sanitized identifiers only. Never put MRNs,
names, raw URLs, or free-text clinical identifiers in keys. Never share cached
patient, ward, dashboard, or search responses across users or facilities unless
the response is proven identical for all authorized callers.

## Realtime Contract Rules

WebSocket and realtime subscriptions must:

- authenticate the session before upgrade or subscription use
- bind the connection to facility and active profile scope
- authorize every channel join through `hms-access`
- enforce patient or ward visibility before joining patient/ward groups
- recheck permission-version changes and fail closed on stale authorization
- use PHI-safe channel names, metric labels, logs, and event payloads
- avoid putting patient identifiers, MRNs, names, or free-text clinical data in
  channel names

Polling is only a fallback. It must follow the same access and cache-scope rules
as realtime.

## Persistence Contract Rules

Repository Interfaces should describe product intent. SQL details should remain
inside `hms-db`.

Invoice finalization preserves the first finalizer, named reviewer and time
evidence and emits one finalization event. A valid repeat returns the protected
current invoice, not an immutable snapshot of later invoice balances. A named
billing reviewer must be a distinct active local user with current Billing
feature and manage authority; this attribution is not a second person's signed
approval. Financial commands check reviewer and acting-user time boundaries at
one final database clock. Reversals serialize on the payment parent before
reading the current ledger total. Repeating a staff activation state must not
revoke newly established sessions or append another transition event.

Clinical care context is a first-class persistence contract:

- Encounter/visit-scoped clinical events must store validated `encounter_id`
  and/or `visit_id` when the caller supplies that context. If both are supplied,
  they must describe the same patient journey.
- Patient administrative record status is not encounter/admission/care status.
  Discharge, checkout, triage completion, and admission cancellation must not
  imply patient-record deactivation.
- Patient identity status is split into administrative `record_status`
  (`registered`, `restricted`, `entered_in_error`, `superseded`) and
  `vital_status` (`presumed_alive`, `deceased`, `unknown`). Legacy
  `patients.status` is compatibility output only while callers migrate.
- Legacy status migration maps `active` to `registered + presumed_alive`,
  `deceased` to `registered + deceased`, and `inactive` to
  `restricted + presumed_alive + legacy_inactive_unreviewed`.
- Normal care intake must block `deceased`, `entered_in_error`, and
  `superseded` records. Restricted records require an explicit authorized
  override and auditable reason before care intake can proceed.
- `superseded_by_patient_id` must point to a same-facility registered canonical
  patient record. Cross-facility canonical links and chains through
  non-canonical records are invalid.
- Admission-scoped inpatient events should derive care journey context from the
  owning `admission_case` when a visit/encounter led to admission, instead of
  making every ward table repeat outpatient columns.
- Discharge-scoped records should remain tied to the admission case and carry
  the inherited or explicit care journey context for Chronicle, billing, and
  audit joins.
- Patient-longitudinal facts such as active problems and allergies remain
  patient facts. They may carry an originating context in future, but focused
  Chronicle views must not hide safety-critical patient facts merely because
  they are not owned by a single encounter.
- Billing rows must preserve clinical provenance when created from a clinical
  source. Invoice context (`encounter_id`, `visit_id`, `admission_case_id`) and
  line provenance (`source_type`, `source_id`, `is_auto_generated`) are
  additive audit fields, not substitutes for patient access checks.

For hot paths, repositories should prove:

- no table scan caused by avoidable date functions
- no N+1 queries
- stable cursor sort
- bounded limit
- selected columns match DTO needs
- facility scope is part of the predicate
- care-area hot lists use indexed filters for clinic, practitioner, ward,
  assignee, status, and stable cursor columns; frontend callers must not sort or
  filter partial server pages as a substitute.

## Frontend Bridge Rules

Feature API adapters translate generated Rust V2 response envelopes into the
shape expected by UI Modules. UI components should not need to know whether an
older compatibility shape or Rust V2 shape was used internally.

Adapters must preserve:

- `AbortSignal`
- `AbortError`
- server-side pagination
- feature gating
- PHI-safe, scoped query keys and browser events

Automatic mutation retry is disabled globally; reads retain their own retry
policy. A workflow may opt into replay only through its reviewed idempotency
protocol. Unexpected persistence or commit errors use an explicit
`*_unconfirmed` code and preserve the central opaque recovery barrier, including
HTTP 409 responses. Known validation, authority and business conflicts remain
definite. A status read never silently confirms an uncertain command: the user
must review the saved workflow and explicitly acknowledge its recovery notice
before a new non-idempotent change. Failed staff setup delivery is definite only
after confirmed account removal; failed or skipped compensation stays
unconfirmed.

Chronicle context handoff must preserve real workflow context. OPD and
Emergency links may set `visit=<encounter_id>` only when the list row carries a
real encounter id; ward-board links may set `admission=<admission_case_id>`.
Adapters must not translate raw visit ids into Chronicle visit scope.

OmniSearch result `id` values are target resource IDs, not search-index document
IDs. The server-provided `route_path` is the canonical internal navigation path
for result clicks; frontend result renderers should prefer it over rebuilding
links from IDs, while still rejecting non-internal paths. Search-index producers
must only emit `route_path` values that the destination screen actually honors,
such as opening a detail panel, selecting a tab, applying a filter, or marking
the target row/card.

For list-backed OmniSearch targets, use the registered route plus an honored
target parameter instead of a generic list page. Examples include
`/appointments?tab=sessions&clinic=<clinic_id>`, `/billing/catalog?service=<id>`,
`/billing/invoices/<invoice_id>?payment=<payment_id>`,
`/billing/claims?claim=<claim_id>`, `/inventory/items?location=<location_id>`,
and `/referrals/inbox?referral=<referral_id>`.
If a list cannot load or mark a specific target deterministically, do not index
that source until the destination has a target-aware query or detail fetch. For
example, waitlist search rows are limited to statuses rendered by the appointment
waitlist.

Query keys for authorization-sensitive data must include visibility-changing
scope such as facility, user/profile, feature set, permission version, patient or
ward scope, and query params. Use opaque/sanitized scope values; do not key
patient or ward data only by route name, MRN, patient name, raw URL, or free-text
identifier.

## External I/O And FHIR Rules

FHIR, exports, email, PDF generation, and third-party calls are unsafe external
I/O for request-path design.

- Do not block request threads, dashboards, or hot clinical views on FHIR calls.
- Do not keep a DB transaction open while waiting on any external I/O.
- Queue external work through `hms-worker` where possible.
- Project FHIR data to minimal safe fields before exposing it to clients.
- Treat FHIR errors as external-system failures, not as permission bypasses or
  partial raw payloads to return to clients.

## Performance Contract Rules

Performance evidence must be aggregate and PHI-safe. Do not commit raw response
bodies, raw k6 exports with fixture identifiers, raw URLs with IDs, SQL text,
request bodies, or browser traces that expose patient data.

Acceptance requires either:

- a before/after report from the maintained harness, or
- a documented blocker that explains why evidence cannot be collected yet.

## Compatibility Policy

- Rust V2 HTTP changes are breaking when they remove a field, rename a field,
  change an error mode, change pagination semantics, or weaken access behavior.
  Breaking changes require a coordinated frontend bridge update and contract
  tests in the same change.
- Additive HTTP fields are allowed when they do not expose PHI, do not bloat hot
  list DTOs, and do not require UI callers to change.
- Access-control changes have no grace period when they fix overexposure. A
  change that weakens access is rejected unless an ADR explicitly accepts the
  risk and the security owner signs off.
- Generated-client changes must preserve existing feature API shapes until all
  callers are moved or the removal is documented in the owning feature Module.
- Metric names and labels must remain compatible with the load reporter and ops
  dashboard until both consumers are migrated.
- Migration and env-var changes must update deploy and rollback runbooks before
  they are treated as production-ready.

## Contract Change Checklist

Before changing a contract:

1. Name the caller that depends on it.
2. Name the test that will catch a regression.
3. Update the source-of-truth file or generated artifact.
4. Update the frontend bridge when HTTP shape changes.
5. Update runbooks when deploy/runtime behavior changes.
6. Update ADRs when the decision changes the long-term architecture.

## Patient-aware note-template previews

Patient-aware note-template previews bind an exact immutable revision, protected
patient and explicit encounter UUID or null. The exact POST operation is a
read-only calculation for offsite policy and uncertainty handling; it retains
ordinary Full/documentation/demographics authority through final database time,
without inheriting emergency access or management authority. The response is a
bounded string/one-level string-map patch. Eight literal allowlisted tokens use
server demographics and a disclosed UTC date; missing values remain literal.
There is no expression evaluation, arbitrary override, implicit latest revision
or saved note/command receipt. Applying a reviewed preview and saving a UUID note
remain separate. A current access denial clears both preview and applied draft;
reads never acknowledge an uncertain clinical write.

## Governed referral responses

Referral routing DTOs expose status without specialist notes or recommendations.
Clinical response context, bounded history, exact revision and actor-bound receipt
reads use a separate retained Full/ordinary relationship purpose. Draft,
completion and reasoned amendment are immutable UUID/CAS commands; completion time
and original receipts remain stable after later amendments. The legacy completion
operation returns a typed409 and has no successful write fallback. Appointment
booking and referral scheduling commit atomically with current scheduling proof.

Saved-state review after losing an original RAM request is explicit manual review,
not confirmation of that request. Only actual fresh protected transport reads and
a separate fresh acknowledgment may clear its opaque barrier. Current denial,
authority or context transitions invalidate older proof, including active retries.
Migration024 requires coordinated runtime/schema/ops deployment; earlier runtime
rollback is refused. See the checkpoint17 verification and runtime-schema scope.

## Reviewed admission moves and effective task routing

Placement context, eligible destination search, bounded metadata history, exact
move detail and actor-bound original receipts use an explicit Patient Chronicle
admission purpose. A reviewed UUID command atomically preserves the episode,
advances its physical placement revision, closes/opens placement intervals,
changes bed states, routes every open task and records immutable evidence/audit.
Source ward or section inactivity alone does not block release from an existing
consistent occupied placement; all source ownership, interval, scope and current
authority proofs remain required. Every destination ward/section must be active,
including resources shared with the source. New admission/reservation/activation
also retain their own active ward/section eligibility through commit.

The single routing policy clears open-task assignments. An oversized membership
refuses the whole move. Terminal task evidence and original ward/instruction
provenance remain unchanged; current lists and decisions use service_ward_id.

Existing placement observations expose an unknown prefix. Known interval
occupancy stops at one database snapshot timestamp and reports partial coverage;
unknown attribution and zero-capacity rates remain unavailable rather than zero.
Current active bed capacity and full requested-range rate denominators are
explicit bases. Canonical facility episode totals are absent for ward filters.

Current facility/profile/session/network, Full/demographics, admission authority,
ordinary patient relationship and actual ward scope remain authoritative through
waits and final database time. Open task routing adds real nursing authority.
The UI reviews exact source/destination/membership tokens and does not choose a
destination automatically. Lost-payload saved-state review is manual, single-use
and invalidated by later denial or scope transitions, including during awaits.
Migration025 requires coordinated runtime/schema/ops deployment; old024 rollback
is refused. See checkpoint18 verification for the current acceptance boundary.

Referral consultation commands preserve explicit care context:

- One immutable start belongs to the exact patient/referral. New outpatient care
  requires an explicit existing-visit or no-visit choice. Reusing an admission
  retains its exact encounter, visit, encounter type and admission chronology.
- Selected waiting/called/in-triage/triaged/in-consultation/on-hold visits may
  transition to consultation after explicit review. This transition does not
  assert that triage finished. Checkout-ready or terminal visits cannot be
  revived through a new encounter or generic consultation start.
- Scheduled referrals require an eligible exact local appointment and retain its
  bounded status/time/clinic/practitioner snapshot. There is no implicit check-in
  or inferred appointment. Accepted referrals with a stored booking are
  inconsistent and must be resolved before first start.
- UUID receipts preserve the original reviewed command and resulting link.
  Current link state does not prove an uncertain earlier request's outcome.
  Start capability grants neither clinical-documentation view nor note editing.
- An encounter bound to an admission or consultation keeps its original care
  identity after closure. A recorded non-null admission visit cannot be replaced
  while attaching a first encounter. First attachment must match that visit.
- Restricted-record intake overrides remain intake decisions. They do not grant
  historical Chronicle access. A limited preparation surface must rely on its
  own protected context, keep the chart hidden and obtain current authority for
  each command. An immutable original start actor may supply historical ordinary
  relationship evidence under independently current clinical read grants.

## Organization-unit maintenance

Organization create, rename, retire and reactivate are original-actor UUID
commands with typed canonical reviewed input. Later commands compare an exact
unit version. Facility, identity, code, type, parent and creation time remain
immutable; exact-state no-ops preserve unit version/timestamps while recording
their own immutable receipt. Ordinary directory responses cannot confirm an
uncertain command. Only the exact current original actor/request receipt can
establish review, with separate acknowledgment of any persisted recovery notice.

Both active-state transitions refuse recorded child units, positions or scoped
permission references, including inactive/history rows. This prevents silently
restoring legacy scoped authority. New reference publication retains the actual
active same-facility unit/parent. No cascade, physical deletion, reparenting,
membership, leadership or coverage capability is implied by this slice.

Writes and original receipts require current AdminAuthorityManage and Admin,
with existing retained privileged session/factor/network proof and final database
time. Ordinary bounded directory reads keep their existing read authority.
Migration027 requires coordinated runtime/schema/ops deployment; supported
rollback to026 is refused after027 commits. See checkpoint20 verification and
the runtime-schema compatibility scope for exact acceptance limits.

## Storage-location maintenance

Location create, rename, retire and reactivate are exact original-actor UUID
commands. Later commands review an exact version; facility, id, code, type,
temperature zone and creation time stay permanent. Exact-state no-ops preserve
location version/timestamps and record an immutable receipt. Name correction may
preserve a used location. Both state transitions in this slice refuse every
operational reference, including zero stock and terminal history. This is an
unused-maintenance capability; it does not implement used-location closeout.

Actual reference publication retains an active same-facility location inside its
own transaction across13 edges in10 tables. Unchanged historical links remain
available for evidence and closure. InventoryView protects administration reads;
InventoryManage, Inventory feature, real demographics visibility, fresh
credential proof and retained facility/session/network authority protect commands
and original receipts through final database time. Admin role is not substituted
for existing inventory policy, and privileged-account factor policy still
applies independently.

Directory/detail/stock reads cannot confirm an unknown command. Exact
actor-bound original receipts may establish review; a separate acknowledgment
clears a persisted recovery notice. A retained error handle alone cannot clear
it. Actual response leases must survive receipt validation without a later
denial, cancellation, scope transition or uncertainty-identity change. No raw
command body survives reload. Migration028 requires coordinated runtime/schema/ops
deployment; supported rollback to027 is refused after028 commits.

## Ordinary same-session credential confirmation

POST/auth/reauthenticate accepts only current_password for an authenticated live
ordinary session with no current privileged policy or active/malformed enrolled
credential. It shares the existing durable login attempt/crypto admission budget.
Exact password bytes are verified outside the database transaction; finalization
retains current account/session/version/profile/factor and original authority
proof. Original database admission time becomes monotonic password proof, with
an atomic assurance_version increment and minimal own-session audit. Refresh
cookie/material, family and idle/absolute horizons remain unchanged. No factor
evidence is manufactured. Older JWTs retain their older credential freshness.

The exact own-auth network exception grants no business-write authority and
does not relax mandatory password change. Enrolled/privileged users retain
passkey confirmation with no ordinary fallback after failure or cancellation.
Token/session validity and optional workflow continuity are distinct checks:
ordinary continuity requires unchanged factor evidence, while a genuine expired
evidence downgrade may require fresh review. Invalid session, revision or
strengthened factor claims must fail closed. Staged current network proof is
still required to retain workflow continuity. Credential response failure never
authorizes automatic business replay.

A retained original write handle clears only against still-current actual
saved-record proof. Actor-bound original note amendment receipts use their exact
request UUID, protected patient/note, action and reconstructed original command
fingerprint across the different read/write route families. Later denial,
cancellation, scope activation, active retry, changed uncertainty identity or
storage failure invalidates that proof. No clinical body is persisted by the
opaque recovery ledger.
