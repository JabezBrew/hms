# Ops API Services

Status: active
Owner: Backend/Operations Engineering
Last reviewed: 2026-06-01
Scope: operational dashboard and Prometheus-facing API service helpers.

## Purpose

`services/ops/` supports the operational dashboard and private metrics surfaces.
It should expose operational state without leaking PHI or secrets.

## Module Map

| Module | Owns |
| --- | --- |
| `../ops.rs` | top-level ops service functions used by `handlers/ops.rs`. |
| `prometheus.rs` | Prometheus scrape/query helpers and metric projection behavior. |

## Invariants

- Ops responses should use aggregate operational metadata, not raw request
  bodies, clinical text, names, MRNs, accessions, or secrets.
- Metric labels must use route templates and stable service/status labels.
- Dashboard queries must be bounded and should not put external systems on hot
  request paths.
- GCP staging is the current runtime authority; single-VM Compose metrics
  behavior is rollback/reference unless explicitly testing that path.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-api --test ops_contract
cargo test -p hms-api --test telemetry
```
