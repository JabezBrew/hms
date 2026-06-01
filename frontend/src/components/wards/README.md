# frontend/src/components/wards

Status: active
Owner: Frontend Ward Engineering
Last reviewed: 2026-06-01
Scope: ward, bed, section, admission, layout, dashboard, and staff-management UI.

## Invariants

- Ward views must preserve facility and ward scope.
- Bed/admission transitions should avoid duplicate submissions.
- Ward clinical actions should route through Patient Chronicle or authorized
  ward workflows.
