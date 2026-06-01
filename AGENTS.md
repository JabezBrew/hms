# HMS Agent Guidelines (Security, Scale, Performance)

Build a highly performant, scalable, and secure hospital management system.
Treat PHI as toxic waste and p99 latency as a safety issue. When in doubt,
favor correctness, least privilege, and predictable performance.

## Source of Truth
- Read `claude.md` and this `agents.md` before making changes. It consolidates current
  security, systems, and DB reliability findings.

## Architecture Mode
- The active HMS backend is Rust V2 under `backend-rs/`. Treat `backend-rs/`
  and `docs/v2/rust-v2-backend-spec.md` as the backend source of truth.
- The old Django/DRF/Celery backend under `backend/` is legacy reference code.
  Use it only when the task explicitly asks for legacy Django maintenance,
  parity research, or comparison against old behavior.
- When any Django-specific guidance conflicts with Rust V2 guidance, the Rust
  V2 spec wins for active backend work.
- Shared non-negotiables remain mandatory: PHI safety, least privilege, patient
  access enforcement, facility scoping, p99 performance, bounded/cursor lists,
  scoped cache keys, no PHI logs, no unbounded clinical lists, and no external
  I/O inside open DB transactions.
- Translate legacy concepts into Rust equivalents during active work:
  `apps/core/security.py` becomes `hms-access`, DRF serializers become explicit
  DTOs, Django ORM query hygiene becomes SQL/query-plan hygiene, Celery tasks
  become `hms-worker` jobs, and Django migrations become `hms-migrator`
  migrations and seed/provisioning commands.

## Project Structure
- Active backend: `backend-rs/` with crates under `backend-rs/crates/`.
- Active backend API: `backend-rs/crates/hms-api/`.
- Active backend persistence: `backend-rs/crates/hms-db/` and
  `backend-rs/migrations/`.
- Active worker/migrator: `backend-rs/crates/hms-worker/` and
  `backend-rs/crates/hms-migrator/`.
- Legacy Django backend: `backend/` for explicit legacy work only.
- Frontend: `frontend/src/` with built assets in `frontend/public/`.

## Rust V2 Architecture Rules
- Use deep module design for Rust V2 work. A module should expose a small
  Interface, hide meaningful implementation detail, and own a product invariant.
  Splitting files is a consequence of Depth, not the objective.
- Current request flow: `routes/*` mount URLs, `handlers/*` translate HTTP and
  OpenAPI shapes, `services/*` orchestrate workflows, `hms-access` authorizes,
  `hms-db` persists, and `hms-domain` owns typed product language.
- `AppState` is a runtime Adapter/facade for configuration, pools, auth/session
  helpers, deployment capabilities, and service factories. Do not put workflow
  implementation in `state.rs`.
- New complex workflows should add or extend a `services/<domain>/...` module
  with a small public Interface, and add matching `hms-db` repository modules
  when persistence is non-trivial. Avoid shallow pass-through modules.
- Reuse `hms-access::RequestContext` for facility, session, profile,
  permission, feature, patient-visibility, offsite, and reauth facts. Do not
  recreate handler-local access checks.
- Reuse `hms-api/src/cursor_list.rs` for bounded cursor-list parsing and
  response shape. Do not add local pagination helpers without a specific reason.
- Tests should cross the same Interface production callers use. Prefer contract,
  repository, and access tests that prove the invariant at the module Seam.
- For architecture planning, use the `improve-codebase-architecture` vocabulary:
  Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, and
  Locality.

## Frontend Modularization Rules
- Feature code lives in `frontend/src/features/<domain>/` with `api/`, `hooks/`, `components/`, `pages/`, `routes.js`, `index.js` exports.
- `frontend/src/pages/*` are thin route wrappers that import feature pages; do not put logic there.
- Shared cross-cutting primitives live in `frontend/src/shared/` (components, hooks, constants, utils).
- Routes are defined in `frontend/src/app/routes/*` with `roles`, `layout`, `title`, `breadcrumbs` and rendered via `renderRoutes`.
- Use `PageShell`, `PageHeader`, and `PageState` for page structure and loading/error/empty states.
- Use `usePageMeta` for titles and breadcrumbs when values are static or derived in-page.
- Prefer feature/shared API modules over `frontend/src/lib/api.js`; treat `lib/api.js` as legacy compatibility only.
- Centralize React Query keys with `shared/lib/queryKeys.js` helpers and feature key exports. Avoid ad-hoc `queryKey: ['...']`.

## Build, Test, and Development Commands
- `docker compose up -d postgres redis` starts local backend dependencies.
- `cd backend-rs && cargo run -p hms-api` starts the Rust API.
- `cd backend-rs && cargo test --workspace` runs active backend tests.
- `cd backend-rs && cargo fmt --all --check` validates Rust formatting.
- `cd backend-rs && cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json` regenerates the Rust OpenAPI document.
- `cd frontend && npm run dev` serves the React app; `npm run build` and `npm run lint` validate.

## Coding Style
- Rust: keep handlers thin; domain decisions live in `hms-domain`, persistence
  in `hms-db`, access decisions in `hms-access`, and auth/session concerns in
  `hms-auth`.
- React: PascalCase components, `use*` hooks, camelCase utilities.
- Keep `hms-worker` jobs small and pure. Prefer Tailwind utilities over inline styles.

## Workflow-Oriented Product Rules
- Prioritize workflow-centric UX over data-centric CRUD: guide users step-by-step.
- Use progressive disclosure and guided flows with clear "what's next" cues.
- Prefer action-oriented cards and contextual quick actions over passive lists.
- Minimize navigation; aim to complete common clinical tasks in a single flow.
- Role-based personalization: doctor, nurse, receptionist views differ.

## Clinical Data Placement (Critical)
- All patient clinical data (vitals, notes, meds, labs, etc.) must be accessible only
  from `PatientChroniclePage`. Use slide-overs/panels inside that page.
- Do not create standalone clinical pages like `/nursing/fluid-balance/:patientId`.

## Security Rules (Non-Negotiable)
- Every endpoint that accepts a patient identifier MUST enforce access control
  before returning or mutating data (use `hms-access` and request context
  guards, not handler-local shortcuts).
- Never log PHI. Avoid logging request bodies and free-text clinical data.
- Use least-privilege DTOs: list endpoints should not return full objects.
- Treat FHIR calls as external and unsafe; never block request threads on FHIR.
- WebSocket subscriptions must enforce facility + patient/ward access before joining groups.
- Cache keys must include user scope when access varies by role or assignment.
- FHIR data exposed to clients must be projected to minimal safe fields.

## Performance Rules (p99 < 200ms for clinical views)
- List endpoints must be O(1) queries per page. No N+1s.
- Use SQL that proves bounded page size and avoids per-row follow-up queries.
- Select only the columns needed for list DTOs.
- Keep external I/O (FHIR, PDFs, emails) async via `hms-worker`.
- Never use `__date` or `DATE(column)` filters. Always use `[start, end)` ranges.
- Avoid `distinct()` on join filters for search; prefer `Exists` subqueries.
- For dashboards, use cached projections + async refresh with stale reads; no FHIR in request path.
- List endpoints should accept `include_data` or `expand` flags for large JSON payloads.

## Frontend Performance Budget
- Assume many deployments use modest client hardware; the default experience must stay fast without a special mode.
- Defer heavy widgets (charts, calendars), virtualize large lists, and avoid render-time side effects.
- Keep motion lightweight and honor reduced-motion preferences.

## Database Reliability Rules
- Avoid table scans: no `DATE(column)` filters; use range predicates.
- For `icontains`, add trigram or FTS indexes.
- Avoid low-cardinality single-column indexes. Prefer composite/partial indexes.
- Partition time-series tables (`audit_logs`, `vital_signs`, `chart_entries`,
  `lab_results`) by time to keep indexes small.
- Beware write amplification: every index is a tax on inserts.
- Use per-day sequence tables for order numbers; never scan with `Max()` on hot paths.

## Query Hygiene (Rust/sqlx)
- Keep repository queries in `hms-db`; handlers should not contain SQL.
- Use explicit projections for list DTOs instead of selecting whole rows.
- Use `EXISTS`, joins, or precomputed projections instead of per-row count/existence checks.
- Keep cursor pagination deterministic with stable sort keys and bounded limits.

## API Payload Optimization (Mandatory)
- All list endpoints must use lightweight DTOs (5-8 fields max unless the
  contract explicitly justifies more).
- All hot lists must be cursor-paginated and bounded server-side.
- Never nest full related objects in list responses; flatten required fields instead.

## Interactive List Fetching (Mandatory)
- Route-level list pages must not use `apiClient.getAll()` against paginated endpoints. Use server-side pagination via `getWithPagination()` and explicit pagination UI.
- Search, filter, and tab state for paginated lists must be pushed to the backend query params; do not fetch the full dataset just to filter client-side.
- TanStack Query `signal` must be threaded through every API helper involved in list fetching, and shared API wrappers must preserve `AbortError` instead of converting it into a generic error.
- When a user navigates away, in-flight paginated fetch chains must stop immediately. Continuing to walk backend pages after unmount is a production bug, not acceptable background behavior.

## Caching and Real-Time
- Cache read-heavy list endpoints with short TTLs and invalidate on writes.
- Use WebSockets for real-time updates; polling is only a fallback.
- For heavy lists, debounce search inputs and virtualize client-side lists >100 items.
- Use lock-based single-flight to prevent cache stampedes; do not block request threads waiting on FHIR.

## Concurrency and Transactions
- Never keep a DB transaction open while waiting on network calls.
- Use optimistic flow: save locally, queue async work, update status later.
- Avoid read-modify-write patterns that require table scans (use sequences/counters).

## Testing and Migrations
- Backend tests live under the relevant Rust crate (`backend-rs/crates/*/tests`
  or focused `#[cfg(test)]` modules).
- Add tests for DTO contracts, handlers, repository scope, worker jobs, and
  `hms-access` decisions.
- Always run tests after code changes; fix failures before moving on.
- Use scoped tests for bug fixes and full suite for refactors when feasible.
- Add query-count tests for hot endpoints to enforce O(1) query behavior.
- For migrations, include fresh-database/provisioning checks and index creation
  where needed.

## Commit and PR Notes
- Use Conventional Commits (`feat:`, `fix(scope):`, `Add ...`).
- PRs must note migrations, env var changes, worker/job schedule changes, and
  OpenAPI/generated-client changes.
- Provide UI captures for visual changes.
- Do not credit yourself in commit messages.

## Security and Configuration Notes
- Never commit secrets. Use `ops/compose-v2/env.example` and `frontend/.env.example`.
- Ignore legacy `backend/credentials/` contents.
- Ensure Redis is available before launching `hms-api` or `hms-worker`.
- Document new dependencies or IAM needs in `docs/`.

## Deployment Notes
- Current staging is GCP, not Hetzner. Use `ops/gcp-staging/README.md` as the
  source of truth for `staging.thehms.systems`.
- Current GCP staging uses the GCP global HTTPS Load Balancer and Cloud SQL
  PostgreSQL over private IP. Do not infer the live staging database path from
  `ops/compose-v2/compose.yml` alone; that file is also the reusable
  single-VM/rollback Compose baseline with Docker Postgres and PgBouncer.
- For current GCP staging deploys, use
  `ops/gcp-staging/deploy.sh`, which combines the reusable Compose baseline
  with `ops/gcp-staging/compose.cloudsql.yml`.
- To verify the live GCP staging database path, inspect only the redacted
  `HMS_DATABASE_URL` host/port inside `hms-api` and `hms-worker`; never print
  credentials, DB names, dumps, request bodies, raw PHI URLs, MRNs, or patient
  identifiers.
- HMS single-VM/rollback deploys one client per VPS with Docker Compose. The
  active Rust V2 Compose runbook is `ops/compose-v2/README.md`.
- For HMS Hetzner VPS access from this laptop, prefer `ssh hms-staging` when the
  staging hostname is DNS-only. If `staging.thehms.systems` is proxied through
  Cloudflare, SSH must bypass the hostname and use the Hetzner origin directly:
  `ssh -F /dev/null -i /Users/jebre/.ssh/hms_staging deploy@157.180.81.144`.
- Use `ssh hms-staging-root` only when root access is explicitly needed.
- On the VPS, HMS lives at `/opt/hms`. Normal Docker Compose operations should
  run as `deploy` from `/opt/hms` and do not require `sudo`.
- Do not store deployment passwords in repo files, Codex memory, or shell history;
  use the SSH alias and local keychain/agent setup instead.
- The reusable Rust V2 Compose profile is `ops/compose-v2/compose.yml`.
- Create private client env files from `ops/compose-v2/env.example`.
- Deploy updates from `/opt/hms` on the VPS with:
  `ops/compose-v2/deploy.sh`.
- `ops/hetzner-client-vps/` is the legacy Django deployment kit. Do not use it
  for new Rust V2 deploys.

## Design System (Frontend)
- Use Chronicle design system (/Users/jebre/Desktop/hms/frontend/CHRONICLE_DESIGN_SYSTEM.md) patterns and components when building clinical UIs.
- Fonts: Fraunces (display), DM Sans (headings), IBM Plex Mono (data).
- Visual language: editorial medical journal aesthetic; avoid generic dashboards.

## Running tests
- Active backend tests use Rust cargo suites under `backend-rs/`.
- The default backend test run is:

```bash
cd backend-rs
cargo fmt --all --check
cargo test --workspace
```

- Focus high-risk suites before cutover:

```bash
cargo test -p hms-access
cargo test -p hms-db admission -- --nocapture
cargo test -p hms-db inventory -- --nocapture
cargo test -p hms-db billing -- --nocapture
cargo test -p hms-db laboratory -- --nocapture
cargo test -p hms-api --test auth_contract --test patients_contract --test ward_contract
```

- Rust DB tests use `HMS_TEST_DATABASE_URL` when supplied. Without it, tests try
  to create an isolated local Postgres database first, then use a temporary
  local Postgres cluster if the binaries are available.
- Legacy Django tests are only for explicit legacy backend tasks:

```bash
cd backend
source .venv/bin/activate
pytest -n auto
```

## Debugging
- When it comes to debugging, never stipulate what the cause "could be". Always investigate the codebase for the actual cause and provide a solution. The solution should be robust and not some quick patch.

# Agent Behaviour Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
