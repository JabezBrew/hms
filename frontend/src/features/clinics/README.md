# clinics feature

Status: active
Owner: Frontend/Clinic Workflow
Last reviewed: 2026-06-01
Scope: clinic waiting-room route and clinic workflow UI.

## Routes

- `/clinics/:clinicId/waiting-room`

## Backend Contracts

- `/api/v2/clinics`
- `/api/v2/visits`

## Invariants

- Waiting-room state is backend-authoritative.
- Patient identifiers in queue views must stay within authorized role/facility
  scope.
- Use realtime only through authorized subscription contracts.
