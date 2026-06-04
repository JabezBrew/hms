# frontend/src/components/wards

Status: active
Owner: Frontend Ward Engineering
Last reviewed: 2026-06-01
Scope: ward, bed, section, admission, layout, dashboard, and staff-management UI.

## Invariants

- Ward views must preserve facility and ward scope.
- Summary cards must render ward/section aggregate counters from the backend;
  bounded bed lists are for bed visualization only.
- Summary-card status filters must only run against a complete loaded bed set;
  do not filter a whole-ward aggregate through a partial bed page.
- Bed grid tiles are an operational capacity surface: show bed identity, bed
  state, section/bay placement, and LOS when occupied, but do not show patient
  names, diagnoses, acuity, vitals, clinician names, MRNs, or clinical flags.
- Bed/admission transitions should avoid duplicate submissions.
- Ward clinical actions should route through Patient Chronicle or authorized
  ward workflows.
