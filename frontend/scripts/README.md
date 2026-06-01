# frontend/scripts

Status: active tooling
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: frontend build, API generation, performance, and quality helper scripts.

## Scripts

| Script | Role |
| --- | --- |
| `generate-v2-api-client.mjs` | generates/checks Rust V2 client helpers from `backend-rs/openapi/hms-v2.openapi.json`. |
| `check-bundle-budget.mjs` | enforces frontend bundle budget and initial chunk guardrails. |
| `measure-runtime-perf.mjs` | Playwright-based runtime performance probe for route shell/first useful view checks. |
| `react-doctor-summary.mjs` | summarizes React Doctor output. |
| `react-quality-gate.mjs` | React quality gate and diff mode. |

## Invariants

- Runtime perf output must be PHI-safe.
- API generation should be checked after Rust OpenAPI changes.
- Bundle budget should protect low-end-device experience by keeping heavy chunks
  off initial routes.
