# monitoring/grafana/provisioning

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Grafana provisioning config.

## Directory Map

| Path | Owns |
| --- | --- |
| `dashboards/dashboards.yml` | dashboard folder/provider registration. |
| `datasources/datasources.yml` | Prometheus, Loki, Tempo, and related datasource registration. |

## Invariants

- Provisioning should make a fresh monitoring stack useful without manual UI
  setup.
- Datasource URLs should target private Compose/WireGuard addresses.
- Do not commit datasource credentials.
