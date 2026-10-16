# Fluid observation corrections and facility monitoring

The current route access and authority-lifetime contract is tightened by [Fluid access and authority lifetime](2026-10-16-fluid-access-lifetime-scope.md); use that document for Full/Summary, actual ward and session-proof rules. The evidence/projection behavior described here remains in force.

This active Rust slice retains original paired intake/output evidence and adds
recorded corrections, voids, metadata, and facility-scoped monitoring.

## Clinical workflow

The Chronicle fluid panel records whole millilitre volumes, observation time in
UTC, typed categories, optional subcategories, output colour, and notes. A new
observation requires an active local admission. A correction loads the complete
saved source before review, preserves both measured directions, requires a
reason, and appends a replacement. A void records a reason and removes the
observation from effective totals without deleting its evidence. Earlier
combined rows with unknown categories remain truthful; unchanged historical
volumes can be preserved during a metadata correction.

Day and all-history views use explicit patient/admission scopes and bounded
cursor pages. The optional `include_closed` list mode exposes the last recorded
version of voided roots so their history stays reachable after a receipt closes.
Voided entries are marked and excluded from totals. Per-root history retains
original/replacement values, metadata, reasons, actors, and recording times.
Synthetic direction IDs from the old frontend adapter are never accepted as
write targets.

Every write carries a client UUID. Actor, operation, and canonical request digest
are reserved inside the same transaction as the evidence/projection/audit. An
identical request replays its saved result; a reused key with different content
conflicts. Corrections and voids lock the root and require the saved source and
revision still to be current. Competing changes have one winner. Audit events
contain opaque resource references and revision only, with no clinical notes,
volumes, patient names, reasons, or request bodies.

Unknown network, malformed-success, and generic persistence responses retain the
exact UUID and payload. Automatic write retries are absent. The panel controller
survives dialog portal dismissal; pending dismissal is blocked and an uncertain
change can be reopened and explicitly retried unchanged. Permission/context
changes remove copied clinical controls. A callback or failed refresh does not
turn a confirmed write into a new recording.

## Monitoring policy

`NursingTaskManage`, the Nursing feature, demographic patient access, FullClinical
visibility, and actual current admission-ward authority protect rich patient
reads and every patient write. ClinicalSummary deliberately permits only scalar
legacy totals/trends. Current and compatibility paths carry mandatory live
session/version/profile/feature/deadline proof after waits and before commit;
ward predicates apply before pages and aggregates. New observations additionally
require active admission/ward context; historical evidence corrections remain
authorized separately from new entry eligibility.

Publishing facility rules requires explicit `AdminAuthorityManage` and the Admin
feature, with a separate locked administrative proof; it does not infer Nursing
or patient visibility. Each publication has an expected version, reason, client
UUID, immutable version row, and atomic audit. Replaying an older rule write
returns its original version even after a later publication, under current
access and live authority.

Unconfigured presets have every assessment disabled. Configured rules assess
whole UTC days using strict threshold crossings: low intake, high output,
negative balance (critical), and positive balance (warning). The current day is
explicitly partial. No observations produce `no_data` and no inferred condition.
Disabled and unconfigured states are distinct. Derived fluid conditions remain
separate from manually recorded/acknowledged nursing alerts.

Effective daily counters change atomically with the root pointer. Cross-day
corrections acquire both counters in date order. Old compatibility list,
summary, and trend contracts now exclude superseded/voided rows. Their create
path is also audited transactionally and reports generic persistence failures
as unconfirmed. Imported/demo insert/update/delete paths maintain projections
through compatibility triggers; new clinical correction APIs append evidence.
Migration backfill uses original recording timestamps for activity provenance.

The ward board reads one indexed daily counter per admission, with current
facility rules. Fluid conditions participate in attention ranking, critical and
alert filtering before pagination. DTO fields identify the derived condition
and critical counts; manual alert counts remain unchanged. Latest fluid
activity uses an indexed root timestamp. No per-row API fetch is required.

## Explicit remaining scope

Outpatient fluid observations without an admission, patient-specific targets,
weight/renal-adjusted prescriptions, retrospective clinical approval policy,
automated clinician notification, and alert acknowledgement for derived
conditions require separate clinical contracts. This slice does not infer
those policies from legacy defaults. The Django global singleton settings and
in-place clinical overwrites are not ported.

## Verification

Focused regressions exercise paired history/void reachability, exact UUID replay,
concurrent corrections, rollback on audit failure, UTC day moves, populated
legacy backfill/import compatibility, complete scoped totals, rule versions and
no-data boundaries, patient/feature authorization, pre-page board filtering,
real generated-client payloads, uncertain writes, dismissal/capability changes,
and actual Chronicle/settings interactions. Release acceptance and browser
verification are tracked by the parent phase ledger.
