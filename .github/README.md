# .github

Status: active
Owner: Engineering
Last reviewed: 2026-06-03
Scope: GitHub workflow configuration.

## Workflows

| Workflow | Trigger | Role |
| --- | --- | --- |
| `ci.yml` | pushes and pull requests to `main`/`develop`, manual dispatch | path-aware Rust V2/backend/frontend validation. |
| `backend-codeql.yml` | security workflow triggers | backend CodeQL security analysis. |
| `frontend-codeql.yml` | security workflow triggers | frontend CodeQL security analysis. |
| `backend-dependency-review.yml` | dependency-review triggers | backend dependency review. |
| `frontend-dependency-review.yml` | dependency-review triggers | frontend dependency review. |

## `ci.yml` Job Map

| Job | Checks |
| --- | --- |
| `changes` | classifies changed paths and chooses backend, frontend, and Docker gates; manual dispatches and workflow changes fail open to full CI. |
| `rust-backend-tests` | starts Postgres 16 and Redis 7, runs `cargo fmt --all --check`, then `cargo test --workspace` in `backend-rs/`. |
| `frontend-tests` | runs `npm ci`, lint, Rust V2 API client generation check, unit tests with coverage, build, bundle budget, and coverage/artifact upload. |
| `docker-builds` | builds `backend-rs/Dockerfile` and `frontend/Dockerfile` with Rust V2 API build args. |
| `ci-summary` | reports selected/skipped gates and fails if any selected gate failed. |

## `ci.yml` Path Policy

- Manual dispatches and workflow-file changes run full CI.
- Rust backend checks run for `backend-rs/**`, contract/OpenAPI paths, and
  workflow changes.
- Frontend checks run for `frontend/**`, contract/OpenAPI paths, and workflow
  changes.
- Docker builds run for Dockerfiles, lockfiles, `deploy`, `ops/deploy.sh`,
  `ops/gcp-staging/**`, `ops/compose-v2/**`, deprecated `ops/hetzner-v2/**`
  forwarding paths, workflow changes, full CI, and backend/frontend changes
  pushed to `main`.
- Docs-only changes skip heavy app CI unless they touch `docs/contracts/**`.
- Real GCP deploy behavior lives behind `./deploy staging` and
  `ops/gcp-staging/`; CI does not perform deployments.

## Invariants

- Active backend checks should target Rust V2 unless explicitly legacy.
- Secrets must not be committed into workflow files.
- Dependency/security workflows should stay scoped to HMS unless intentionally
  broadened.
- A workflow named deploy is not proof of a real deploy unless it calls the
  current environment runbook and records health evidence.
