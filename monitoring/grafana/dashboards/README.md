# monitoring/grafana/dashboards

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Grafana dashboard JSON files.

## Dashboard Map

| File | Owns |
| --- | --- |
| `hms-operability.json` | service readiness, dependency readiness, worker health, and infrastructure health. |
| `hms-request-observability.json` | API request rate, errors, latency, and route-level signals. |
| `hms-rum-observability.json` | browser runtime/RUM ingestion and frontend experience signals. |

## Invariants

- Panels should use aggregate metrics and route templates.
- Do not add labels or queries that require patient names, MRNs, raw URLs, or
  clinical text.
