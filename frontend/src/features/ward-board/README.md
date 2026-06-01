# ward-board feature

Status: active
Owner: Frontend/Ward Workflow
Last reviewed: 2026-06-01
Scope: ward clinical task board UI.

## Routes

- `/ward-board`
- `/wards/:wardId/board`

## Backend Contracts

- `/api/v2/wards/board`
- nursing task, alert, monitoring, MAR, treatment, and ward stock APIs

## Invariants

- Ward board reads must stay bounded and fast.
- Lane visibility must follow enabled features and permissions.
- Realtime/polling updates must preserve facility/ward/patient authorization.
