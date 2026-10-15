# tests/load/scripts

Status: active
Owner: Performance Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 load-test reporting and regression scripts.

## File Map

| File | Owns |
| --- | --- |
| `run-rust-v2-regression.sh` | maintained Rust V2 regression load-test wrapper. |
| `report-rust-v2-performance.mjs` | performance result summarizer. |
| `report-rust-v2-performance.test.mjs` | report script tests. |
| `k6-rust-v2-session.test.mjs` | shared-account session reuse, refresh, and VU isolation regression tests. |

## Invariants

- Keep reports PHI-safe and aggregate.
- Do not commit raw URLs with patient identifiers.
- Measure before optimizing.

Network-free harness checks:

```bash
node --test tests/load/scripts/*.test.mjs
```
