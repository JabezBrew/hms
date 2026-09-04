# Contributing to HMS

Thanks for helping build HMS. This guide covers the minimum you need to
contribute safely to a clinical system.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
Be kind, be precise, assume clinical impact.

## Before you start

1. Read [`CONTEXT.md`](CONTEXT.md) (product language + safety invariants).
2. Read [`docs/README.md`](docs/README.md) (codebase map).
3. Read the README for the area you will touch (`backend-rs/`, `frontend/`,
   `ops/`, …).
4. Read [`docs/contracts/README.md`](docs/contracts/README.md) when changing
   APIs, access, realtime, persistence, frontend adapters, performance,
   migrations, or deploy behavior.

Active backend is `backend-rs/` (`/api/v2`). `backend/` is legacy Django
reference only — do not add new behavior there unless the issue explicitly
says legacy maintenance.

## Reporting issues

- Use the issue templates (bug report / feature request).
- Include: what you did, what you expected, what happened, version/commit,
  backend + frontend logs (redacted), and steps to reproduce.
- **Never include PHI, credentials, tokens, MRNs, names, accessions,
  request/response bodies, or production dumps.** Synthetic demo data only.

## Making changes

- Keep changes surgical. Do not refactor unrelated code.
- Follow the existing request flow:
  `routes/*` → `handlers/*` → `services/*` → `hms-access` → `hms-db`.
  Keep SQL in `hms-db`, handlers thin, orchestration in `services/*`.
- Frontend: feature code in `frontend/src/features/<domain>/`; shared
  primitives in `frontend/src/shared/` or `frontend/src/components/ui/`;
  routes in `frontend/src/app/routes/*`. Keep patient clinical data in the
  Patient Chronicle surface.
- Preserve `AbortSignal` / `AbortError` in list/search API helpers.
- Centralize React Query keys and include sanitized authorization scope.
- Use bounded cursor lists for hot endpoints; select only needed columns;
  avoid N+1 queries.
- Use `[start, end)` timestamp ranges, never `DATE(column)` filters.

### PHI rules (non-negotiable)

- No PHI in logs, metric labels, browser events, cache/query keys,
  screenshots, fixtures, or committed evidence.
- Every endpoint accepting a patient identifier must enforce patient access.
- List endpoints return least-privilege DTOs, not full objects.
- WebSocket channel joins must authenticate, bind facility/profile scope,
  and authorize every subscription.
- FHIR / export / email / PDF work is unsafe external I/O: never block hot
  request paths, never hold DB transactions open around it.

## Tests

Backend (from repo root, with Docker running):

```bash
docker compose up -d postgres redis
cd backend-rs
cargo fmt --all --check
cargo test --workspace
cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json
```

Focused suites:

```bash
cargo test -p hms-access
cargo test -p hms-db admission -- --nocapture
cargo test -p hms-api --test auth_contract --test patients_contract --test ward_contract
```

Frontend:

```bash
cd frontend
npm run lint
npm run test:run
npm run build
npm run api:v2:generate:check
```

Ops scripts:

```bash
pytest ops/tests
```

Regenerate the OpenAPI document and the frontend client after contract
changes, and commit the generated output.

## Commit messages & PRs

- Write imperative, scoped subjects: `feat(ward): bound board pagination`.
- Reference issues (`Fixes #123`).
- One logical change per PR. Include tests and docs updates.
- PR checklist: no secrets/PHI, contract + migration notes if applicable,
  screenshots for UI changes (demo data only), perf impact for hot paths.
- Do not commit: `.env`, credentials, tokens, private keys, dumps, coverage
  artifacts, local logs.

## Reviews

- Clinical safety and data-access correctness outrank style.
- Expect review on: access checks, DTO minimization, query plans, pagination
  bounds, realtime authorization, migration safety, rollback impact.

## License

By contributing you agree your contributions are licensed under the
[MIT License](LICENSE).
