# billing feature

Status: active
Owner: Frontend/Billing Workflow
Last reviewed: 2026-06-01
Scope: billing dashboard, invoices, payments, catalog, cash sessions, insurance, NHIS.

## Routes

- `/billing`
- `/billing/invoices`
- `/billing/invoices/new`
- `/billing/invoices/:id`
- `/billing/payments`
- `/billing/catalog`
- `/billing/psp`
- `/billing/cash-sessions`
- `/billing/claims`
- `/billing/nhis`
- `/billing/nhis/mappings`
- `/billing/insurance`
- `/billing/discharges`

## Backend Contracts

- `/api/v2/billing/*`
- `/api/v2/nhis/*`

## Invariants

- Invoice finalization, voids, reversals, and refunds are backend-authoritative.
- High-risk financial actions require proper permission and reauth behavior.
- Do not duplicate ledger calculations in UI code.
