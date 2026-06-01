# ops/hetzner-v2/grafana

Status: rollback/reference for Rust V2 Compose deployments
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Hetzner V2 Grafana provisioning.

## File Map

| File | Owns |
| --- | --- |
| `provisioning/datasources/prometheus.yml` | Grafana datasource wiring for the Hetzner V2 Compose Prometheus service. |

## Invariants

- This path supports the Hetzner V2 rollback/reusable Compose profile.
- Current GCP staging behavior is controlled by the GCP runbook, not this
  provisioning file.
- Do not commit datasource credentials.
