# triage feature

Status: active
Owner: Frontend/Triage Workflow
Last reviewed: 2026-06-01
Scope: triage queue and triage assessment UI.

## Routes

- `/triage`

## Backend Contracts

- `/api/v2/triage`
- `/api/v2/triage/:id/*`

## Invariants

- Triage assignment and assessment state is backend-authoritative.
- Queue views must be facility-scoped and role-scoped.
- Triage patient data must not become a standalone clinical record outside
  Chronicle.
