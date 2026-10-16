# Inventory Repositories

Status: active
Owner: Database/Inventory Engineering
Last reviewed: 2026-06-01
Scope: inventory catalog, stock, procurement, pharmacy, and controlled-substance persistence.

## Purpose

`hms-db::inventory` owns SQLx repository behavior for stock and procurement
workflows. API services should call these interfaces rather than stitching
multiple lower-level SQL operations together in handlers.

## Module Map

| Module | Owns |
| --- | --- |
| `catalog.rs` | inventory item, category, unit, and location metadata queries. |
| `stock_control.rs` | stock levels, stock movement, adjustment, transfer, and alert queries. |
| `standing_orders.rs` | governed recurring templates, due occurrences, and immutable line-backed requisition snapshots. |
| `standing_fulfillment.rs` | audited request approval/cancellation and atomic FEFO stock transfers with paired movement evidence. |
| `procurement.rs` | requisitions, purchase orders, goods receipt, supplier, and approval persistence. |
| `pharmacy.rs` | dispensing and pharmacy queue persistence tied to stock movement. |
| `controlled_substances.rs` | controlled-substance registers, restricted movements, and audit-facing queries. |

## Query Rules

- Inventory queries must scope by facility and relevant location.
- Stock-changing writes must be auditable and should avoid read-modify-write
  table scans.
- Controlled-substance queries should project the minimum required fields.
- Low-stock, expiring-stock, procurement, and queue views must be bounded.
- Patient-linked dispensing must not return patient context unless the service
  has already enforced patient access.
- Governed template runs serialize on the template and are unique by scheduled
  occurrence. Item units must match the units explicitly reviewed by the caller.
- Governed request issue serializes on the request, validates saved lines and
  current stock references, and preserves lot number/expiry in the receiving
  location. Up to 500 source allocations are written in bounded bulk statements.
  Insufficient/expired stock or audit failure rolls back the whole issue.
- Fulfilled replay returns existing evidence without another stock movement.
  Metadata-only fulfillment and arbitrary supply-dispense cannot issue a governed
  request. A fulfilled historical manual supply request cannot be dispensed again.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-db inventory -- --nocapture
```
