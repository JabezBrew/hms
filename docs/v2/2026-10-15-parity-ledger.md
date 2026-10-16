# Python to Rust and UI feature parity

Updated: 2026-10-16. Scope: the user's expanded request for all phases after the
phase-one release. This ledger extends `v2-cutover-scope.md`; its old baseline
labels are historical evidence, not a claim that all Python workflows work in
the Rust UI. Python is a behavior reference; Rust access and PHI contracts win
over unsafe legacy shortcuts.

## Acceptance rule

A workflow is complete only after its active Rust route, authorization,
persistence/lifecycle, generated frontend adapter, reachable UI, failure states,
and meaningful regression checks exist. Existing equivalent Rust workflows do
not need another Python-shaped endpoint. A route, disabled screen, mock, empty
array, or passing build alone does not establish parity. External integrations
also need configured sandbox validation before they can be described as working.

## Phase 2: clinical list correctness and usable existing contracts

| Workflow | Source evidence | Gap / acceptance | Status |
| --- | --- | --- | --- |
| Patient/admission MAR | Python `apps/nursing/views.py`; Rust `services/ward/mar.rs`; UI `nursingQueriesV2Bridge.js` | Facility-page client filtering can omit a patient's doses. Server patient/admission/time/status filtering, bounded cursors, access checks, pagination beyond 100 unrelated records. | implemented; local acceptance in phase-two verification |
| Explicit prescription stock link | Python pharmacy dispensing inventory linkage; Rust `clinical.rs` and `pharmacy.rs`; `AddPrescriptionSlideOver` | Backend accepts stock UUID but UI supplies none. Minimal active facility medication catalog, explicit selection, no fuzzy name-to-stock mapping, no inventory permission expansion. | implemented; local acceptance in phase-two verification |
| Security Settings | Python `users/mfa_views.py`; Rust `routes/auth.rs`; UI `auth.js`, `useSettingsQueries.js` | Real passkey status/enrollment/assertion test and recovery-code generation are hidden behind unsupported placeholders/wrong aliases. Expose existing contracts with cancellation, current-password guard, ephemeral code display. Enrollment is not second-factor login or fresh-proof enforcement. | implemented; local acceptance in phase-two verification |
| Existing item catalog correction | Rust `inventory/catalog.rs::apply_catalog_edit`; UI `ItemDetailPage` | Connect audited effective-dated code/name/unit correction. Do not enable unsupported whole-item CRUD or promise future activation without a projector. | implemented; local acceptance in phase-two verification |
| Emergency access | Rust `services/patients.rs` break-glass; UI `useChronicleBreakGlassAccess.js` | Dedicated category, fresh reauthentication, two-hour expiry, bounded grants, revoke/end, authoritative remount and invalidation UX. | implemented; second-checkpoint acceptance |
| Other scoped nursing lists | UI `nursingQueriesV2Bridge.js` fluid/treatment/alert/handoff methods; corresponding ward services | Same first-page filtering risk. Add server scopes and complete aggregate semantics rather than summing truncated rows. | ninth checkpoint adds task/vital/monitoring scopes; tenth checkpoint adds fluid live authority, selected-admission context and atomic ward-round producers; frozen local acceptance passed |

## Phase 3: clinical lifecycle and documentation depth

| Workflow | Python behavior reference | Required Rust / UI work | Status |
| --- | --- | --- | --- |
| MAR nonadministration / PRN | `nursing/models.py` medication outcomes; `nursing/views.py` | Missed/refused/held actor/reason/notes and single-dose PRN provenance; retain source prescription locking and immutable administration history. Compatibility dialog drops outcome fields; active grid lacks these choices. | outcomes and source-linked PRN implemented; third/fourth checkpoint acceptance |
| Patient treatment / supply | `nursing/models.py` treatment entries; `pharmacy/services.py` | Regimen, ordered/dispensed/administered balances, discontinue, repeat supply. Ward stock requisitions are a separate existing workflow. | queued |
| Fluid corrections and facility thresholds | `nursing/models.py`; `core/views.py` fluid settings | Audited corrections, categories/notes, effective facility thresholds and monitoring integration; server complete totals. | implemented; fifth checkpoint acceptance plus tenth checkpoint live-authority and selected-admission hardening; tenth local acceptance passed; browser/staging pending |
| Clinical handover | `nursing/models.py` shift handoff | Patient narrative/context CRUD and correction history; Rust ward/recipient/shift header alone is partial. Python has no delivery or recipient-acknowledgment contract. | inpatient Chronicle narrative, amendments, immutable history and void implemented in eighth checkpoint; outpatient scope remains queued |
| Prescribing documentation and renewal | `clinical_notes/models.py`, `views.py` renewal action | Persist supported instructions/reason, explicit replacement/renewal provenance with no source-course resurrection. | implemented; seventh checkpoint, including shared PRN safety history; see verification boundaries |
| Note/template governance | `clinical_notes/views.py` revision/review/publish/render/duplicate | Versioned schema and visibility, review/publish lifecycle, safe render and historical preservation. | strict immutable note/template commands, pinned revisions, scoped history/CAS/receipts and corresponding Chronicle/catalog UI implemented in ninth checkpoint; optional review/publish/duplicate and remaining safe-render governance queued |
| Referral consultation handover | `referrals/views.py` consultation and response draft | Direct consultation/context handoff and real draft-response editing. Existing accept/decline/schedule/complete/SLA/waitlist are equivalent. | queued |
| Admission advisory tasks | `admissions/models.py`, `views.py` | Advisory create, complete and acknowledge-unresolved lifecycle without reintroducing manual discharge-clearance bypasses. Python has no separate reopen action. Existing source-driven discharge blockers remain authoritative. | queued |
| Atomic ward-round workflow | `clinical_notes` ward-round actions; Rust ward-round routes | Complete reviewed draft, source-aware atomic commit, immutable original receipts, real artifacts, selected admission and retained uncertain-write UI. | implemented in tenth checkpoint; frozen local acceptance passed; later history selection and broader prescribing remain separate |
| Ward transfer | `wards/views.py` transfer/allocation logs | Explicit requested/accepted/cancelled/completed transfer states, atomic bed/admission changes, audit and UI. Existing beds/staff assignments are separate. | queued |

## Phase 4: access administration and trusted runtime

| Workflow | Evidence | Required work | Status |
| --- | --- | --- | --- |
| Grant revocation | Python `organization/views.py`; Rust admin list/create + expiry queries | Append-safe authority/permission/delegation ending, permission-version invalidation and immediate request denial. Socket reauthorization remains a realtime slice. | request lifecycle implemented in third checkpoint; realtime queued |
| Organization lifecycle/membership | Python clinical units/members/coverage; UI `organization.js` | Audited unit updates/activation and hierarchy constraints, scoped membership/coverage; replace empty-array placeholders only when real contracts exist. | queued |
| Account setup/reset delivery | Rust `state.rs` delivery interfaces / reset request | Trusted reset adapter, bounded asynchronous delivery, no raw-token persistence/logging, account-locked all-link invalidation and stale-proof fencing. Durable retries and actual configured provider delivery still require work. | adapter/lifecycle implemented; external sandbox and durable delivery queued |
| Strong authentication | Python MFA flow; Rust enrollment primitives | Verified second-factor login/recovery and fresh privileged proof; enrollment alone is insufficient. | queued |
| Offsite network policy | Python `core/models.py`; Rust extractor header facts | Trusted-proxy-derived client provenance, CIDR policy, deny/read-only decisions and facility administration. Never trust caller-supplied location headers. Caller headers are no longer authority. Actual socket/trusted-proxy facts and current facility policy govern protected reads and writes; policy publication fences server-authorized and client-reviewed versions under lock. | implemented; sixth checkpoint local Rust/frontend/HTTP/proxy acceptance; browser/staging pending |
| Continuous realtime | Python Channels; Rust dashboard upgrade sends initial delta then ends | Persistent bounded fanout, channel visibility, reauthorization/version changes, disconnect/backpressure/reconnect tests; polling remains fallback. | queued |
| Audit investigation | Python `audit/views.py`; Rust admin bounded list | Filter/statistics parity; export only through governed minimal async/download contract, never historical broad PHI CSV. | queued |

## Phase 5: billing and inventory completion

| Workflow | Current evidence | Required work | Status |
| --- | --- | --- | --- |
| NHIS mappings/batches/remittance | Rust billing create mappings, selected-claim batch and structured remittance APIs | Mapping versions and selected-claim batches connected with locked eligibility/snapshots and real UI. Export metadata must preserve later states; remittance has no accounting settlement. | mappings/batch creation and internal export record lifecycle implemented; real download/remittance queued |
| Billing catalog/insurance/cash review | Python billing models/views; UI `billing.js` guarded mutations | Persist supported effective catalog/insurance lifecycle and cash review; preserve immutable finalized invoices/reversal ledger. | queued |
| PSP settlement | Python billing provider modules; Rust adapter guarded | Provider scope, credential isolation, idempotent async intake and settlement reconciliation; sandbox evidence required. | queued; external configuration required |
| Inventory item/location administration | Python inventory; Rust read surfaces | Governed create/update/deactivate, stock/history constraints and audits; catalog correction is a narrower phase-2 slice. | queued |
| GRN/procurement/transfers | Python inventory; Rust limited transitions | GRN item correction/rejection, requisition-to-order conversion and explicit transfer lifecycle, concurrency and stock conservation. | queued |
| Standing orders | Rust previously created metadata and generated empty drafts; legacy UI expects recurring items | Versioned recurring-item payload, populated requisitions and conserved stock issue. Scheduled automatic generation remains separate. | explicit templates/approval/full stock issue implemented; automatic scheduler queued |
| Catalog versions | Rust stores future versions but reads current item; no activation worker/history API | Version history/conflicts and deterministic future activation before offering scheduled edits. | queued |

## Phase 6: scheduling, laboratory, configurable charting

| Workflow | Evidence | Required work | Status |
| --- | --- | --- | --- |
| Appointment recurrence | Python appointment generation; Rust `create_appointment_series` repository exists without API | Expose audited series contract/UI with atomic capacity, conflicts, cancellation and exceptions. Normal booking/session templates already work. | explicit real-slot series implemented; fifth checkpoint local regression/HTTP acceptance passed; browser/staging pending; rule expansion and automatic scheduling queued |
| Appointment type/availability administration | Legacy UI guards versus current scheduling contracts | Complete genuine missing administration without duplicating implemented scheduling sessions/exceptions. | queued |
| Department rosters | Python `organization/views.py` roster generation/import/publish | Staff source, shifts/coverage, publish/override and bounded on-duty projections. Scheduling session templates are not roster parity. | queued |
| Lab catalog management | Python `laboratory/views.py` customize/reset/CRUD | Facility-owned test/panel versioning and safe order/result historical snapshots. Normal lab order through verification already exists. | queued |
| Chart builder and assignments | Python `charts/models.py` templates/fields/assignments/critical entries/trends | Validated versioned schema, assignment lifecycle, safe entries/alerts/trends inside Chronicle. Scalar chart entries alone are partial. | queued |
| Role dashboards / inventory analytics | Existing snapshots plus legacy metrics | Define sourced bounded projections and metric ownership, then implement/test; no fabricated summary data. | queued |

## Phase 7: governed external integration and release proof

FHIR, MPI/merge, record export, cross-facility exchange, AI assistance and tenant
onboarding have legacy implementations or experiments but remain absent from
Rust. The previous cutover explicitly removed them. The expanded request brings
them into the backlog; it does not supply recipient trust, clinical safety,
residency/retention, credential, identity-proofing or provider contracts. Design
those contracts before adding egress routes. A mock provider or disabled connector
must stay labelled as such. Do not send real patient data or buy resources to
make a parity claim.

Each release requires local backend/frontend/contracts/security checks, rendered
desktop/mobile workflow checks against Rust, commit/push evidence, existing free
synthetic staging backup/rollback anchors, exact deployed source/build identity,
readiness, anonymous denial and authenticated persistence checks. GitHub Actions
remains disabled. Phase-one verification is recorded separately in
`2026-10-15-phase-one-verification.md`.
