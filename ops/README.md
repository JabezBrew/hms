# HMS Operations

Status: active
Owner: Operations
Last reviewed: 2026-10-15
Scope: deployment, rollback, and operations tooling under `ops/`.

## Current Role

The Oracle/Cloudflare synthetic testing deployment is verified at
`staging.thehms.systems`; see `free-testing/README.md` for dated release evidence.
`free-testing/` is the $0 hosting path for one tester using synthetic data.
GCP documents the earlier
staging and performance-validation path. `compose-v2/` is the reusable Rust V2
single-VM Compose kit used by both the free-testing profile and client VPS
shapes. Hetzner remains an environment rollback option; the older Hetzner
client VPS kit is legacy Django deployment material.

## Map

| Path | Role |
| --- | --- |
| `free-testing/README.md` | Oracle Always Free or existing-computer synthetic solo-testing runbook; Cloudflare Tunnel/Access domain setup. |
| `../deploy` / `deploy.sh` | GCP staging deploy and edge-verification front door. |
| `gcp-staging/README.md` | earlier GCP staging/perf-lab topology, dated smoke evidence, rollback anchors, cost guardrails. |
| `compose-v2/` | reusable Rust V2 single-VM Docker Compose deployment kit and rollback reference. |
| `hetzner-v2/` | deprecated compatibility shims that forward to `compose-v2/`. |
| `hetzner-client-vps/` | legacy Django deployment kit; do not use for new Rust V2 deploys. |
| `create-client-deployment.py` | client deployment generator/helper. |
| `tests/` | Python tests for deployment scripts, Caddy routes, tracing config, monitoring config. |

## Rust V2 Compose Kit

For free solo testing, follow [`free-testing/README.md`](free-testing/README.md)
and use `ops/free-testing/deploy.sh`. It merges the base kit with a loopback
HTTP origin and a Cloudflare Tunnel connector. This route does not use the GCP
front door or Cloud SQL override.

For the retained GCP staging path, use the root front door:

```bash
./deploy staging
```

Use `./deploy --in-place` only when already SSH'd into `/opt/hms` on the VM, and
`./deploy verify` for a quick GCP edge check. `./deploy staging` refuses dirty
working trees by default; use `./deploy staging --ignore-dirty` only when the
intended release is the committed `HEAD` snapshot and local changes should be
ignored. The override still refuses dirty deploy control scripts. The
lower-level scripts remain available for incident debugging and reusable client
VPS shapes.

`compose-v2/` contains:

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
