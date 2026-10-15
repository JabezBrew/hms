# frontend/e2e

Status: active
Owner: Frontend QA
Last reviewed: 2026-10-14
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
- Registration coverage follows identity lookup, explicit duplicate review when
  required, and the administrative patient profile. Emergency coverage follows
  waiting, staff assignment, assessment, and completion; it does not invent a
  post-assessment clinic assignment step.
- Positive clinical fixtures create a real owned encounter before opening the
  Chronicle. Directory row navigation follows the active user's clinical role;
  creating a demographic record alone must not grant clinical access.
- Nursing task actions use the current Ward Board patient drawer. Removed
  standalone nursing pages are not supported workflow entry points. Structured
  handoff authoring remains outside the active UI; its browser fixture checks
  the native API boundary explicitly.
- Native triage assignment and handoff checks require a dedicated active
  synthetic nurse with a same-facility `staff_profiles` row and nursing
  permissions, including `nursing.task.manage`. Prepare this local test fixture
  through the normal database test factory before the browser gate. Keep its
  credentials private or discard its random password. Demonstration staff are
  deliberately inactive; do not enable them to satisfy browser tests.
- Scheduling fixtures create actual future bookable sessions rather than
  depending on fixed dates in demonstration seed data. The static route catalog
  checks active routes and rejects accidental feature-unavailable redirects.
- Fixture helpers retain the real browser login access token only in test
  memory. They must not independently rotate refresh cookies while the app
  still holds its original in-memory token.
- Independent tests use fresh browser contexts and pace logins for the same
  synthetic identity by at least 6.2 seconds. This respects the server's
  ten-attempts-per-minute limit, including successful logins. Run the native
  browser gate with one worker so concurrent fixtures do not exhaust that limit.
- Staff coverage defaults to an unenrolled synthetic administrator: privileged
  creation must return `403 passkey_required` and leave no staff account behind.
  This proves the fail-closed provisioning boundary, not successful provisioning.
  Set `E2E_ADMIN_PASSKEY_ENROLLED=true` only for a prepared enrolled fixture. With
  that fixture, disabled delivery must return `staff_account_setup_delivery_unavailable`.
  Also set `E2E_STAFF_SETUP_DELIVERY_ENABLED=true` only with configured synthetic
  delivery to exercise generated Employee IDs and account setup.

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

Run the triage, discharge, and emergency-access workflows with a 390 × 844
Chromium touch viewport:

```bash
npm run e2e -- --config=playwright.mobile.config.js --workers=1
```

The mobile configuration inherits the target, credentials, browser executable,
and failure artifact settings from the normal local environment. The default
desktop test project is unchanged.

To use an installed Chromium instead of a Playwright browser download:

```bash
npx playwright install ffmpeg
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run e2e
```

The FFmpeg helper is still needed for failure videos. Both overrides can be
combined. Keep `E2E_ADMIN_EMAIL` and
`E2E_ADMIN_PASSWORD` in the private local test environment; only use synthetic
fixture data. Set `E2E_EXPECT_RUST_V2_ROUTE_GUARD=true` for the Rust V2 target to
include unsupported-route coverage.
