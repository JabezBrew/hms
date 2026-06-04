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
- Patient detail task reads must use Rust V2 patient/admission filters rather
  than fetching broad nursing task pages and filtering in the browser.
- Lane visibility must follow enabled features and permissions.
- Realtime/polling updates must preserve facility/ward/patient authorization.
