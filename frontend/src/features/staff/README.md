# staff feature

Status: active
Owner: Frontend/Admin Workflow
Last reviewed: 2026-06-01
Scope: staff directory, staff creation, and staff profile UI.

## Routes

- `/staff`
- `/staff/create`
- `/staff/:id`

## Backend Contracts

- `/api/v2/admin/staff`
- `/api/v2/admin/staff/:id/*`
- `/api/v2/admin/practitioners/*`

## Invariants

- Staff management is admin-scoped.
- Staff creation does not ask admins for Employee IDs or passwords; Rust V2
  generates facility-scoped Employee IDs and setup/reset tokens server-side.
- Account setup/reset links are out-of-band. The UI must not display, store, or
  ask admins to handle another staff member's password or setup token.
- Password reset/deactivation/reactivation actions are backend-authoritative.
- Practitioner profile state must match backend staff/practitioner contracts.
