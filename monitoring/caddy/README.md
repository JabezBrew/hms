# monitoring/caddy

Status: active for Rust V2 telemetry profiles
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: private metrics proxy configuration.

## File Map

| File | Owns |
| --- | --- |
| `metrics-proxy.Caddyfile` | private proxy on `:9188` for `/api/metrics/` and `/worker/metrics`. |

## Invariants

- Proxy only metrics paths needed by Prometheus.
- Do not expose metrics ports on the public interface.
- Upstream API metrics path is `hms-api:8080/api/v2/metrics`.
- Upstream worker metrics path is `hms-worker:8081/metrics`.
