# tests/load/baselines

Status: active
Owner: Performance Engineering
Last reviewed: 2026-06-01
Scope: checked-in load-test baseline summaries.

## Invariants

- Baselines must be sanitized and aggregate.
- Do not store raw response bodies, patient identifiers, MRNs, names, or raw
  URLs with IDs.
- Update baselines only with a clear performance reason and comparable test
  shape.
