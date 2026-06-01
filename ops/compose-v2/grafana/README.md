# ops/compose-v2/grafana

Status: rollback/reference for Rust V2 Compose deployments
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: single-VM Compose Grafana provisioning.

## File Map

| File | Owns |
| --- | --- |
| `provisioning/datasources/prometheus.yml` | Grafana datasource wiring for the Compose Prometheus service. |

## Invariants

- This path supports the single-VM rollback/reusable Compose profile.
- Current GCP staging behavior is controlled by the GCP runbook, not this
  provisioning file.
- Do not commit datasource credentials.
