# frontend/src/components/patients

Status: active
Owner: Frontend Patient Engineering
Last reviewed: 2026-06-01
Scope: patient registry/detail/form/selector/context components outside the main Chronicle internals.

## Invariants

- Registry/search lists should use lightweight DTOs and backend filters.
- Patient forms must avoid logging patient identity fields.
- Patient clinical data should not move into standalone pages outside
  Chronicle.
