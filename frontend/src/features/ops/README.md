# ops feature

Status: active
Owner: Frontend/Ops Workflow
Last reviewed: 2026-06-01
Scope: operations dashboard UI.

## Routes

- `/system/ops`

## Backend Contracts

- `/api/v2/ops/*`
- `/api/v2/observability/rum`

## Invariants

- Ops data must use route templates and aggregate metrics, not raw URLs or PHI.
- Prometheus/ops availability should be clear to the operator.
- Public ops surfaces require deployment and access review.
