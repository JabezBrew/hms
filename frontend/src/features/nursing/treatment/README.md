# Admission medication courses

Status: Rust V2 frontend implemented against the generated eight-operation
contract. Release acceptance remains the parent phase verification boundary.

This Chronicle workspace reviews canonical generated medication courses for an
explicitly selected admission. It does not reinterpret daily treatment headers as
courses, assign ungenerated prescriptions to a guessed stay, or substitute ward
stock requisitions for patient-course pharmacy demand. The existing MAR remains
the dose-outcome surface and the existing reviewed prescription flow remains the
regimen-change surface.

Whole-course counts come from complete server aggregates, independently of paged
dose and supply histories. Source prescription status and admission-course status
are separate. Missing physical evidence is unknown, never zero or one stock unit.
Days of supply are not estimated from frequency or dose text. Supplied non-Given
doses do not imply reusable bedside stock or a stock return.

Stopping a course is admission-local and requires a fresh protected source,
current server capability, reviewed tokens and an explicit reason. It preserves
the source prescription, other episodes, Given/nonadministration evidence and
physical stock history. An additional contiguous schedule window creates actual
dose records and patient-course demand; it does not dispense stock or document a
Given dose. Existing queued demand is reviewed rather than created again.

The detail shows the captured regimen separately from current source status and
documentation. A changed or terminal source can still have an active local
course: a server-authorized local stop retires only that case's pending work.
Schedule extension additionally requires a matching active source and reviewed
stock basis. The server supplies its current maximum cutoff and 512-record cap;
the form starts with no cutoff and never predicts an exact count before saving.
The prescription handoff opens the actual Chronicle medication timeline. The MAR
handoff uses exactly the selected case, including a historical case, without a
different current-admission fallback.

Rich content requires current Full clinical access and the actual workflow,
patient relationship and ward proof enforced by Rust. Historical admission
review does not imply write access. All-history and outpatient selections never
fall back to the patient's current admission. A protected denial removes copied
clinical content and requires a new authorized read.

A new protected context read is required on every open cycle, even when the
same controller and draft are retained. A pending review cannot switch courses
or publish a late form after close/reopen. Background context polling does not
discard a still-authorized draft. A read-only or newly unavailable action flag
disables new commands even if its opaque snapshot token stayed unchanged.

Commands retain their original UUID, exact reviewed payload and first opaque
uncertainty handle above the dialog portal. Closing hides DOM and queries;
patient/admission/authority changes discard clinical copies. A verified
same-session proof may retain a workflow controller while strict transport
changes abort pending requests. No command automatically retries. Only a
validated exact immutable receipt acknowledges its original uncertainty handle;
a context read, missing lookup or malformed response does not establish success.


Actual actor, permission, profile, facility or clinical-visibility changes discard
clinical command copies. Read-authorized server receipts do not permit carrying a
previous authority's reviewed body into a new scope. The central opaque recovery
barrier remains; a fresh read-only course/history review and explicit manual
reconciliation are available. Same-session factor proof can retain the controller
only when the nonfactor authority facts still match. Neither path retries a write
automatically.

## Verification scope

Tests use the real generated client and transport with synthetic responses. They
cover selected historical versus current admissions, unavailable access and
Summary denial, fresh reopen reads, whole-course versus page counts, nullable
stock evidence, local stop versus source prescription, bounded schedule review,
immutable original membership versus current outcomes, both history pagers on
course change, malformed and missing receipts, aborts, pending dismissal,
response loss, exact replay and opaque receipt recovery. Actual AuthProvider,
NetworkAccessBoundary and retained Chronicle Host tests exercise same-session
proof upgrades while preserving strict transport and frozen unknown commands.

The shared admission classifier loads only when that protocol is needed. A chunk
failure blocks an undispatched write; tests also change actual authority during
loading and make an earlier command uncertain during the await. The final
synchronous dispatch fence and origin-bound recovery checks remain in force.

Full lint, generated-client consistency, full frontend tests, isolated production
build and unchanged bundle budgets are the frontend gates. React Doctor feedback
is recorded separately from authorization and runtime evidence. Its remaining
owner diagnostics concern control-flow complexity in six presentation/controller
functions. Draft, review and pending state stays above dialog portals; extracted
fields, controls, review and pane components keep those lifetimes explicit.
No browser rendering, live pharmacy issue or deployed acceptance is claimed by
this frontend verification.
