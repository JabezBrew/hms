# docs/performance

Status: active
Owner: Performance Engineering
Last reviewed: 2026-06-01
Scope: HMS performance budgets, measurement records, and frontend/backend latency policies.

## File Map

| File | Owns |
| --- | --- |
| `performance-budget.md` | p99/p95 budgets and acceptance gates. |
| `rust-v2-performance-baseline.md` | Rust V2 baseline evidence and known results. |
| `2026-05-25-performance-coverage.md` | performance coverage report. |
| `2026-05-30-rust-v2-slow-sql-followup.md` | slow SQL follow-up evidence. |
| `ops-dashboard.md` | ops dashboard performance signal map. |
| `realtime-delta-optimistic-ui-policy.md` | realtime delta and optimistic UI policy. |

## Invariants

- Measure before optimizing.
- Keep evidence aggregate and PHI-safe.
- Separate app/backend latency from edge/proxy/public-path latency before
  blaming code.
- Hot clinical routes should protect p99 latency as a safety requirement.
