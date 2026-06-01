# dashboards feature

Status: active
Owner: Frontend/Dashboard Workflow
Last reviewed: 2026-06-01
Scope: role dashboards, snapshot views, notification widgets, and shell readiness.

## Routes

- `/`
- `/dashboards/nurse`
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

- Dashboard snapshots must not block on FHIR or external I/O.
- Dashboard route shells should become useful before heavy widget bodies finish.
- Query keys must include role/profile/facility visibility scope.
