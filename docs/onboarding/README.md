# HMS Engineering Onboarding

Status: active
Owner: Engineering
Last reviewed: 2026-06-01
Scope: first path through the HMS codebase for engineers and agents.

## Day 0 Reading

Follow the canonical start-here path from `docs/README.md`:

1. `CONTEXT.md`
2. `docs/README.md`
3. `docs/architecture/README.md`
4. `docs/contracts/README.md`
5. `docs/runbooks/README.md`
6. `docs/ownership/README.md`
7. `docs/onboarding/README.md`

Skim after that:

- `docs/v2/rust-v2-backend-spec.md`
- `docs/v2/v2-cutover-scope.md`
- `docs/performance/performance-budget.md`
- `ops/gcp-staging/README.md`
- `frontend/CHRONICLE_DESIGN_SYSTEM.md`

## Local Setup

Start dependencies:

```bash
docker compose up -d postgres redis
```

Backend validation:

```bash
cd backend-rs
cargo fmt --all --check
cargo test --workspace
```

Frontend validation:

```bash
cd frontend
npm install
cp .env.example .env
npm run lint
npm run test:run
npm run build
```

## First Codebase Tour

Backend:

- `backend-rs/crates/hms-api/src/routes/`
- `backend-rs/crates/hms-api/src/handlers/`
- `backend-rs/crates/hms-api/src/services/`
- `backend-rs/crates/hms-access/`
- `backend-rs/crates/hms-db/`
- `backend-rs/crates/hms-domain/`

Frontend:

- `frontend/src/app/routes/featureRoutes.js`
- `frontend/src/features/patients/`
- `frontend/src/features/dashboards/`
- `frontend/src/features/ward-board/`
- `frontend/src/shared/`
- `frontend/src/lib/api/v2/`

Operations:

- `ops/gcp-staging/README.md`
- `ops/compose-v2/README.md`
- `tests/load/scripts/run-rust-v2-regression.sh`

## First Safe Change

A good first change is one that crosses a real Interface without touching PHI:

- update a non-clinical DTO field with a contract test
- improve a feature route title or breadcrumb with route validation
- add a focused repository test for an existing bounded list
- improve a runbook with verified command output

Avoid first changes that touch:

- patient-access logic
- session/auth primitives
- billing finalization or voids
- controlled substances
- migrations without a fresh-database check
- public deploy configuration

## Review Expectations

Before asking for review, be ready to answer:

- What Module owns the invariant?
- Which Interface did you change?
- What test crosses the same Seam production callers use?
- How did you prove PHI is not exposed?
- How did you prove the hot path remains bounded?
- Does this require OpenAPI, generated client, migration, env, or runbook
  updates?

## Common Mistakes

- Adding backend logic to legacy Django by default.
- Putting SQL in an API handler.
- Filtering patient clinical data client-side after fetching too much.
- Creating standalone patient clinical pages outside Chronicle.
- Dropping `AbortSignal` through frontend API adapters.
- Treating public HTTPS latency as backend p99 before separating the path.
