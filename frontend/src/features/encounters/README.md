# encounters feature

Status: active
Owner: Frontend/Encounter Workflow
Last reviewed: 2026-06-01
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
