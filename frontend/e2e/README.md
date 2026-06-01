# frontend/e2e

Status: active
Owner: Frontend QA
Last reviewed: 2026-06-01
Scope: Playwright end-to-end tests.

## Tests

| File | Role |
| --- | --- |
| `smoke.spec.js` | general frontend smoke coverage. |
| `rust-v2-routes.spec.js` | Rust V2 route smoke coverage. |

## Runtime Contract

- Playwright test root is `frontend/e2e/`.
- Default base URL is `http://127.0.0.1:4173`.
- Override the target with `PLAYWRIGHT_BASE_URL` when testing an already-running
  local or staging frontend.
- CI retries once and writes the HTML report to `frontend/playwright-report/`.
- Failure screenshots, traces, and videos are enabled by config and must remain
  PHI-safe.

## Invariants

- E2E tests must not store PHI in screenshots, traces, or logs.
- Prefer route-template and synthetic fixture references in reports.
- Test credentials belong in environment/config, not committed files.
- Smoke tests should prove the Rust V2 route shell and generated API bridge are
  wired, not scrape production clinical data.

## Run

```bash
cd frontend
npm run e2e
```

Against a running target:

```bash
cd frontend
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npm run e2e
```
