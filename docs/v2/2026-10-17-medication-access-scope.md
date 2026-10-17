# Medication workflow access and lifetime

Status: the 17 focused medication-access HTTP regressions, 24 affected existing
HTTP regressions and 42 affected DB regressions pass. Checkpoint acceptance
remains pending; this document does not claim a clinical release.

## Bedside medication work

Rich MAR lists, PRN orders and requests, manual scheduled doses and dose outcomes
require FullClinical, NursingTaskManage, the Nursing feature and existing
demographic/name access. A current ordinary Chronicle relationship and an active
assignment to the admission's actual current ward, or explicit all-ward
authority, are separate requirements. Assignment filtering and coherent local
patient/admission joins run before the bounded page, never after a facility
preview has already been truncated.

Ordinary Chronicle evidence currently means a registered, nondeceased patient
with an actual patient context or authored clinical note. This matches
`clinical_patient_access_evidence`; it does not invent a new historical-death
policy. Discharged admissions for otherwise authorized patients remain readable,
and an exact terminal outcome replay remains immutable. Given, new scheduled
doses and new PRN care require an active admission and active ward. Existing
scheduled/manual nonadministration can still be charted after discharge under
current access and unchanged source/course eligibility: its actual recording
time and actor are retained, with a required reason. It is not a backdated
administration or a resurrection of locally retired work. Broader deceased-record
historical access requires an explicit future access-policy decision.

The legacy TreatmentSheet DTO is a lean dated header with patient identifiers,
names, admission, status and timestamps. It retains demographic workflow access,
rather than acquiring an invented FullClinical requirement. Its reads and writes
still require live Nursing authority, a coherent local patient/admission and
actual ward scope. The header does not imply a complete medication plan.

## Central pharmacy purpose

The central queue, fulfillment detail and stock issue require PharmacyDispense,
the Pharmacy feature, Prescription or FullClinical visibility and the retained
demographic/name rights. This is an existing facility-purpose workflow. A
pharmacist does not need an authored note, Chronicle context, Nursing permission
or bedside ward assignment. Facility/source/course/admission/patient tuples must
be coherent before paging or returning a body. Location catalog metadata keeps
its separate existing pharmacy permission contract.

## Live proof and source locks

The covered HTTP entrypoints are generic prescription PATCH and MAR generation,
rich MAR/PRN list and write routes, lean dated treatment-sheet routes, and central
pharmacy queue/detail/issue. Each passes a mandatory exact-session proof.
Facility, current user versions/profile and live refresh-session rows are
locked with SHARE proofs; feature overrides are reread while the facility parent
is held. The deadline includes the resolved managed-authority boundary, token
bound, session bound and applicable offsite freshness. Actual DB-clock checks
cover lock waits, audit/receipt work and final publication. A missing proof does
not become an HTTP compatibility shortcut.

The proof also carries only the server-resolved network policy version, without
an address. It locks that policy row with SHARE and rejects a changed version;
publication takes UPDATE on the same row. If the resolved policy is absent
version zero, the transaction first inserts only the unchanged readonly sentinel
with empty ranges. This does not configure onsite access or create a policy
history, command or audit event. Configured requests never insert a sentinel.
The policy lock remains held through the final clock check and commit.

Source-bearing writes lock the prescription first, then live identity, PRN group,
ordinary patient/ward context and copied course/fulfillment/dose work. Returned
outcome and issue evidence is read inside the same protected transaction. Generic
prescription PATCH uses the protected source-first variant and a minimal audit;
it cannot update using a session revoked while the source lock waited.

Local course stops remain separate from source prescription status. Source-wide
hold/resume/stop/completion cannot revive or rewrite locally stopped courses or
their pending dose evidence. PRN requests retain their explicit source policy and
rolling group limits; their aggregate fulfillment is explicitly `prn_aggregate`.
No stock return, arbitrary daily PRN default, anonymous PRN dose, witness claim or
physical-quantity inference is introduced.

Trusted pool-only repository interfaces remain for isolated fixtures/imports.
Production HTTP callers use the authorized variants. List queries remain bounded
to 100 rows plus one cursor sentinel with a constant number of proof statements;
this is not a claim of constant scanned rows or constant assignment cardinality.
Source and proof statements carry static measurement tags without identifiers or
clinical text.

## Regression evidence

`medication_access_contract` exercises actual HTTP routes and isolated Docker
databases. The clean checkpoint 12 source run compiled only this new test file
against the frozen production source. Eleven assertions exposed missing guards:
rich Summary access, central pharmacy purpose, ordinary patient relationship,
ward access and withdrawal, Nursing feature withdrawal, generic prescription
PATCH and PRN request after exact-session revocation, new manual scheduling after
discharge, and a policy publication during a prescription source wait. In the
last case an operator published Deny while the old request waited, and the old
request still changed the prescription with HTTP 200. Three existing safety
cases passed. The pagination case initially failed in fixture setup because it
created two active admissions for one patient; its excluded admission is now
historical, preserving the intended same-patient cross-ward test.

The working implementation passed all 17 cases, including the corrected
pagination fixture, a central pharmacist without a bedside relationship,
measured page-size query costs, terminal replay after discharge and natural
managed-authority expiry. Two first-publication orderings prove that the v0
sentinel creates no publication evidence, a rich read holding its proof delays
publication, and a request resolved before a winning publication rejects the
changed version. No broader in-flight network policy cancellation guarantee is
claimed for other HMS workflows.
