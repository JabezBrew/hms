# HMS Rust V2 Ops Dashboard Contract

Status: implementation-aligned v1 contract for a custom engineer dashboard.

Scope: this document defines the product, security, and API contracts for the
HMS Rust V2 Ops Dashboard. It does not implement backend handlers, frontend UI,
Prometheus configuration, Grafana dashboards, Caddy routing, or deployment
changes.

## Product Intent

The v1 dashboard is an HMS engineer dashboard in the style of Vercel or
Cloudflare: fast status, release, route, latency, payload, RUM, database, and
operational budget signals in one protected HMS UI.

It is not a Grafana replacement. Grafana remains the private fallback for deep
incident work. The custom dashboard gives platform engineers a safer, narrower,
HMS-specific first screen.

## Audience and Surface

Audience:

- HMS platform administrators.
- HMS platform operators.
- On-call engineers who have been granted the explicit ops dashboard
  permission.

Non-audience:

- Hospital administrators.
- Clinical, billing, pharmacy, laboratory, nursing, reception, or patient users.
- Any user whose only authority comes from a client facility position.

Canonical routes:

- Production clients: `https://ops.<client-domain>`
- Staging: `https://ops.staging.thehms.systems`

The dashboard UI may route internally under `/`, `/routes`, `/database`,
`/browser`, and `/incidents`. API calls must use `/api/v2/ops/*`.

## Data Sources

Primary source:

- Prometheus-compatible HMS metrics scraped privately from the Rust V2 API and
  worker. The browser must never receive raw Prometheus queries.

Secondary optional source:

- `pg_stat_statements`, only through a server-side repository/Adapter that
  returns query fingerprints and aggregate timing. The API contract must never
  return SQL text, bind parameters, schemas, table rows, or query plans.

Fallback source:

- Private Grafana over SSH tunnel or WireGuard. Grafana is used for deeper
  incident analysis, not embedded into the custom dashboard and not exposed as
  a public iframe.

Deferred source:

- Logs. v1 must not include log search, raw log lines, request body inspection,
  or arbitrary log queries. Safe service error counts may be shown only when an
  existing aggregate metric or safe log-derived counter is already present.

## Safe Label Contract

The dashboard contract allows only these variable labels in API responses:

| Label | Contract |
| --- | --- |
| `route_pattern` | Static route templates only, for example `/api/v2/patients/:id/chronicle`. Never raw URLs or query strings. |
| `status_bucket` | `2xx`, `3xx`, `4xx`, `5xx`, `network`, `timeout`, `cancelled`, or `unknown`. |
| `facility_safe` | Safe facility code such as `MAIN`, or `_unknown`. Never facility names. |
| `service` | Safe service slug such as `hms-api`, `hms-worker`, `frontend`, `postgres`, `redis`, or `caddy`. |
| `environment` | Safe environment slug such as `staging` or `production`. |
| `client_slug` | Safe deployment slug. Never client legal name unless it is already the approved slug. |

The contract forbids labels or payload fields containing patient IDs, MRNs,
patient names, encounter IDs, accession numbers, invoice IDs, external
identifiers, email addresses, phone numbers, request bodies, clinical text,
diagnoses, medication names from patient orders, SQL text, raw PromQL, log
lines, free-form search text, or arbitrary error messages.

## API Contract Conventions

Base path: `/api/v2/ops`

All v1 endpoints are read-only JSON endpoints and use the existing Rust V2
response envelope:

```json
{
  "data": {}
}
```

Time windows are enums, not query languages:

```text
5m, 15m, 1h, 6h, 24h
```

Default window: `15m`.

Allowed common query params:

| Param | Values | Default |
| --- | --- | --- |
| `window` | `5m`, `15m`, `1h`, `6h`, `24h` | `15m` |
| `facility_safe` | Safe facility code or omitted | Actor scope |
| `service` | Safe service slug or omitted | all services |
| `limit` | Integer `1..50` where supported | endpoint-specific |

Forbidden query params:

- `promql`
- `query`
- `sql`
- `logql`
- `raw`
- `url`
- `patient_id`
- `mrn`
- `request_body`
- any free-form route, SQL, log, or clinical search string

Timestamps are UTC ISO-8601 strings. Durations are milliseconds in JSON and
seconds only in Prometheus metrics. Payload sizes are bytes.

## Current V1 Endpoints

### `GET /api/v2/ops/overview`

Purpose: first dashboard paint with enough data to answer "is HMS healthy, what
changed, and which safe surface is over budget?"

Required response shape:

```json
{
  "data": {
    "generated_at": "2026-05-23T00:00:00Z",
    "window": "15m",
    "client_slug": "staging",
    "environment": "staging",
    "health_version": {},
    "clinical_budget_cards": [],
    "route_latency": [],
    "db_pool": {},
    "request_context_cache": {},
    "payload": {},
    "rum": {},
    "slow_query_fingerprints": {},
    "service_errors": {}
  }
}
```

The overview endpoint is backed by the same `OpsService` Interface as the
focused endpoints below. It must not become a shallow handler that performs
Prometheus, Postgres, and authorization work inline.

Additional current-process snapshot endpoints:

- `GET /api/v2/ops/performance`
- `GET /api/v2/ops/database`
- `GET /api/v2/ops/frontend`

The current v1 implementation reads in-process Rust metrics only. Fixed
historical windows remain a follow-up once a server-side, allowlisted
Prometheus summary Adapter exists.

## Future Endpoint Contracts

The focused endpoint names below are reserved for the Prometheus-backed phase.
They should either be implemented as aliases over the current service Interface
or replace the current snapshot endpoints through a documented API migration.

### `GET /api/v2/ops/health-version`

Purpose: release and readiness strip.

Data sources:

- Rust health endpoints and process gauges.
- Deployment metadata if already available to `AppState` or a safe runtime
  Adapter.

Required fields:

| Field | Type | Notes |
| --- | --- | --- |
| `service` | string | Safe slug. |
| `status` | string | `alive`, `ready`, `not_ready`, or `unknown`. |
| `version` | string | Package/app version. |
| `build_sha` | string or null | Git SHA only, no branch secrets. |
| `started_at` | string or null | UTC. |
| `dependencies` | array | `{ name, ready }` only. |
| `rum_enabled` | boolean | From safe runtime config/metric. |

### `GET /api/v2/ops/route-latency`

Purpose: Vercel-style route table for request rate, p95/p99 latency, and error
rate.

Data sources:

- Route request count and duration metrics.
- Dedicated dashboard, Chronicle, and ward board metrics when present.

Required row fields:

| Field | Type |
| --- | --- |
| `route_pattern` | string |
| `status_bucket` | string |
| `facility_safe` | string |
| `request_count` | integer |
| `request_rate_per_minute` | number |
| `p50_ms` | number or null |
| `p95_ms` | number or null |
| `p99_ms` | number or null |
| `error_rate` | number |
| `budget_ms` | number or null |
| `budget_status` | `pass`, `warn`, `fail`, or `unknown` |

### `GET /api/v2/ops/clinical-budgets`

Purpose: top cards for clinical safety and performance budgets.

Required cards:

| Key | Surface | Budget |
| --- | --- | --- |
| `health_alive` | health alive | p99 <= 20ms |
| `auth_me` | authenticated identity | p99 <= 75ms |
| `patient_list` | patient hot list | p99 <= 200ms |
| `patient_chronicle` | Chronicle initial read | p99 <= 300ms |
| `ward_board` | ward board | p99 <= 250ms |
| `search` | omni search | p99 <= 250ms |
| `dashboard_snapshot` | clinical dashboard snapshot | p99 <= 250ms |
| `laboratory` | lab read group | p99 <= 300ms |
| `inventory_pharmacy` | inventory/pharmacy read group | p99 <= 300ms |
| `billing_nhis` | billing/NHIS read group | p99 <= 500ms |

Required card fields:

```json
{
  "key": "patient_chronicle",
  "title": "Chronicle initial read",
  "route_pattern": "/api/v2/patients/:id/chronicle",
  "p95_ms": 120,
  "p99_ms": 210,
  "budget_ms": 300,
  "budget_status": "pass",
  "request_count": 42,
  "last_regression_status": "unknown"
}
```

`last_regression_status` may be `unknown` until a safe aggregate baseline store
exists. It must not link to raw k6 exports, raw response bodies, or raw
Prometheus snapshots.

### `GET /api/v2/ops/db-pool`

Purpose: pool pressure, saturation, and wait visibility.

Data sources:

- API/auth/worker pool gauges.
- Pool wait histogram when present.

Required fields:

```json
{
  "pools": [
    {
      "service": "hms-api",
      "pool": "main",
      "size": 10,
      "idle": 7,
      "in_use": 3,
      "utilization_pct": 30.0,
      "wait_p95_ms": 2.0,
      "wait_p99_ms": 7.0,
      "status": "pass"
    }
  ]
}
```

### `GET /api/v2/ops/request-context-cache`

Purpose: identify request-context hydration regressions without exposing actor,
session, or patient facts.

Data sources:

- Request-context cache hit/miss counters.
- Request-context hydration DB duration histogram.

Required row fields:

| Field | Type |
| --- | --- |
| `route_pattern` | string |
| `facility_safe` | string |
| `hits` | integer |
| `misses` | integer |
| `hit_ratio` | number |
| `hydration_db_p95_ms` | number or null |
| `hydration_db_p99_ms` | number or null |
| `status` | `pass`, `warn`, `fail`, or `unknown` |

No user IDs, session IDs, permission versions, or profile names may be returned.

### `GET /api/v2/ops/payload`

Purpose: route-level response size budget cards and table.

Data sources:

- API response payload histogram.

Required row fields:

| Field | Type |
| --- | --- |
| `route_pattern` | string |
| `status_bucket` | string |
| `facility_safe` | string |
| `sample_count` | integer |
| `p50_bytes` | integer or null |
| `p95_bytes` | integer or null |
| `p99_bytes` | integer or null |
| `budget_p95_bytes` | integer or null |
| `budget_p99_bytes` | integer or null |
| `status` | `pass`, `warn`, `fail`, or `unknown` |

The dashboard must not display response bodies or object previews.

### `GET /api/v2/ops/rum`

Purpose: browser-side experience without page text or raw URLs.

Data sources:

- Browser RUM metrics accepted by the Rust API.
- RUM enabled gauge.

Required fields:

```json
{
  "enabled": true,
  "events": [
    {
      "event_group": "api",
      "route_pattern": "/api/v2/patients",
      "status_bucket": "2xx",
      "facility_safe": "MAIN",
      "event_count": 120,
      "p95_ms": 180,
      "p99_ms": 320,
      "status": "pass"
    }
  ]
}
```

Allowed `event_group` values: `api`, `navigation`, `app_shell`, `web_vital`,
and `unknown`. Event names from the browser must be folded into these safe
groups before returning dashboard data.

### `GET /api/v2/ops/slow-query-fingerprints`

Purpose: surface database pain without leaking SQL.

Data sources:

- Prometheus route-level slow query counters and DB duration histograms.
- Optional `pg_stat_statements` aggregate rows.

Required fields:

```json
{
  "source": "pg_stat_statements",
  "available": true,
  "fingerprints": [
    {
      "fingerprint_id": "q_9f2a13c7",
      "route_pattern": "/api/v2/patients/:id/chronicle",
      "query_name": "clinical.patient_chronicle_summary",
      "calls": 120,
      "total_exec_ms": 4000,
      "mean_exec_ms": 33.3,
      "p99_exec_ms": null,
      "rows": 480,
      "last_seen_at": null,
      "status": "warn"
    }
  ]
}
```

Rules:

- `fingerprint_id` is a one-way stable identifier derived from `queryid` or a
  safe query name. It must not be SQL text.
- `query_name` is optional and must be a stable application label, not SQL.
- The Adapter must not select or return the `query` text from
  `pg_stat_statements`.
- When `pg_stat_statements` is unavailable, return `available: false` with a
  safe reason code such as `extension_unavailable`.

### `GET /api/v2/ops/service-errors`

Purpose: safe error-count strip, only if already backed by aggregate metrics.

Required fields:

```json
{
  "available": true,
  "errors": [
    {
      "service": "hms-api",
      "status_bucket": "5xx",
      "route_pattern": "/api/v2/billing/invoices",
      "count": 3,
      "rate_per_minute": 0.2
    }
  ]
}
```

No stack traces, error messages, log lines, exception strings, or request bodies
are allowed in v1.

## Security Contract

Authorization:

- Every `/api/v2/ops/*` endpoint must require an authenticated
  `RequestContext`.
- Every endpoint must require the explicit ops dashboard permission
  `system.ops.view`.
- The permission is granted only to platform administrator/operator authority,
  not client facility administrators.
- `system.ops.view` must not be included in deployment-profile permission seeds
  or assignable through normal client facility-admin workflows.
- No endpoint may rely on a broad `is_admin` check.
- The frontend must hide the dashboard unless the same capability is present,
  but backend authorization is authoritative.

Transport and exposure:

- The UI is served only on the ops subdomain surface.
- The client hospital host must return `404` for `/system/ops` and
  `/api/v2/ops/*`.
- Prometheus, Grafana, Loki, Postgres, Redis, metrics proxy, and exporter ports
  remain private.
- The browser calls only the HMS `/api/v2/ops/*` JSON API. It never calls
  Prometheus, Grafana, Loki, or Postgres directly.
- Responses should be `Cache-Control: no-store`.

Audit:

- Access to the dashboard should be audited as operational metadata:
  `actor_user_id`, `facility_id` if applicable, `action`, `window`, endpoint,
  outcome, and timestamp.
- Audit metadata must not include query text, raw URLs, patient identifiers, or
  request/response bodies.

PHI and operational safety:

- No PHI, MRN, patient names, raw SQL, request bodies, raw PromQL, or log search
  appears in request params, API responses, UI state, browser storage, or URLs.
- Route labels must come from matched route patterns or the existing RUM route
  scrubber. Raw paths from the browser are not displayable.
- Unknown or unsafe labels collapse to `_unknown` or `:id`.
- Any row that cannot be rendered safely must be dropped or summarized as
  `unsafe_label_dropped`.

## Backend Implementation Handoff

Recommended Rust V2 Module shape:

- `routes/ops.rs`: mount `/api/v2/ops/*` only.
- `handlers/ops.rs`: extract `RequestContext`, parse enum query params, call
  the service Interface, map DTOs into OpenAPI responses.
- `services/ops_dashboard/`: own the dashboard workflow Interface and budget
  rules.
- `hms-db`: add a repository module only if `pg_stat_statements` or stored
  aggregate baselines are used.
- `hms-access`: add/seed the explicit ops permission and policy tests.
- `hms-observability`: keep metric label sanitization and histogram math local.

Service Interface should hide the Prometheus and optional Postgres Adapters from
handlers. Handlers should not contain Prometheus queries, SQL, budget math, or
label-sanitization logic.

## Frontend Implementation Handoff

The frontend should build a custom HMS ops experience, not embed Grafana:

- Status and version strip.
- Clinical budget cards.
- Route latency table.
- DB pool pressure panel.
- Request-context cache panel.
- Payload budget panel.
- RUM/browser panel.
- Slow query fingerprint table with no SQL text.
- A private Grafana fallback link or runbook hint only; no public iframe.

Do not add a PromQL editor, SQL editor, raw log search, request replay, response
body preview, patient drill-down, or free-form route search in v1.

## Acceptance Criteria

The v1 implementation is accepted only when:

- Ops UI is reachable at `ops.<client-domain>` and
  `ops.staging.thehms.systems`, and not exposed as a normal hospital dashboard.
- Non-ops users receive 403 from every `/api/v2/ops/*` endpoint.
- Platform admin/operator users can load the dashboard without direct access to
  Prometheus, Grafana, Loki, or Postgres.
- API responses contain only safe labels and aggregate values from this
  contract.
- Slow query data contains fingerprints and aggregate timings only, with no SQL
  text or parameters.
- Logs are not searchable or displayed in v1, except safe aggregate service
  error counts when already available.
- OpenAPI documents all `/api/v2/ops/*` DTOs and query enums.
- Contract tests prove auth, permission denial, DTO shape, label safety, and no
  forbidden fields.
- Existing Rust V2 metrics and RUM ingestion continue to pass their PHI-safety
  tests.
- No backend, frontend, or ops config work introduces public access to
  `/api/v2/metrics`, Grafana, Loki, exporter ports, or Postgres.

## Verification Checklist

Backend:

- Run Rust format and tests from `backend-rs/`.
- Add focused `hms-access` tests for `ops.dashboard.view`.
- Add `hms-api` contract tests for every endpoint:
  unauthenticated, authenticated without permission, platform operator success,
  query enum validation, and forbidden query param rejection.
- Add DTO tests or PHI-safe text assertions proving responses do not contain
  raw SQL, request bodies, raw URLs, raw PromQL, log lines, MRNs, or patient
  names.
- If `pg_stat_statements` is used, test the repository projection does not
  select or serialize SQL text.

Frontend:

- Run lint/build and targeted tests for the ops feature.
- Verify network calls go only to `/api/v2/ops/*`.
- Verify the UI has no PromQL, SQL, or log search input.
- Verify tables render route templates and `:id`, not raw URLs.
- Verify no dashboard data is persisted to localStorage/sessionStorage.

Ops:

- Verify ops subdomain routing separately from the normal client domain.
- Verify public `/api/v2/metrics` remains blocked on the client domain.
- Verify Grafana is reachable only through the private path.
- Verify `pg_stat_statements` is optional: dashboard still renders a safe
  unavailable state when the extension is absent.

Manual safety review:

- Inspect one representative `/api/v2/ops/summary` response.
- Confirm it contains no MRN-like tokens, patient names, SQL fragments, raw
  PromQL, log lines, query strings, or request/response bodies.
- Confirm all route paths are route templates, not concrete patient or object
  URLs.
