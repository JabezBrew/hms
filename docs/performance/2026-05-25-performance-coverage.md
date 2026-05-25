# HMS Performance Coverage Pass - 2026-05-25

Status: current-tree coverage and regression-hardening pass after the auth/session
latency fix in commit `9a21db613`.

Scope:

- Active backend: `backend-rs/`.
- Legacy Django backend under `backend/` was not used except as out-of-scope
  reference.
- No PHI, patient identifiers, MRNs, raw URLs, search terms, request bodies, or
  fixture IDs are included in this report.
- No access-control, `RequestContext`, facility scoping, patient access,
  permissions, reauth, or PHI protections were weakened for speed.

## Evidence Sources

Maintained performance harness:

- `tests/load/k6-rust-v2-realistic.js`
- `tests/load/scripts/report-rust-v2-performance.mjs`
- `tests/load/baselines/rust-v2-vps-edge-https-stress-after-auth-invalidation-cache.json`

Accepted staging stress baseline, captured 2026-05-20T02:41:52Z:

- Target: staging public HTTPS from the VPS Docker edge network.
- Profile: `stress`.
- Data scale: current staging seed.
- Checks: 100,077 passed, 0 failed.
- HTTP failures: 0.
- HMS application errors: 0.

Current local after-run, using `/private/tmp/hms-perf-after-local`:

- Checks: 348 passed, 0 failed.
- HTTP failures: 0.
- HMS application errors: 0.
- Route DB-query budgets: passed.
- Pool snapshot: main pool 33.33% used with 2 idle connections; auth pool 0%
  used with 2 idle connections.
- Payload budgets after this pass: passed.
- DB pool-wait budgets after this pass: passed.
- Slow SQL budgets after this pass: passed.

Frontend bundle budget from `frontend/dist`:

- Startup transfer gzip: 41.74 KB / 90 KB.
- Startup transfer raw: 249.37 KB / 350 KB.
- Entry JS gzip: 10.6 KB / 40 KB.
- Entry CSS gzip: 31.15 KB / 45 KB.
- Largest JS chunk gzip: 112.55 KB / 120 KB, `vendor-core-CD4Y7yJX.js`.

## Surface Matrix

| Surface | Current local p50/p95/p99 | Accepted stress p99 | DB queries/request | Payload, pool wait, slow SQL | Frontend/static evidence | Status |
| --- | ---: | ---: | ---: | --- | --- | --- |
| Auth/session hydration, `GET /api/v2/auth/me` | 1.77ms / 2.80ms / 29.49ms | 44.97ms | 0.00, budget 0 | p99 payload 3.97 KiB, pool wait 0ms, slow SQL 0 | App shell lazy-loads authenticated runtime; auth API threads `signal` | Pass after auth cache fix |
| Patient list/search page, `GET /api/v2/patients` | 4.52ms / 14.21ms / 16.59ms | 87.51ms | 1.39, budget 2 | p99 payload 1,014 B, pool wait 0ms, slow SQL 0 | No production `apiClient.getAll()` calls; patient list uses server params and cursor adapter | Pass for current seed |
| Patient Chronicle initial API, `GET /api/v2/patients/:id/chronicle` | 11.38ms / 20.48ms / 20.62ms | 62.08ms | 2.00, budget 3 | p99 payload 3.97 KiB, pool wait 0ms, slow SQL 0 | Chronicle queries pass TanStack `signal`; timeline is cursor-paged | Pass for current seed; large Chronicle seed still unproven |
| OmniSearch, `POST /api/v2/search/omni` | 7.17ms / 32.97ms / 56.66ms | 91.11ms | 1.00, budget 2 | p99 payload 3.97 KiB, pool wait 0ms, slow SQL 0 | Search is debounced in shared search hooks; no client-side full-dataset filtering found | Pass for current seed; large search corpus still unproven |
| Ward/admission/nursing board, `GET /api/v2/wards/board` | 5.45ms / 13.02ms / 24.11ms | 44.87ms | 1.00, budget 2 | p99 payload 1,014 B, pool wait 0ms, slow SQL 0 | Ward board, admissions, and nursing queries thread `signal`; ward bed layout uses virtualization | Pass for current seed |
| Dashboard snapshot, `GET /api/v2/dashboards/snapshot` | 11.30ms / 50.59ms / 72.21ms | Missing in preserved stress artifact | 2.86, budget 3 | p99 payload 3.97 KiB, pool wait 0ms, slow SQL 0 | Dashboard queries thread `signal`; chart code is lazy-loadable | Local pass; regenerate accepted stress baseline with dashboard trend |
| Laboratory read group | 1.94ms / 7.79ms / 8.33ms | 52.63ms | 0.22, budget 2 | p99 payload 1,014 B, pool wait 0ms, slow SQL 0 | Lab APIs use paginated helpers with `options`; lab pages use backend params | Pass for current seed |
| Inventory/pharmacy read group | 2.60ms / 7.45ms / 12.24ms | 70.10ms | 0.43, budget 2 | p99 payload 1,014 B, pool wait 0ms, slow SQL 0 | Inventory list pages use `VirtualizedTable`; signal gaps in legacy fallback list helpers were closed | Pass for current seed |
| Billing/NHIS read group | 1.94ms / 6.86ms / 7.02ms | 55.18ms | 0.19, budget 2 | p99 payload 1,014 B, pool wait 0ms, slow SQL 0 | Billing helpers now pass cancellation signals through paginated fallback paths | Pass for current seed |
| Frontend startup/chunks | Bundle budget passed | n/a | n/a | n/a | App/authenticated/ops/public runtimes lazy-loaded; heavy chart widgets have lazy wrappers | Pass, but largest vendor chunk is close to the 120 KB gzip ceiling |
| Frontend list cancellation and low-end rendering | Static audit pass for no production `getAll()`; paginated calls now preserve signals | n/a | n/a | n/a | Virtualized tables are used in high-density inventory, encounters, audit, and ward-bed views | Pass with residual need for low-end browser profiling |
| Observability/regression protection | Reporter now enforces p99 latency, DB-query budgets, route payloads, DB pool waits, slow SQL, pool snapshot, and named query guards | n/a | n/a | n/a | Metrics use route patterns, status buckets, and safe facility labels only | Improved in this pass |

## Fixes Made In This Pass

1. Extended the Rust V2 load reporter so Prometheus snapshots now enforce:
   route payload-size budgets, DB pool-wait budgets, and route slow-SQL budgets.
2. Added reporter tests proving failures are raised for oversized payloads,
   excessive DB pool wait, and slow SQL on hot routes.
3. Added payload, pool-wait, and slow-SQL budgets to the committed Rust V2
   baseline surface definitions.
4. Threaded cancellation signals through paginated frontend list fallbacks in
   encounters, nursing, audit logs, inventory/pharmacy, and billing/NHIS helpers.

## Residual Risks

- The accepted staging stress artifact proves the current staging seed only.
  Chronicle and OmniSearch still need a deliberately larger seeded profile
  before their current numbers can be treated as realistic data-scale proof.
- The preserved accepted stress artifact predates the `hms_dashboard_snapshot`
  k6 trend. Local evidence covers the trend; staging should be regenerated.
- The maintained harness has `HMS_LOAD_DATA_SCALE`, but that value is currently
  a label. It does not seed small, medium, or large datasets by itself.
- Frontend bundle size passes, but `vendor-core` is near the 120 KB gzip budget.
- Low-end browser runtime proof is still static plus bundle-budget evidence; the
  next pass should capture real route-level RUM or browser trace evidence for a
  large Chronicle timeline, busy inventory list, and dashboard navigation.

## Next Highest-ROI Targets

1. Add a PHI-safe Rust V2 performance seed/provisioning command for `small`,
   `medium`, and `large` data profiles, especially Chronicle timelines and
   search documents.
2. Regenerate the accepted staging stress baseline with the current reporter,
   role-specific load credentials, dashboard trend, payload budgets, pool-wait
   budgets, and slow-SQL budgets.
3. Add a low-end frontend profiling script or Playwright trace flow for
   Chronicle, dashboards, ward board, inventory, lab, and billing navigation.
4. Investigate reducing `vendor-core` before it crosses the gzip budget.
