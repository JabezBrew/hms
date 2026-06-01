# Laboratory API Services

Status: active
Owner: Backend/Laboratory Engineering
Last reviewed: 2026-06-01
Scope: lab catalog, orders, specimens, and results workflows.

## Purpose

`services/laboratory/` coordinates laboratory workflows for
`handlers/laboratory.rs`. It keeps lab state transitions, result projection,
and patient/facility scope behavior out of handlers.

## Module Map

| Module | Owns |
| --- | --- |
| `mod.rs` | public laboratory service exports. |
| `common.rs` | shared lab DTO and scope helpers. |
| `catalog.rs` | lab tests, panels, catalog metadata, and availability. |
| `orders.rs` | lab order creation, cancellation, status, and worklist workflow. |
| `specimens.rs` | specimen collection, receipt, rejection, and tracking workflow. |
| `results.rs` | result entry, verification, viewing, and patient Chronicle projections. |

## Invariants

- Lab orders/results tied to patients require patient access and facility scope.
- List DTOs must stay lightweight; full result payloads belong behind detail
  views and access checks.
- Result verification must remain auditable and should not leak clinical text
  through logs or metric labels.
- External analyzer/FHIR-style integrations are unsafe I/O and must not block
  request paths or open transactions.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test laboratory_contract
cargo test -p hms-db laboratory -- --nocapture
```
