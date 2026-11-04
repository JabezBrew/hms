# scripts

Status: support tooling
Owner: Engineering
Last reviewed: 2026-06-01
Scope: top-level helper scripts.

## Scripts

| Script | Role |
| --- | --- |
| `../deploy` | root deploy front door; forwards to `ops/deploy.sh`. |
| `seed_prod_test_users.py` | historical/support helper for seeding test users. |
| `cargo-budget.py` | shared-target Cargo admission, cross-worktree lock, sampled storage budgets, and owned-session cleanup; see [`../ops/CARGO_BUDGET.md`](../ops/CARGO_BUDGET.md). |
| `cargo_capture.py` | versioned RAM-only capture client with a default 64 MiB fail-closed ceiling; validates outer guardian and nested worker closure before accepting complete output. |
| `tests/test_cargo_budget.py` | standard-library tests using fake Cargo and real lightweight process groups; no Rust/service workload. |
| `tests/test_cargo_capture.py` | fake-Cargo pipe/cancellation/parent-death integration; no raw output files, compiler, or database. |

## Invariants

- Do not run seed scripts against production PHI data unless explicitly approved
  and documented.
- Prefer Rust V2 migrator/provisioning paths for active backend seed work.
  Legacy Python seed helpers are not the default active path.
- Only the coordinator launches heavy Cargo/browser workloads. Use the existing
  explicitly selected shared target through `cargo-budget.py`; do not create
  worktree-local targets or clean shared output.

## Storage guard tests

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_cargo_budget.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -p 'test_cargo_capture.py' -v
```
