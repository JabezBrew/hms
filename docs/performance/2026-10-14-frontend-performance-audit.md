# Frontend performance audit — 2026-10-14

Status: local implementation evidence; backend latency acceptance incomplete
Owner: Performance Engineering
Scope: initial dependency transfer, optional route prefetch, and preload-cache growth

## Measured bundle change

The maintained `npm run build` / `npm run perf:bundle-budget` harness was run
before and after changing Vite's React vendor chunk to let optional Radix
widgets split with their consuming routes. Both builds use the same installed
dependencies. Values are KiB, using gzip level 9. These measurements precede
the typography and dependency updates in the same implementation phase.

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Initial scripts/styles, including unique modulepreloads, gzip | 212.56 | 172.12 | -19.0% |
| Initial scripts/styles, including unique modulepreloads, raw | 789.82 | 654.42 | -17.1% |
| Entry scripts/styles only, gzip | 60.25 | 61.36 | +1.11 KiB |
| Entry scripts/styles only, raw | 308.95 | 312.00 | +3.05 KiB |
| Largest JS chunk, gzip | 115.36 | 115.36 | unchanged |
| Initial chart-engine chunks | 0 | 0 | unchanged |

The final frozen typography/dependency build measures 173.94 KiB initial
JS/CSS gzip and 661.67 KiB raw: 18.2% and 16.2% below the original baseline.
Entry scripts/styles measure 62.63 KiB gzip and 317.77 KiB raw. All entry,
explicit initial-dependency, largest-chunk, and lazy-chart guards pass.

The previous harness reported only entry scripts/styles as “startup transfer,”
omitting five initial modulepreloads. The corrected harness keeps the historical
90/350 KiB entry limits and reports/enforces the full initial JS/CSS set with an
explicit provisional 225/850 KiB ceiling. Actual initial JS/CSS remains above
the original 90/350 KiB target. Font binaries, images, HTML, runtime config, and
later idle prefetches are excluded from this specific bundle measurement.

One attempted shared Radix vendor chunk produced a circular chunk warning and
was discarded. The retained automatic widget splitting produced no circular
chunk warnings. Production Chromium smoke loaded the login form and synthetic
authenticated My Work shell at desktop and mobile sizes with zero JavaScript
page errors. This establishes rendering compatibility, not clinical latency.

## Prefetch and long-session changes

- Critical route preloads now share a promise per static route group. A test
  opening 2,000 synthetic patient routes observes one Chronicle preload promise,
  replacing one retained path/promise per patient. No patient paths remain in
  the preload cache.
- Optional route warmup previously launched ten imports together after one idle
  turn. It now runs at most one loader at a time and yields before each next
  chunk. Hidden tabs pause; Save-Data and slow-2G/2G connections skip optional
  downloads; cleanup prevents further scheduling after session unmount.
- The public-form authenticated-shell prefetch follows the same connection and
  visibility conditions. An interrupted optional asset request no longer
  produces an unhandled rejection. Required route loading remains on demand.
- Doctor/admin background critical-alert monitoring previously polled Rust
  dashboard payloads that never contain an urgent-alert aggregate. Those
  ineffective reads are now disabled; actual nurse alert/overdue-medication
  sources and legacy monitoring remain enabled. Permission-scoped Rust
  doctor/admin alert aggregation remains unimplemented, not an all-clear result.

Regression coverage verifies long-session deduplication, route-group separation,
idle yielding, connection restrictions, visibility changes, queue cancellation,
optional-loader failure recovery, full modulepreload accounting, duplicate asset
accounting, retained entry limits, lazy chart guards, and safe runtime-probe setup
errors. All 25 focused tests pass with the patched frontend toolchain.

## Local authenticated runtime observation

The maintained runtime probe subsequently completed against a migrated,
synthetic-seeded local Rust debug-profile API and production frontend assets, using Chromium
with 4× CPU throttling. Every warm transition used SPA history navigation; the
optional warmup queue completed in 1.30 seconds. The harness now targets the
canonical Chronicle route and explicitly opens the administrative all-ward
board, avoiding compatibility redirects and the assigned-ward resolver.

| Route | Document-load ready, ms | Warm SPA ready, ms |
| --- | ---: | ---: |
| Dashboard | 3309.47 | 435.12 |
| Patient registry | 5072.42 | 1225.93 |
| Patient Chronicle | 3146.83 | 775.60 |
| Ward board | 4290.96 | 1245.38 |
| Laboratory orders | 4730.31 | 335.40 |
| Inventory items | 5143.36 | 823.86 |

App-shell document-load readiness was 3713.91 ms, above the 2500 ms p99 ceiling.
These are one observation per route, not route p95/p99. The restricted shared
host was running concurrent Rust builds, unit tests, and browser tests; its
observed load averages were 10.30/16.98/12.34. The cgroup CPU quota subsequently
checked as 400000/100000, equivalent to four CPUs. The cause and acceptance of these timings
remain unresolved until repeated quiet-host measurements. A document load
reinitializes the application but may reuse browser-cached HTTP assets; it is
not a fresh-browser network-cache measurement.

The probe now records API response-status buckets and an explicit completeness
flag when Resource Timing exposes response status. Unknown statuses do not
prove an error-free run. The first completed timing capture predates this
status-bucket addition; it is not an accepted API-error report.

## Independent laboratory review

The laboratory batch-response change replaces per-result hydration with one
query. The write count is still proportional to the bounded request size; API
batches are capped at 50. The response-order `array_position` sort is bounded to
at most 2,500 comparisons. Existing primary keys and the result `order_id` index
support the new order-test/result existence checks. Cancellation and verification
lock the same parent orders; multi-order verification locks them in sorted ID
order. No external I/O is held inside those database transactions.

The backend agent also ran the exact completion UPDATE against a rolled-back
temporary-table model with schema-equivalent primary/order indexes: 1,000
synthetic orders, 50 tests per order, and 50,000 results. Planning took 2.833 ms;
execution took 1.772 ms. The plan used a one-row order primary-key lookup,
50-row order-test index-only scans, and 50-row result order-index scans. This
proves indexed query shape at that cardinality, not route or production p99
latency. Lock-wait and request latency still require the integration/load harness.

## Independent medication and patient-context review

Scheduled medication generation previously issued three child queries per dose
while holding its parent locks: a maximum 186-dose schedule implied 558 child
round trips. The reviewed implementation batches dose creation with bounded
`UNNEST` arrays and links the exact facility/course/time/sequence schedule in one
query. Existing conflict handling preserves administered, held, and dispensed
history. The backend query-count regression reports seven observed queries for
both one-dose and 186-dose initial generation, and six on retry, with 186 links
and retained history. Parent lock ordering remains admission, prescription,
course, then child fulfillment/MAR records. This is a round-trip reduction, not
a measured write-latency claim.

My Patients now derives current ownership/care-team relationships in the same
observed query as persisted contexts, before deduplication and cursor paging.
The added partial owner and active-care-team indexes match the caller predicates;
encounter, visit, and patient joins retain facility/lifecycle checks. A
rollback-only synthetic plan reported 1,000 callers, 10,000 rows per source,
and target-caller candidates of 200 persisted, 100 owned, and 50 care-team rows.
It produced 200 deduplicated patients and a 26-row page in 2.339 ms execution,
with 3.922 ms planning. The plan used the context index, owner index-only scan,
care-team bitmap scan, and scoped primary-key joins. Grouping and sorting still
scale with the caller's candidate/history set before the page limit; this is
neither O(page-size) execution nor production route-p99 evidence.

## Acceptance limits

Backend route p95/p99, database query-count/pool-wait visibility, response payload
budgets, and repeated authenticated clinical-route timings are not established
by these frontend measurements. The maintained Rust V2 load harness and quiet
repeated browser probe must be run after final backend restart and broad-suite
completion. Do not treat browser smoke, individual timings, or bundle ceilings
as a claim that clinical hot paths meet their p99 budgets.

Final local timing should use the optimized release-profile API with the same
source, lockfile, feature set, and runtime configuration. Debug-profile browser
checks validate workflows; release readiness/auth smoke and subsequent quiet
measurements provide separate optimized-runtime evidence.

DB pool-wait instrumentation is a confirmed pre-existing blocker:
`hms-observability` exposes `record_db_pool_wait` and emits route histograms only
when the request recorder contains wait observations, but neither `hms-db` nor
`hms-api` calls that function. Actual connection acquisition currently occurs
inside SQLx executors. A truthful latency measurement needs an explicit pool
acquisition adapter; absent observations cannot establish zero wait. The
maintained reporter now marks missing wait evidence incomplete for routes with
observed DB work, while preserving the legitimate zero-query warm-auth case.

Local load-harness preparation also fixed shared-account session duplication.
Each VU now shares one login across workflows with identical credentials, using
static role cache keys. Separate credentials and separate VUs remain isolated.
Six network-free regressions cover reuse, distinct credentials, refresh,
fallback, and isolation. This preserves the ten-login-per-minute backend limit
instead of weakening it for testing. The maintained smoke schedule remains
30 seconds ramp up, two minutes at five VUs, and 30 seconds ramp down.

The reporter includes available k6 p95 alongside p99 and treats absent route
query counters as incomplete evidence. Eighteen reporter regressions cover
budget behavior, missing evidence, grouped routes, and valid zero-query auth.
Private raw k6 summaries and logs remain
outside the repository because setup data can contain synthetic fixture IDs.
Only aggregate local-smoke results should be published, with the workload and
missing-instrumentation limits stated explicitly.
