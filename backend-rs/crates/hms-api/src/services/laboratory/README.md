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
| `administration.rs` | dedicated no-patient catalog reads, reviewed availability commands and own original results. |
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
- `laboratory.catalog.manage` permits only the separate metadata purpose. It
  supplies neither order/verify authority nor demographics/Chronicle access.
  Current ordinary reads do not impose onsite credential confirmation; commands
  and own original receipt recovery require fresh ordinary credentials.
- Existing clinical catalog reads retain their original purpose and DTOs through
  transaction-bound authority. Order creation retains actor, patient, care and
  complete test/panel source proof before publishing any order or link.
- Availability changes do not edit names, specimen/unit definitions, price,
  reference ranges, TAT, defaults or panel composition. Those public operations
  remain unsupported.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test laboratory_contract
cargo test -p hms-api --test laboratory_catalog_governance_contract
cargo test -p hms-db laboratory -- --nocapture
```
