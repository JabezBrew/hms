# ops/hetzner-v2/monitoring

Status: rollback/reference for Rust V2 Compose deployments
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Hetzner V2 Prometheus configuration.

## File Map

| File | Owns |
| --- | --- |
| `prometheus.yml` | Prometheus scrape config for the Hetzner V2 Compose profile. |

## Invariants

- This path is for the Hetzner V2 rollback/reusable Compose profile, not the
  current GCP staging authority.
- Metrics must remain private and PHI-safe.
