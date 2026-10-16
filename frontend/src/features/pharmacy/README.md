# pharmacy feature

Status: active
Owner: Frontend/Pharmacy Workflow
Last reviewed: 2026-10-16
Scope: pharmacy dispensing and Chronicle prescribing UI.

## Routes

- `/pharmacy/dispensing`

## Backend Contracts

- `/api/v2/pharmacy/dispenses`
- inventory/pharmacy APIs under `/api/v2/inventory/*` and `/api/v2/pharmacy/*`

## Invariants

- Dispense state and stock movement are backend-authoritative.
- Pharmacy context should expose only order-relevant clinical data.
- Controlled-substance workflows use inventory controlled-substance contracts.
- Chronicle prescribing can explicitly link an active facility medication using
  `/api/v2/clinical/medication-catalog`. The bounded catalog exposes only identity,
  code, name, unit, controlled flag, and cursor timestamp under prescribing
  permission. It does not expose procurement data or grant inventory access.
- Stock links require an explicit product choice. Editing medication text clears
  the old binding; never infer inventory identity from a name or RxNorm code.

## Dispensing location choice

Rust queue confirmation shows the actual linked stock name, code and current
unit, alongside the immutable PRN stock basis. Internal item/location identifiers
remain inside API payloads. Staff explicitly choose a named active location from
the bounded, searchable `/api/v2/pharmacy/dispensing-locations` projection under
pharmacy permission; inventory access is not required. A previously recorded
location is not automatically selected.

The confirmation resets when its medication or authorization scope changes.
Pending requests block dismissal and duplicate submission. Unknown issue outcomes
remain locked across reopening; confirmed server receipts remain visible through
queue refreshes. API, paging/error and real queue regressions accompany the picker.

## Prescribing documentation and new courses

The Chronicle medication menu exposes fresh prescription detail, governed
instruction/reason editing, and explicitly reviewed renewal/replacement courses.
See [prescribing/README.md](prescribing/README.md) for eligibility, source continuity,
PRN linked-dose limits and uncertain-save handling. These actions do not schedule
nursing doses or move stock automatically.
