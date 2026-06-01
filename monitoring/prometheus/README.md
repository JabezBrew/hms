# monitoring/prometheus

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Prometheus scrape configuration, alert rules, and client target files.

## Directory Map

| Path | Owns |
| --- | --- |
| `*.yml` | Prometheus scrape and alert configuration. |
| `rules/` | alerting and recording rules when present. |
| `client-targets/` | ops-VPS target files for client telemetry over private networks. |

## Invariants

- Scrapes should use private service names or private network IPs.
- Metric labels must remain PHI-safe.
- Client target files should not contain secrets.
