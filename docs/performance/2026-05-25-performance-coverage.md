# HMS Performance Coverage Pass - 2026-05-25

Status: current-tree coverage, regression-hardening, scaled synthetic seed, and
frontend runtime pass after the auth/session latency fix in commit `9a21db613`.

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

Scaled local follow-up, using `/private/tmp/hms-perf-medium-after-patient-search`:

- Dataset: synthetic medium seed, generated through `hms-migrator` with
  `HMS_PERF_SEED_SCALE=medium`.
- Synthetic rows: 2,500 performance patients, 8,000 clinical notes, 1,500 lab
  orders, 1,000 inventory items, 250 admissions, 750 nursing tasks, and 1,500
  invoices.
- Checks: 402 passed, 0 failed.
- HTTP failures: 0.
- HMS application errors: 0.
- Route DB-query budgets: passed.
- Payload budgets: passed.
- DB pool-wait budgets: passed.
- Slow SQL budgets: passed.
- Pool snapshot: main pool 25% used with 3 idle connections; auth pool 0% used
  with 2 idle connections.
- Guardrails: `auth.user_auth_versions_for_facility=0` and
  `dashboard.refresh_snapshot=0`.

Focused database plan evidence for patient search on the medium seed:

- Previous predicate: index scan on `patients_facility_created_idx`, filtered
  2,501 rows, execution time 5.882ms.
- Optimized predicate: bitmap scan on the existing
  `patients_search_trgm_idx`, execution time 0.438ms.
- Result: 13.4x faster plan for the selective search case, while preserving
  the same facility-scoped search surface.

Frontend bundle budget from `frontend/dist`:

- Startup transfer gzip: 41.74 KB / 90 KB.
- Startup transfer raw: 249.37 KB / 350 KB.
- Entry JS gzip: 10.6 KB / 40 KB.
- Entry CSS gzip: 31.15 KB / 45 KB.
- Largest JS chunk gzip: 112.55 KB / 120 KB, `vendor-core-CD4Y7yJX.js`.
- Initial modulepreloads: 6.
- Initial chart chunks: none. `vendor-echarts*` and `vendor-zrender*` chunks are now forbidden initial
  script/preload in `frontend/scripts/check-bundle-budget.mjs`.

Low-end browser probe from `/private/tmp/hms-frontend-runtime-perf.json`:

- Browser: Playwright Chromium, 1366x768, 4x CPU throttle, reduced motion.
- Login shell/dashboard: 1,709.1ms, 3 long tasks totaling 231ms, API p99
  335.6ms, no chart chunk.
- Patient Registry: 261.2ms, 0 long tasks, API p99 45.2ms, 20 script assets,
  no `PatientChroniclePage` chunk, no chart chunk.
- Patient Chronicle: 320.5ms, 0 long tasks, API p99 30.1ms, Chronicle route
  code loads only on `/patients/:id`.
- Ward Board: 210.6ms, 1 long task at 50ms, API p99 15.8ms.
- Lab Orders: 246.3ms, 0 long tasks, API p99 11.9ms.
- Inventory Items: 340.7ms, 1 long task at 55ms, API p99 14.1ms.

## Surface Matrix

| Surface | Medium local p99 | Accepted stress p99 | DB queries/request | Payload, pool wait, slow SQL | Frontend/runtime evidence | Status |
| --- | ---: | ---: | ---: | --- | --- | --- |
| Auth/session hydration, `GET /api/v2/auth/me` | 45.86ms | 44.97ms | 0.00, budget 0 | p99 payload 3.97 KiB, pool wait 0ms, slow SQL 0 | App shell lazy-loads authenticated runtime; auth API threads `signal` | Pass after auth cache fix |
| Patient list/search page, `GET /api/v2/patients` | 19.64ms | 87.51ms | 1.43, budget 2 | p99 payload 14.16 KiB, pool wait 0ms, slow SQL 0 | Registry route 261.2ms at 4x CPU, 0 long tasks, no Chronicle chunk before navigation | Pass on medium seed |
| Patient Chronicle initial API, `GET /api/v2/patients/:id/chronicle` | 10.49ms | 62.08ms | 2.00, budget 3 | p99 payload 15.91 KiB, pool wait 0ms, slow SQL 0 | Chronicle route 320.5ms at 4x CPU, 0 long tasks, route code loads on `/patients/:id` only | Pass on medium seed |
| OmniSearch, `POST /api/v2/search/omni` | 65.18ms | 91.11ms | 1.00, budget 2 | p99 payload 3.97 KiB, pool wait 0ms, slow SQL 0 | Search is debounced in shared search hooks; no client-side full-dataset filtering found | Pass on medium seed |
| Ward/admission/nursing board, `GET /api/v2/wards/board` | 12.65ms | 44.87ms | 1.00, budget 2 | p99 payload 15.92 KiB, pool wait 0ms, slow SQL 0 | Ward Board route 210.6ms at 4x CPU, one 50ms long task | Pass on medium seed; frontend residual |
| Dashboard snapshot, `GET /api/v2/dashboards/snapshot` | 204.03ms | Missing in preserved stress artifact | 2.89, budget 3 | p99 payload 3.97 KiB, pool wait 0ms, slow SQL 0 | Login/dashboard path had three long tasks totaling 231ms under 4x CPU | Pass, close to budget |
| Laboratory read group | 36.98ms | 52.63ms | 0.22, budget 2 | p99 payload 15.82 KiB, pool wait 0ms, slow SQL 0 | Lab Orders route 246.3ms at 4x CPU, 0 long tasks | Pass on medium seed |
| Inventory/pharmacy read group | 12.87ms | 70.10ms | 0.44, budget 2 | p99 payload 29.12 KiB, pool wait 0ms, slow SQL 0 | Inventory Items route 340.7ms at 4x CPU, one 55ms long task | Pass on medium seed; frontend residual |
| Billing/NHIS read group | 10.71ms | 55.18ms | 0.10, budget 2 | p99 payload 7.90 KiB, pool wait 0ms, slow SQL 0 | Billing helpers pass cancellation signals through paginated fallback paths | Pass on medium seed |
| Frontend startup/chunks | Bundle budget passed | n/a | n/a | n/a | charting chunks no longer appear in initial scripts or modulepreloads; initial chart chunks: none | Pass, but largest vendor chunk is close to the 120 KB gzip ceiling |
| Frontend list cancellation and low-end rendering | Browser probe passed key routes | n/a | n/a | n/a | Patient Registry no longer route-prefetches Chronicle on hover/focus; PHI data prefetch remains navigation-gated | Improved in this pass |
| Observability/regression protection | Reporter and browser probe cover hot paths | n/a | n/a | n/a | Metrics use route patterns, status buckets, and safe facility labels only; runtime probe sanitizes UUIDs and records no PHI | Improved in this pass |

## Fixes Made In This Pass

1. Extended the Rust V2 load reporter so Prometheus snapshots now enforce:
   route payload-size budgets, DB pool-wait budgets, and route slow-SQL budgets.
2. Added reporter tests proving failures are raised for oversized payloads,
   excessive DB pool wait, and slow SQL on hot routes.
3. Added payload, pool-wait, and slow-SQL budgets to the committed Rust V2
   baseline surface definitions.
4. Threaded cancellation signals through paginated frontend list fallbacks in
   encounters, nursing, audit logs, inventory/pharmacy, and billing/NHIS helpers.
5. Added `HMS_PERF_SEED_SCALE=small|medium|large` provisioning in
   `hms-migrator`, guarded against `HMS_ENV=production`, with deterministic
   synthetic non-PHI data and idempotence coverage.
6. Changed patient search to use the existing combined trigram expression index
   instead of filtering facility-created index scans with multiple `OR` clauses.
7. Split shared UI utility packages out of the charting chunks and made the bundle
   budget fail if `vendor-echarts*` or `vendor-zrender*` becomes an initial script or modulepreload.
8. Added `frontend/scripts/measure-runtime-perf.mjs`, a PHI-safe Playwright
   probe for login, Patient Registry, Patient Chronicle, Ward Board, Lab Orders,
   and Inventory Items.
9. Removed Patient Registry row hover/focus loading of the heavy Chronicle route.
   Route and PHI data prefetch now remain navigation-gated for patient rows.

## Residual Risks

- The accepted staging stress artifact proves the older staging seed only. The
  new medium seed evidence is local; staging should be reprovisioned and rerun
  with the current reporter before replacing the accepted baseline.
- The preserved accepted stress artifact predates the `hms_dashboard_snapshot`
  k6 trend. Local evidence covers the trend, but the accepted staging artifact
  still lacks it.
- The dashboard snapshot p99 passed at 204.03ms on medium seed but is close to
  the 250ms clinical-view budget and remains the next backend hot path.
- Frontend bundle size passes, but `vendor-core` is near the 120 KB gzip budget.
- Ward Board still produced one 50ms long task under 4x CPU throttling.
- Inventory Items still produced one 55ms long task under 4x CPU throttling.
- The large seed profile exists but was not run in this pass.

## Next Highest-ROI Targets

1. Regenerate the accepted staging stress baseline with the current reporter,
   role-specific load credentials, dashboard trend, payload budgets, pool-wait
   budgets, slow-SQL budgets, and `HMS_PERF_SEED_SCALE=medium`.
2. Move dashboard reads further toward precomputed projections or async refresh
   so p99 has more headroom under load.
3. Profile and split the Inventory Items route to remove the remaining low-end
   long task.
4. Investigate reducing `vendor-core` before it crosses the gzip budget.
5. Run `HMS_PERF_SEED_SCALE=large` locally or on staging once the environment
   has enough database headroom.
