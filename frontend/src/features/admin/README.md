# admin feature

Status: active
Owner: Frontend/Admin Workflow
Last reviewed: 2026-06-01
Scope: admin organization, staff, permission, feature, authority, and audit UI.

## Routes

- `/admin/audit-logs`
- `/admin/organization`
- `/admin/organization/unit-types`
- `/admin/organization/leadership-roles`
- `/admin/organization/duty-roster`
- `/admin/organization/roster-setup`
- `/admin/organization/roster-builder`

## Backend Contracts

- `/api/v2/admin/*`
- `/api/v2/staff/directory`

## Invariants

- Admin routes are admin-only unless the route explicitly allows nursing roster
  roles.
- Permission/authority UI must not invent frontend-only access rules.
- Audit log views must avoid PHI leakage in filters, URLs, and logs.
