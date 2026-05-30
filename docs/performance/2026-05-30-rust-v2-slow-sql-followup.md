# Rust V2 slow SQL follow-up - 2026-05-30

## Pause point

Paused after deploying and validating commit `3335a82c7c5c` in the GCP performance
lab. The direct VPC origin regression run passed every maintained gate except the
zero-slow-SQL budget. Public HTTPS and frontend runtime probes should be rerun
after origin slow SQL is cleared.

## Evidence run

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
HMS_LOAD_OUT_DIR=results/load/gcp-internal-direct-stress-singleflight-3335a82c7c5c-$(date -u +%Y%m%dT%H%M%SZ) \
tests/load/scripts/run-rust-v2-regression.sh
```

Reporter output:

- Summary: `results/load/gcp-internal-direct-stress-singleflight-3335a82c7c5c-20260530T075733Z/summary.json`
- Report: `results/load/gcp-internal-direct-stress-singleflight-3335a82c7c5c-20260530T075733Z/report.json`
- Status: `FAIL`, only because slow SQL budget is zero.
- Checks: 50,834 passed, 0 failed.
- `http_req_failed`: 0%.
- `hms_errors`: 0%.
- Pool wait p99: 0 ms on all reported hot surfaces.
- App memory during run: peaked around 477 MiB of 768 MiB, then settled near
  407 MiB. No OOM evidence in this run.

## Hot-route latency after latest fixes

| Surface | p99 | Target status |
| --- | ---: | --- |
| `auth/me` | 1.36 ms | pass |
| Patient list | 2.04 ms | pass |
| Patient Chronicle | 8.77 ms | pass |
| Omni search | 3.93 ms | pass |
| Dashboard snapshot | 1.80 ms | pass |
| Ward board | 1.74 ms | pass |
| Laboratory routes | 5.80 ms | pass |
| Inventory/pharmacy routes | 3.25 ms | pass |
| Billing routes | 4.69 ms | pass |

## DB query rates after latest fixes

| Surface | Requests | DB queries | Queries/request | Status |
| --- | ---: | ---: | ---: | --- |
| `auth/me` | 3,065 | 0 | 0 | pass |
| Patient list | 4,089 | 37 | 0.0090 | pass |
| Patient Chronicle | 2,173 | 108 | 0.0497 | pass |
| Omni search | 2,164 | 31 | 0.0143 | pass |
| Ward board | 3,108 | 10 | 0.0032 | pass |
| Dashboard snapshot | 3,108 | 20 | 0.0064 | pass |
| Laboratory routes | 2,737 | 0 | 0 | pass |
| Inventory/pharmacy routes | 2,358 | 6 | 0.0025 | pass |
| Billing routes | 3,186 | 0 | 0 | pass |

## Remaining slow SQL failures

Maintained reporter failures:

| Surface | Requests | Slow queries | Slow/request | Budget |
| --- | ---: | ---: | ---: | ---: |
| Patient list | 4,089 | 2 | 0.0005 | 0 |
| Omni search | 2,164 | 2 | 0.0009 | 0 |

Sanitized route-level slow query counters visible after the run:

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

## Next investigation path

1. Reset or restart metrics, then rerun a targeted origin-only workload focused
   on `/api/v2/patients` and `/api/v2/search/omni`.
2. Capture safe slow-query fingerprints for those two routes. Prefer the ops
   fingerprint endpoint with a proper ops/admin identity, or `pg_stat_statements`
   with query text/binds handled PHI-safely. Do not store raw bind values,
   patient identifiers, request bodies, response bodies, MRNs, or raw URLs with
   IDs.
3. For patient list, trace the two slow events to the exact repository call in
   `hms_db::patients::list_patient_registry` or related hot-path query labels,
   then run `EXPLAIN (ANALYZE, BUFFERS)` with sanitized literals on the same data
   shape.
4. For Omni search, trace the two slow events to the exact search repository
   label and query variant, then verify index usage and cache behavior under the
   same load shape.
5. Only after origin reports zero gated slow SQL, rerun public HTTPS regression
   and frontend runtime probes to separate app latency from edge/network latency.
