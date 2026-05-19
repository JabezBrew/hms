# HMS Load Testing

The active HMS backend is Rust V2. Use `k6-rust-v2-realistic.js` for current
load testing. The older `k6-test.js`, `k6-smoke.js`, `k6-debug.js`, and
`locustfile.py` still target legacy Django `/api/...` paths and should only be
used for explicit legacy-backend work.

The V2 suite is designed to model real hospital use: logged-in concurrent staff,
role-weighted workflows, realistic think time, bounded V2 list endpoints, shared
operational objects, optional synthetic writes, and p99 thresholds from the Rust
V2 performance budget.

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
| patient chronicle | `<300ms` |
| ward board | `<250ms` |
| omni search | `<250ms` |
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

## Result Handling

Write a machine-readable result when comparing runs:

```bash
mkdir -p results/load
k6 run \
  --summary-export results/load/rust-v2-baseline-summary.json \
  -e HMS_LOAD_PROFILE=baseline \
  tests/load/k6-rust-v2-realistic.js
```

For regression comparisons, keep the k6 summary plus Grafana screenshots of
aggregate panels only. Do not share raw response bodies or patient-level data.
