# frontend/src/components/appointments

Status: active
Owner: Frontend Care/Scheduling Engineering
Last reviewed: 2026-06-01
Scope: appointment detail, forms, blocked time, availability, and calendar UI.

## Invariants

- Availability and appointment lists should use backend filters and pagination
  where available.
- Calendar widgets should be deferred when they are not needed for first useful
  route paint.
