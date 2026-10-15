# MAR outcome parity

Scope: the first phase-three clinical lifecycle slice. PRN request/supply is a
separate follow-up; this change does not invent PRN dosing limits or ward stock.

## Source evidence

- Python `apps/nursing/models.py` and `serializers.py` distinguish administered,
  missed, refused and held, with a reason when a dose is not given.
- Before this slice Rust's `AdministerMedicationRequest` accepted only a witness.
  `hms-db/src/ward/mar.rs` always wrote `status = 'administered'`.
- Evaluating the actual frontend `normalizeV2MedicationAdministerPayload` with
  each of `administered`, `refused`, `missed` and `held` produced the identical
  `{witness_user_id: null}` request, discarding reason and notes. The old
  `MedicationAdministration.jsx` dialog offered these outcomes and toasted the
  chosen status. It has tests but no current production importer; the dangerous
  adapter behavior is reproduced, but that dialog's reachability is not claimed.
- Reachable Chronicle uses `TreatmentSheetSlideOver` → `TreatmentSheetContent`.
  That grid only records Given; it lacks nonadministration choices. Medication
  history hides Missed/Refused in Rust mode.
- Source-linked administration had no supply guard. The prior lifecycle test
  administered a generated dose before dispensing despite available stock.
- `prescription_held` already distinguishes reversible source holds. A nurse's
  explicit Held decision must not be resurrected by source resume.

## Intended behavior

The new explicit `/medication-administrations/{id}/outcome` POST accepts a typed
required outcome and rejects unknown fields. An old server returns unavailable
instead of silently ignoring a new decision field. It accepts a bounded reason
for nonadministration, and optional bounded notes. Omitted outcome remains
Administered on the old `/administer` endpoint for compatibility. Server actor
and recording time describe every
decision; administration actor/time describe actual administration only. Only
real existing administration evidence is backfilled; historical hold evidence
stays unknown.

Prescription, then dose locks serialize all writers. A terminal decision cannot
be overwritten. Exact same-actor replay returns the saved decision without
rewriting evidence or adding an audit event. Competing outcomes, stale/stopped
orders, future Missed decisions, foreign witnesses and unsupplied source-based
administration are refused. Manual unlinked policy is retained.

Unsupplied terminal doses leave the pharmacy request count; actual stock,
supplied counts, supply actors and supply timestamps remain unchanged. Audits
contain only the outcome and opaque identifiers. Reasons and notes stay in
authorized clinical records, never logs or audit metadata.

The active grid offers explicit outcome selection and renders saved decisions.
Its progress and duration labels describe the selected period; a filtered week
does not prove course completion. History exposes supported outcomes and their
real reason/recording evidence. Writes do not automatically retry; uncertain
responses trigger refresh and an explicit review state.

## Acceptance

Targeted repository and HTTP checks must cover competing outcomes, exact replay,
reason validation, future Missed, source fencing, supplied/unsupplied decisions,
foreign access/witnesses, audit rollback, preserved supply/history and independent
holds across source resume. Frontend checks must cross the generated bridge and
reachable grid, verify chosen statuses/reasons, uncertain writes and real cache
key invalidation. Local full suites and rendered workflow verification remain
release gates owned by the parent integration task.

## PRN follow-up contract

Rust generation already intentionally skips PRN doses. A safe next slice needs
an idempotent on-demand request derived from an active source prescription and
matching active admission, then the normal pharmacy-to-nursing lifecycle. The
one-fulfillment-per-course constraint requires append-only request reconciliation
without resetting prior supply. The explicit stock picker exists; unbound old
orders cannot be represented as dispensed. Python's arbitrary four potential PRN
doses per day is not a clinical order and must not be copied.
