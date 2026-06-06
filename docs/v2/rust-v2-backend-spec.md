# HMS Rust Backend V2 Specification

Status: draft v0.1
Scope: backend architecture, deployment profiles, runtime request model, administration model, access control, sessions, security, performance, schema direction, API direction, workers, and implementation milestones.

## Table of Contents

1. [Purpose](#purpose)
2. [Hard Assumptions](#hard-assumptions)
3. [Target Stack](#target-stack)
4. [Crate Layout](#crate-layout)
5. [Core Runtime Model](#core-runtime-model)
6. [Deployment Profiles](#deployment-profiles)
7. [Profile Enforcement](#profile-enforcement)
8. [Administration and Authority Model](#administration-and-authority-model)
9. [Authorization Schema](#authorization-schema)
10. [Action-Based Permissions](#action-based-permissions)
11. [Patient Data Visibility](#patient-data-visibility)
12. [Access Decision Flow](#access-decision-flow)
13. [Committee Authority](#committee-authority)
14. [Delegation](#delegation)
15. [Core Domain Schema Direction](#core-domain-schema-direction)
16. [API Contract Direction](#api-contract-direction)
17. [First-Cut API Modules](#first-cut-api-modules)
18. [Session Architecture](#session-architecture)
19. [Security Architecture](#security-architecture)
20. [Performance and Scalability Architecture](#performance-and-scalability-architecture)
21. [Workers and Events](#workers-and-events)
22. [Deployment](#deployment)
23. [Seed and Provisioning](#seed-and-provisioning)
24. [Implementation Milestones](#implementation-milestones)
25. [Non-Negotiable Tests](#non-negotiable-tests)
26. [Design Principle](#design-principle)

<a id="purpose"></a>

## 1. Purpose

HMS V2 is a clean Rust backend for a modular hospital management system. It replaces the current Django backend as a new architecture, not a line-by-line port.

The system must support one codebase that can be deployed for different facility types without exposing irrelevant institutional complexity. A CHPS compound should not see Sub-BMC administration. A teaching hospital should be able to model executive directorates, service lines, units, teams, committees, and scoped administrative authority.

<a id="hard-assumptions"></a>

## 2. Hard Assumptions

- One client per isolated deployment is the product target. Current staging and
  performance validation run on GCP; the Hetzner VPS Compose kit remains
  rollback/reusable deployment reference.
- A deployment may contain one facility or multiple facilities/branches for that one client.
- True multi-tenant SaaS is not a V2 requirement.
- PostgreSQL is the source of truth.
- Redis is used for cache, rate limits, realtime fanout, and jobs.
- Caddy remains the edge proxy.
- Billing and NHIS are part of the first production cutover.
- AI features are excluded from the first cutover.
- Existing Django data does not need to be migrated.
- Existing Django auth/session compatibility is not required.
- Existing users can be forced through a fresh password setup.
- Django admin is replaced by HMS-native admin screens.
- Frontend APIs target Rust `/api/v2`; the maintained UI runtime is the
  JavaScript/Vite app in `frontend/`, not a standalone `frontend-v2`
  TypeScript rewrite.

<a id="target-stack"></a>

## 3. Target Stack

```text
Language: Rust
HTTP framework: axum
Runtime: tokio
Database: PostgreSQL
DB access: sqlx
Cache/jobs/realtime: Redis
API schema: utoipa/OpenAPI
Auth: short-lived access JWT plus refresh session cookie
Password hashing: argon2
Logging/tracing: tracing with JSON logs
Metrics: Prometheus-compatible /metrics endpoint
Deployment: Docker Compose stack; current staging/performance path is GCP, with
single-VM Compose retained as rollback/reusable reference.
```

<a id="crate-layout"></a>

## 4. Crate Layout

```text
backend-rs/
  crates/
    hms-api/             # HTTP API server
    hms-worker/          # background job worker
    hms-migrator/        # migrations and seed/provisioning commands
    hms-domain/          # domain types, commands, events, policies
    hms-db/              # sqlx repositories and transaction helpers
    hms-auth/            # auth, sessions, password reset, MFA
    hms-access/          # permissions, scopes, patient access, break-glass
    hms-events/          # domain event and job contracts
    hms-observability/   # logging, metrics, tracing helpers
```

The initial production system should be a modular monolith. Split crates only
when an operational boundary is proven. Inside a crate, prefer deep modules:
each module should expose a small Interface that hides meaningful implementation
detail and owns a product invariant.

Current `hms-api` shape:

```text
src/
  main.rs
  config.rs
  routes/
    patients.rs          # URL mounting only
    ward.rs
    billing.rs
    inventory.rs
    laboratory.rs
    ...
  handlers/
    patients.rs          # HTTP extractors/OpenAPI response mapping
    ward.rs
    ...
  services/
    ward/                # workflow Interface + implementation modules
    billing/
    inventory/
    laboratory/
    patients.rs
    care.rs
    clinical.rs
  cursor_list.rs         # shared cursor pagination module
  extractors.rs          # authenticated session + RequestContext extraction
  state.rs               # runtime adapter/facade, not workflow logic
  error.rs
```

Route modules stay thin. Handler modules translate HTTP into typed calls.
Workflow decisions live in `services/*`. Domain language and DTOs live in
`hms-domain`, persistence lives in `hms-db`, access decisions live in
`hms-access`, and auth/session concerns live in `hms-auth`.

`routes/*.rs` files are mount points only. They should group URLs and connect them to handler functions; they should not contain business logic, SQL, large DTO definitions, or resource-specific policy code.

`handlers/*.rs` files should not contain SQL, product-state transitions, or
handler-local access shortcuts. They may validate HTTP shape, call the relevant
service Interface, and map the result into a response.

`services/*` is the main workflow Seam inside `hms-api`. New complex workflows
should get a service module or submodule with a small public Interface. The
Interface should be the test surface callers use. Avoid shallow pass-through
modules that only rename calls without hiding invariants or reducing caller
knowledge.

`state.rs` is an Adapter/facade for runtime capabilities: database pools,
configuration, auth/session helpers, deployment capabilities, and service
factories. Do not add new workflow implementations to `state.rs`.

Use existing shared modules before adding local variants:

- `hms-access::RequestContext` for facility, session, profile, permission,
  feature, patient-visibility, offsite, and reauth facts.
- `hms-api/src/extractors.rs` for request-context extraction.
- `hms-api/src/cursor_list.rs` for bounded cursor-list parsing and response
  shape.

File splitting is not the goal. Depth is the goal. Split a file when the new
module can own a stable Interface, hide implementation detail, and reduce the
knowledge required at callers. Do not split merely because a file is long.

Example shape:

```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/patients",
            get(handlers::patients::list_patients)
                .post(handlers::patients::create_patient),
        )
        .route(
            "/api/v2/patients/:id",
            get(handlers::patients::get_patient)
                .patch(handlers::patients::update_patient),
        )
        .route(
            "/api/v2/patients/:id/chronicle",
            get(handlers::patients::get_patient_chronicle),
        )
}
```

The same split applies inside the domain and database crates:

```text
hms-domain/src/patients/
  mod.rs
  commands.rs
  queries.rs
  policies.rs
  events.rs

hms-db/src/patients/
  mod.rs
  registry_repo.rs
  chronicle_repo.rs
  search_repo.rs
  identity_repo.rs
```

`hms-db` currently has deeper repository modules for workflows such as ward and
inventory. Broader files such as admin, billing, care, laboratory, and search
should be deepened when a workflow Interface is clear, especially when doing so
lets the caller state one intention instead of coordinating SQL details across
multiple helpers.

<a id="core-runtime-model"></a>

## 5. Core Runtime Model

Every request resolves a strict context before reaching handlers.

Conceptual request context:

```rust
RequestContext {
    request_id,
    user_id,
    facility_id,
    facility_code,
    active_profile,
    session_id,
    permission_version,
    enabled_features,
    active_authorities,
    patient_visibility,
    is_offsite,
}
```

Handlers should not manually parse user, session, facility, feature, or patient-access state. They receive context through typed extractors and guards.

Required guards:

```text
require_auth
require_facility
require_feature
require_permission
require_patient_access
require_billing_access
require_lab_access
require_inventory_access
require_reauth_for_high_risk_action
```

The handler pattern should look like:

```text
extract RequestContext
extract validated path/query/body
run guard or policy check
call domain command/query service
return standard response DTO
```

Do not let handlers perform ad-hoc joins, raw permission checks, or unstructured audit logging. That logic belongs in shared policy, repository, and audit helpers.

<a id="deployment-profiles"></a>

## 6. Deployment Profiles

Profiles control which modules, org-unit types, positions, permission bundles, seed data, and UI navigation are enabled.

Initial profiles:

```text
chps_compound
health_center
clinic
hospital
district_hospital
regional_hospital
teaching_hospital
hospital_network
```

Profiles are configuration and seed templates, not separate codebases.

### 5.1 CHPS Compound

Purpose: small community-level facility with simple outpatient, maternal/child health, public health, and basic dispensing workflows.

Enabled modules:

```text
patients
basic_encounters
appointments_basic
maternal_child_health_basic
immunization_basic
dispensing_basic
stock_basic
billing_basic_optional
reports_basic
```

Org unit types:

```text
facility_root
service_area
team
store
cash_point
```

Positions:

```text
facility_in_charge
community_health_officer
midwife
records_officer
dispensing_officer
cashier
```

Explicitly disabled by default:

```text
sub_bmc/service_line
executive_directorate
clinical_department
advanced_rosters
wards
inpatient_admissions
nhis_claim_batches unless enabled
committees
```

### 5.2 Health Center

Purpose: primary care facility with outpatient care, maternity, basic lab/dispensing, claims, and modest staff administration.

Enabled modules:

```text
patients
appointments
encounters
triage_basic
maternity_basic
laboratory_basic
pharmacy_basic
inventory_basic
billing
nhis_basic
reports
```

Org unit types:

```text
facility_root
service_area
clinic
functional_area
team
store
cash_point
```

Positions:

```text
medical_officer_in_charge
health_center_administrator
nurse_in_charge
midwife_in_charge
lab_in_charge
pharmacy_in_charge
billing_officer
records_officer
store_manager
```

### 5.3 Clinic

Purpose: private or small outpatient clinic.

Enabled modules:

```text
patients
appointments
encounters
clinical_notes
billing
pharmacy_basic
laboratory_basic_optional
inventory_basic
reports
```

Org unit types:

```text
facility_root
clinic_service
functional_area
team
store
cash_point
```

Positions:

```text
clinic_owner
medical_director
clinic_administrator
nurse_in_charge
reception_lead
billing_officer
pharmacist_or_dispensing_lead
lab_lead_optional
```

### 5.4 Hospital

Purpose: general hospital with inpatient services, departments, wards, lab, pharmacy, billing, inventory, and nursing workflows.

Enabled modules:

```text
patients
appointments
encounters
wards
admissions
discharge
nursing
clinical_notes
laboratory
pharmacy
inventory
billing
nhis
referrals
ward_board
dashboards
reports
```

Org unit types:

```text
facility_root
directorate
department
unit
team
ward
clinic
service_department
store
cash_point
committee_optional
```

Positions:

```text
medical_superintendent
hospital_administrator
head_of_clinical_care
head_of_nursing
head_of_pharmacy
head_of_finance
head_of_administration
department_head
unit_head
team_lead
ward_manager
clinic_manager
department_secretary
department_accountant
store_manager
cashier
```

### 5.5 District Hospital

Purpose: hospital profile with district-level management, public-sector reporting, and broader administrative responsibilities.

It extends `hospital` with:

```text
district_reporting
public_health_reporting
district_program_coordination
management_committee
```

Additional positions:

```text
district_health_management_liaison
public_health_program_lead
hospital_management_committee_member
```

### 5.6 Regional Hospital

Purpose: referral hospital with more formal directorates, specialist departments, and regional reporting.

It extends `hospital` with:

```text
specialist_referrals
regional_reporting
advanced_rosters
committee_governance
quality_safety_compliance
```

Additional org unit types:

```text
executive_directorate
specialist_department
committee
```

Additional positions:

```text
medical_director
director_of_nursing
director_of_finance
director_of_pharmacy
director_of_administration
director_of_hr
quality_safety_lead
committee_chair
committee_member
```

### 5.7 Teaching Hospital

Purpose: tertiary hospital with executive administration, directorates, service lines/Sub-BMCs, departments, units, teams, committees, teaching, research, and advanced reporting.

Enabled org unit types:

```text
facility_root
governing_board
executive_directorate
service_line
clinical_department
clinical_unit
team
ward
clinic
service_department
support_department
store
cash_point
committee
teaching_program
research_unit
```

`service_line` is the internal generic concept. The display label can be configured as `Sub-BMC`, `Directorate`, `Service Line`, or another client-specific label.

Additional positions:

```text
board_member
chief_executive
medical_director
director_medical_affairs
director_nursing
director_finance
director_pharmacy
director_administration
director_hr
director_general_services
research_innovation_director
service_line_head
department_head
unit_head
team_lead
training_coordinator
research_coordinator
committee_chair
committee_member
```

### 5.8 Hospital Network

Purpose: one client with multiple facilities/branches under one deployment.

It extends the relevant base profile with:

```text
facility_group
cross_facility_reporting
cross_facility_referrals
cross_facility_record_exchange_optional
network_level_positions
```

Network profile is still one client per isolated deployment. It is not SaaS
tenancy.

Additional org unit types:

```text
facility_group
network_executive
branch_facility
```

Additional positions:

```text
network_chief_executive
network_medical_director
network_finance_director
network_operations_director
branch_facility_head
```

<a id="profile-enforcement"></a>

## 7. Profile Enforcement

The database can support all org-unit and position concepts, but the active deployment profile controls what can be created or assigned.

Runtime checks:

```text
Can this profile create org_unit_type?
Can this profile assign position template?
Can this profile enable feature?
Can this profile show this UI section?
```

Example:

```text
profile = clinic
create org_unit_type = service_line
result = denied
```

Profile configuration tables:

```text
deployment_profiles
profile_org_unit_types
profile_position_templates
profile_feature_flags
profile_module_entitlements
profile_seed_templates
```

For early V2, these can be seed/config-controlled. Later, HMS-native admin screens can expose safe customization.

<a id="administration-and-authority-model"></a>

## 8. Administration and Authority Model

The V2 system must not ask `is_admin?` for operational decisions.

It asks:

```text
Can this user perform this action on this resource within this scope?
```

Authority is:

```text
Person + Professional Role + Position + Scope + Permissions + Time Window
```

### 7.1 Professional Role

Professional role describes what the person is.

Examples:

```text
doctor
nurse
midwife
pharmacist
dispensing_officer
lab_scientist
accountant
cashier
records_officer
administrator
community_health_officer
biomedical_engineer
it_officer
```

### 7.2 Position

Position describes an authority pattern.

Examples:

```text
facility_in_charge
medical_superintendent
hospital_administrator
chief_executive
medical_director
director_nursing
director_finance
director_pharmacy
director_hr
director_general_services
service_line_head
department_head
unit_head
team_lead
ward_manager
clinic_manager
department_secretary
department_accountant
quality_safety_lead
committee_chair
committee_member
store_manager
cashier
```

### 7.3 Scope

Scope defines where authority applies.

Scope types:

```text
facility
facility_group
directorate
service_line
department
unit
team
ward
clinic
store
cash_point
committee
```

A department head can inherit descendant units and teams. A team lead does not inherit sibling teams.

### 7.4 Time Window

Every appointment should support:

```text
starts_at
ends_at
is_active
appointed_by
reason
```

This supports acting heads, temporary delegations, leave coverage, and term-limited committee membership.

<a id="authorization-schema"></a>

## 9. Authorization Schema

Core tables:

```text
org_units
  id
  facility_id
  parent_id
  unit_type
  code
  name
  display_label
  path
  depth
  is_active

position_templates
  id
  code
  name
  category
  allowed_scope_types
  inherits_descendants
  patient_visibility_mode
  is_system

positions
  id
  template_id
  facility_id
  name
  display_label
  is_active

authority_appointments
  id
  user_id
  position_id
  scope_unit_id
  starts_at
  ends_at
  is_active
  appointed_by
  reason

permissions
  id
  code
  resource_type
  action
  patient_data_class
  description

position_permissions
  position_id
  permission_id

user_permission_overrides
  id
  user_id
  permission_id
  scope_unit_id
  effect
  starts_at
  ends_at
  reason
```

<a id="action-based-permissions"></a>

## 10. Action-Based Permissions

Permissions are system capabilities. Positions are hospital-specific bundles of capabilities.

Examples:

```text
patient.demographics.view
patient.clinical_summary.view
patient.full_clinical.view
patient.break_glass.invoke
appointment.create
encounter.start
encounter.complete
roster.view
roster.manage
unit.assign_staff
ward.manage_beds
admission.activate
discharge.finalize
clinical_note.write
lab_order.create
lab_result.verify
prescription.create
medication.administer
invoice.create
invoice.finalize
payment.post
claim.submit
cash_session.close
inventory.stock_adjust
controlled_substance.dispense
audit.view
dashboard.executive.view
dashboard.department.view
feature_entitlement.manage
```

Client-specific positions can be created without code changes when they use existing permissions.

Code changes are required only when the client wants a genuinely new system capability.

<a id="patient-data-visibility"></a>

## 11. Patient Data Visibility

Administrative authority must not automatically become full clinical access.

Patient data classes:

```text
none
demographics
operational_summary
clinical_summary
full_clinical
laboratory
prescription
billing
audit
de_identified
```

Default examples:

```text
chief_executive: operational_summary, de_identified
medical_director: clinical_summary, audited identified drill-down
director_nursing: nursing workload and clinical_summary in nursing scope
director_finance: billing
department_accountant: billing in scoped department/service_line
department_secretary: demographics and scheduling
department_head: clinical_summary in scoped department
unit_head: clinical_summary in scoped unit
team_lead: full_clinical for assigned team patients
quality_safety_lead: de_identified by default, audited identified access when justified
committee_member: committee-specific access only
```

Full clinical record access requires clinical relationship, scoped authority, or break-glass depending on the data class and endpoint.

<a id="access-decision-flow"></a>

## 12. Access Decision Flow

Every sensitive request follows this flow:

```text
1. Authenticate user.
2. Resolve facility context.
3. Resolve enabled deployment profile and feature entitlements.
4. Resolve active authority appointments and direct roles.
5. Resolve resource scope.
6. Check action permission.
7. Check scope containment.
8. If patient data is involved, check patient-data visibility class.
9. If clinical data is involved, check patient relationship/team/unit access.
10. Apply off-site/read-only restrictions.
11. Audit sensitive decisions and all break-glass access.
```

No endpoint should rely on broad `admin` checks.

<a id="committee-authority"></a>

## 13. Committee Authority

Committees grant limited authority outside the line-management hierarchy.

Tables:

```text
committees
  id
  facility_id
  committee_type
  name
  scope_unit_id
  is_active

committee_memberships
  id
  committee_id
  user_id
  role
  starts_at
  ends_at
  is_active

committee_case_files
committee_reviews
committee_minutes
committee_decisions
```

Examples:

```text
Medicines and Therapeutics Committee
Infection Prevention Committee
Quality Assurance Committee
Mortality Review Committee
Procurement Committee
Disciplinary Committee
```

V2 should include schema and access primitives for committees. Full committee workflow UI can follow after core cutover if necessary.

<a id="delegation"></a>

## 14. Delegation

Delegation supports acting heads and temporary coverage.

```text
delegations
  id
  from_user_id
  to_user_id
  position_id
  scope_unit_id
  starts_at
  ends_at
  reason
  approved_by
  is_active
```

Delegated authority is always time-bound and audited.

<a id="core-domain-schema-direction"></a>

## 15. Core Domain Schema Direction

Platform:

```text
facilities
facility_groups
deployment_profile_state
feature_entitlements
users
roles
permissions
refresh_sessions
password_reset_tokens
audit_events
domain_events
jobs
```

People:

```text
staff_profiles
practitioner_profiles
patient_identities
patient_profiles
patient_contacts
patient_flags
patient_search_documents
```

Patient identity separates administrative record status from care activity:

```text
record_status: registered | restricted | entered_in_error | superseded
vital_status: presumed_alive | deceased | unknown
superseded_by_patient_id
record_status_reason_code
record_status_updated_by_user_id
record_status_updated_at
patient_identity_lookup_sessions
care_area_intake_idempotency_keys
```

Legacy patient `status` is temporary compatibility output. Discharge, checkout,
triage completion, encounter completion, and admission cancellation are
care-status transitions; they must not deactivate or hide a patient record.
Superseded records must point to a same-facility registered canonical patient
record. Duplicate-review sessions are bound to the reviewing user and store only
fingerprints plus candidate ids.

Care delivery:

```text
appointments
appointment_types
triage_queue
encounters
visits
care_team_assignments
clinical_notes
clinical_note_versions
note_templates
problems
problem_codes
allergies
prescriptions
medication_courses
chart_templates
chart_entries
vital_signs
nursing_tasks
medication_administrations
pharmacy_fulfillments
fluid_balance_entries
handoffs
```

Clinical notes carry one controlled workstream type: `doctor_note`,
`nursing_note`, or `allied_health_note`. Specific documentation shapes such as
SOAP, HPI, ward round, wound care, or discharge summary are represented by note
templates and their structures, not by expanding the note type set.

Medication fulfillment is prescription-led:

- A prescription may generate one `medication_course` for an admission case.
- `bid`, `tid`, `qid`, `q4h`, `q6h`, `q8h`, and `q12h` are interval schedules
  from the first dose anchor. They are not hard-coded ward-round clock lists.
- MAR generation inserts scheduled `medication_administrations`
  idempotently for the requested window and does not rewrite administered or
  dispensed rows.
- `prn` creates/keeps the clinical prescription/course context but does not
  create scheduled MAR rows or a pharmacy fulfillment obligation.
- Pharmacy sees `pharmacy_fulfillments`: patient, prescription/course,
  medication, linked inventory item, requested dose count, coverage window,
  next due, overdue count, and dispense status. Pharmacy does not need the
  anchor as a primary field.
- Dispense requires an explicit inventory item, dispensing location, and
  positive quantity, and the inventory item must match the prescription's
  linked item. The system does not guess the stock item from medication free
  text.

Inpatient:

```text
wards
ward_sections
beds
bed_events
admissions
admission_cases
admission_tasks
discharge_cases
discharge_tasks
ward_board_tasks
ward_board_events
```

Laboratory:

```text
lab_test_catalog
lab_panels
lab_orders
lab_order_tests
lab_specimens
lab_results
```

Pharmacy and inventory:

```text
inventory_categories
inventory_items
storage_locations
stock_batches
stock_movements
stock_transfers
purchase_requisitions
purchase_orders
goods_received_notes
internal_requisitions
supply_requests
controlled_registers
controlled_entries
controlled_discrepancies
```

Billing and NHIS:

```text
service_categories
services
service_prices
billing_rules
patient_insurances
insurance_providers
insurance_plans
invoices
invoice_items
payments
receipts
claims
nhis_claim_batches
nhis_exports
remittance_imports
remittance_lines
cash_drawers
cash_sessions
cash_movements
payment_intents
settlement_batches
```

Notifications and dashboards:

```text
notifications
dashboard_snapshots
search_documents
```

<a id="api-contract-direction"></a>

## 16. API Contract Direction

Use `/api/v2`.

Object response:

```json
{
  "data": {},
  "meta": {}
}
```

List response:

```json
{
  "data": [],
  "page": {
    "next_cursor": null,
    "has_next": false,
    "limit": 50
  },
  "meta": {}
}
```

Error response:

```json
{
  "error": {
    "code": "patient_access_denied",
    "message": "You do not have access to this patient.",
    "details": {}
  },
  "request_id": "..."
}
```

Use cursor pagination for hot clinical lists. Use page-number pagination only where exact page navigation is needed.

<a id="first-cut-api-modules"></a>

## 17. First-Cut API Modules

Auth:

```text
POST /api/v2/auth/login
POST /api/v2/auth/refresh
POST /api/v2/auth/logout
POST /api/v2/auth/password-reset/request
POST /api/v2/auth/password-reset/complete
GET  /api/v2/auth/me
```

Admin:

```text
GET  /api/v2/admin/users
POST /api/v2/admin/users
PATCH /api/v2/admin/users/:id
POST /api/v2/admin/users/:id/force-password-reset
GET  /api/v2/admin/audit-events
GET  /api/v2/admin/features
PATCH /api/v2/admin/features/:key
GET  /api/v2/admin/org-units
POST /api/v2/admin/org-units
GET  /api/v2/admin/positions
POST /api/v2/admin/positions
POST /api/v2/admin/authority-appointments
```

Patients:

```text
GET  /api/v2/patients
POST /api/v2/patients
POST /api/v2/patients/identity/lookup
GET  /api/v2/patients/:id
PATCH /api/v2/patients/:id
GET  /api/v2/patients/:id/current-contexts
GET  /api/v2/patients/:id/chronicle
POST /api/v2/patients/:id/break-glass
```

Care-area work:

```text
GET  /api/v2/care-areas/my-work
POST /api/v2/care-areas/outpatient/intake
POST /api/v2/care-areas/inpatient/intake
POST /api/v2/care-areas/emergency/intake
```

Care-area intake requests require an idempotency key. The server stores only a
hash of the key and a request fingerprint, replays completed results for exact
retries, rejects mismatched reuse, and treats in-progress reuse as retryable.
Outpatient intake requires an explicit clinic context. Inpatient intake must
reuse or redirect any current admission instead of creating another current
admission. Emergency current context is waiting or assigned triage; completed
triage is not considered current.

Encounters and visits:

```text
GET  /api/v2/visits
POST /api/v2/triage
GET  /api/v2/triage
POST /api/v2/triage/:id/assign
POST /api/v2/visits/check-in
POST /api/v2/visits/:id/call
POST /api/v2/visits/:id/start-consultation
POST /api/v2/visits/:id/checkout
POST /api/v2/encounters
POST /api/v2/encounters/:id/complete
POST /api/v2/encounters/:id/cancel
```

Admissions and wards:

```text
POST /api/v2/admissions/cases
POST /api/v2/admissions/cases/:id/reserve-bed
POST /api/v2/admissions/cases/:id/activate
POST /api/v2/admissions/cases/:id/cancel
GET  /api/v2/wards/board
POST /api/v2/ward-board/tasks
POST /api/v2/ward-board/tasks/:id/complete
```

Billing:

```text
GET  /api/v2/billing/services
POST /api/v2/billing/invoices
POST /api/v2/billing/invoices/:id/finalize
POST /api/v2/billing/payments
POST /api/v2/billing/payments/:id/void
POST /api/v2/billing/claims
POST /api/v2/billing/nhis/batches
POST /api/v2/billing/nhis/batches/:id/export
POST /api/v2/billing/remittances/import
```

Inventory and pharmacy:

```text
GET  /api/v2/inventory/items
POST /api/v2/inventory/stock/adjust
POST /api/v2/inventory/stock/transfer
POST /api/v2/inventory/controlled/receive
POST /api/v2/inventory/controlled/dispense
POST /api/v2/pharmacy/dispense
GET  /api/v2/pharmacy/dispensing-queue
GET  /api/v2/pharmacy/dispensing-queue/:id
POST /api/v2/pharmacy/dispensing-queue/:id/dispense
POST /api/v2/clinical/prescriptions/:id/generate-mar
```

<a id="session-architecture"></a>

## 18. Session Architecture

Sessions are security-critical because hospital users often work on shared machines, during long shifts, and across interrupted workflows.

Use a split token model:

```text
access token: short-lived JWT, 5-10 minutes
refresh token: opaque random token stored in an HttpOnly Secure SameSite cookie
session record: server-side row with device, user, facility, expiry, and revocation state
```

The access JWT is only a cache of server-side authority. The backend must reject access tokens when the session version or permission version is stale.

Access JWT claims:

```text
sub
session_id
facility_id
active_profile
permission_version
session_version
iat
exp
```

Do not put full permission lists, patient scopes, role names, or PHI in JWT claims.

Refresh sessions:

```text
refresh_sessions
  id
  user_id
  facility_id
  token_hash
  session_version
  permission_version_at_issue
  device_label
  ip_hash
  user_agent_hash
  created_at
  last_seen_at
  expires_at
  revoked_at
  revoked_reason
  rotated_from_id
```

Refresh-token rotation is mandatory. Every successful refresh issues a new opaque refresh token and invalidates the previous token. Reuse of an old refresh token revokes the whole session family and emits a high-severity security event.

Login rules:

```text
rate-limit by username and IP bucket
verify password with argon2id
deny if user is inactive
require password reset if force_password_reset_at is set
require MFA if enabled for the user or facility policy
create refresh session
issue short-lived access token
write login audit event without PHI
```

Authentication errors must be non-enumerating. The API should not reveal whether username, password, MFA, or account status failed.

Password reset requirements:

```text
single-use token
hashed token storage
short expiry, default 30 minutes
invalidate all existing sessions after completion
increment user session_version
write audit event
require strong password policy
deny password reuse using password_history
```

Default expiry policy:

```text
access token ttl: 5-10 minutes
refresh idle ttl: 12 hours
refresh absolute ttl: 7 days
high-risk action re-auth: required after 15 minutes
shared workstation idle timeout: configurable, default 15 minutes
```

High-risk actions include permission changes, authority appointments, break-glass, controlled-substance operations, payment voids, claim batch export, feature entitlement changes, and user deactivation.

The system must support:

```text
admin view of active sessions
user self-view of active sessions
revoke one session
revoke all sessions
facility-wide forced logout
role-aware idle timeout
screen-lock friendly re-auth
```

Because refresh tokens live in cookies:

```text
refresh/logout/password endpoints require CSRF protection
state-changing endpoints require Authorization bearer access token
refresh cookie uses HttpOnly, Secure, SameSite=Lax or Strict
CORS allows only configured frontend origins
```

Do not depend on browser localStorage for refresh credentials. Store only non-sensitive UI state client-side.

<a id="security-architecture"></a>

## 19. Security Architecture

Security is a product requirement, not a middleware layer. Every request must be designed around least privilege, facility scoping, patient access, and PHI minimization.

Security invariants:

```text
no endpoint accepts a patient identifier without patient access enforcement
no list endpoint returns full objects by default
no cross-facility access unless explicitly granted by profile and scope
no PHI in logs, metrics labels, traces, job names, URLs, or cache keys
no external I/O inside open DB transactions
no background job processes PHI without an audit trail
no broad admin bypass
```

Every authenticated request follows this pipeline:

```text
parse request id
authenticate access token
load session summary
load active user and facility context
verify session_version and permission_version
resolve profile and feature entitlements
authorize action against resource and scope
apply patient-data visibility projection
execute repository query with facility/patient scope embedded
write audit event when required
return least-privilege payload
```

Authorization should be enforced before object hydration where possible, so unauthorized users cannot trigger expensive or leaky lookups.

Patient access sources:

```text
active clinical relationship
ward/team assignment
clinic/session assignment
referral ownership
department/unit authority
committee/delegated authority
break-glass session
explicit patient access grant
```

Patient access classes from the earlier working model map to V2 projection levels:

```text
Demographics -> demographics
Clinical -> clinical_summary or full_clinical
Laboratory -> laboratory
Prescription -> prescription
Billing -> billing
Administrative -> operational_summary, audit, or de_identified
```

Operational access defaults:

```text
Reception: demographics and scheduling
Doctor/nurse: clinical access through active encounter, admission, assigned unit/team, or break-glass
Patient: own record only
Lab technician: patients with lab orders
Pharmacist: patients with prescriptions or dispensing work
Billing: patients with invoices, claims, or payments
Inventory staff: inventory-only unless explicitly granted clinical context
```

Audit event fields:

```text
id
request_id
actor_user_id
facility_id
action
resource_type
resource_id
patient_id nullable
scope_type
scope_id
outcome
risk_level
reason_code
metadata_json redacted
created_at
```

Audit logs must not include clinical free text, request bodies, passwords, tokens, raw identifiers from external systems, or payment card data.

High-risk audit events:

```text
login failure burst
refresh token reuse
break-glass start/end
patient chart view outside normal assignment
permission grant/revoke
authority appointment changes
user deactivation
controlled-substance receive/dispense/adjust
payment void/refund
claim export
bulk export
```

Rate limits:

```text
login by username and IP bucket
password reset request by username and IP bucket
refresh by session and IP bucket
search by user and facility
bulk/export endpoints by user and facility
break-glass by user
```

Use Redis counters with hashed identifiers. Do not store raw usernames, phone numbers, emails, or patient identifiers in rate-limit keys.

Realtime subscriptions require the same authorization model as HTTP:

```text
authenticate connection
bind connection to user, session, facility, and permission_version
authorize every channel join
do not trust client-provided facility or patient ids
drop connection when session is revoked
recheck authorization on permission_version changes
```

Channel names must not expose patient names, MRNs, diagnoses, or other PHI.

Break-glass is an audited emergency override, not a role.

Break-glass requirements:

```text
explicit reason required
time-limited grant, default 30 minutes
patient-specific where possible
high-severity audit event
supervisor/security dashboard visibility
post-event review queue
cannot grant billing/admin permissions
```

Exports are high-risk:

```text
export permission is separate from view permission
exports are queued jobs
exports have expiry
exports are audit logged
exports use minimum columns
de-identified reporting is preferred where possible
bulk patient export requires re-auth
```

<a id="performance-and-scalability-architecture"></a>

## 20. Performance and Scalability Architecture

Deployment hardware can be modest in both the current GCP path and the reusable
single-client Compose path, so the design must be efficient by default.

Target budgets:

```text
health/alive: < 20ms p99
auth/me: < 75ms p99
hot list endpoints: < 200ms p99
patient chronicle initial load: < 300ms p99
ward board: < 250ms p99
search: < 250ms p99
billing invoice finalize: < 500ms p99 excluding external integrations
claim export enqueue: < 300ms p99
```

Any endpoint expected to exceed these budgets must be explicitly async or return a job handle.

Database query rules:

```text
all list endpoints are paginated
hot lists use cursor pagination
no unbounded joins on clinical child tables
no SELECT * on list endpoints
no DATE(column) filters; use [start, end) ranges
no per-row count/exists queries
no N+1 repository loops
avoid DISTINCT on search joins; use EXISTS or search_documents
avoid OFFSET for large hot tables
```

Index policy:

```text
facility_id appears in composite indexes for scoped tables
patient timelines indexed by (facility_id, patient_id, occurred_at desc)
patient identity lookup indexed by facility, patient_code, exact DOB/name/sex,
DOB/name possible-match branches, record_status, vital_status, and
superseded_by_patient_id
current admission and current emergency triage have partial uniqueness guards
work queues indexed by (facility_id, status, priority, created_at)
appointments indexed by (facility_id, clinic_id, starts_at)
outpatient work indexed by clinic, practitioner, status, checked_in_at, and stable cursor ids
emergency work indexed by assignee, status, created_at, and stable cursor ids
admissions indexed by (facility_id, ward_id, status)
billing indexed by (facility_id, invoice_status, created_at)
inventory indexed by (facility_id, store_id, item_id)
audit indexed by time and actor/resource dimensions
search uses generated search_documents plus trigram/FTS indexes
```

Large append-heavy tables should be partition-ready from V2:

```text
audit_events
clinical_observations
chart_entries
lab_results
medication_administrations
notification_events
job_attempts
```

Cache only stable or projection-safe data.

Good cache targets:

```text
feature entitlements
profile metadata
permission bundles
org tree summaries
service catalog
price catalog
dashboard snapshots
search suggestions
```

Unsafe default cache targets:

```text
full patient charts
clinical free text
authorization decisions without version keys
user-scoped lists without user/facility/scope in key
```

Cache keys must include deployment id, facility id, user or authority scope when user-specific, profile version, permission version when authorization affects content, and projection level.

Slow or failure-prone work must be async:

```text
NHIS export generation
remittance import parsing
dashboard snapshot refresh
search indexing
notification fanout
PDF generation
bulk exports
external integrations
```

Concurrency rules:

```text
use DB transactions for state transitions
do not hold DB transactions while calling external systems
use row locks only on narrow rows
use optimistic concurrency for editable clinical documents
use append-only ledgers for stock, cash, and audit
use per-day/per-facility counters for human-readable numbers
```

Default payload limits:

```text
list item: 5-8 fields unless explicitly justified
list page size default: 25-50
max page size: 100
chronicle initial payload: summary plus newest timeline slice
large sections loaded by expand/include flags
```

Frontend routes must not fetch all pages to filter client-side. Search, filters, tabs, and date ranges are backend query params.

Every request logs structured non-PHI metadata:

```text
request_id
method
route pattern, not raw URL with PHI
status
duration_ms
facility_id
actor_user_id hashed or internal id
db_query_count
db_duration_ms
cache_hits
cache_misses
job_enqueued_count
```

Metrics:

```text
http_request_duration_seconds by route/status
db_query_duration_seconds by query name
redis_duration_seconds by operation
job_duration_seconds by kind/status
auth_failures_total by reason bucket
access_denied_total by action/resource
break_glass_total
audit_events_total
```

Metrics labels must never contain patient ids, names, MRNs, diagnoses, free text, or raw URLs.

<a id="workers-and-events"></a>

## 21. Workers and Events

No Celery compatibility.

Jobs table:

```text
jobs
  id
  kind
  payload_json
  status
  attempts
  available_at
  locked_by
  locked_at
  last_error
  created_at
  updated_at
```

Domain events:

```text
PatientRegistered
EncounterStarted
EncounterCompleted
AdmissionActivated
DischargeFinalized
LabOrderSubmitted
LabResultVerified
PrescriptionCreated
MedicationAdministered
InvoiceFinalized
PaymentPosted
ClaimSubmitted
StockAdjusted
ControlledSubstanceDispensed
ReferralSubmitted
AuthorityAppointmentCreated
PermissionOverrideChanged
```

Workers update:

```text
search documents
dashboard snapshots
notifications
realtime broadcasts
billing syncs
stock alerts
audit side effects
scheduled reminders
```

<a id="deployment"></a>

## 22. Deployment

Compose services:

```text
caddy
frontend
hms-api
hms-worker
hms-migrator
db
pgbouncer
redis
```

Rules:

- API never mutates schema.
- Migrator runs schema migrations and seed/provisioning.
- Worker runs jobs only.
- Health endpoints must distinguish alive from ready.

Endpoints:

```text
GET /api/v2/health/alive
GET /api/v2/health/ready
GET /api/v2/metrics
```

<a id="seed-and-provisioning"></a>

## 23. Seed and Provisioning

Each deployment profile has a seed package.

Seed categories:

```text
facility
admin/system owner
roles and base permissions
profile feature entitlements
org unit templates
position templates
authority presets
clinical units/departments
wards/beds where applicable
billing catalog
NHIS claim settings where applicable
lab catalog
inventory catalog
pharmacy catalog
note/chart templates
dashboard defaults
```

The seed path must be idempotent.

<a id="implementation-milestones"></a>

## 24. Implementation Milestones

1. Rust workspace, API skeleton, config, DB pool, errors, logging, metrics.
2. Request context, extractors, middleware, route skeletons, and standard responses.
3. Auth, sessions, password reset, facility context.
4. Session rotation, password reset, re-auth, revocation, and CSRF handling.
5. Deployment profiles, feature entitlements, org units, positions, permissions.
6. Access engine, patient-data visibility, break-glass, audit events.
7. Performance harness, query counting, tracing, metrics, and payload budgets.
8. Patient registry and Patient Chronicle read model.
9. Organization, clinics, appointments, triage, encounters.
10. Wards, admissions, discharge, ward board.
11. Clinical notes, problems, vitals, MAR, nursing tasks.
12. Laboratory.
13. Inventory, controlled substances, pharmacy.
14. Billing, NHIS, cash drawer, payments, remittances.
15. Dashboards, notifications, realtime.
16. TypeScript API client generation from OpenAPI.
17. GCP staging/performance validation, Hetzner rollback validation, and
    production hardening.

<a id="non-negotiable-tests"></a>

## 25. Non-Negotiable Tests

Before production cutover:

```text
auth/session tests
request context extractor tests
guard/policy enforcement tests
refresh token rotation and reuse-detection tests
CSRF tests for cookie-backed auth endpoints
forced password reset tests
session revocation tests
profile enforcement tests
facility isolation tests
org hierarchy scope tests
position/permission assignment tests
patient access regression tests
patient identifier endpoint authorization tests
break-glass audit tests
committee/delegation authority tests
clinical workflow tests
admission/discharge state tests
lab order lifecycle tests
MAR/pharmacy dispense tests
inventory stock balance tests
controlled-substance witness and balance tests
invoice/payment/claim tests
NHIS export/remittance tests
websocket authorization tests
p99/list pagination tests
query-count tests for hot list endpoints
payload-size regression tests
cache-key scope tests
PHI-safe logging tests
metrics-label PHI safety tests
```

<a id="design-principle"></a>

## 26. Design Principle

No endpoint should ask:

```text
Is this user an admin?
```

Every endpoint should ask:

```text
Can this user perform this action on this resource within this scope, with this patient-data visibility?
```
