# frontend/src/components/inventory

Status: active
Owner: Frontend Inventory Engineering
Last reviewed: 2026-06-01
Scope: inventory item, stock, location, requisition, procurement, expiry, and transfer UI.

## Invariants

- Stock-changing actions should be auditable and avoid duplicate submission.
- Controlled-substance UI must preserve least privilege and PHI-safe telemetry.
- Long inventory lists should use backend pagination and filters.
