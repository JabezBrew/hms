# backend-rs/scripts

Status: active tooling
Owner: Performance/Backend Engineering
Last reviewed: 2026-06-01
Scope: backend-side helper scripts.

## Scripts

| Script | Purpose |
| --- | --- |
| `bench-omni-search.mjs` | local helper for measuring omni-search behavior against Rust V2. |

## Invariants

- Scripts must keep output PHI-safe.
- Prefer maintained performance harnesses under `tests/load/scripts/` for
  acceptance evidence.
- Do not create one-off scripts that bypass access-control or query-scope rules.
