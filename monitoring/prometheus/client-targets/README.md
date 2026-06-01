# monitoring/prometheus/client-targets

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Prometheus target files for client telemetry.

## File Pattern

| Pattern | Role |
| --- | --- |
| `*.example.yml` | example target files with placeholder private IPs. |
| `*.empty.targets.yml` | empty target files that keep Prometheus config valid before clients are added. |
| `*.targets.yml` | environment-specific target files created outside tracked examples. |

## Invariants

- Use private WireGuard or Compose addresses, not public service URLs.
- Do not commit secrets.
- Target labels must remain PHI-safe.
