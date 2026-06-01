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

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-db inventory -- --nocapture
```
