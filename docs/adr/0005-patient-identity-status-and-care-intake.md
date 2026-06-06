# ADR 0005: Patient Identity Status And Care Intake Are Separate

Status: accepted
Owner: Patient Workflow/Backend
Last reviewed: 2026-06-06
Scope: patient administrative identity, duplicate prevention, and OPD/IPD/Emergency intake.

## Context

The old patient registry model treated `active`, `inactive`, `deceased`, and
care-flow terms as if they were one status axis. That made discharged patients
look like candidates for patient-record deactivation and made the global
registry an unsafe default work queue as the registered patient population
grows.

## Decision

Patient identity status is split into:

- `record_status`: `registered`, `restricted`, `entered_in_error`, `superseded`
- `vital_status`: `presumed_alive`, `deceased`, `unknown`

Legacy compatibility maps as follows:

- legacy `active` -> `registered` + `presumed_alive`
- legacy `deceased` -> `registered` + `deceased`
- legacy `inactive` -> `restricted` + `presumed_alive` with
  `legacy_inactive_unreviewed`

Care activity is separate. Discharge, checkout, encounter completion, triage
completion, and admission cancellation must never deactivate a patient record.

Registration and care-area entry use Find or Register Patient first. If backend
identity lookup finds possible duplicate records, creation requires a fresh
lookup id, an explicit `new_distinct_patient` decision, and an auditable reason.
OPD, IPD, and Emergency intake then create or reuse scoped care contexts for a
resolved `patient_id`. Care intake requests require idempotency keys; only key
hashes and request fingerprints are persisted.

Superseded records must link to a same-facility registered canonical record.
Normal intake cannot use superseded, deceased, or entered-in-error records.
Restricted-record intake requires an authorized override and audited reason.

## Consequences

- Patient Directory is a bounded identity directory, not a clinical work queue.
- Care-area lists own workflow-specific patient access: Outpatient, Inpatient,
  and Emergency have separate entry points and server-side filters.
- Deceased, restricted, entered-in-error, and superseded records fail closed for
  normal intake unless an explicit future correction/override path allows it.
- IPD intake reuses an existing current admission instead of creating a second
  current admission. Emergency current context is waiting or assigned triage;
  completed triage is not current.
- Legacy `patients.status` remains only as temporary compatibility output until
  all callers use `record_status` and `vital_status`.
- Query keys, URLs, logs, metrics, and audit metadata must not contain raw names,
  DOBs, MRNs, phones, or free-text identity search input.

## Rollout Note

For a production facility with a large `patients` table, deploy the schema
change as expand/backfill/contract work: add nullable columns first, backfill in
batches, validate constraints after backfill, and build hot-table indexes using
non-blocking migration tooling where supported. Do not run a table-wide
backfill/index build in the same deploy transaction on a busy live facility.
