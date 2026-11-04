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
| `category_governance.rs` | current category metadata, exact parent publication, unused lifecycle and immutable original command receipts. |
| `read_access.rs` | shared retained current inventory, demographics, facility/profile/session/network and final-time read proof. |
| `suppliers.rs` and `suppliers/` | current supplier metadata/address, bounded directory/history, unused lifecycle and original command receipts. |
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

## Governed categories

Category administration is separate from the active three-field item picker.
UUID, facility, code and creation identity are permanent. New commands use an
original actor request UUID and exact current version; unchanged commands retain
version and update time while appending their own receipt and audit. General
history returns versions and change flags; directory/history omit descriptions,
private reasons and actor attribution. Exact detail contains current description. Own receipts require the
same current fresh inventory authority as writes and replay original observations
without joining current parents.

The nullable direct parent changes grouping only. It implies no item reassignment,
recursive membership or inherited authority. New parents require active local
exact-version selection and a complete local acyclic chain of at most64 hops.
Global category identity try gates prevent cross-facility UUID uniqueness waits.
A facility graph try gate and bounded sorted ancestor locks serialize every
category writer; existing030 item category SHARE guards remain in force.
Any retained item or current child pointer blocks both lifecycle intents,
including inactive and malformed redundant-facility references. Historical JSON
observations alone are not current membership. There is no physical delete.

Migration031 preserves historical category text/lifecycle and unknown provenance.
It also repairs existing producer-backed item search text and category metadata
using the actual item's same-facility nullable category, preserving document IDs,
unrelated metadata and resource families. The repair is O(item documents), runs
under the deployment quiesce fence, and does not claim orphan-document repair.
Later local category renames reach general search only after the existing explicit
rebuild and cache turnover; category administration reads current state directly.
Ordinary item readers use the same-facility nullable category projection.

Canonical MED provisioning checks permanent ID before code and inserts missing
rows only. Configured metadata and retired status survive reruns. Conflicting
ID/code ownership requires typed operator review; missing default items retain
the existing active local category publication guard.

Focused verification: `cargo test -p hms-db --test inventory_category_governance
--test baseline_inventory_integrity --test schema_compatibility -- --test-threads=1`.

## Governed suppliers

The original eight-field supplier list retains its current filter, three-field
literal search and ascending cursor contract with a mandatory shared read proof.
New administration separates seven-field directory metadata, eleven-field scalar
history and fourteen-field exact detail. Contact/address values, private reasons,
snapshots and actors do not expand the new directory/history. Own original receipts
retain the richer observations under current management/fresh credential authority.

Supplier identity/code/creation are permanent. Exact CAS/UUID commands preserve
no-op row/search times and append immutable receipt/audit evidence. All retained
item pointers block both lifecycle intents, including inactive and malformed
foreign rows, without disclosing item identities or counts. New non-NULL pointers
retain an active local source; unchanged historical pointers and NULL remain exact.

Canonical supplier rows are ID-first missing-only defaults, preserving configured
contacts/address, retired state, provenance and timestamps. Canonical unbound item
defaults remain optional and never borrow a replacement or reactivate a supplier.
The supplier/binding transaction is not a whole-baseline atomicity claim.

Only the supplier's own search document is refreshed, with demographics required,
no address indexing, preserved document identity/unrelated JSON and typed ownership
collision refusal. The032 scoped repair excludes orphans and other families;
in-memory cache turnover remains separate. Purchase-order names stay free text.
See the [supplier repository contract](suppliers/README.md) for bounds and limits.
