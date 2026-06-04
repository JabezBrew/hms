# dashboards feature

Status: active
Owner: Frontend/Dashboard Workflow
Last reviewed: 2026-06-04
Scope: app root, shared provider dashboards, snapshot views, notification widgets, and shell readiness.

## Routes

- `/`
- `/dashboards/inpatient`
- `/dashboards/reception`
- `/dashboards/admin`
- `/dashboard/doctor`
- `/dashboard/provider`

## Backend Contracts

- `/api/v2/dashboards/*`
- `/api/v2/notifications/*`
- `/api/v2/realtime/*`

## Invariants

- Nurses should land in workflow surfaces such as Ward Board, OPD waiting room,
  triage, or Patient Chronicle rather than a standalone nurse dashboard.
- Dashboard snapshots must not block on FHIR or external I/O.
- Dashboard route shells should become useful before heavy widget bodies finish.
- Query keys must include role/profile/facility visibility scope.
