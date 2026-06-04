# nursing feature

Status: active
Owner: Frontend/Nursing Workflow
Last reviewed: 2026-06-04
Scope: nursing API adapters, hooks, and Chronicle/Ward Board clinical components.

## Routes

No standalone nursing routes. Nursing work is launched from the workflow that
owns the patient context:

- OPD intake actions from clinic waiting rooms.
- Triage assessment from `/triage`.
- Ward tasks, vitals, fluids, treatment sheets, and medication history from
  `/ward-board` or `/wards/:wardId/board`.
- Patient-specific clinical data from `/patients/:id` Chronicle workspaces.

## Backend Contracts

- `/api/v2/nursing/*`
- `/api/v2/discharges/*`

## Invariants

- Patient clinical nursing data belongs in Chronicle context or authorized
  ward workflow surfaces.
- MAR, vitals, handoff, alerts, and treatment-sheet state are backend-authoritative.
- Realtime/task updates must use authorized facility/ward/patient subscriptions.
