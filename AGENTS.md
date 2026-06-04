# HMS Agent Guidelines

This is the single canonical agent instruction file for HMS.

Build HMS as a secure, performant hospital management system. Treat PHI as
toxic waste and p99 latency as a clinical safety concern.

## Start Here

Before changing the repo, read these in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `docs/README.md`
4. The README for the area you will touch
5. `docs/contracts/README.md` when changing APIs, access, realtime, persistence,
   frontend adapters, performance, migrations, or deploy behavior

Use `frontend/CHRONICLE_DESIGN_SYSTEM.md` for clinical UI work.
Use `docs/v2/rust-v2-backend-spec.md` for active backend architecture.
Use `ops/gcp-staging/README.md` for current staging/deploy behavior.

## Work Rules

- Do not edit code unless the user asks for an implementation, fix, or document
  change. If the user is asking a question, answer from inspected context.
- When implementing, choose the robust, secure, performant solution. Do not add
  speculative features.
- Keep changes surgical. Do not refactor unrelated code.
- Do not revert user or unrelated work.
- Do not commit unless the user explicitly asks for a commit.
- After a feature or fix, run relevant tests. For high-risk changes, also run
  adversarial security/performance review where available.
- Never commit secrets, private env files, PHI, raw patient URLs, request
  bodies, credentials, tokens, or production dumps.

## Active Architecture

- Active backend: `backend-rs/`.
- Active backend API: `backend-rs/crates/hms-api/`.
- Active backend persistence: `backend-rs/crates/hms-db/` and
  `backend-rs/migrations/`.
- Active worker/migrator: `backend-rs/crates/hms-worker/` and
  `backend-rs/crates/hms-migrator/`.
- Active frontend: `frontend/`.
- Legacy Django backend: `backend/`, for explicit legacy maintenance, parity
  research, or historical comparison only.

When Django guidance conflicts with Rust V2 guidance, Rust V2 wins.

Translate legacy concepts during active work:

- `apps/core/security.py` -> `hms-access`
- DRF serializers -> explicit Rust DTOs
- Django ORM query hygiene -> SQL/query-plan hygiene
- Celery tasks -> `hms-worker` jobs
- Django migrations -> `hms-migrator` and `backend-rs/migrations/`

## Backend Rules

- Request flow is `routes/*` -> `handlers/*` -> `services/*` ->
  `hms-access` -> `hms-db`, with `hms-domain` owning typed product language.
- Keep routes as URL mounts only.
- Keep handlers thin: extract HTTP shape, call services, map responses.
- Put workflow orchestration in `services/*`.
- Keep SQL in `hms-db`, not handlers.
- `AppState` is a runtime adapter/facade, not a workflow module.
- Reuse `hms-access::RequestContext` for facility, session, profile,
  permission, feature, patient visibility, offsite, and reauth facts.
- Reuse `hms-api/src/cursor_list.rs` for bounded cursor-list behavior.
- Tests should cross the same interface production callers use.

## Frontend Rules

- Feature code belongs in `frontend/src/features/<domain>/`.
- `frontend/src/pages/*` is a compatibility area for thin wrappers and global
  denied/unavailable pages. Do not put product workflow logic there.
- Shared primitives belong in `frontend/src/shared/` or
  `frontend/src/components/ui/`.
- Routes live in `frontend/src/app/routes/*` and use `component`, `roles`,
  `layout`, `title`, `breadcrumbs`, and optional `sidebar`/`props`.
- Use `PageShell`, `PageHeader`, `PageState`, and `usePageMeta` for ordinary
  pages.
- Prefer feature/shared API modules over `frontend/src/lib/api.js`.
- Preserve `AbortSignal` and `AbortError` in list/search API helpers.
- Centralize React Query keys through shared query-key helpers and include
  sanitized authorization scope when visibility changes.

## Clinical Data Placement

Patient clinical data belongs in Patient Chronicle or panels launched from it.
Do not create standalone clinical patient-data pages such as
`/nursing/fluid-balance/:patientId`.

## Security Rules

- Every endpoint that accepts a patient identifier must enforce access before
  returning or mutating data.
- Never log PHI, request bodies, free-text clinical data, names, MRNs, accessions,
  raw patient URLs, tokens, or secrets.
- Use least-privilege DTOs. List endpoints should not return full objects.
- Cache/query keys must use opaque or sanitized scope values only. Never use
  MRNs, names, raw URLs, or free-text clinical identifiers.
- WebSocket subscriptions must authenticate, bind facility/profile scope, and
  authorize every channel join.
- FHIR/export/email/PDF/third-party work is unsafe external I/O. Do not block
  hot request paths on it and do not keep DB transactions open around it.

## Performance Rules

- Clinical hot paths target p99 under 200 ms unless the contract says otherwise.
- List endpoints must be bounded and O(1) queries per page.
- Select only columns needed for list DTOs.
- Avoid N+1 queries and per-row existence/count follow-ups.
- Use `[start, end)` timestamp ranges. Do not use `DATE(column)` filters.
- Prefer `EXISTS` or indexed search projections over `distinct()` on join-heavy
  search.
- Defer heavy frontend widgets, virtualize large lists, and avoid render-time
  side effects.

## Deployment And Ops

- Current staging/performance validation is GCP. Use `./deploy staging` or
  `ops/gcp-staging/README.md`.
- `ops/compose-v2/` is the reusable Rust V2 single-VM Compose kit for rollback
  and client VPS shapes.
- `ops/hetzner-v2/` is deprecated compatibility forwarding to `compose-v2/`.
- `ops/hetzner-client-vps/` is legacy Django deployment material.
- Verify real remote branch/commit, public `/api/v2/health/ready`, container
  state, and rollback anchors after deploys.
- When checking live config, inspect only redacted host/port facts. Never print
  credentials, DB names, dumps, request bodies, MRNs, or patient identifiers.

## Tests

Backend:

```bash
docker compose up -d postgres redis
cd backend-rs
cargo fmt --all --check
cargo test --workspace
cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json
```

Rust tests use the Docker Compose Postgres/Redis services by default. Keep
the local Docker database password in your private shell environment when
Postgres client tools require it; do not commit or print DB passwords. The
`hms-db` test support should create and drop isolated `hms_v2_test_*` databases
inside the Docker Postgres instance with `createdb`/`dropdb`. Do not rely on a
machine-local temporary Postgres cluster or Homebrew `initdb` path for HMS Rust
verification.

Focused backend suites:

```bash
cargo test -p hms-access
cargo test -p hms-db admission -- --nocapture
cargo test -p hms-db inventory -- --nocapture
cargo test -p hms-db billing -- --nocapture
cargo test -p hms-db laboratory -- --nocapture
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

Legacy Django tests only when explicitly working on legacy behavior:

```bash
cd backend
source .venv/bin/activate
pytest -n auto
```

## Debugging

Do not guess at causes. Inspect the code, logs, config, tests, and runtime state
needed to identify the actual cause, then provide a robust fix.
