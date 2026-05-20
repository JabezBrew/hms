# HMS V2 Cutover Scope

Updated: 2026-05-19

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

## Locked Decisions Implemented For First Cutover

These decisions are part of the first Rust V2 cutover scope and should remain
covered by backend contract/repository tests plus generated frontend bridge
tests.

1. Break-glass / emergency access
   Patient identity discovery remains facility-scoped through
   `patient.demographics.view`; Chronicle access requires patient-specific
   workflow evidence or a dedicated break-glass grant. Break-glass requires the
   dedicated permission, active/current patients, a required category, fresh
   reauthentication, a user-patient-facility grant with a two-hour expiry, at
   most three active grants per user, and start/end audit events only.

2. Scheduling
   Clinic Session / Appointment Book is the central model. Sessions can be
   practitioner, team, clinic, service, or department owned, support fixed-slot
   and capacity-block booking, use dynamic availability without generated slot
   rows, allow appointment series creation, and require explicit audited
   overbooking when policy permits it.

3. Discharge blockers
   Discharge blockers are source-driven and auto-clear only from their source
   workflow. Summary, nursing release, pharmacy, and billing blockers gate final
   discharge; billing/pharmacy can be held with reason; override is per blocker
   with fresh reauthentication; completed discharge moves the bed to cleaning
   before automatic availability.

4. Billing finalization and payment voids
   Invoices lock after payment, claim, export, or finalization. Voids/refunds
   are append-only reversal ledger entries with supervisor approval and fresh
   reauthentication. NHIS mappings are effective-dated, claims store the mapping
   version, and write-offs affect NHIS/payer receivable, not patient liability.

5. Controlled-substance discrepancies
   Controlled-substance discrepancy handling is log-only for V1, with missing,
   surplus, breakage, expired, documentation-error, and other categories. A
   confirmed physical count adjusts stock immediately, requires permission,
   fresh reauthentication, reason/category, witness, and high-severity audit.

6. Referrals and clinical context slices
   Referrals schedule into the normal appointment contract. Waitlist promotion
   creates appointment/offer state, not visits, and waitlist cancel/promote are
   audited. Same-patient problem artifact links are supported. Pharmacy context
   is limited to active problems, allergies, and order-relevant meds; lab
   context is limited to order/encounter-linked diagnoses or problems.

7. WebAuthn and privileged actions
   Privileged users can log in before enrollment, but privileged/high-risk
   actions fail closed until passkey enrollment exists. Recovery code
   regeneration requires fresh password reauthentication and invalidates old
   unused codes.

## Deferred After Baseline

These remain valid product areas, but they should not block first cutover.

- Insurance / PSP / Hubtel: provider scope, patient-insurance capture,
  settlement reconciliation, and whether Hubtel is needed for the first client.
- Ward transfers/reports/staff assignments: staff source of truth, transfer
  states, approval rules, amenity taxonomy, and report definitions.
- Role dashboards: role taxonomy and metric ownership for doctor, nurse,
  receptionist, admin, inpatient doctor, and other operational roles.
- Chart builder/template management: schema, validation/safety model, facility
  customization, and migration strategy.
- Lab catalog administration: whether facilities manage test/panel catalog
  mutations at cutover.
- Inventory analytics beyond the cutover queue/state workflows: dashboard
  ownership, report definitions, and long-range procurement analytics.

## Future Stubs Requiring Separate Specs

These are explicit stubs only. Do not add endpoint sketches, generated client
methods, or UI paths until the listed decisions are approved.

- FHIR interoperability: decide resource profile subset, source system trust,
  validation strategy, async sync boundaries, conflict handling, PHI minimizers,
  retry/dead-letter ownership, and audit review.
- Patient/export bundles: decide recipient identity, consent linkage, minimum
  payload, retention and expiry, revocation, breach-response ownership, export
  approval, worker queue, and download controls.
- Cross-facility exchange: decide facility trust model, patient matching,
  access grants, emergency exceptions, consent revocation, routing, audit
  escalation, and whether exchange is push, pull, or referral-attached.
- AI/copilot: decide provider, data residency, prompt/data retention, clinical
  safety responsibility, review workflow, liability boundary, cost controls,
  and whether output can enter the record.
- Onboarding runtime: decide tenant bootstrap authority, facility/profile
  creation rules, first-admin identity proofing, seed data boundaries, billing
  handoff, and rollback/deprovisioning workflow.

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
3. Model the work as a deep Rust module with a small Interface and an explicit
   product invariant. Do not start by splitting files or porting legacy
   handlers line-for-line.
4. Keep access decisions in `hms-access` and request context guards.
5. Keep workflow orchestration in `hms-api/src/services/*`; handlers stay thin
   and route modules remain mount points only.
6. Keep persistence in `hms-db`; repository Interfaces should express workflow
   intent instead of leaking SQL coordination to handlers.
7. Reuse `hms-api/src/cursor_list.rs` for bounded lists and
   `hms-access::RequestContext` for facility/session/profile/permission facts.
8. Generate OpenAPI after backend changes.
9. Add or update generated JavaScript `/api/v2` bridge tests in `frontend/`.
10. Add Playwright smoke for user-visible workflows.
11. Keep unsupported legacy UI actions guarded until their Rust contract exists.
