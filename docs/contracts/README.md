# HMS Engineering Contracts

Status: active
Owner: Engineering
Last reviewed: 2026-06-06
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
| Deployment runtime | `ops/gcp-staging/README.md`, `ops/compose-v2/README.md`, compose/env files | Operations owner | staging, rollback, smoke, incident response | health, smoke, logs, rollback evidence |

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
- Ward-board list rows are lightweight sourced projections: census, alert
  counts, nursing-task counts/due timestamps, due MAR counts/timestamps, last
  vitals timestamp, unverified-result and pending-order counts, and discharge
  blocker counts/status. Do not put placeholder risk labels, result values,
  note bodies, discharge hold reasons, or broad patient clinical records in the
  hot board DTO.

## Access Contract Rules

Any endpoint that accepts a patient identifier must prove patient access before
returning or mutating data.

Access behavior belongs in `hms-access` and request context guards. It should be
covered through tests that call the same Interface production code uses.

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
