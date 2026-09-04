# Rust V2 slow SQL follow-up - 2026-05-30

> Historical lab report. Hostnames, IPs, and commit SHAs are the values from
> that day's lab run — treat them as examples and substitute your own
> environment. No patient data is included.

## Current pause point

Paused after deploying commit `5b3d11bd6ada` in the GCP performance lab and
deciding to stop the slow-SQL campaign for the day. The latest attempted
origin regression is **not valid performance evidence**: the Rust API became
unreachable during the run, the reporter could not scrape metrics afterward,
and the app container was in a restart loop with `OOMKilled=true` / exit `137`.

The latest fully valid backend pass remains commit `6f4354cf3c0a`. That run
showed the bounded startup warmup for the known hot read query shapes clearing
the previously gated slow-SQL counters without changing PHI exposure, facility
scoping, request authorization, payload shape, or cache scope.

The current backend evidence is good enough to preserve as the next-day starting
point:

- Direct VPC origin regression: `PASS`.
- Public HTTPS regression: `PASS`.
- Checks: all passed.
- HTTP failures: 0%.
- HMS application errors: 0%.
- Pool wait p99: 0 ms on all reported hot surfaces.
- Slow SQL: 0 gated events on all reported hot surfaces.

The issue is not closed as a root-cause investigation. Treat the warmup as a
verified mitigation for rare cold-query-shape tails. The next pass should prove
whether those tails were only PostgreSQL/app-plan cold start effects or whether a
deeper query-plan/index issue can still be reproduced under a colder or larger
data shape.

## Latest invalid rerun

After the dashboard refresh enqueue change in `5b3d11bd6ada`, the direct VPC
origin regression was started against `http://10.10.0.2:8080`:

```bash
cd /opt/hms
set -a && . ./.hms-gcp-load.env && set +a
HMS_LOAD_BASE_URL=http://10.10.0.2:8080 \
HMS_LOAD_METRICS_URL=http://10.10.0.2:8080/api/v2/metrics \
HMS_LOAD_PROFILE=stress \
HMS_LOAD_STAGE_DURATION_SCALE=0.1 \
HMS_LOAD_THINK_TIME_SCALE=0.2 \
HMS_LOAD_TOKEN_REFRESH_SECONDS=60 \
HMS_LOAD_OUT_DIR=results/load/gcp-internal-direct-stress-5b3d11bd6ada-$(date -u +%Y%m%dT%H%M%SZ) \
tests/load/scripts/run-rust-v2-regression.sh
```

Evidence:

- Report: `results/load/gcp-internal-direct-stress-5b3d11bd6ada-20260530T092305Z/report.json`
- Status: `FAIL`, but not a useful latency/slow-SQL failure.
- Checks: 16,697 passed, 21,160 failed.
- `hms_errors`: 55.89%.
- Metrics scrape after the run failed because the API was not reachable.
- App container state afterward: `Restarting (137)`, restart count `10`,
  `OOMKilled=true`, health `unhealthy`.

Do not compare the p95/p99 values from this run against product targets. Many
samples are connection-refused artifacts and missing telemetry, not application
latency. The next attempt should first stabilize or restore the API container,
then rerun origin validation from a clean process.

## Later dashboard slow-SQL miss

Before the invalid rerun, commit `6c78bfe18de9` produced a narrow origin
regression failure after the frontend route-chunk preload change:

- Report: `results/load/gcp-internal-direct-stress-6c78bfe18de9-20260530T090808Z/report.json`
- Status: `FAIL`, only because the dashboard slow-SQL budget is zero.
- Checks: 50,861 passed, 0 failed.
- `http_req_failed`: 0%.
- `hms_errors`: 0%.
- Pool wait p99: 0 ms on all reported hot surfaces.
- Dashboard p99: 1.52 ms.
- Dashboard slow SQL: 1 event across 3,077 dashboard requests.

Safe ops fingerprint evidence pointed to
`dashboard.queue_projection_refresh`. The code path returned the cached stale
dashboard projection quickly, but still awaited the refresh-queue DB write in
the request path. Commit `5b3d11bd6ada` moved that queue write out of the
request path after the access/context checks and existing refresh gate, but the
subsequent origin validation was invalidated by the API OOM/restart loop above.

## Latest passing evidence runs

### Direct VPC origin

Command run from the GCP load VM:

```bash
cd /opt/hms
set -a && . ./.hms-gcp-load.env && set +a
HMS_LOAD_BASE_URL=http://10.10.0.2:8080 \
HMS_LOAD_METRICS_URL=http://10.10.0.2:8080/api/v2/metrics \
HMS_LOAD_PROFILE=stress \
HMS_LOAD_STAGE_DURATION_SCALE=0.1 \
HMS_LOAD_THINK_TIME_SCALE=0.2 \
HMS_LOAD_TOKEN_REFRESH_SECONDS=60 \
HMS_LOAD_OUT_DIR=results/load/gcp-internal-direct-stress-warmup-6f4354cf3c0a-$(date -u +%Y%m%dT%H%M%SZ) \
tests/load/scripts/run-rust-v2-regression.sh
```

Evidence:

- Report: `results/load/gcp-internal-direct-stress-warmup-6f4354cf3c0a-20260530T084433Z/report.json`
- Status: `PASS`.
- Checks: 50,489 passed, 0 failed.
- `http_req_failed`: 0%.
- `hms_errors`: 0%.
- Slow SQL: 0 on every reported hot surface.

| Surface | Origin p99 | DB queries/request | Payload p99 | Pool wait p99 | Slow SQL |
| --- | ---: | ---: | ---: | ---: | ---: |
| `auth/me` | 1.66 ms | 0 | 3.97 KiB | 0 ms | 0 |
| Patient list | 1.86 ms | 0.0090 | 1,014 B | 0 ms | 0 |
| Patient Chronicle | 7.97 ms | 0.0495 | 31.82 KiB | 0 ms | 0 |
| Omni search | 2.72 ms | 0.0138 | 7.90 KiB | 0 ms | 0 |
| Dashboard snapshot | 1.73 ms | 0.0060 | 3.97 KiB | 0 ms | 0 |
| Ward board | 1.74 ms | 0.0023 | 3.97 KiB | 0 ms | 0 |
| Laboratory routes | 5.24 ms | 0 | 31.36 KiB | 0 ms | 0 |
| Inventory/pharmacy routes | 2.44 ms | 0.0024 | 1,014 B | 0 ms | 0 |
| Billing routes | 3.21 ms | 0 | 7.93 KiB | 0 ms | 0 |

### Public HTTPS path

Command run from the GCP load VM:

```bash
cd /opt/hms
set -a && . ./.hms-gcp-load.env && set +a
HMS_LOAD_BASE_URL=https://<public-edge-host> \
HMS_LOAD_METRICS_URL=http://<app-vm-private-ip>:8080/api/v2/metrics \
HMS_LOAD_PROFILE=stress \
HMS_LOAD_STAGE_DURATION_SCALE=0.1 \
HMS_LOAD_THINK_TIME_SCALE=0.2 \
HMS_LOAD_TOKEN_REFRESH_SECONDS=60 \
HMS_LOAD_OUT_DIR=results/load/gcp-public-https-stress-warmup-6f4354cf3c0a-$(date -u +%Y%m%dT%H%M%SZ) \
tests/load/scripts/run-rust-v2-regression.sh
```

Evidence:

- Report: `results/load/gcp-public-https-stress-warmup-6f4354cf3c0a-20260530T084757Z/report.json`
- Status: `PASS`.
- Checks: 50,897 passed, 0 failed.
- `http_req_failed`: 0%.
- `hms_errors`: 0%.
- Slow SQL: 0 on every reported hot surface.

| Surface | Public HTTPS p99 | DB queries/request | Payload p99 | Pool wait p99 | Slow SQL |
| --- | ---: | ---: | ---: | ---: | ---: |
| `auth/me` | 2.82 ms | 0 | 3.97 KiB | 0 ms | 0 |
| Patient list | 2.86 ms | 0.0089 | 1,014 B | 0 ms | 0 |
| Patient Chronicle | 7.30 ms | 0.0505 | 31.82 KiB | 0 ms | 0 |
| Omni search | 4.69 ms | 0.0141 | 7.90 KiB | 0 ms | 0 |
| Dashboard snapshot | 3.58 ms | 0.0058 | 3.97 KiB | 0 ms | 0 |
| Ward board | 2.73 ms | 0.0019 | 3.97 KiB | 0 ms | 0 |
| Laboratory routes | 7.42 ms | 0 | 31.36 KiB | 0 ms | 0 |
| Inventory/pharmacy routes | 4.38 ms | 0.0024 | 1,014 B | 0 ms | 0 |
| Billing routes | 5.50 ms | 0 | 7.93 KiB | 0 ms | 0 |

## What the slow-SQL issue was

The remaining gated failures before `6f4354cf3c0a` were rare cold-tail events:

- Patient list: one slow event across 4,074 requests.
- Omni search: one slow event across 2,166 requests.
- Both surfaces had sub-4 ms p99 request latency in the same run.
- Pool wait was 0 ms, checks passed, HTTP failures were 0%, and app errors were
  0%.

The high-signal fingerprints were:

- `patient.registry.list_projection`
- `search.documents_with_status`

Sanitized `EXPLAIN (ANALYZE, BUFFERS)` checks on the same lab data shape showed
fast steady-state plans, so the evidence did not support a simple missing-index
diagnosis. A warm-process repeat also passed with zero slow SQL before the final
warmup commit, which made cold query-shape/startup behavior the strongest
working explanation.

## Previous failing pause point

Paused after deploying and validating commit `14b536b435c0` in the GCP
performance lab. The direct VPC origin regression run passed every maintained
gate except the zero-slow-SQL budget. Public HTTPS and frontend runtime probes
should be rerun after origin slow SQL is cleared.

The latest cache-scope reduction improved the slow-SQL tail from 2 patient-list
events plus 2 Omni-search events to 1 patient-list event plus 1 Omni-search
event. The remaining failure is therefore narrow and rare, but still blocks the
maintained reporter because the budget is intentionally zero.

## Previous failing evidence run

Command run from the GCP load VM:

```bash
cd /opt/hms
set -a && . ./.hms-gcp-load.env && set +a
HMS_LOAD_BASE_URL=http://10.10.0.2:8080 \
HMS_LOAD_METRICS_URL=http://10.10.0.2:8080/api/v2/metrics \
HMS_LOAD_PROFILE=stress \
HMS_LOAD_STAGE_DURATION_SCALE=0.1 \
HMS_LOAD_THINK_TIME_SCALE=0.2 \
HMS_LOAD_TOKEN_REFRESH_SECONDS=60 \
HMS_LOAD_OUT_DIR=results/load/gcp-internal-direct-stress-cache-scope-14b536b435c0-$(date -u +%Y%m%dT%H%M%SZ) \
tests/load/scripts/run-rust-v2-regression.sh
```

Reporter output:

- Summary: `results/load/gcp-internal-direct-stress-cache-scope-14b536b435c0-20260530T082020Z/summary.json`
- Report: `results/load/gcp-internal-direct-stress-cache-scope-14b536b435c0-20260530T082020Z/report.json`
- Status: `FAIL`, only because slow SQL budget is zero.
- Checks: 50,732 passed, 0 failed.
- `http_req_failed`: 0%.
- `hms_errors`: 0%.
- Pool wait p99: 0 ms on all reported hot surfaces.
- App memory during run: peaked around 580 MiB of 768 MiB, then settled near
  522 MiB. No OOM evidence in this run.

## Previous failing-run hot-route latency

| Surface | p99 | Target status |
| --- | ---: | --- |
| `auth/me` | 1.23 ms | pass |
| Patient list | 1.76 ms | pass |
| Patient Chronicle | 7.74 ms | pass |
| Omni search | 3.20 ms | pass |
| Dashboard snapshot | 1.78 ms | pass |
| Ward board | 1.67 ms | pass |
| Laboratory routes | 7.40 ms | pass |
| Inventory/pharmacy routes | 2.31 ms | pass |
| Billing routes | 4.08 ms | pass |

## Previous failing-run DB query rates

| Surface | Requests | DB queries | Queries/request | Status |
| --- | ---: | ---: | ---: | --- |
| `auth/me` | 3,084 | 0 | 0 | pass |
| Patient list | 4,074 | 37 | 0.0091 | pass |
| Patient Chronicle | 2,175 | 108 | 0.0497 | pass |
| Omni search | 2,166 | 30 | 0.0139 | pass |
| Ward board | 3,103 | 7 | 0.0023 | pass |
| Dashboard snapshot | 3,103 | 18 | 0.0058 | pass |
| Laboratory routes | 2,821 | 0 | 0 | pass |
| Inventory/pharmacy routes | 2,410 | 6 | 0.0025 | pass |
| Billing routes | 3,041 | 0 | 0 | pass |

## Payloads and pool wait

| Surface | Payload p99 | Pool wait p99 | Status |
| --- | ---: | ---: | --- |
| `auth/me` | 3.97 KiB | 0 ms | pass |
| Patient list | 1,014 B | 0 ms | pass |
| Patient Chronicle | 31.82 KiB | 0 ms | pass |
| Omni search | 7.90 KiB | 0 ms | pass |
| Ward board | 3.97 KiB | 0 ms | pass |
| Dashboard snapshot | 3.97 KiB | 0 ms | pass |
| Laboratory routes | 31.36 KiB | 0 ms | pass |
| Inventory/pharmacy routes | 1,014 B | 0 ms | pass |
| Billing routes | 7.93 KiB | 0 ms | pass |

## Previous failing slow SQL counters

Maintained reporter failures:

| Surface | Requests | Slow queries | Slow/request | Budget |
| --- | ---: | ---: | ---: | ---: |
| Patient list | 4,074 | 1 | 0.000245 | 0 |
| Omni search | 2,166 | 1 | 0.000462 | 0 |

Earlier sanitized route-level slow query counters, from the prior
`3335a82c7c5c` run:

```text
/api/v2/auth/login: 9
/api/v2/nursing/alerts: 5
/api/v2/nursing/tasks: 7
/api/v2/nursing/vitals: 14
/api/v2/patients: 2
/api/v2/patients/:patient_id/clinical/notes: 2
/api/v2/search/omni: 2
/api/v2/system/deployment-capabilities: 1
```

At that point, only `/api/v2/patients` and `/api/v2/search/omni` were
reporter-gated failures. Chronicle and inventory/pharmacy slow SQL had already
been cleared by the latest single-flight/scoped-cache work.

## Slow-query fingerprint evidence

The ops slow-query fingerprint endpoint was queried with an ops-capable admin
identity in the isolated GCP performance lab. The high-signal fingerprints were:

| Query label | Count | Avg | P95 | P99 |
| --- | ---: | ---: | ---: | ---: |
| `patient.registry.list_projection` | 37 | 40 ms | 500 ms | 1000 ms |
| `search.documents_with_status` | 31 | 33 ms | 500 ms | 500 ms |

`pg_stat_statements` was unavailable in the lab DB, so fingerprint evidence came
from application metrics rather than PostgreSQL extension counters.

Sanitized `EXPLAIN (ANALYZE, BUFFERS)` checks on the same GCP data shape did not
show bad steady-state plans:

| Query label | Planning | Execution | Buffers |
| --- | ---: | ---: | --- |
| `patient.registry.list_projection` | 4.755 ms | 0.223 ms | 9 hits |
| `search.documents_with_status` | 3.953 ms | 4.528 ms | 65 hits |

Interpretation at the failing pause point: this was not proven to be a
missing-index or high-cardinality data-plan issue. The remaining events looked
more like rare cold-query-shape or cold-cache tails that still occurred after
request caches were mostly warm. The later startup-warmup run supports that
interpretation, but does not replace a deeper root-cause pass with PostgreSQL
statement-level evidence.

## What changed before this run

- Bounded password hash/verify concurrency to stop artificial login-refresh load
  from OOM-killing the Rust API container.
- Removed per-session fragmentation from patient-list and Chronicle startup hot
  read cache keys while keeping user, facility, permission version, session
  version, active profile, features, patient visibility, and active-authority
  scope.
- Added offsite mode to Chronicle startup cache scope so offsite read-only
  requests cannot reuse an onsite write-capable cached response.
- Added single-flight hydration locks for hot read caches to prevent concurrent
  cold-miss stampedes.
- Added first-page pharmacy dispense caching with invalidation on dispense
  writes.
- Reduced patient-list and Omni-search cache fragmentation further so the same
  scoped workload reuses hot cache entries instead of creating unnecessary
  per-session or per-permission-version entries.
- Added bounded startup warmup for the exact patient-list and Omni-search query
  shapes that had produced rare cold-tail slow SQL. The warmup is best treated
  as a mitigation until a colder-run root-cause pass proves the underlying
  mechanism.
- Moved dashboard projection refresh enqueue out of the snapshot request path
  after access/context resolution and the existing refresh gate. This is intended
  to clear the rare `dashboard.queue_projection_refresh` slow-SQL counter, but it
  still needs a clean origin rerun because the next validation attempt OOM-killed
  the API process.

## Next investigation path

1. First stabilize the GCP app VM API container. The last run ended with
   `OOMKilled=true`, exit `137`, restart count `10`, and failed metrics scrape.
   Do not evaluate slow SQL or latency until the container is healthy for a clean
   run.
2. Verify `5b3d11bd6ada` with a direct VPC origin regression. This is the commit
   that should prove whether moving `dashboard.queue_projection_refresh` out of
   the request path clears the dashboard slow-SQL miss.
3. Keep `6f4354cf3c0a` as the last known good slow-SQL baseline and rerun a
   cold-start origin workload
   focused on `/api/v2/patients` and `/api/v2/search/omni`.
4. Run one variant with the startup warmup enabled and, if safe in the lab, one
   variant with the warmup disabled to prove whether the slow events are
   startup-plan/cache tails rather than steady-state query-plan problems.
5. Capture safe slow-query fingerprints for those two routes. Prefer the ops
   fingerprint endpoint with a proper ops/admin identity, or `pg_stat_statements`
   with query text/binds handled PHI-safely. Do not store raw bind values,
   patient identifiers, request bodies, response bodies, MRNs, or raw URLs with
   IDs.
6. For patient list, trace any reproduced slow event to the exact repository call
   in `hms_db::patients::list_patient_registry` or related hot-path query
   labels, then run `EXPLAIN (ANALYZE, BUFFERS)` with sanitized literals on the
   same data shape.
7. For Omni search, trace any reproduced slow event to the exact search
   repository label and query variant, then verify index usage and cache
   behavior under the same load shape.
8. If query plans remain fast and the warmup-enabled run stays clean, document
   the slow-SQL risk as startup-only and keep the mitigation. If a warm run
   reproduces slow SQL, prioritize a real SQL/index/cache fix over adding more
   warmup.
9. After backend evidence is stable, rerun public HTTPS regression and frontend
   runtime probes to separate app latency from user-path network and browser
   timing.
