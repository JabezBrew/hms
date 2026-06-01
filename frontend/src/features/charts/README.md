# charts feature

Status: active
Owner: Frontend/Clinical Documentation
Last reviewed: 2026-06-01
Scope: chart templates, chart builder, and chart-entry UI support.

## Routes

- `/charts/templates`
- `/charts/builder`
- `/charts/builder/:id`

## Backend Contracts

- clinical chart/template APIs under `/api/v2/clinical/*`
- patient chart entries under `/api/v2/patients/:patient_id/clinical/chart-entries`

## Invariants

- Chart data attached to a patient belongs inside Patient Chronicle workflows.
- Template management can be standalone, but patient chart entries must preserve
  patient-access enforcement.
- Heavy chart rendering should be lazy/deferred.
