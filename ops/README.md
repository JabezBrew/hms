# HMS Operations

Status: active
Owner: Operations
Last reviewed: 2026-06-01
Scope: deployment, rollback, and operations tooling under `ops/`.

## Current Role

GCP is the current staging and performance-validation path. Hetzner remains the
rollback and reusable Rust V2 Compose reference. The older Hetzner client VPS
kit is legacy Django deployment material.

## Map

| Path | Role |
| --- | --- |
| `gcp-staging/README.md` | current GCP staging/perf-lab state, smoke evidence, rollback anchors, cost guardrails. |
| `hetzner-v2/` | Rust V2 Docker Compose deployment kit and rollback reference. |
| `hetzner-client-vps/` | legacy Django deployment kit; do not use for new Rust V2 deploys. |
| `create-client-deployment.py` | client deployment generator/helper. |
| `tests/` | Python tests for deployment scripts, Caddy routes, tracing config, monitoring config. |

## Rust V2 Hetzner Kit

`hetzner-v2/` contains:

- `compose.yml`
- `Caddyfile`
- `deploy.sh`
- `backup-postgres.sh`
- `restore-postgres.sh`
- `env.example`
- `monitoring/prometheus.yml`

## Legacy Kit

`hetzner-client-vps/` contains the older Django deployment path:

- Caddy/Docker Compose files
- Django-oriented deploy/backup/restore scripts
- env example

Use it only for legacy reference.

## Invariants

- Never commit private env files or deployment secrets.
- Verify the actual remote branch/commit and health endpoint after deploys.
- Preserve rollback anchors before destructive restore/migration work.
- Public smoke reports must be PHI-safe.
- Ops and metrics endpoints must not be publicly exposed without access control.

## Tests

Run from repo root:

```bash
pytest ops/tests
```
