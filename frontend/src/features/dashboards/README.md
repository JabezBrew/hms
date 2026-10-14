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
- `/api/v2/care-areas/my-work`
- `/api/v2/notifications/*`
- `/api/v2/realtime/*`

## Invariants

- Clinical users should land in My Work, then choose scoped workflow surfaces
  such as OPD waiting rooms, Ward Board, triage, or Patient Chronicle rather
  than defaulting into one broad patient list.
- My Work previews are bounded, server-filtered summaries. They must not fetch a
  broad patient directory page and sort/filter it locally.
- My Work links to Patient Directory only for administrative/global lookup.
- Dashboard snapshots must not block on FHIR or external I/O.
- Dashboard route shells should become useful before heavy widget bodies finish.
- Query keys must include role/profile/facility visibility scope.
- The Rust admin summary displays only metrics returned by the permission-filtered
  snapshot. A missing initial projection is pending, not zero activity. Unsupported
  alert, intervention, workforce, and compliance summaries must say unavailable;
  the capacity panel continues to use its dedicated bounded endpoint. Snapshot
  metrics have no historical-window filter, so this mode does not offer one.

## Compatibility landing routes

In Rust V2, `/dashboard/doctor` and `/dashboard/provider` render the existing
My Work workspace and its real `/care-areas/my-work` response. These URLs retain
their route permissions and do not redirect through the root dashboard. Legacy
mode retains its existing dashboard implementations.

Rust inpatient and reception routes show bounded workflow previews. Labels and
counts describe the records shown, with explicit continuation links. Inpatient
attention comes from supplied board alert/result/task/MAR counts; no clinical
stability is inferred from discharge timing. Reception patient previews are
Patient Directory records, not registration metrics. Sections load independently
and unavailable or withheld data is not displayed as measured zero. Disabled
modules are not queried. Reception check-in passes the actual patient, clinic
and appointment context into the existing visit workflow.
