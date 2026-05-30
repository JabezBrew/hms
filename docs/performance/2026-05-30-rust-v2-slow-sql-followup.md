# Rust V2 slow SQL follow-up - 2026-05-30

## Latest pause point

Paused after deploying and validating commit `14b536b435c0` in the GCP
performance lab. The direct VPC origin regression run passed every maintained
gate except the zero-slow-SQL budget. Public HTTPS and frontend runtime probes
should be rerun after origin slow SQL is cleared.

The latest cache-scope reduction improved the slow-SQL tail from 2 patient-list
events plus 2 Omni-search events to 1 patient-list event plus 1 Omni-search
event. The remaining failure is therefore narrow and rare, but still blocks the
maintained reporter because the budget is intentionally zero.

## Latest evidence run

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

## Hot-route latency after latest fixes

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

## DB query rates after latest fixes

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

## Remaining slow SQL failures

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

Only `/api/v2/patients` and `/api/v2/search/omni` are current reporter-gated
failures. Chronicle and inventory/pharmacy slow SQL were cleared by the latest
single-flight/scoped-cache work.

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

Current interpretation: this is not yet proven to be a missing-index or
high-cardinality data-plan issue. The remaining events look more like rare
cold-query-shape or cold-cache tails that still occur after request caches are
mostly warm. That interpretation must be revalidated before the next fix.

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

## Next investigation path

1. Reset or restart metrics, then rerun a targeted origin-only workload focused
   on `/api/v2/patients` and `/api/v2/search/omni`.
2. Capture safe slow-query fingerprints for those two routes. Prefer the ops
   fingerprint endpoint with a proper ops/admin identity, or `pg_stat_statements`
   with query text/binds handled PHI-safely. Do not store raw bind values,
   patient identifiers, request bodies, response bodies, MRNs, or raw URLs with
   IDs.
3. For patient list, trace the remaining slow event to the exact repository call
   in `hms_db::patients::list_patient_registry` or related hot-path query
   labels, then run `EXPLAIN (ANALYZE, BUFFERS)` with sanitized literals on the
   same data shape.
4. For Omni search, trace the remaining slow event to the exact search
   repository label and query variant, then verify index usage and cache
   behavior under the same load shape.
5. If the query plans remain fast but the first routed hits still trip slow-SQL
   counters, evaluate bounded startup warmup for exact hot query shapes outside
   request routes. Warmup must not log PHI, must tolerate timeout/failure, and
   must not bypass facility scoping.
6. Only after origin reports zero gated slow SQL, rerun public HTTPS regression
   and frontend runtime probes to separate app latency from edge/network latency.
