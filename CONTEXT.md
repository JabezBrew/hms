# HMS Context

Status: living context
Owner: Engineering
Last reviewed: 2026-06-01
Scope: product language, architectural invariants, and source-of-truth rules for HMS engineering work.

## Product Intent

HMS is a workflow-oriented hospital management system. It should help clinical
and operational staff finish real hospital work with fewer steps, safer
defaults, and predictable latency.

The product is not a generic CRUD admin panel. Navigation, data access, and UI
composition should follow clinical and operational workflows: registration,
triage, consultation, admission, ward care, discharge, laboratory, pharmacy,
inventory, billing, and administration.

## Active Architecture

- Active backend: `backend-rs/`.
- Active frontend: `frontend/`.
- Legacy backend reference: `backend/`.
- Current API family: `/api/v2`.
- Current deployment direction: GCP staging, with Hetzner retained as rollback
  until the GCP path is proven stable.

Rust V2 is the backend source of truth. The old Django backend is reference
material only unless a task explicitly asks for legacy maintenance or parity
research.

## Safety Invariants

These invariants outrank local convenience:

- PHI must not appear in logs, metric labels, browser event names, cache keys,
  screenshots, raw evidence artifacts, or committed fixtures.
- Every endpoint that accepts a patient identifier must enforce patient access
  before returning or mutating data.
- Facility scoping must be explicit in backend persistence, access checks, and
  frontend data fetches.
- Authorization-sensitive cache keys and frontend query keys must include the
  opaque or sanitized scope that changes visibility, such as facility,
  user/profile, patient or ward scope, feature set, permission version, and
  query parameters. Do not use MRNs, names, raw URLs, or free-text identifiers
  in keys.
- Realtime subscriptions must authenticate the session, bind to facility scope,
  authorize every channel join, recheck permission-version changes, and use
  PHI-safe channel names and payloads.
- Clinical patient data belongs in `PatientChroniclePage` or panels launched
  from that page. Do not create standalone clinical patient-data pages.
- Hot lists must be bounded, cursor-paginated, and backed by lightweight DTOs.
- External I/O, exports, FHIR, emails, and expensive side effects must not run
  inside open database transactions. FHIR is unsafe external I/O: do not block
  request paths or dashboards on FHIR calls, and expose only minimal projected
  safe fields to clients.
- High-risk actions require least privilege, auditability, and fresh
  reauthentication when the product rule calls for it.

## Architecture Language

Use these words consistently when documenting or designing HMS:

- Module: anything with an Interface and an Implementation.
- Interface: everything a caller must know to use the Module correctly,
  including invariants, ordering, errors, configuration, and performance.
- Implementation: the code inside a Module.
- Depth: leverage at the Interface.
- Seam: the place where an Interface lives.
- Adapter: a concrete thing satisfying an Interface at a Seam.
- Leverage: what callers get from Depth.
- Locality: what maintainers get from Depth.

Avoid using "boundary" when "Seam" or "Interface" is meant.

## Domain Language

- Patient Chronicle: the central patient workspace and only product home for
  patient clinical data.
- Patient Registry: identity and demographic discovery, not full clinical
  record access.
- Encounter: a clinical visit or care interaction.
- Admission Case: the inpatient workflow record that coordinates bed,
  ward-care, and discharge state.
- Ward Board: operational inpatient view for beds, patients, and ward work.
- Order: a clinical request that may have a clinical owner and a fulfillment
  owner.
- Fulfillment: the downstream work that completes an order, such as specimen
  handling, imaging, dispensing, or service delivery.
- Feature: a deployed capability controlled by Rust V2 deployment capability
  and entitlement rules.
- Deployment Profile: the facility/client shape that determines available
  modules, institutional structure, and workflow assumptions.

## Implementation Authority

When documents conflict, prefer this order:

1. Current code and tests in `backend-rs/` and `frontend/`.
2. Active contracts: OpenAPI, migrations, generated client bridge tests,
   repository contracts, and access tests.
3. Domain source-of-truth docs for the area being changed:
   `docs/v2/rust-v2-backend-spec.md` for backend architecture,
   `docs/v2/v2-cutover-scope.md` for cutover scope,
   `docs/performance/performance-budget.md` for performance contracts, and
   current `ops/` runbooks for deployment behavior.
4. The concrete codebase maps under `docs/`, `backend-rs/`, and `frontend/`.
5. Supporting runbooks, planning docs, and evidence under `docs/` and `ops/`.
6. Legacy Django docs only when explicitly working on legacy behavior.

If older docs conflict with this context or active code, update the older doc or
mark it historical before using it as implementation guidance.
