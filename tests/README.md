# HMS Tests

Status: active
Owner: Engineering
Last reviewed: 2026-06-01
Scope: top-level test assets.

## Map

| Path | Role |
| --- | --- |
| `load/` | k6/Locust load testing, Rust V2 regression wrapper, performance reporter, baselines. |
| `../backend-rs/crates/*/tests` | Rust V2 crate/API/repository contract tests. |
| `../frontend/src/**/__tests__` | frontend unit/component/hook tests. |
| `../frontend/e2e` | Playwright end-to-end smoke and Rust V2 route tests. |
| `../ops/tests` | operations/deployment script tests. |
| `../backend/apps/*/tests` | legacy Django tests only. |

## Active Backend Tests

Run from `backend-rs/`:

```bash
cargo fmt --all --check
cargo test --workspace
```

## Active Frontend Tests

Run from `frontend/`:

```bash
npm run lint
npm run test:run
npm run build
```

## Performance Tests

Use `tests/load/scripts/run-rust-v2-regression.sh` for maintained Rust V2
performance regression evidence.

Load-test output must be PHI-safe. Do not commit raw k6 exports that include
fixture IDs or target internals.
