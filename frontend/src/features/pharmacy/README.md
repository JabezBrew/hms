# pharmacy feature

Status: active
Owner: Frontend/Pharmacy Workflow
Last reviewed: 2026-06-01
Scope: pharmacy dispensing UI.

## Routes

- `/pharmacy/dispensing`

## Backend Contracts

- `/api/v2/pharmacy/dispenses`
- inventory/pharmacy APIs under `/api/v2/inventory/*` and `/api/v2/pharmacy/*`

## Invariants

- Dispense state and stock movement are backend-authoritative.
- Pharmacy context should expose only order-relevant clinical data.
- Controlled-substance workflows use inventory controlled-substance contracts.
- Chronicle prescribing can explicitly link an active facility medication using
  `/api/v2/clinical/medication-catalog`. The bounded catalog exposes only identity,
  code, name, unit, controlled flag, and cursor timestamp under prescribing
  permission. It does not expose procurement data or grant inventory access.
- Stock links require an explicit product choice. Editing medication text clears
  the old binding; never infer inventory identity from a name or RxNorm code.
