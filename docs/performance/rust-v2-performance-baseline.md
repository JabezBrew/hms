# HMS Rust V2 Performance Baseline

Status: Agent 0 baseline report for the first Rust V2 performance wave.

Current-tree note, 2026-05-25: the historical gaps below for route-level
payload-size metrics and DB pool-wait metrics have since been closed in code,
and the maintained Rust V2 reporter now enforces payload, pool-wait, and
slow-SQL budgets when Prometheus snapshots are supplied. Rust V2 now also has a
PHI-safe synthetic performance seed behind `HMS_PERF_SEED_SCALE`. The accepted
stress artifact is still preserved as the 2026-05-20 baseline and still needs
regeneration for a dashboard trend and a seeded medium or large profile.

This report uses only the maintained Rust V2 load harness:

- Load script: `tests/load/k6-rust-v2-realistic.js`
- Reporter: `tests/load/scripts/report-rust-v2-performance.mjs`
- Regression wrapper: `tests/load/scripts/run-rust-v2-regression.sh`
- Stable aggregate baseline artifact:
  `tests/load/baselines/rust-v2-vps-edge-https-stress-after-auth-invalidation-cache.json`

Raw k6 exports and Prometheus snapshots are not committed here. They can contain
target-environment fixture IDs or operational internals. Only aggregate values
are summarized.

## Baseline Classification

Accepted baseline data: measured aggregate data from the committed Rust V2
baseline artifact captured on 2026-05-20T02:41:52Z.

Fresh staging run on 2026-05-22: not an accepted full baseline. The run was
stopped at the user checkpoint before the 19-minute `baseline` profile
completed. Its aggregate reporter output is useful as partial evidence only:

`/private/tmp/hms-agent0-rust-v2-baseline-hostnet-20260522T221000Z/report.json`

## Accepted Aggregate Baseline

Environment from the committed artifact:

| Field | Value |
| --- | --- |
| Target | Staging public HTTPS from VPS Docker edge network |
| Base URL | `https://staging.thehms.systems` |
| Profile | `stress` |
| Writes | Disabled |
| Data scale | Current staging seed |
| Checks | 100,077 passed, 0 failed |
| HTTP failures | 0 |
| HMS application errors | 0 |

Route and workflow p95/p99 from the accepted aggregate baseline:

| Surface | k6 metric | p95 | p99 | Budget | Status |
| --- | --- | ---: | ---: | ---: | --- |
| Auth/me | `hms_auth_me` | 9.35ms | 44.97ms | 75ms | Pass |
| Patient list | `hms_patient_list` | 12.78ms | 87.51ms | 200ms | Pass |
| Chronicle initial API read | `hms_patient_chronicle` | 20.25ms | 62.08ms | 300ms | Pass |
| Omni search | `hms_search` | 38.68ms | 91.11ms | 250ms | Pass |
| Ward board read | `hms_ward_board` | 11.00ms | 44.87ms | 250ms | Pass |
| Dashboard snapshot | `hms_dashboard_snapshot` | n/a | n/a | 250ms | Missing k6 trend |
| Laboratory group | `hms_laboratory` | 13.44ms | 52.63ms | 300ms | Pass |
| Inventory/pharmacy group | `hms_inventory` | 11.71ms | 70.10ms | 300ms | Pass |
| Billing/NHIS group | `hms_billing` | 10.65ms | 55.18ms | 500ms | Pass |
| All HTTP requests | `http_req_duration` | 21.61ms | 74.05ms | n/a | Informational |

Server-side visibility in the accepted baseline:

| Surface | Visibility |
| --- | --- |
| DB query counts | Available from `hms_api_http_db_query_count_sum`; all committed baseline route query budgets passed. |
| DB pool pressure | Available as pool size/idle snapshots and route pool-wait metrics when current Prometheus snapshots are supplied. |
| Dashboard p95/p99 | Missing dedicated k6 trend in the preserved accepted artifact. Server route counters were present, but dashboard user-latency trend was not. |
| Chronicle p95/p99 | Present and passing for the current staging seed. Larger Chronicle data profiles remain unproven. |
| API payload size | Available per route through `hms_api_response_payload_bytes` when current Prometheus snapshots are supplied. |
| Slow SQL | Available through route-pattern/status-bucket/facility-safe slow SQL budget labels when current Prometheus snapshots are supplied. |

## Current Medium-Seed Follow-Up

Local follow-up on 2026-05-25 provisioned a synthetic medium seed with
`HMS_PERF_SEED_SCALE=medium` and ran the maintained regression harness using
metrics snapshots from the local Rust V2 API.

The medium seed included 2,500 synthetic performance patients, 8,000 clinical
notes, 1,500 lab orders, 1,000 inventory items, 250 admissions, 750 nursing
tasks, and 1,500 invoices. These rows are synthetic and scoped to deterministic
performance fixtures; no PHI is written to reports or test artifacts.

Run artifact:

`/private/tmp/hms-perf-medium-after-patient-search/report.json`

Result:

| Surface | p99 | Budget | DB queries/request | Status |
| --- | ---: | ---: | ---: | --- |
| Auth/me | 45.86ms | 75ms | 0.00 | Pass |
| Patient list | 19.64ms | 200ms | 1.43 | Pass |
| Patient Chronicle | 10.49ms | 300ms | 2.00 | Pass |
| Omni search | 65.18ms | 250ms | 1.00 | Pass |
| Ward board | 12.65ms | 250ms | 1.00 | Pass |
| Dashboard snapshot | 204.03ms | 250ms | 2.89 | Pass |
| Laboratory routes | 36.98ms | 300ms | 0.22 | Pass |
| Inventory/pharmacy routes | 12.87ms | 300ms | 0.44 | Pass |
| Billing routes | 10.71ms | 500ms | 0.10 | Pass |

Payload, pool-wait, slow-SQL, pool snapshot, and named query guardrails all
passed. This local run does not replace the accepted staging stress baseline
until the same seeded profile is run on staging.

Example local medium seed:

```bash
cd backend-rs
HMS_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hms_perf_medium \
HMS_PROVISION_BASELINE=true \
HMS_SEED_DEMO_DATA=true \
HMS_PERF_SEED_SCALE=medium \
HMS_ENV=development \
HMS_BOOTSTRAP_ADMIN_EMAIL=owner@hms.local \
HMS_BOOTSTRAP_ADMIN_PASSWORD=ChangeMe123! \
cargo run -p hms-migrator
```

`HMS_PERF_SEED_SCALE` accepts `small`, `medium`, and `large`. The migrator
refuses performance seeding when `HMS_ENV=production`. `HMS_LOAD_DATA_SCALE`
remains a run label and does not seed data by itself.

## Fresh Staging Attempt

The user fixed the staging firewall during this run. SSH then worked:

```bash
ssh hms-staging 'cd /opt/hms && git status --short --branch'
```

Result: `/opt/hms` was on `rust-v2-integration`, and
`tests/load/k6-rust-v2-realistic.js` was present.

Remote readiness checks found:

| Check | Result |
| --- | --- |
| `k6` installed on host | Missing |
| `node` installed on host | Missing |
| Docker available | Present |
| `HMS_LOAD_*` credentials exported in remote shell | Missing |
| `HMS_LOAD_METRICS_URL` exported in remote shell | Missing |
| Rust V2 API metrics inside container | Present at `http://127.0.0.1:8080/api/v2/metrics` |

Because host k6 and load env vars were missing, the run used the official
`grafana/k6` container and sourced only the private staging Rust V2 env on the
remote host. No secret values were printed or written to docs.

Initial local command attempted before staging credentials were available:

```bash
HMS_LOAD_OUT_DIR=/private/tmp/hms-agent0-rust-v2-baseline-20260522T000000Z \
HMS_LOAD_BASE_URL=https://staging.thehms.systems \
HMS_LOAD_FACILITY_CODE=HMS \
HMS_LOAD_PROFILE=baseline \
HMS_LOAD_DATA_SCALE=current-seed \
HMS_LOAD_ALLOW_MISSING_METRICS=true \
tests/load/scripts/run-rust-v2-regression.sh
```

Blocker: no `HMS_LOAD_EMAIL/HMS_LOAD_PASSWORD` or role-specific
`HMS_LOAD_<ROLE>_EMAIL/HMS_LOAD_<ROLE>_PASSWORD` was exported locally. The
report status was `incomplete`.

Staging smoke command shape:

```bash
ssh hms-staging 'cd /opt/hms &&
  set -a && . ops/hetzner-v2/.env && set +a &&
  OUT=/tmp/hms-agent0-rust-v2-smoke-20260522T220500Z &&
  mkdir -p "$OUT" &&
  docker compose -f ops/hetzner-v2/compose.yml exec -T hms-api sh -lc "curl -fsS http://127.0.0.1:8080/api/v2/metrics" > "$OUT/api-metrics-before.prom" &&
  docker run --rm --network hms-v2-staging_internal -v /opt/hms:/work:ro -v "$OUT":/out -w /work
    -e HMS_LOAD_BASE_URL=http://hms-api:8080
    -e HMS_LOAD_FACILITY_CODE="$HMS_FACILITY_CODE"
    -e HMS_LOAD_PROFILE=smoke
    -e HMS_LOAD_DATA_SCALE=current-seed
    -e HMS_LOAD_EMAIL="$HMS_BOOTSTRAP_ADMIN_EMAIL"
    -e HMS_LOAD_PASSWORD="$HMS_BOOTSTRAP_ADMIN_PASSWORD"
    grafana/k6 run --summary-export /out/summary.json tests/load/k6-rust-v2-realistic.js'
```

Smoke result: authenticated successfully and exercised all workflow groups with
399 checks passed and 0 failed. The summary export failed because `/out` was not
writable by the k6 container user. The printed smoke p99 crossed patient-list
and search thresholds, so it was not treated as a baseline.

Public HTTPS bridge-network command then failed before setup completed:

```bash
docker run --rm --network hms-v2-staging_internal ... \
  -e HMS_LOAD_BASE_URL=https://staging.thehms.systems \
  grafana/k6 run --summary-export /out/summary.json tests/load/k6-rust-v2-realistic.js
```

Blocker: Docker bridge DNS returned
`lookup staging.thehms.systems on 127.0.0.11:53: server misbehaving`.

Host-network baseline command shape:

```bash
ssh hms-staging 'cd /opt/hms &&
  set -a && . ops/hetzner-v2/.env && set +a &&
  OUT=/tmp/hms-agent0-rust-v2-baseline-hostnet-20260522T221000Z &&
  mkdir -p "$OUT" && chmod 0777 "$OUT" &&
  docker compose -f ops/hetzner-v2/compose.yml exec -T hms-api sh -lc "curl -fsS http://127.0.0.1:8080/api/v2/metrics" > "$OUT/api-metrics-before.prom" &&
  docker run --rm --network host -v /opt/hms:/work:ro -v "$OUT":/out -w /work
    -e HMS_LOAD_BASE_URL=https://staging.thehms.systems
    -e HMS_LOAD_FACILITY_CODE="$HMS_FACILITY_CODE"
    -e HMS_LOAD_PROFILE=baseline
    -e HMS_LOAD_DATA_SCALE=current-seed
    -e HMS_LOAD_EMAIL="$HMS_BOOTSTRAP_ADMIN_EMAIL"
    -e HMS_LOAD_PASSWORD="$HMS_BOOTSTRAP_ADMIN_PASSWORD"
    grafana/k6 run --summary-export /out/summary.json tests/load/k6-rust-v2-realistic.js'
```

This command authenticated and ran against the public staging URL. It was
stopped at the checkpoint before the full baseline profile completed. The
partial run reached 5,428 checks, all passing.

Partial stopped-run aggregate:

| Surface | k6 metric | p95 | p99 | Budget | Status |
| --- | --- | ---: | ---: | ---: | --- |
| Auth/me | `hms_auth_me` | 5.52ms | 10.57ms | 75ms | Route latency pass; DB query budget failed |
| Patient list | `hms_patient_list` | 10.83ms | 104.08ms | 200ms | Pass |
| Chronicle initial API read | `hms_patient_chronicle` | 17.10ms | 32.30ms | 300ms | Pass |
| Omni search | `hms_search` | 27.95ms | 67.49ms | 250ms | Pass |
| Ward board read | `hms_ward_board` | 8.91ms | 16.96ms | 250ms | Pass |
| Dashboard snapshot | `hms_dashboard_snapshot` | n/a | n/a | 250ms | Missing k6 trend |
| Laboratory group | `hms_laboratory` | 10.83ms | 26.35ms | 300ms | Pass |
| Inventory/pharmacy group | `hms_inventory` | 11.99ms | 115.20ms | 300ms | Failed drift from committed baseline |
| Billing/NHIS group | `hms_billing` | 8.73ms | 16.65ms | 500ms | Pass |
| All HTTP requests | `http_req_duration` | 22.24ms | 67.87ms | n/a | Informational |

Maintained reporter result for the stopped partial run: `fail`.

Failures:

- `Inventory/pharmacy routes` p99 regressed 1.6433x from the committed baseline.
- `Auth/me` had 5 DB queries over 342 server requests, exceeding the zero-query
  warm-route budget.

Warnings:

- `hms_dashboard_snapshot` trend was missing.
- `dashboard.refresh_snapshot` occurred 18 times over 341 dashboard snapshot
  requests, or 0.0528 refreshes/request, above the interim 0.02 warning budget.

Pool visibility:

- Main postgres pool snapshot: size 7, idle 7, used 0%, pass.
- Auth postgres pool snapshot: size 2, idle 2, used 0%, pass.
- Pool wait time is still not visible. Implement
  `hms_db_pool_wait_seconds` from `performance-budget.md` before accepting pool
  wait improvements.

Payload visibility:

- The stopped partial k6 export recorded aggregate `data_received=10,440,103`
  bytes and `data_sent=626,950` bytes across 5,428 HTTP requests.
- Route-level payload size is not visible. Implement
  `hms_api_response_payload_bytes` before accepting API payload-size work.

## Gaps To Close Before Optimization Acceptance

1. Configure role-specific staging load credentials instead of using the
   bootstrap admin account for every workflow.
2. Install host `k6` on staging or keep a documented Docker command with a
   writable output directory and host networking for public HTTPS runs.
3. Add the missing `hms_dashboard_snapshot` trend to all preserved baseline
   artifacts, or regenerate the accepted baseline after the current script is
   deployed.
4. Reprovision staging with `HMS_PERF_SEED_SCALE=medium` or `large` before
   replacing the accepted current-seed baseline.
5. Treat the stopped 2026-05-22 host-network run as partial evidence only. Do
   not use it as the accepted baseline for downstream optimization approval.
