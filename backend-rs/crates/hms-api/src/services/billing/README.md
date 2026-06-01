# Billing API Services

Status: active
Owner: Backend/Billing Engineering
Last reviewed: 2026-06-01
Scope: service catalog, invoices, payments, receipts, cash sessions, and NHIS workflows.

## Purpose

`services/billing/` coordinates billing workflows behind `routes/billing.rs`
and `handlers/billing.rs`. It translates HTTP requests into bounded repository
operations and billing response DTOs without exposing database details to
handlers.

## Module Map

| Module | Owns |
| --- | --- |
| `mod.rs` | public billing service exports. |
| `common.rs` | shared billing helpers, scope handling, and DTO assembly. |
| `catalog.rs` | service catalog and price lookup workflow. |
| `overview.rs` | billing dashboard/summary projections. |
| `financial_workflow.rs` | invoices, charges, payments, receipts, and patient account workflow. |
| `cash_control.rs` | cashier sessions, closeout, reconciliation, and cash movement views. |
| `nhis.rs` | NHIS claim-facing workflow and insurance-specific billing paths. |

## Invariants

- Billing services must return least-privilege DTOs; list views should not
  expose full patient or clinical objects.
- Patient-linked billing paths require patient access and facility scope before
  returning balances, invoices, payments, or claim context.
- Cash-control state transitions must be auditable and deterministic.
- Monetary calculations should happen in one service/repository path so callers
  do not recompute totals independently.
- Payment integrations or external claim submission must not run inside open DB
  transactions.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test billing_contract
cargo test -p hms-db billing -- --nocapture
```
