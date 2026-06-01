# frontend/src/components/laboratory

Status: active
Owner: Frontend Laboratory Engineering
Last reviewed: 2026-06-01
Scope: lab order, specimen, result entry/viewer, catalog, and technician dashboard UI.

## Invariants

- Lab results are clinical data and should remain in authorized patient/lab
  workflow context.
- Do not log result values, accession identifiers, patient names, or MRNs.
- Lab worklists should be backend-filtered and bounded.
