# encounters feature

Status: active
Owner: Frontend/Encounter Workflow
Last reviewed: 2026-06-06
Scope: encounters list, create/edit/detail, and encounter workspace.

## Routes

- `/encounters`
- `/encounters/new`
- `/encounters/:id`
- `/encounters/:id/edit`
- `/encounters/:id/workspace`

## Backend Contracts

- `/api/v2/encounters`
- `/api/v2/encounters/:id/*`

## Invariants

- Encounter workspace must preserve patient/visit context.
- Clinical actions from encounters should write into Chronicle-compatible
  patient clinical records.
- Encounter lists must be server-paginated and cancellable.
- Encounter list tabs and type filters must be capability-scoped before
  sending list queries. Do not let `/encounters?tab=emergency`,
  `/encounters?tab=triage`, or `All Encounters` request emergency/triage rows
  unless `emergency_encounters` is enabled.
