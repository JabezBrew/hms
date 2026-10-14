# frontend/scripts

Status: active tooling
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: frontend build, API generation, performance, and quality helper scripts.

## Scripts

The React quality gate runs the version of React Doctor pinned in the lockfile,
uses the operating system temporary directory, and disables remote dependency
scanning, scoring, sharing and crash reporting. Its diff mode uses the supported
changed-source scope; dependency advisories are checked separately with
`npm audit`.

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

## Bundle Measurements

`check-bundle-budget.mjs` reports entry scripts/styles separately from all initial
scripts/styles, including unique `modulepreload` dependencies. The existing
`BUDGET_STARTUP_GZIP_KB=90` and `BUDGET_STARTUP_RAW_KB=350` limits historically
measured only entry files; they remain entry-file guards for compatibility.
They do not establish that the complete initial dependency set meets those
limits.

The explicit initial dependency guards are
`BUDGET_TOTAL_STARTUP_GZIP_KB=225` and `BUDGET_TOTAL_STARTUP_RAW_KB=850`.
These are provisional measured regression ceilings, not the original 90 KiB
initial-load target. Font binaries, images, HTML, runtime configuration, and
later idle prefetches are outside this scripts/styles measurement. Measure the
browser resource timeline when evaluating complete startup transfer and timing.

Regression tests: `npm run test:run -- tests/performance/bundle-budget.test.js`.

## Runtime Probe

Set `HMS_FRONTEND_PERF_PASSWORD` in a private shell before running
`npm run perf:runtime`. The probe never assumes an account password. Optional
`HMS_FRONTEND_PERF_BROWSER_EXECUTABLE` selects an already installed Chromium
binary when the Playwright-managed browser is unavailable.

The default report is `hms-frontend-runtime-perf.json` in the operating system's
temporary directory. `HMS_FRONTEND_PERF_OUT` overrides it. The probe creates
the report's parent directory when necessary. Route warmup waits up to
`HMS_FRONTEND_PERF_WARMUP_TIMEOUT_MS` (default 15000 ms) for the optional idle
queue to finish before measuring warm transitions.

The default administrative probe opens `/ward-board?scope=all`, since
`/ward-board` now resolves assigned-ward choices instead of opening a board
directly. Set `HMS_FRONTEND_PERF_WARD_BOARD_PATH` for a probe account's authorized
ward-specific board. Patient measurements use the canonical Chronicle route.
API resource timings include response-status buckets when available; an unknown
status marks error visibility incomplete. Probe failures use controlled stage
messages instead of raw Playwright errors, which may include private URLs or
form-fill arguments.
