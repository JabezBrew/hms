# HMS Load Testing

The active HMS backend is Rust V2. Use `k6-rust-v2-realistic.js` for current
load testing. The older `k6-test.js`, `k6-smoke.js`, `k6-debug.js`, and
`locustfile.py` still target legacy Django `/api/...` paths and should only be
used for explicit legacy-backend work.

The V2 suite is designed to model real hospital use: logged-in concurrent staff,
role-weighted workflows, realistic think time, bounded V2 list endpoints, shared
operational objects, optional synthetic writes, and p99 thresholds from the Rust
V2 performance budget.

## Current Performance Baseline

The named Rust V2 baseline is:

`tests/load/baselines/rust-v2-vps-edge-https-stress-after-auth-invalidation-cache.json`

It preserves the successful staging stress run from `2026-05-20T02:41:52Z`
as a PHI-safe aggregate artifact. The raw k6 export was:

`/tmp/hms-load-results/vps-edge-https-stress-after-auth-invalidation-cache.json`

Do not commit the raw export. k6 summary exports include `setup_data.fixture`
IDs from the target environment. The committed baseline stores only aggregate
latency, check/error, route counter, and query-counter budgets.

Baseline result:

| Surface | Baseline p99 |
| --- | ---: |
| Auth/me | 44.96ms |
| Patient Chronicle | 62.07ms |
| Omni Search | 91.1ms |
| Patient list | 87.51ms |
| Ward board | 44.87ms |
| Laboratory group | 52.63ms |
| Inventory group | 70.1ms |
| Billing group | 55.18ms |

The baseline also recorded `100,077` checks, `0` failed checks, `0` HTTP
failures, and server metrics showing `/api/v2/auth/me` handled `6,046`
requests with `0` DB queries.

## Safety Rules

- Prefer staging, a temporary clone, or a synthetic-data environment.
- Do not enable writes against production PHI data.
- Do not paste response bodies, patient identifiers, names, notes, or raw URLs
  containing identifiers into issue trackers or chat.
- Run real load from another machine or VPS. A laptop run is acceptable for
  smoke only.
- Watch Grafana/Prometheus during every ramp, stress, and soak run.

## Prerequisites

Install k6:

```bash
brew install k6
```

The script reads credentials from environment variables. For quick smoke, one
shared account is enough:

```bash
export HMS_LOAD_EMAIL='owner@hms.local'
export HMS_LOAD_PASSWORD='<password>'
```

For realistic role behavior, prefer role-specific credentials:

```bash
export HMS_LOAD_NURSE_EMAIL='nurse-load@example.test'
export HMS_LOAD_NURSE_PASSWORD='<password>'
export HMS_LOAD_DOCTOR_EMAIL='doctor-load@example.test'
export HMS_LOAD_DOCTOR_PASSWORD='<password>'
export HMS_LOAD_RECEPTION_EMAIL='reception-load@example.test'
export HMS_LOAD_RECEPTION_PASSWORD='<password>'
export HMS_LOAD_LAB_EMAIL='lab-load@example.test'
export HMS_LOAD_LAB_PASSWORD='<password>'
export HMS_LOAD_PHARMACY_EMAIL='pharmacy-load@example.test'
export HMS_LOAD_PHARMACY_PASSWORD='<password>'
export HMS_LOAD_BILLING_EMAIL='billing-load@example.test'
export HMS_LOAD_BILLING_PASSWORD='<password>'
export HMS_LOAD_ADMIN_EMAIL='admin-load@example.test'
export HMS_LOAD_ADMIN_PASSWORD='<password>'
```

## Rust V2 Runs

Local read-only smoke:

```bash
k6 run \
  -e HMS_LOAD_BASE_URL=http://127.0.0.1:8080 \
  -e HMS_LOAD_FACILITY_CODE=HMS \
  -e HMS_LOAD_PROFILE=smoke \
  tests/load/k6-rust-v2-realistic.js
```

Staging baseline:

```bash
k6 run \
  -e HMS_LOAD_BASE_URL=https://staging.thehms.systems \
  -e HMS_LOAD_FACILITY_CODE=HMS \
  -e HMS_LOAD_PROFILE=baseline \
  tests/load/k6-rust-v2-realistic.js
```

Write-enabled staging run:

```bash
k6 run \
  -e HMS_LOAD_BASE_URL=https://staging.thehms.systems \
  -e HMS_LOAD_FACILITY_CODE=HMS \
  -e HMS_LOAD_PROFILE=baseline \
  -e HMS_LOAD_ENABLE_WRITES=true \
  tests/load/k6-rust-v2-realistic.js
```

OPD rush overlay with arrival-rate pressure:

```bash
k6 run \
  -e HMS_LOAD_BASE_URL=https://staging.thehms.systems \
  -e HMS_LOAD_FACILITY_CODE=HMS \
  -e HMS_LOAD_PROFILE=busy-site \
  -e HMS_LOAD_INCLUDE_OPD_RUSH=true \
  -e HMS_LOAD_OPD_HOLD_RATE=30 \
  tests/load/k6-rust-v2-realistic.js
```

## Profiles

| Profile | Shape | Use |
| --- | --- | --- |
| `smoke` | 5 users for 2 minutes | Verify credentials, routing, and basic metrics. |
| `baseline` | 25 users for 15 minutes | Normal small-clinic concurrency. |
| `small-site` | 50 users for 30 minutes | Small facility day-load. |
| `busy-site` | 100 users for 30 minutes | Busy outpatient/inpatient concurrency. |
| `stress` | ramps to 200 users | Find the saturation point. |
| `soak` | 75 users for 1 hour by default | Find memory, pool, cache, and queue drift. |

Override soak duration with `HMS_LOAD_SOAK_HOLD_DURATION=2h`.

## Environment Options

| Variable | Default | Purpose |
| --- | --- | --- |
| `HMS_LOAD_BASE_URL` | `http://127.0.0.1:8080` | API origin, without `/api/v2`. |
| `HMS_LOAD_FACILITY_CODE` | `HMS` | Facility code sent to auth and request context. |
| `HMS_LOAD_PROFILE` | `smoke` | One of the profiles above. |
| `HMS_LOAD_WORKFLOWS` | all | Comma-separated subset: `reception,doctor,nurse,lab,pharmacy,billing,admin`. |
| `HMS_LOAD_ENABLE_WRITES` | false | Enables synthetic patient, visit, triage, note, vitals, lab, pharmacy, and billing writes. |
| `HMS_LOAD_INCLUDE_OPD_RUSH` | false | Adds an arrival-rate OPD rush scenario. |
| `HMS_LOAD_DATA_SCALE` | `current-seed` | Labels the dataset scale in k6 tags and logs. Use `small`, `medium`, or `large` only after the environment has actually been seeded to that scale. |
| `HMS_LOAD_THINK_TIME_SCALE` | `1` | Lower for faster tests, higher for slower human pacing. |
| `HMS_LOAD_BUDGET_MULTIPLIER` | `1` | Multiplies p99 thresholds when measuring over higher-latency public links. |
| `HMS_LOAD_DEBUG_FAILURES` | false | Logs method, route template, role, and status for failed requests. Never logs bodies. |

## Workflows Covered

- Reception: appointments, patient search, optional registration/check-in/triage.
- Doctor: visit/triage review, patient search, omni search, chronicle, notes, optional clinical note and lab order.
- Nurse: dashboard snapshot, ward board, nursing tasks, alerts, vitals reads, optional vitals writes.
- Lab: test catalog, orders, specimens, results, optional lab order writes.
- Pharmacy: inventory summary/items/locations, dispenses, optional dispense writes.
- Billing: dashboard, invoices, payments, service prices, claims, optional invoice writes.
- Admin: capacity dashboard, staff directory, audit events, deployment capabilities.

## Targets

The script uses Rust V2 p99 budgets by default:

| Surface | Default p99 threshold |
| --- | --- |
| `auth/me` | `<75ms` |
| hot patient lists | `<200ms` |
| dashboard snapshot | `<250ms` |
| patient chronicle | `<300ms` |
| ward board | `<250ms` |
| omni search | `<250ms` |
| laboratory route group | `<300ms` |
| inventory/pharmacy route group | `<300ms` |
| billing route group | `<500ms` |
| clinical/operational writes | `<500ms` |
| error rate | `<1%` |

If the k6 generator runs over a public internet path, use
`HMS_LOAD_BUDGET_MULTIPLIER=1.5` only for client-observed latency. Server-side
Grafana metrics should still be judged against the real Rust V2 budget.

## Observability During Runs

Open Grafana through the staging tunnel:

```bash
ssh -L 3001:127.0.0.1:3001 hms-staging
```

Then visit `http://127.0.0.1:3001` and watch:

- request rate and route-level latency,
- 4xx/5xx rate,
- slow routes,
- API CPU and memory,
- Postgres/PgBouncer connections,
- Redis health,
- worker queue depth,
- logs filtered by request id, route template, and status.

The Rust API exposes PHI-safe Prometheus text at `/api/v2/metrics` on the
container network. Do not expose that endpoint publicly.

## Regression Workflow

For a full internal app-stack regression run, run k6 from the VPS or another
machine on the same private network path. Use the same credentials and profile
shape as the baseline unless the change being tested explicitly requires a
different profile.

If you have a private metrics URL available from the runner, capture before and
after metrics so the report can compare counter deltas instead of cumulative API
process counters:

```bash
export HMS_LOAD_BASE_URL=https://staging.thehms.systems
export HMS_LOAD_FACILITY_CODE=HMS
export HMS_LOAD_PROFILE=stress
export HMS_LOAD_DATA_SCALE=current-seed
export HMS_LOAD_METRICS_URL=http://hms-api:8080/api/v2/metrics

tests/load/scripts/run-rust-v2-regression.sh
```

`HMS_LOAD_METRICS_URL` is required for a full regression verdict. Without API
metrics the report is `incomplete`, because DB-query budgets, auth guardrails,
and pool pressure were not evaluated. For a k6-only smoke report, set
`HMS_LOAD_ALLOW_MISSING_METRICS=true`; do not treat that mode as a full
regression pass.

If you already have a k6 summary export, generate the report directly:

```bash
node tests/load/scripts/report-rust-v2-performance.mjs \
  --summary /tmp/hms-load-results/vps-edge-https-stress-after-auth-invalidation-cache.json \
  --metrics-after /tmp/hms-load-results/api-metrics-after.prom
```

The report decides pass/fail from:

- k6 `checks` failure rate,
- `http_req_failed` and HMS application error rates,
- custom hot-route p99 absolute budgets and drift from the committed baseline,
- route-level DB queries/request from `hms_api_http_db_query_count_sum`,
- pool snapshot pressure from SQLx pool gauges when metrics are supplied,
- guard query counters such as `auth.user_auth_versions_for_facility`.

Report status meanings:

- `pass`: all budgets and baseline-drift tolerances passed.
- `warn`: route p99 has drifted meaningfully from the committed baseline but has
  not crossed the fail threshold or absolute budget.
- `fail`: checks, errors, p99, query budgets, or guardrails crossed a hard
  failure threshold.
- `incomplete`: required evidence was missing, such as API metrics or matching
  route counters.

The default p99 drift tolerance warns at `>1.2x` the committed baseline and
fails at `>1.5x` the committed baseline. Absolute route p99 budgets always fail.

For regression comparisons, keep the k6 summary, the report JSON, and Grafana
screenshots of aggregate panels only. Do not share raw response bodies or
patient-level data. Do not commit raw k6 exports that include `setup_data`.

## Internal Versus User Latency

This harness is for internal app-stack speed: k6 running close to the API, over
the VPS edge or private Docker network, with server metrics from the API
container. It is the right tool for catching Rust API, SQL, cache, pool, and
route-regression problems.

Laptop-to-VPS and real-user latency are different measurements. They include
local ISP routing, TLS connection setup, browser scheduling, frontend render
work, device speed, and geographic distance. Use browser RUM, synthetic browser
checks, and regional probes for that class of latency. Do not claim production
user latency from this k6 baseline alone.

## Data-Scale Profiles

The current committed baseline is only for the current staging seed. Larger
Chronicle and search datasets are still unproven. Once staging has explicit
seed profiles, label runs like this:

```bash
HMS_LOAD_DATA_SCALE=small tests/load/scripts/run-rust-v2-regression.sh
HMS_LOAD_DATA_SCALE=medium tests/load/scripts/run-rust-v2-regression.sh
HMS_LOAD_DATA_SCALE=large tests/load/scripts/run-rust-v2-regression.sh
```

The `HMS_LOAD_DATA_SCALE` value is a label only. It does not seed data and must
not be used to claim small/medium/large performance until the environment has
actually been provisioned to that scale.

## Guardrails

- `GET /api/v2/auth/me` must stay at `0` DB queries on a warm cache.
- `auth.user_auth_versions_for_facility` must stay at `0` during warm-cache
  auth regression runs.
- Dashboard reads must not regress into per-request write amplification. The
  historical baseline tolerates bounded cache refresh only as an interim guard;
  lower the `dashboard.refresh_snapshot` guard to zero once dashboard refreshes
  are fully moved out of the read path.
- Hot list endpoints must remain bounded and cursor-paginated.
- Chronicle and omni search must be rerun after larger seeded datasets exist.
- Pool gauges in the report are snapshots. Use Grafana/Prometheus range panels
  to prove peak pool pressure during a stress run.
