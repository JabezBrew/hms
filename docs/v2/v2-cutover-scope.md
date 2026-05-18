# HMS V2 Cutover Scope

Updated: 2026-05-18

This is the active planning tracker for the Rust V2 cutover. It replaces the
older parity matrix, UI workflow matrix, product-decision list, and standalone
`frontend-v2` planning notes.

## Source Of Truth

- Backend architecture: `docs/v2/rust-v2-backend-spec.md`.
- Cutover scope and product decisions: this document.
- Deployment runbook: `docs/v2/v2-production-cutover.md`.
- Active backend runtime: `backend-rs/`.
- Active frontend runtime: `frontend/` JavaScript/Vite.
- Legacy Django backend: `backend/`, reference only.

## Current Direction

HMS V2 is not a line-by-line Django port. It is a Rust backend cutover behind
the maintained HMS React/Vite product UI.

For each supported workflow:

1. Keep the existing `frontend/` route, component, layout, and Chronicle design
   system behavior.
2. Trace the exact frontend API calls before changing implementation.
3. Use generated JavaScript Rust `/api/v2` helpers only in `rust-v2` mode.
4. Preserve `AbortSignal` support for list/search calls.
5. If Rust lacks the endpoint, response field, persistence rule, or permission
   contract, add it in `backend-rs/` with backend tests first.
6. Adapt Rust envelopes at the feature API boundary so UI components do not need
   to know Django response shapes or stripped-down rewrite shapes.

## Status Definitions

- `pass`: workflow is usable against Rust V2 and has targeted evidence.
- `deferred`: workflow remains possible, but needs product/API rules before
  implementation.
- `removed`: deliberately outside the first V2 production cutover.

## Current Cutover Baseline

All non-deferred rows in the previous Rust V2 main UI workflow matrix had
targeted Rust V2 evidence before this consolidation. Keep those tests as
regression coverage.

Baseline areas currently treated as cutover-ready:

- Auth/session/password reset baseline.
- Deployment profiles, features, permissions, and route/access gates.
- Patient registry, patient creation/edit, context patients, Patient Chronicle,
  and print summary baseline.
- Appointments CRUD, check-in through visits, waiting room, triage, encounters,
  encounter workspace, and care team baseline.
- Ward list/detail/sections/beds/board, admission cases, direct admission, and
  direct discharge baseline.
- Nursing tasks, handoff, ward stock requests, treatment sheets, vitals, alerts,
  monitoring, fluid balance, and medication administration baseline.
- Clinical notes, templates, note versions, problems, allergies, prescriptions,
  and chart entries inside Patient Chronicle.
- Laboratory catalog read, panels, orders, specimens, results, and result
  verification.
- Inventory categories/items/locations/stock batches/stock movements/transfers,
  purchase requisitions, purchase orders, GRNs, and controlled-substance
  register/balance baseline.
- Billing service catalog read, invoices, payments, receipts, cash drawers/cash
  sessions, NHIS claims, NHIS batches, batch export baseline, and remittance
  import baseline.
- Admin organization units, positions, authority appointments, permission
  assignments, committees, delegations, audit events, staff management, and
  practitioner profiles.
- Notifications/inbox, dashboard snapshots, same-facility referrals/SLA/clinic
  waitlist, and same-facility consent grant/revoke.

## Decisions Required Before First Cutover

These are the remaining high-value decisions that should be settled before the
first real-client V2 cutover.

1. Break-glass / emergency access
   Decide who can override patient access, required reason, expiry, alerting,
   audit severity, revocation, and review workflow. Implement internal
   emergency access only; do not bundle patient-record export with this work.

2. Scheduling
   Choose the source of appointment availability: staff roster, practitioner
   calendar, manual clinic schedule, or hybrid. Define recurring generation,
   blocked time, overbooking, clinic-pool versus practitioner-bound slots, and
   conflict behavior before adding schedule/availability persistence.

3. Discharge blockers
   Decide which blockers gate final discharge: billing clearance, nursing
   tasks, pharmacy meds, discharge summary, prescriptions, admin clearance, or
   other gates. Define blocker ownership, override rules, reopen authority, and
   audit requirements.

4. Billing finalization and payment voids
   Decide when invoices lock, who can void/refund payments, whether fresh
   re-authentication is required, approval requirements, and ledger/audit
   behavior.

5. Controlled-substance discrepancies
   Decide how missing or extra controlled drugs are reported, witnessed,
   escalated, resolved, re-authenticated, and reviewed.

6. NHIS AR and mappings
   Decide who owns unpaid NHIS balances, how service-code mappings are
   maintained/versioned, and how remittances, write-offs, adjustments, and
   reconciliation work.

## Deferred After Baseline

These remain valid product areas, but they should not block first cutover.

- MFA/WebAuthn/security settings: enforcement level, authenticators, recovery,
  and device/session UX.
- Insurance / PSP / Hubtel: provider scope, patient-insurance capture,
  settlement reconciliation, and whether Hubtel is needed for the first client.
- Clinic management: whether clinics are entities, org units, service areas, or
  roster-derived schedules.
- Ward transfers/reports/staff assignments: staff source of truth, transfer
  states, approval rules, amenity taxonomy, and report definitions.
- Role dashboards: role taxonomy and metric ownership for doctor, nurse,
  receptionist, admin, inpatient doctor, and other operational roles.
- Chart builder/template management: schema, validation/safety model, facility
  customization, and migration strategy.
- Lab catalog administration: whether facilities manage test/panel catalog
  mutations at cutover.
- Inventory suppliers/expiry/audit/analytics: supplier fields, expiry policy,
  audit event taxonomy, and analytics definitions.
- Procurement internal requisitions, standing orders, and detail workflow
  splits: approval/state boundaries.
- Pharmacy supply-request dispensing, bulk dispense, and stock-check queue
  behavior: queue ownership and action boundaries.

## Removed From First Cutover

These are not first-cutover tasks. Keep existing fail-closed guards in the UI
and API adapters.

- Standalone `frontend-v2` TypeScript rewrite.
  The maintained product UI is `frontend/` JavaScript/Vite. Do not rebuild the
  product experience in `frontend-v2`, and do not convert the frontend to
  TypeScript for this path.

- FHIR endpoints, record export bundles, consent access tokens, and
  cross-facility record exchange.
  These create a PHI egress path. Reintroduce only with a dedicated external
  data-sharing spec covering recipient identity, consent linkage, minimum export
  payloads, data minimization, retention/expiry, revocation, audit review,
  alerting, and breach-response ownership.

- AI/copilot/note assistant/lab interpretation/omni AI.
  Revisit only after privacy, clinical safety, provider, and cost rules are
  approved.

- Onboarding runtime.
  It has no required Rust backend contract and should not block production
  readiness.

## Implementation Rule For Deferred Work

When a deferred item becomes approved:

1. Add or update this document with the product rule and acceptance criteria.
2. Add Rust repository/contract tests before implementation.
3. Keep access decisions in `hms-access` and request context guards.
4. Keep persistence in `hms-db`; handlers stay thin.
5. Generate OpenAPI after backend changes.
6. Add or update generated JavaScript `/api/v2` bridge tests in `frontend/`.
7. Add Playwright smoke for user-visible workflows.
8. Keep unsupported legacy UI actions guarded until their Rust contract exists.
