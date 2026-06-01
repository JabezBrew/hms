# discharge feature

Status: active support module
Owner: Frontend/Inpatient Workflow
Last reviewed: 2026-06-01
Scope: discharge workflow components, hooks, pages, and API support.

## Routes

No primary route is exported from this feature today. Discharge UI is reached
through ward, admissions, nursing, and workflow routes.

## Backend Contracts

- `/api/v2/discharges`
- `/api/v2/discharges/:id/*`

## Invariants

- Discharge blockers are backend-authoritative.
- Billing/pharmacy/nursing blockers must not be hidden by frontend state.
- Override and final completion actions require permission and reauth handling.
