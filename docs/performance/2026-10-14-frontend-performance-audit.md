# Clinical performance audit — 2026-10-14–15

Status: improvements verified locally; overall performance acceptance **not met**
Owner: Performance Engineering
Scope: initial transfer, route prefetch, authenticated browser readiness, and synthetic Rust V2 read smoke

The retained frontend reduces initial JavaScript/CSS transfer, bounds route
preload memory, and avoids ineffective background requests. The final local
read-only smoke passes HTTP checks, latency, and payload budgets, but its
maintained reporter remains **fail**: Auth/me observed 0.2 DB queries/request
against the unchanged zero-query budget. DB pool-wait evidence is unavailable,
and laboratory/billing query instrumentation is incomplete. Uncached Chronicle
readiness also remains above the first-useful-view ceiling in these observations.

The aggregate artifact is
[`2026-10-15-local-smoke-evidence.json`](2026-10-15-local-smoke-evidence.json).
It contains no credentials, fixture identifiers, raw URLs, bodies, or SQL text.
Raw runtime/k6 reports and Prometheus snapshots remain outside the repository.

## Provenance and limits

- Frontend source: `3538ed17cbc4356610d1a5656d6964b3c3671ffd`, local production
  Vite assets served through a same-origin local proxy.
- Backend tree: `050036ae5c707cfd9ef310862b3a00ae55b80ef0`; actual Rust 1.88
  release Docker image
  `846c75b952193c5fad78389b8574d311525e101be8a361a33b3cb10a9efce1f9`.
  Readiness, login, and authenticated identity smoke passed before measurement.
- Local synthetic fixture only, shared synthetic owner credentials, five VUs,
  small current dataset. These results do not establish production capacity,
  representative role permissions, larger patient histories, or write latency.
- CPU quota was four CPUs (`cpu.max=400000 100000`). Build, unit-test, Doctor,
  and other browser lanes stopped before the three sequential browser probes
  and subsequent k6 smoke. Existing idle API and two-second background worker
  services remained running against the shared local database.
- Functional evidence on this frontend source was 1,395 tests in 224 files,
  32 desktop workflows, and three touch workflows passing. ESLint had zero
  errors and 69 warnings. The separate React Doctor scan retained its baseline
  15 errors and 261 warnings; static analysis is not wholly clean.

## Measured bundle change

The isolated Vite experiment used the same installed dependencies before and
after allowing optional Radix widgets to split with their consuming routes.
Values are KiB, using gzip level 9, before later typography/dependency changes.

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Initial scripts/styles, including unique modulepreloads, gzip | 212.56 | 172.12 | -19.0% |
| Initial scripts/styles, including unique modulepreloads, raw | 789.82 | 654.42 | -17.1% |
| Entry scripts/styles only, gzip | 60.25 | 61.36 | +1.11 KiB |
| Entry scripts/styles only, raw | 308.95 | 312.00 | +3.05 KiB |
| Largest JS chunk, gzip | 115.36 | 115.36 | unchanged |
| Initial chart-engine chunks | 0 | 0 | unchanged |

The final local production build measures **174.21 KiB initial JS/CSS gzip and
662.38 KiB raw**, 18.0% and 16.1% below the original baseline. Entry
scripts/styles measure 62.75 KiB gzip and 317.99 KiB raw. Five initial
modulepreloads are included, and charts remain lazy. The measured browser
artifact was the same source with timestamp metadata accounting for 0.01 KiB
more gzip; raw totals are identical.

The previous harness called entry scripts/styles “startup transfer” while
omitting modulepreloads. The corrected harness retains the historical 90/350
KiB entry limits and enforces an explicit provisional 225/850 KiB ceiling for
the complete initial JS/CSS set. All current bundle guards pass, but actual
initial JS/CSS **does not meet the original 90/350 KiB startup target**. Fonts,
images, HTML, runtime configuration, and later idle prefetches are excluded
from this bundle calculation.

A shared Radix vendor chunk produced a circular chunk warning and was
discarded. Retained automatic splitting produced no circular chunk warnings.
Container and local builds have equivalent normalized JavaScript/import graphs
and font assets, but timestamp/Git build metadata changes their hashes; these
figures describe the local production build, not byte-identical Docker output.

## Prefetch, cache, and workflow changes

- Critical preloads share a promise per static route group. Opening 2,000
  synthetic patient routes retains one Chronicle preload promise rather than
  patient paths and one promise per path.
- Optional warmup performs one import per idle turn, pauses hidden tabs, skips
  Save-Data/slow-2G/2G connections, and stops after session unmount. Optional
  public-form shell preloads follow the same restrictions and recover from
  interrupted requests without unhandled rejections.
- Ineffective Rust doctor/admin urgent-alert dashboard polling is disabled.
  Actual nurse alert/overdue-medication sources and legacy monitoring remain.
  Permission-scoped Rust doctor/admin aggregate alerting remains unimplemented;
  missing evidence is never an all-clear result.
- Laboratory transitions now patch safe detail fields and await bounded order
  query-prefix refreshes, including specimen/result parent aliases. Real
  QueryClient regressions cover cached source lists, empty destinations, and
  mutation pending state until the refreshed partition arrives. Collection
  appears in Collected without a reload; retry remains zero.
- Login inbox session flags are consumed after commit rather than during
  render. StrictMode regressions verify one urgent notification and retained
  manual read/navigation behavior.

The original preload/bundle/runtime harness regressions passed 25 focused
tests. The subsequent laboratory cache and inbox suites passed 12 and 10
focused tests respectively, and are included in the final full frontend suite.

## Quiet authenticated browser observations

Three sequential maintained probes used Chromium, a 1366×768 viewport, and
4× CPU throttling. The canonical Chronicle and administrative all-ward routes
avoid redirects and assigned-ward resolution. The runtime-config route override
enables Playwright routing, which **disables HTTP cache**. Document-load cases
therefore measure uncached assets; SPA cases retain the running module/query
caches. This corrects the earlier suggestion that document cases might reuse
browser HTTP cache.

| Route | Document-load samples, ms | Document median, ms | Warm SPA samples, ms | Warm median, ms |
| --- | --- | ---: | --- | ---: |
| Dashboard | 699.77 / 701.43 / 695.74 | 699.77 | 214.86 / 242.20 / 162.61 | 214.86 |
| Patient registry | 1346.28 / 1415.35 / 1454.73 | 1415.35 | 480.32 / 549.65 / 359.97 | 480.32 |
| Patient Chronicle | 1420.00 / 1554.66 / 1590.62 | 1554.66 | 302.86 / 320.05 / 211.58 | 302.86 |
| Ward board | 1577.11 / 1468.87 / 1496.32 | 1496.32 | 315.65 / 362.59 / 280.64 | 315.65 |
| Laboratory orders | 779.37 / 937.82 / 869.97 | 869.97 | 301.77 / 225.24 / 166.07 | 225.24 |
| Inventory items | 1392.60 / 1921.45 / 1474.80 | 1474.80 | 352.67 / 390.34 / 298.06 | 352.67 |

App-shell samples were 767.83, 777.34, and 914.68 ms, median 777.34 ms. All
18 warm transitions used SPA history navigation, without document fallback;
optional warmup completed in 1,349–1,507 ms. Recorded windows contained 144
API resource entries including login, all with known 2xx status and zero
recorded API errors. These are resource entries, not an independent server
request census.

Three samples are **not browser p95/p99 evidence**. Readiness follows the
maintained route marker, with a 100 ms post-ready resource collection window;
it does not establish every widget or interaction is ready. Chronicle's
1.42–1.59 second document observations exceed the frozen 1.2-second p99
first-useful ceiling as a provisional comparison, while warm observations
remain below it. Browser percentile acceptance is unresolved.

Each uncached Chronicle window loaded 79 scripts and three styles, about
1,491.91 KiB total resource transfer including more than the bundle guard's
initial JS/CSS set, and no chart engine. Total long-task time was 239–266 ms;
the largest task was 76–84 ms. The slowest recorded Chronicle API resource per
probe was 106–172 ms. These timings identify substantial client work but do
not attribute it to individual modules without a CPU trace.

A bounded, same-method trial removed four eager deferred-body preloads and
avoided mounting the closed lazy workspace. It reduced scripts to 61–70 but
did not improve document Chronicle median (1,599.91 vs 1,554.66 ms), and shell
median worsened (1,581.80 vs 777.34 ms). The trial was reverted. Targets,
readiness, and cache-disabled methodology were preserved.

An earlier debug-profile capture ran concurrently with builds/tests at load
averages 10.30/16.98/12.34. Its shell took 3,713.91 ms and several routes
exceeded four seconds. That contended capture is not accepted latency or
API-error evidence and is superseded by the quiet observations above.

## Maintained read-only load smoke

The maintained `k6-rust-v2-realistic.js` smoke used 30 seconds ramp up, two
minutes at five VUs, and 30 seconds ramp down, all seven workflow labels,
read-only requests, and unchanged budgets. Shared credentials reuse one
session per VU across workflow role keys; distinct credentials remain isolated.
Six network-free regressions verify reuse, refresh, fallback, and isolation.
Six logins (setup plus five VUs) and no refreshes were observed. The account's
ten-login-per-minute limit was retained, with cooldown after browser work.

**391/391 checks passed, with zero HTTP or custom errors. The maintained
reporter result is fail**, both before and after correcting its missing-query
interpretation. No acceptance target was weakened.

| Surface | k6 p95 / p99, ms | Successful server requests | Observed DB queries / request | Query budget |
| --- | ---: | ---: | ---: | ---: |
| Auth/me | 3.15 / 3.79 | 25 | 5 / 25 = **0.200** | **0: fail** |
| Patient list | 9.19 / 10.87 | 29 | 22 / 29 = 0.759 | 2 |
| Patient Chronicle | 10.58 / 10.81 | 23 | 63 / 23 = 2.739 | 3 |
| Omni search | 20.60 / 22.56 | 14 | 10 / 14 = 0.714 | 2 |
| Ward board | 11.86 / 12.22 | 21 | 5 / 21 = 0.238 | 2 |
| Dashboard snapshot | 5.98 / 27.16 | 21 | 11 / 21 = 0.524 | 3 |
| Laboratory | 5.87 / 10.73 | 37 | **Unavailable**; raw observed counter 0 | 2 |
| Inventory/pharmacy | 9.34 / 19.61 | 22 | **Unavailable**; raw observed counter 4 | 2 |
| Billing | 8.77 / 18.97 | 26 | **Unavailable**; raw observed counter 0 | 2 |

All current absolute/drift API latency and payload guards passed. k6 timings
are client-side HTTP trends; payload p95/p99 are estimates from route
histograms, not exact response quantiles. The aggregate artifact preserves
their values/budgets. Sparse local samples and comparison to a remote
historical baseline do not establish production capacity or improvement.
The dashboard refresh guard observed zero refresh queries over 21 requests;
the auth-version lookup guard observed zero. End-of-run pool snapshots were
main size 10/idle 9 and auth size 2/idle 2; these do not establish peak pressure.

The five Auth/me queries were `auth.user_by_id_for_facility_session` cache
rehydrations after the existing 30-second auth-cache lifetime. They validate
active facility/user, unrevoked session, matching versions, and session
deadlines. The three-minute run mixes warm and expired-cache requests, so its
0.2 average does not establish the warm-only zero-query target. Required
security checks and expiry were preserved. Existing warm-zero, singleflight,
logout/revocation, and permission invalidation unit tests provide separate
functional evidence; they do not turn this aggregate failure into a pass.

## Missing measurement evidence

Laboratory order/catalog/specimen/result lists and billing summary/list methods
perform uncached raw SQLx reads without the query observer. Their zero emitted
query counters are **not zero actual queries**. The reporter marks their query
counts, slow SQL, and pool wait unavailable/incomplete while retaining clearly
labelled raw observed counters. Positive observed query counts on other routes
are instrumented counts, not independent proof that every underlying query is
observed. No recorded slow queries does not prove uninstrumented SQL was fast.
The inventory group is also incomplete because active zero-count subroutes
lack a verified zero-query fast path, despite four observed queries elsewhere
in the group. Corrected query statuses are five pass, one fail, and three
incomplete; slow-SQL statuses are six pass and three incomplete.

Pool wait is unavailable across all nine measured groups. The observability
crate exposes `record_db_pool_wait`, but no DB/API acquisition path calls it;
absent histogram samples cannot establish zero wait. SQLx's optional
`sqlx::pool::acquire` event measures total successful acquisition, including
queueing, connection checks, and new-connection setup. It omits failed/cancelled
acquisitions and is not an isolated queue-wait measurement. Reusing that
duration for the frozen pool-wait budget would require an explicit metric/
budget contract, coverage, and a new baseline; no such relabelling or synthetic
samples were introduced.

The maintained reporter preserves a verified zero-query Auth/me fast path but
marks unsupported zero-query DB evidence incomplete. Its 25 regressions run
without network access; combined with session tests, 31 harness tests pass.
The corrected report was regenerated from the same private k6 summary and
before/after snapshots, without another load run.

## Independent database review

Laboratory batch hydration now uses one response query rather than one per
result. Writes remain proportional to the capped 50-result request. The
bounded response-order sort and completion existence checks use existing
order/test/result indexes. Cancellation and verification lock common parent
orders, with sorted IDs for multi-order verification. A rollback-only
schema-equivalent synthetic plan (1,000 orders × 50 tests/results) reported
2.833 ms planning and 1.772 ms execution using scoped index lookups. This is
query-shape evidence, not route p99 or lock-wait acceptance.

Scheduled medication generation previously made three child round trips per
dose: a maximum 186-dose schedule implied 558 child queries. Bounded `UNNEST`
creation and exact schedule linking now use seven observed queries initially
and six on retry for both one and 186 doses. Tests preserve administered,
held, and dispensed history and 186 fulfillment links. Parent locks remain
admission → prescription → course → child rows. This establishes round-trip
reduction, not measured write latency.

My Patients derives current ownership/care-team and persisted contexts in one
observed scoped query before deduplication/cursor paging. Partial indexes match
caller predicates and joins preserve facility/lifecycle checks. A rollback-only
synthetic plan with 1,000 callers and 10,000 rows per source scanned 200
persisted, 100 owned, and 50 team candidates for the target caller, producing
200 deduplicated patients and a 26-row page in 2.339 ms execution/3.922 ms
planning. Grouping/sorting still scale with caller history before the limit;
this is not O(page-size) or production route-p99 evidence.

## Remaining acceptance work

The original startup-transfer target, uncached Chronicle first-useful timing,
mixed-cache Auth/me zero-query guard, complete query observation, and real
pool-wait measurements remain open. Production-like data sizes, separate
role credentials, sustained concurrent users, write contention, and peak pool
pressure also need dedicated measurements. Bundle, functional, and local
latency passes should not be presented as overall performance acceptance.
