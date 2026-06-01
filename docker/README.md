# docker

Status: legacy deployment reference
Owner: Operations
Last reviewed: 2026-06-01
Scope: historical Docker assets outside the active Rust V2 Compose kit.

## Role

This directory contains older Docker assets for the Django-era stack:

- `Dockerfile.backend`
- `Dockerfile.celery`
- `Dockerfile.daphne`
- `Dockerfile.frontend`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `entrypoint.sh`
- `init-db.sql`
- `nginx.conf`
- Postgres primary/replica config under `postgres/`

Active Rust V2 deployments should use `ops/gcp-staging/` for current staging and
`ops/hetzner-v2/` for the reusable Rust V2 Compose kit.

## Invariants

- Do not use this directory for new Rust V2 deploy work unless explicitly asked.
- Keep secrets out of Dockerfiles and compose files.
- Treat this as legacy reference when comparing old deployment behavior.
