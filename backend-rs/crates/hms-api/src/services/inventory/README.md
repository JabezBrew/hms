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
| `categories.rs` | governed current category administration, explicit parent commands and own original receipts. |
| `suppliers.rs` | governed supplier metadata/address, unused lifecycle, scalar history and own original command receipts. |
| `stock_control.rs` | stock levels, movements, adjustments, transfers, and low-stock views. |
| `standing_orders.rs` | explicit line-backed template configuration, due generation, request review and governed approval/cancel/issue actions. |
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
- `/inventory/standing-order-templates` is the governed contract. Historical
  `/inventory/standing-orders` metadata cannot generate empty stock requests.
  Distinct operations prevent an older backend from silently dropping item lines.
- Template and request writes require `inventory.manage`. Lists and detail reads
  use inventory read authorization and facility scope. List payloads omit lines;
  details contain at most 100 lines.
- Run requests carry the reviewed template version and scheduled occurrence.
  One catch-up request is generated for a due occurrence, then the next date
  advances beyond the UTC current day. Monthly anchors survive shorter months.
  There is no automatic generation worker in this slice.
- Request approval and cancellation preserve history; issue transfers only the
  persisted quantities between the saved locations. No submitted arbitrary item
  or stock quantity can override the request. Generic persistence errors return
  distinct `*_unconfirmed` codes so clients do not claim a definite failed save.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test inventory_contract
cargo test -p hms-db inventory -- --nocapture
```

## Category administration

`InventoryCategoryService` keeps bounded view-protected directory/detail/history
separate from manage-protected UUID commands and original actor receipts.
Directory rows are lean metadata; history returns only versions and change flags.
Description remains in exact detail and immutable original receipts.
Commands retain existing Inventory, demographics, facility/profile/session/network
and credential proof through final database time. Admin authority is not added.
Current reads cannot confirm an uncertain write. Requests are closed and nullable
description/parent choices are explicit. Parent retain/clear/set is a direct
metadata change with no recursive or inherited item semantics.

The actual generated OpenAPI owns the new `category-administration`, category
correction/lifecycle/history and `category-commands` operations. Existing
`GET /inventory/categories` stays the active local paged `{id,code,name}` picker.
Immutable item receipt category observations keep their original shape and values.

## Supplier administration

`InventorySupplierService` exposes bounded InventoryView-protected administration
and InventoryManage-protected UUID commands/original receipts. Ordinary onsite
readers do not acquire a management or fresh-credential requirement. The service
passes the exact current context/deadline into mandatory retained database proof;
commands and own receipts use the existing fresh credential policy.

The seven-field administration directory omits contact/address values and actor
attribution. Exact current detail carries contacts/address; general history
contains only versions and change flags. Original actor receipts retain the
reviewed nullable choices and original before/after observations. Current reads
cannot establish an uncertain command's outcome. New nullable contact/address
choices are explicit even when null; supplier UUID, facility, code and creation
identity are permanent. Lifecycle eligibility concerns actual retained item
supplier references, not free-text purchase-order names or commercial non-use.

The actual compiled OpenAPI and generated client expose eight operations for
directory/create, exact detail, correction, retire/reactivate, scalar history and
own command receipt. Existing `GET /inventory/suppliers` remains the separate
eight-field compatibility list. Supplier assignment, preferred/alternative
suppliers, typed purchase-order identity and analytics remain separate work.
[Checkpoint 26B verification](../../../../../../docs/v2/2026-11-04-checkpoint-26b-verification.md)
records the complete local suites, frozen producer/client and finite runtime
checks without a full-parity or deployment claim.
Finite public-SDK/native, guarded-browser, visual and exact fixture-cleanup
checks pass within that separately recorded local scope.
