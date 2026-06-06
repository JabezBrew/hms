# dashboards feature

Status: active
Owner: Frontend/Dashboard Workflow
Last reviewed: 2026-06-06
Scope: app root, My Work landing, shared provider dashboards, snapshot views, notification widgets, and shell readiness.

## Routes

- `/`
- `/my-work`
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

- Clinical users should land in My Work, then choose scoped workflow surfaces
  such as OPD waiting rooms, Ward Board, triage, or Patient Chronicle rather
  than defaulting into one broad patient list.
- Dashboard snapshots must not block on FHIR or external I/O.
- Dashboard route shells should become useful before heavy widget bodies finish.
- Query keys must include role/profile/facility visibility scope.
