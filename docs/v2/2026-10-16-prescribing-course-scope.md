# Reviewed prescribing documentation and linked courses

Status: implemented source; parent integration owns checkpoint acceptance.

Prescribing remains in Patient Chronicle. Rust V2 stores instructions (at most
4000 characters) and prescribing reason (at most 2000) on prescriptions. These
fields and course-change reasons are protected clinical detail; prescription
lists and Chronicle medication summaries do not acquire them. Expanded detail,
documented create, documentation changes, linked-course commands and receipt
reads require explicit FullClinical visibility as well as the existing clinical
workflow permission, feature, facility and patient access. Lean lists and the
existing lifecycle PATCH retain their established access contract.

## Explicit commands

- `POST /api/v2/patients/{patient_id}/clinical/prescriptions` accepts optional
  instructions and reason and returns the saved detailed prescription. Existing
  internal repository create callers retain their compatibility interface.
- `GET /api/v2/clinical/prescriptions/{id}` returns authoritative detail, an opaque
  snapshot token, stock unit, generated-course flag, source provenance and any
  existing successor ID. A successor ID does not itself grant access to its data.
- `PATCH /api/v2/clinical/prescriptions/{id}/documentation` requires a nonzero
  request UUID, reviewed snapshot token and explicit full instructions/reason.
  This change is available only before generated medication work for an active
  or held, non-PRN order. Generated, terminal and PRN documentation is locked.
- `POST /api/v2/clinical/prescriptions/{id}/new-course` requires the UUID, snapshot
  token, renewal/replacement relation, change reason and a complete explicitly
  reviewed regimen, including route and start date. Linked stock requires the
  reviewed current stock unit. No medication, duration, route, date, limits or
  indication is copied as a clinical default by this command.
- `GET /api/v2/clinical/prescriptions/{id}/documentation/requests/{request_id}` and
  `GET /api/v2/clinical/prescriptions/{id}/new-course/requests/{request_id}` recover
  the original actor's confirmed immutable receipt within the current facility
  and full clinical access. Unknown outcomes retain the original key and payload;
  a definite denial differs from `prescription_action_unconfirmed`.

Strict new command shapes reject missing/unknown fields with a PHI-free typed
400 response. Canonically normalized full payloads bind to actor, facility,
source and command type. Exact same-key replay returns the original receipt,
including its original prescription snapshot; it never rewrites history or
pretends to be a current detail read. A fresh GET separately returns current
status. Reusing a key for another command or payload is a conflict. Each source
has at most one successor, so another reviewed continuation follows that child.

## Lifecycle and stock

Renewal accepts only a completed or stopped source, which remains terminal.
Replacement accepts an active or held source and atomically stops its future
planned work while saving a new active prescription and provenance. Given doses,
supplied-dose evidence, dispensing actors/timestamps and stock quantities remain
unchanged. A new linked course does not generate MAR, dispense stock or transfer
pending doses. Existing status PATCH cannot reactivate a terminal prescription,
including one that never had a generated MAR course.

Optional encounter and visit references are same-patient/facility and held in
encounter-then-visit order through the new-course write. Only in-progress
encounters and recognized active visit states qualify; concurrent checkout is
rechecked after its row lock is released. Ordinary basic-create care-context
lifetime checks predate this slice and are not claimed to have gained these
transactional parent locks.

Source locks serialize token comparison, original lifecycle changes, successor
creation, command receipt and minimal audit metadata in one transaction. Item
locks use a deterministic order. Public create and both new command writes hold
verified facility, actor and exact session evidence, compare authorization
versions/profile, and recheck the exclusive server-derived authorization deadline
after lock waits and before commit. Revoked sessions and naturally expired
managed authority cannot finish a previously authorized waiting write. Audit
metadata contains IDs and enums, not clinical text or request bodies.

## PRN continuity

Migration `202610160013` assigns existing PRN prescriptions their own immutable
safety group and associates matching same-patient/facility dose history. It does
not infer missing PRN limits, instructions, reasons or renewal links. A nullable
legacy policy stays unconfigured and cannot request/administer a PRN dose.

An explicitly reviewed PRN successor retains its ancestor's group. Database
membership constraints bind facility and patient. Requests and actual
administrations lock prescription, then group, then copied dose/fulfillment work;
no writer takes a source lock while holding the group lock. Pending reservations,
actual last Given time and rolling 24-hour counts use the whole group, including
prior courses. The explicitly reviewed successor policy governs its new dose
checks against that shared history; no automatic equal-or-stricter policy rule is
invented. If a reviewed cap is tighter than prior usage, the displayed eligibility
uses the relevant retained Given timestamp, rather than merely the oldest dose.
Changing medication within a linked PRN course still retains that history.

PRN-to-scheduled and scheduled-to-PRN linked successors are explicitly rejected
with `prescription_mixed_regimen_unsupported`. This slice does not invent a safe
mixed-regimen conversion policy or allow a continuation to reset PRN history.

## Evidence and remaining scope

Focused repository and actual HTTP contracts cover detailed persistence without
list leakage, strict shape/CAS guards, immutable receipt recovery and races,
rollback, one successor, terminal closure, supplied/Given stock conservation,
patient/facility constraints, populated migration, group-wide request/admin
concurrency, managed-authority expiry and session revocation during lock waits.
Full checkpoint acceptance and generated client integration are recorded by the
parent release process.

Standalone hold/stop reasons remain outside this slice. Their compatible legacy
status PATCH does not claim to persist such a reason; replacement always records
its own required change reason. This slice introduces no automatic renewal,
clinical recommendation, external prescription transmission or strong-MFA claim.
