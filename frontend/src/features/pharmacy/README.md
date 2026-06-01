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
