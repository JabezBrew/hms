# nursing feature

Status: active
Owner: Frontend/Nursing Workflow
Last reviewed: 2026-06-01
Scope: nursing dashboard, shift handoff, task board, ward stock requests, nursing discharges.

## Routes

- `/nursing/dashboard`
- `/nursing/shift-handoff`
- `/nursing/tasks`
- `/nursing/ward-stock-requests`
- `/nursing/discharges`

## Backend Contracts

- `/api/v2/nursing/*`
- `/api/v2/discharges/*`

## Invariants

- Patient clinical nursing data belongs in Chronicle context or authorized
  ward/nursing workflow surfaces.
- MAR, vitals, handoff, alerts, and treatment-sheet state are backend-authoritative.
- Realtime/task updates must use authorized facility/ward/patient subscriptions.
