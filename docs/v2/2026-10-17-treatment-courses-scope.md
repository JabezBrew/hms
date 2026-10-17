# Generated admission medication courses

Status: focused treatment repository acceptance passed; integrated release
verification remains pending. This is not a clinical release claim.

## Coverage and clinical meaning

The Chronicle medication-course workspace covers canonical `medication_courses`
for the explicitly selected patient and admission. It does not guess an
admission for an ungenerated prescription or present a dated treatment-sheet
header as a complete medication plan. Source prescription status and the local
admission-course status are separate facts.

Whole-course counts distinguish actual generated scheduled doses, indicated PRN
requests, supplied doses, Given doses, unsupplied scheduled doses, supplied
pending doses, and explicit nonadministration outcomes. Supplied non-Given doses
retain their original issue evidence. Their difference from Given doses is not
a bedside-stock, return, waste or consumption ledger. Physical totals are null
when recorded evidence is missing, mixed in unit or outside the supported whole
quantity range. No historical one-unit conversion or days-of-supply estimate is
inferred from clinical dosage text.

## Local stop

`Stop this admission course` requires an explicit reason and the reviewed source,
course and selected-care-context tokens. It appends immutable actor/time/ward and
source-status evidence, closes only the selected admission course, retires only
eligible pending doses and cancels only its still-open fulfillment headers.
Given, independent Held/refused/missed decisions, issue quantities and physical
stock movements are preserved. The source prescription and other admission
courses remain unchanged.

An active/on-hold course in an active selected admission can be retired even
when its correctly scoped source is now terminal or its regimen has changed.
The saved evidence records that actual source state; this is cleanup of local
pending work, not source resurrection. Missing or foreign source bindings are
not accepted. No local resume exists. Canonical source-wide hold, resume, stop
and completion exclude locally stopped courses and their retired dose markers.

## Additional scheduled window

An expansion is a distinct prescribing command requiring
`ClinicalDocumentationManage`. It creates one canonical fulfillment for the
new nonoverlapping window and exactly the new MAR membership, without moving
stock or creating a second order for doses that are already queued. Existing
pending supply is reviewed through its original demand.

The window begins at the recorded `scheduled_through` boundary, uses the
unchanged captured regimen/anchor and reviewed physical policy, and has an
explicit exclusive end within the minimum of the prescription's actual finite
end, 31 days from that boundary and 31 days from the current DB clock. It must
contain 1..512 actual new doses. Elapsed boundaries, PRN, once/stat, unknown
schedules, missing policies, changed catalog units and either controlled-item
classification are rejected. The current maximum is a constraint, not an exact
pre-save dose-count preview.

The initial generation retains its original time window and original
fulfillment identity when replayed after expansion. A partial unique index
allows only one original header across `initial_generation` and `prn_aggregate`;
later `scheduled_window` headers have their own exact window identity. Dedicated
controlled-substance stock remains a separate workflow, with no invented
controlled-Rx-to-MAR issue contract.

## Live access, locking and evidence

Rich reads require Patients, Encounters and Nursing features, explicit
`ClinicalDocumentationView`, FullClinical, an ordinary Chronicle relationship
and actual authority for the selected admission's current ward. Write permission
is additional, never inferred from role or Nursing task authority. An active
admission/ward is required for new local stop or expansion; authorized historical
review remains separate. The central pharmacy queue/issue retains its distinct
facility-purpose Prescription-or-Full policy rather than acquiring a bedside
relationship requirement.

HTTP repositories require an exact live session/version/profile/deadline proof.
The server-resolved network-policy version is checked after waits and retained
under a policy SHARE lock through publication. Version zero uses only an
unchanged readonly sentinel, with no implicit onsite ranges or authority. A
policy published before that proof rejects the old request; a publication after
the proof waits for the protected transaction. This fence is specific to the
medication workflows using the shared helper, not a global cancellation claim.
Source commands serialize the prescription, current identity, PRN group if any,
selected admission, course and child work. Item policy is reread under an item
SHARE lock before adding demand; actual stock issue retains its canonical source
serialization. All clinical effects, original membership, command receipt and
minimal audit commit together, with final DB-clock checks after waits. List
filters and tuple/relationship scope precede LIMIT. A fixed number of proof and
projection statements serves a page; this does not claim constant scanned rows.

Stable client UUIDs are actor-bound and store normalized reviewed input plus an
immutable original receipt. Exact replay is checked after current rich-read
authority but before present-day action eligibility/Manage. A changed body or
scope with the same UUID conflicts. Original request membership is separately
returned from the dose's current status and supply evidence; later stop or
outcomes cannot rewrite it. Local-stop membership hashing uses bounded chunks
rather than materializing an unbounded ID array; total stop work still scales
with the number of affected doses.

## Deliberate limits

Migration023 replaces the old full course-fulfillment uniqueness with a partial
original-header constraint and separate window identities. Pre-023 generation
and PRN writers use the old unconditional `ON CONFLICT` target and cannot run
against that new schema. Deployment must quiesce/drain those writers before
applying023 and start the matching application before admitting work. An older
application rollback requires an explicitly forward-compatible build; retaining
the old full unique constraint would incorrectly prohibit additional windows.

No ungenerated inpatient-order admission binding is inferred. No automatic
renewal, local resume, PRN expansion, medication-text arithmetic, stock return,
bedside balance, controlled issue integration or physical-issue UUID receipt is
introduced. The existing pharmacy issuer's one-eligible-batch behavior is
unchanged; this workspace promises neither aggregate availability nor a new
multi-lot FEFO contract.

## Focused evidence

The isolated Docker/Postgres `hms-db` treatment suite passes23/23 cases. Two
imported foreign-child fixtures first reproduced successful complete-course
reads; the repaired parent-known indexed probes now return review-required
without a foreign body or mutation. A real final audit wait first reproduced
publication after the reviewed start elapsed; the final clock check now returns
typed `treatment_course_window_elapsed` and rolls back header, doses, membership,
boundary and audit together.

Actual source-lock barriers exercise both publication orders for supply versus
local stop, Given versus local stop, and window expansion versus local stop.
Given/non-Given and issued physical evidence are retained; no extra stock move
is inferred. Source hold/resume/stop cannot rewrite the local terminal evidence.
Other episode and source rows remain unchanged by a local decision. Source-wait
session revocation/natural deadline expiry and final-audit expiry reject without
business effects. Exact replay and receipt recovery remain available with fresh
read authority after Manage withdrawal; new or changed intent cannot acquire
write authority that way.

Page-size1 versus100 checks include the instrumented live proof and preserve a
constant query count for clean course and original-dose-member pages. Newer
excluded terminal courses cannot truncate the active first page. An imported
604-dose pending course exercises chunked stop membership and separately paged
immutable original evidence. Missing or mixed-unit physical history remains
unknown; no one-unit conversion is introduced. Initial-generation replay keeps
its original header after an additional window, and incompatible imported
original kinds cannot be relabelled by replay.

The full working workspace check passed. Integrated HTTP, preserved medication
regressions, generated contracts and frontend acceptance are owned by the
coordinating release gate; their final coherent-source results must be included
before checkpoint acceptance.
