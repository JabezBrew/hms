# .github

Status: active
Owner: Engineering
Last reviewed: 2026-06-01
Scope: GitHub workflow configuration.

## Workflows

| Workflow | Trigger | Role |
| --- | --- | --- |
| `ci.yml` | pushes and pull requests to `main`/`develop`, manual dispatch, nightly `03:00 UTC` cron | main Rust V2/backend/frontend validation. |
| `backend-codeql.yml` | security workflow triggers | backend CodeQL security analysis. |
| `frontend-codeql.yml` | security workflow triggers | frontend CodeQL security analysis. |
| `backend-dependency-review.yml` | dependency-review triggers | backend dependency review. |
| `frontend-dependency-review.yml` | dependency-review triggers | frontend dependency review. |
| `legacy-django.yml` | legacy workflow triggers | legacy Django checks only. |

## `ci.yml` Job Map

| Job | Checks |
| --- | --- |
| `rust-backend-tests` | starts Postgres 16 and Redis 7, runs `cargo fmt --all --check`, then `cargo test --workspace` in `backend-rs/`. |
| `frontend-tests` | runs `npm ci`, lint, Rust V2 API client generation check, unit tests with coverage, build, bundle budget, and coverage/artifact upload. |
| `docker-builds` | builds `backend-rs/Dockerfile` and `frontend/Dockerfile` with Rust V2 API build args. |
| `build-and-deploy` | runs only on push to `main` after the validation jobs; builds release backend/frontend and currently contains a placeholder deploy step. Real GCP deploy behavior lives in `ops/gcp-staging/`. |

## Invariants

- Active backend checks should target Rust V2 unless explicitly legacy.
- Secrets must not be committed into workflow files.
- Dependency/security workflows should stay scoped to HMS unless intentionally
  broadened.
- A workflow named deploy is not proof of a real deploy unless it calls the
  current environment runbook and records health evidence.
