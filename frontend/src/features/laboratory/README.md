# laboratory feature

Status: active
Owner: Frontend/Laboratory Workflow
Last reviewed: 2026-06-01
Scope: laboratory catalog, orders, specimens, results, and verification UI.

## Routes

- `/laboratory/catalog`
- `/laboratory/dashboard`
- `/laboratory/orders`
- `/laboratory/results`

## Backend Contracts

- `/api/v2/laboratory/*`

## Invariants

- Lab orders and result verification are backend-authoritative.
- Clinical context returned to lab must be minimal and order-relevant.
- Critical/verified result handling must preserve audit and permission behavior.
- Native `is_critical` means Critical without a high/low direction. Missing
  interpretation is Not classified; show Normal only for an explicit result
  flag. Critical page counts and order badges must honor the native boolean.
