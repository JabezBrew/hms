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

## NHIS mapping creation

Rust V2 users with explicit `nhis.claim.manage` permission can add a dated NHIS
service mapping from `/billing/nhis/mappings`. The dialog searches and pages the
active billable-service catalog, sends only the supported create fields, and
shows the persisted mapping version. Mapping edits, inactive-status toggles and
file import remain guarded because those contracts are not implemented. A lost
save response requires reviewing the refreshed mapping list before another
attempt; no automatic create retry runs.

Payer-specific mappings are stored for review and are not automatically applied
to new claims. Claims currently snapshot generic mappings only, because invoice
and claim creation do not carry explicit payer provenance. The UI states this
boundary; it does not infer a payer from patient insurance records.

## NHIS selected-claim batches

Rust V2 users with `nhis.claim.manage` can explicitly select draft or ready
claims from the current cursor page and save a draft batch. Page/filter changes
clear selection; selection is bounded to 100 claims of one currency and is
revalidated by the backend against current status and existing batch membership.
The confirmation displays the persisted batch, not a submission or AR settlement.
Pending writes cannot be repeated or dismissed; an uncertain result requires
reviewing refreshed batches and claims. Unsupported lint, file remittance import,
and ZIP downloads remain hidden in Rust V2.
