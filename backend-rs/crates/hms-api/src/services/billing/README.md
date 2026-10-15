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

## NHIS Mapping And Batch Boundaries

- Mapping creation requires an active same-facility service and, when supplied,
  an active same-facility payer. A service-row lock serializes globally increasing
  version numbers across payer scopes. Existing effective versions are retained.
- Claims snapshot a generic mapping (`payer_id IS NULL`) effective on the
  invoice's UTC issue date. The
  current invoice/claim contract has no explicit payer provenance; payer-specific
  mappings must not be selected by guessing from patient insurance records.
  Later mapping versions do not rewrite an existing claim snapshot.
- Batches accept 1–100 distinct, unbatched draft/ready claims of one facility and
  currency. Ordered claim locks serialize overlapping selections; terminal or
  submitted statuses, mixed currencies, and overflowing totals reject atomically.
  Membership is inserted in one bounded statement. Audit metadata contains only
  workflow facts, with request correlation and no service code or patient text.
- These guards do not implement external claim submission, remittance allocation,
  or AR settlement. Those remain separate workflow contracts.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test billing_contract
cargo test -p hms-db billing -- --nocapture
```
