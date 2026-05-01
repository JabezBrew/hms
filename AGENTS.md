# HMS Agent Guidelines (Security, Scale, Performance)

Build a highly performant, scalable, and secure hospital management system.
Treat PHI as toxic waste and p99 latency as a safety issue. When in doubt,
favor correctness, least privilege, and predictable performance.

## Source of Truth
- Read `claude.md` and this `agents.md` before making changes. It consolidates current
  security, systems, and DB reliability findings.

## Project Structure
- Backend: `backend/` with domain apps under `backend/apps/`.
- Shared backend settings: `backend/hms_backend/`.
- Workflows and dashboards: `backend/workflows/`, `backend/dashboards/`.
- Frontend: `frontend/src/` with built assets in `frontend/public/`.

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
- `cd backend && python manage.py runserver` starts the Django API.
- `cd backend && pytest` runs backend tests (use `-k` or `apps.<app_name>` to scope).
- `cd backend && celery -A hms_backend worker --beat --loglevel=info` runs background tasks.
- `cd frontend && npm run dev` serves the React app; `npm run build` and `npm run lint` validate.

## Coding Style
- Python: PEP 8, 4-space indentation, business logic stays inside the owning app.
- React: PascalCase components, `use*` hooks, camelCase utilities.
- Keep Celery tasks small and pure. Prefer Tailwind utilities over inline styles.

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
  at the queryset and object level (use `apps/core/security.py`).
- Never log PHI. Avoid logging request bodies and free-text clinical data.
- Use least-privilege serializers: list endpoints should not return full objects.
- Treat FHIR calls as external and unsafe; never block request threads on FHIR.
- WebSocket subscriptions must enforce facility + patient/ward access before joining groups.
- Cache keys must include user scope when access varies by role or assignment.
- FHIR data exposed to clients must be projected to minimal safe fields.

## Performance Rules (p99 < 200ms for clinical views)
- List endpoints must be O(1) queries per page. No N+1s.
- Avoid `prefetch_related` on large child tables unless explicitly requested.
- Use `select_related` and `annotate` for counts/exists instead of per-row queries.
- Defer or exclude large JSON/BLOB fields in list endpoints.
- Keep external I/O (FHIR, PDFs, emails) async via Celery.
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

## Query Hygiene (Django ORM)
- Prefer `.select_related()` for FK joins and `.prefetch_related()` only when bounded.
- Use `.only()`/`.defer()` to avoid pulling large JSON blobs.
- Avoid per-row `.count()` or `.exists()` calls; annotate once in the queryset.

## API Payload Optimization (Mandatory)
- All list endpoints must use lightweight `*ListSerializer` (5-8 fields max).
- All `ModelViewSet` classes must set `pagination_class = StandardResultsSetPagination`.
- Import pagination from `apps.core.pagination.StandardResultsSetPagination`.
- Never nest full related objects in list serializers; flatten required fields instead.

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
- Backend tests live alongside modules (e.g., `backend/apps/users/tests.py`).
- Add tests for serializers, viewsets, Celery tasks, and access control.
- Always run tests after code changes; fix failures before moving on.
- Use scoped tests for bug fixes and full suite for refactors when feasible.
- Add query-count tests for hot endpoints to enforce O(1) query behavior.
- For migrations, include data backfill checks and index creation where needed.
- When adding FKs to models moved across apps, add explicit migration dependencies
  (e.g., `('encounters', '0001_initial')`) to avoid fresh-DB ordering failures.

## Commit and PR Notes
- Use Conventional Commits (`feat:`, `fix(scope):`, `Add ...`).
- PRs must note migrations, env var changes, and Celery schedule changes.
- Provide UI captures for visual changes.
- Do not credit yourself in commit messages.

## Security and Configuration Notes
- Never commit secrets. Use `backend/.env.example` and `frontend/.env.example`.
- Ignore `backend/credentials/` contents.
- Ensure Redis is available before launching Celery.
- Document new dependencies or IAM needs in `docs/`.

## Deployment Notes
- HMS is no longer deployed on Railway. Do not use Railway CLI for HMS deploy,
  log, or production-debug workflows unless explicitly asked to investigate a
  legacy Railway artifact.
- HMS deploys one client per Hetzner VPS with Docker Compose. Use the runbook in
  `ops/hetzner-client-vps/README.md`.
- The reusable client Compose profile is `ops/hetzner-client-vps/compose.yml`.
- Generate private client env files with `ops/create-client-deployment.py`.
- Deploy updates from `/opt/hms` on the VPS with:
  `ops/hetzner-client-vps/deploy.sh`.
- Legacy managed-hosting config files have been removed. Do not reintroduce
  provider-specific service config unless the deployment target changes again.

## Design System (Frontend)
- Use Chronicle design system (/Users/jebre/Desktop/hms/frontend/CHRONICLE_DESIGN_SYSTEM.md) patterns and components when building clinical UIs.
- Fonts: Fraunces (display), DM Sans (headings), IBM Plex Mono (data).
- Visual language: editorial medical journal aesthetic; avoid generic dashboards.

## Running tests
- Backend tests: Activate virtual environment and run `pytest`. This is how to activate the virtual environment in the backend directory:
- Ensure Postgres is running and accessible on the configured host/port before running tests.

```bash
source .venv/bin/activate
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
