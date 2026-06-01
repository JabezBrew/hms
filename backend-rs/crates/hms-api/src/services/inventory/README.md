# Inventory API Services

Status: active
Owner: Backend/Inventory Engineering
Last reviewed: 2026-06-01
Scope: inventory catalog, stock control, procurement, pharmacy, and controlled-substance workflows.

## Purpose

`services/inventory/` coordinates inventory and pharmacy-adjacent workflows for
`handlers/inventory.rs`. Persistence is in `hms-db::inventory`; handlers should
not coordinate multi-step stock or procurement behavior directly.

## Module Map

| Module | Owns |
| --- | --- |
| `mod.rs` | public inventory service exports. |
| `common.rs` | shared scope, DTO, and workflow helper code. |
| `catalog.rs` | inventory item catalog, categories, units, and location-facing metadata. |
| `stock_control.rs` | stock levels, movements, adjustments, transfers, and low-stock views. |
| `procurement.rs` | requisitions, purchase orders, goods receipt, suppliers, and approval paths. |
| `pharmacy.rs` | dispensing and pharmacy queue integration with inventory stock. |
| `controlled_substances.rs` | controlled-substance registers, movement audit, and restricted workflows. |

## Invariants

- Stock-changing operations must be auditable and facility/location scoped.
- Controlled-substance paths require least privilege and should expose only the
  fields needed for the caller's workflow.
- Hot lists must use bounded server-side pagination and explicit projections.
- Procurement and stock movement code must avoid read-modify-write table scans
  on hot paths.
- Patient-linked dispensing must enforce patient access before returning patient
  context.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test inventory_contract
cargo test -p hms-db inventory -- --nocapture
```
