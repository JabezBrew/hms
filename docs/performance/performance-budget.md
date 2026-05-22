# HMS Rust V2 Performance Budget

Status: frozen Agent 0 contract for the Rust V2 performance wave.

Scope: shared metric names, event names, labels, and budgets for Rust V2
backend and frontend performance work. This document does not implement
dashboard, Chronicle, auth, frontend, or worker optimizations.

## Label Contract

All new performance metrics and browser events MUST use only these safe labels:

| Label | Allowed values |
| --- | --- |
| `route_pattern` | Static route templates only, for example `/api/v2/patients/:id/chronicle`, `/dashboards/nurse`, or `_none`. Never raw URLs. |
| `status_bucket` | `2xx`, `3xx`, `4xx`, `5xx`, `network`, `timeout`, `cancelled`, or `unknown`. |
| `facility_safe` | Safe facility code such as `MAIN`, or `_unknown` when unavailable. No facility names. |

Do not add labels for patient IDs, MRNs, names, encounter IDs, invoice IDs,
note text, clinical text, user IDs, email addresses, raw status codes, query
strings, SQL text, request bodies, or free-form error messages.

Current Rust V2 compatibility metrics still expose some historical labels such
as `method`, `route`, `status`, and stable `query` names. New work should keep
those names working for the existing regression harness, but new budget metrics
and new browser events must follow the three-label contract above.

## Frozen Metrics And Events

These names are the shared contract for downstream agents. If a metric is not
implemented yet, the owning agent must implement this exact name instead of
inventing a local variant.

| Surface | Metric or event name | Type | Required labels | Budget |
| --- | --- | --- | --- | --- |
| App shell load | `hms_browser_app_shell_load_seconds` | histogram | `route_pattern`, `status_bucket`, `facility_safe` | p95 <= 1.5s, p99 <= 2.5s |
| App shell ready event | `app_shell:ready` | browser event | `route_pattern`, `status_bucket`, `facility_safe` | Event value is milliseconds to first usable non-PHI shell. |
| Dashboard read | `hms_dashboard_read_seconds` | histogram | `route_pattern`, `status_bucket`, `facility_safe` | p95 <= 150ms, p99 <= 250ms |
| Dashboard first useful view | `dashboard:first_useful_view` | browser event | `route_pattern`, `status_bucket`, `facility_safe` | p95 <= 500ms, p99 <= 900ms after authenticated navigation starts |
| Chronicle read | `hms_chronicle_read_seconds` | histogram | `route_pattern`, `status_bucket`, `facility_safe` | p95 <= 200ms, p99 <= 300ms |
| Chronicle first useful view | `chronicle:first_useful_view` | browser event | `route_pattern`, `status_bucket`, `facility_safe` | p95 <= 700ms, p99 <= 1.2s after route navigation starts |
| Ward board read | `hms_ward_board_read_seconds` | histogram | `route_pattern`, `status_bucket`, `facility_safe` | p95 <= 150ms, p99 <= 250ms |
| Ward board update latency | `hms_ward_board_update_latency_seconds` | histogram | `route_pattern`, `status_bucket`, `facility_safe` | p95 <= 250ms, p99 <= 500ms from accepted write to visible board update |
| API payload size | `hms_api_response_payload_bytes` | histogram | `route_pattern`, `status_bucket`, `facility_safe` | Hot list p95 <= 75 KiB, p99 <= 150 KiB; Chronicle initial p95 <= 150 KiB, p99 <= 300 KiB |
| DB pool wait | `hms_db_pool_wait_seconds` | histogram | `route_pattern`, `status_bucket`, `facility_safe` | p95 <= 5ms, p99 <= 25ms; p99 > 50ms fails clinical hot paths |
| Slow SQL duration | `hms_db_query_duration_seconds` | histogram | `route_pattern`, `status_bucket`, `facility_safe` | Hot path p95 <= 25ms, p99 <= 100ms; any query over 250ms is slow, over 1s is critical |
| Slow SQL count | `hms_db_slow_query_total` | counter | `route_pattern`, `status_bucket`, `facility_safe` | Zero critical slow queries during baseline and regression runs |

## Existing Harness Names

The maintained k6 script `tests/load/k6-rust-v2-realistic.js` already emits
these aggregate custom trends. Downstream agents must preserve them until the
new budget metrics above are implemented and the reporter has been updated:

| k6 trend | Surface |
| --- | --- |
| `hms_auth_me` | `GET /api/v2/auth/me` |
| `hms_patient_list` | `GET /api/v2/patients` |
| `hms_patient_chronicle` | `GET /api/v2/patients/:id/chronicle` |
| `hms_search` | `POST /api/v2/search/omni` |
| `hms_ward_board` | `GET /api/v2/wards/board` |
| `hms_dashboard_snapshot` | `GET /api/v2/dashboards/snapshot` |
| `hms_laboratory` | Laboratory read group |
| `hms_inventory` | Inventory and pharmacy read group |
| `hms_billing` | Billing and NHIS read group |
| `hms_clinical_write` | Synthetic clinical writes when explicitly enabled |
| `hms_operational_write` | Synthetic operational writes when explicitly enabled |

The current Rust V2 Prometheus endpoint exports these compatibility metrics:

| Metric | Use |
| --- | --- |
| `hms_api_http_requests_total` | Route request counters |
| `hms_api_http_request_duration_seconds` | Route latency histogram |
| `hms_api_http_db_query_count_sum` | Route query-count budget source |
| `hms_db_query_duration_seconds` | Stable query-name duration histogram |
| `hms_api_postgres_pool_size` / `hms_api_postgres_pool_idle` | Main pool snapshot |
| `hms_api_auth_postgres_pool_size` / `hms_api_auth_postgres_pool_idle` | Auth pool snapshot |
| `hms_browser_rum_events_total` | Accepted browser RUM event count |
| `hms_browser_rum_duration_seconds` | Current browser RUM duration histogram |

## Regression Status Rules

Use the maintained reporter semantics:

| Status | Meaning |
| --- | --- |
| `pass` | All required metrics are present and within absolute budgets and drift tolerances. |
| `warn` | Required data is present, but a surface is above the warning drift threshold or an interim guardrail is noisy. |
| `fail` | Checks, errors, p99 budgets, DB query budgets, pool pressure, payload budgets, or slow SQL budgets exceeded hard limits. |
| `incomplete` | Required metrics are missing. This is not an optimization acceptance result. |

Default drift rules remain: warn when p99 is more than 1.2x the committed
baseline, fail when p99 is more than 1.5x the committed baseline. Absolute
route budgets always fail, even when drift is acceptable.

## Acceptance Rules

- A performance optimization is not accepted without a before/after aggregate
  report from the maintained Rust V2 harness or an explicitly documented
  blocker.
- Reports must include route p95/p99, error/check status, DB query visibility,
  pool visibility, and payload visibility.
- Raw k6 exports, response bodies, and Prometheus snapshots must not be
  committed when they contain target-environment fixture IDs or operational
  internals. Commit only PHI-safe aggregate artifacts.
- Browser events must be route-template based and must not include patient
  identifiers in URLs, event names, labels, or payloads.
