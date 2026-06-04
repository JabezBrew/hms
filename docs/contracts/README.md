# HMS Engineering Contracts

Status: active
Owner: Engineering
Last reviewed: 2026-06-01
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

## Access Contract Rules

Any endpoint that accepts a patient identifier must prove patient access before
returning or mutating data.

Access behavior belongs in `hms-access` and request context guards. It should be
covered through tests that call the same Interface production code uses.

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

For hot paths, repositories should prove:

- no table scan caused by avoidable date functions
- no N+1 queries
- stable cursor sort
- bounded limit
- selected columns match DTO needs
- facility scope is part of the predicate

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
