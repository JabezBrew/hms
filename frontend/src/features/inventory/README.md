# inventory feature

Status: active
Owner: Frontend/Inventory Workflow
Last reviewed: 2026-06-01
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
