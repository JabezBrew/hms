# inventory feature

Status: active
Owner: Frontend/Inventory Workflow
Last reviewed: 2026-10-15
Scope: inventory catalog, locations, stock, requisitions, procurement, transfers, controlled substances.

## Routes

- `/inventory`
- `/inventory/items`
- `/inventory/items/:id`
- `/inventory/locations`
- `/inventory/requisitions`
- `/inventory/requisitions/:id`
- `/inventory/purchase-orders`
- `/inventory/purchase-orders/:id`
- `/inventory/grns`
- `/inventory/grns/:id`
- `/inventory/internal-requisitions`
- `/inventory/standing-orders`
- `/inventory/transfers`
- `/inventory/controlled`
- `/inventory/controlled/:id`
- `/inventory/analytics`

## Backend Contracts

- `/api/v2/inventory/*`
- `/api/v2/pharmacy/controlled-substances/*`

## Invariants

- Stock counts, movements, requisition state, and controlled-substance balances
  are backend-authoritative.
- Controlled-substance actions require high-severity audit and reauth where the
  backend contract requires it.
- Do not derive stock truth from cached frontend state.

## Catalog corrections

Users with explicit `inventory.manage` permission can correct an existing active
item's code, name and unit from its detail page. The dialog posts the effective
date and reason to `/api/v2/inventory/catalog-edits`, shows the persisted version
returned by the server, and refreshes current item reads. It does not enable the
legacy whole-item editor.

The UI permits today or earlier dates in UTC. Future-dated versions currently
have no activation worker/current-read projection, and the API has no version
history list. Those remain separate parity work. An unconfirmed save disables a
repeat submission until the user closes and reviews the refreshed item.

## Standing stock requests

Rust standing orders now use line-backed templates, explicit due-occurrence
generation and immutable request review. Approval, full-request FEFO stock issue
and cancellation are separate server-confirmed actions. Historical requests
without item details remain read-only; automatic recurrence is not enabled.
See [standing/README.md](standing/README.md) for contracts and acceptance coverage.
