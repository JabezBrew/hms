# Admission follow-up evidence

Status: local implementation and focused verification. Release verification is
recorded separately. This is the nonblocking Admission Advisory workflow from
the Python admission domain, distinct from general nursing tasks, admission
intake/activation blockers and DischargeTask finalization.

## Supported workflow

Exactly eight explicit kinds are supported: `pharmacy_med_rec`,
`baseline_lab_followup`, `infection_control`, `dietary`, `social_work`, `transport`,
`documents` and `other`. A case can have one record per kind, with no reopening.
Creation requires a reviewed kind and note. No record is seeded automatically;
no assignee, role inbox, notification delivery or system-blocker clearance is
implied.

Pending follow-up has version one. A clinician can record one terminal decision:
Completed, Acknowledged unresolved or Cancelled. Completion accepts optional
notes, matching the actual Python completion behavior; acknowledgment and manual
cancellation require an explicit reason. Completion never means unresolved
acknowledgment. Original note, creation phase/ward, actor labels and terminal
actor/time/reason/source are persisted and immutable. Phase follows the locked
case status, because the historical `admitted_at` default also exists on Ready
cases.

New follow-up, completion and unresolved acknowledgment are available only for
Ready for activation, Admitted or Discharge pending cases in an active current
ward. Historical or imported Pending evidence can be explicitly Cancelled under
current clinical/ward authority. An actual transfer preserves the creation ward;
the current ward governs access and is separately captured on a later decision.

## Chronicle API

Six operations use the existing bounded cursor and object envelopes:

- `getPatientChronicleAdmissionAdvisoryCases`: GET
  `/api/v2/patients/{patient_id}/chronicle/admission-advisory-cases`.
  `cursor`, `limit` (default 25, maximum 100), `include_closed` and actual case
  `status` are server filters. Current ward predicates precede LIMIT.
- `getPatientChronicleAdmissionAdvisories`: GET
  `/api/v2/patients/{patient_id}/chronicle/admissions/{case_id}/advisories`.
  Returns fresh case/ward status, opaque context token, actual capabilities and
  the complete checklist, with exact status counts. Eight unique kinds bound
  this case checklist independently of the case-picker pagination.
- `postPatientChronicleAdmissionAdvisory`: POST to that case base with stable
  `client_request_id`, `expected_context_token`, explicit `task_type` and `notes`.
- `getPatientChronicleAdmissionAdvisory`: GET that base plus `/{advisory_id}` for
  the protected narrative and captured evidence.
- `postPatientChronicleAdmissionAdvisoryDecision`: POST that detail path plus
  `/decision`, with stable UUID, exact version, context token, decision and
  conditional reason.
- `getPatientChronicleAdmissionAdvisoryRequest`: GET that case base plus
  `/requests/{request_id}` for immutable original actor-bound evidence.

The private context fingerprint includes actual case, patient, ward/name/status,
bed, encounter, visit and case update timestamp. A legacy placement/care-link
change without an update timestamp still invalidates a reviewed command.

Exact same-actor/key/normalized-payload replay returns the original result even
after a later decision or case closure, subject to current read authority. It
does not assert current status or permissions. Saved receipt capabilities are
false; a fresh context/detail controls later actions. A different payload or
actor cannot reuse the reference. A new key cannot reopen an existing kind or
overwrite its terminal evidence. Generic storage failures use
`admission_advisory_write_unconfirmed`; clients must recover the original result
or explicitly replay the same frozen command rather than silently using a new
key. This slice does not give existing bodyless operational closure endpoints
the same UUID command semantics.

## Access and lifetime

Every rich read and decision requires actual AdmissionManage/Admissions,
Chronicle Patients + Encounters + ClinicalDocumentationView, explicit Full
Clinical visibility, an ordinary clinical relationship and current ward
assignment or the existing explicit all-ward permissions. No role, case creator
or attending identity creates these grants. Audited emergency Summary access
does not become Full or write authority through this feature.

Public callers supply mandatory resolved session/profile/version and authority
deadline proof. The repository locks the source case, rechecks the exact active
facility, actor and live session after waits, rereads actual feature entitlements,
retains ordinary relationship/ward assignment evidence and checks the DB-clock
deadline again before returning or committing. Permission/visibility changes,
natural managed authority expiry, session revocation and governed offsite
freshness are bounded by that proof. Reads are protected by the same lifetime
checks. List DTOs contain no clinical note or decision reason.

The normal command order is UUID serialization, case parent, facility/user/exact
session, ordinary patient relationship, current ward/assignment, advisory child,
immutable command/audit, final deadline and commit. Reads use shared source
locks. Case cancellation keeps case-before-bed order; discharge completion keeps
discharge-case-before-admission-before-bed order. Both retire advisory children
only after the parent is held. No child-first public writer is introduced.

## Canonical cancellation and discharge

Canonical admission cancellation and discharge completion atomically retire
only Pending follow-up as Cancelled. They persist actual closure actor, display
label, time and current ward, plus explicit `admission_case_cancelled` or
`admission_discharged` source/system reason. These are episode retirement events,
not clinical completion or unresolved acknowledgment. Earlier terminal evidence
is never rewritten. Audit failure rolls back both closure and retirement.

Pending admission follow-up neither blocks activation nor discharge. Existing
intake and canonical discharge blocker checks remain separate and unchanged.
The existing discharge blocker assessment occurs before the closure transaction;
this slice does not claim a new concurrency guarantee for all billing, pharmacy
or other blocker producers.

The two public closure routes retain their legitimate operational
AdmissionManage/demographic access and add mandatory live proof and post-wait /
final deadline checks. They do not gain Full access or return advisory narrative.
They reject nonempty request bodies with generic 400 rather than silently
discarding clinician text. Trusted older actorless repository helpers cannot
invent an actor when Pending follow-up exists; they fail atomically in that case.
Their no-advisory fixture/import behavior remains compatible.

## Compatibility and limits

Migration020 adds scope-bound advisory roots and immutable command evidence. It
does not invent historical records, roles, clinical relationships or Full grants.
Pending/version-one and paired terminal evidence checks reject half-populated
records; source checks validate local case, patient, ward and captured labels.
Terminal rewrites and deletes are refused.

Actual Ready cases have a ward, but the current intake path does not itself
establish an ordinary clinical relationship, and governed care-assignment
administration is not delivered here. Such cases remain honestly unavailable to
actors without existing clinical/ward access. The UI belongs in Chronicle with
an explicit real case selector; standalone operational detail can link to that
exact case without publishing clinical notes. No current-admission fallback is
appropriate for an all-history or unrelated selection.

Focused DB tests cover all kinds, phase and no-blocking behavior, exact command
recovery, distinct terminal decisions, immutable evidence, current-ward filtering
before LIMIT, transfer/context fences, competing CAS, both publication orders of
manual decisions versus cancellation/discharge and audit rollback. Actual HTTP
tests cover strict input, access/feature/relationship gates, operational closure
without Full elevation, bodyless commands and post-lock session revocation.
These are functional/security regressions, not a p99 performance benchmark.
