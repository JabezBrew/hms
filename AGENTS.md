# HMS Agent Guidelines (Security, Scale, Performance)

Build a highly performant, scalable, and secure hospital management system.
Treat PHI as toxic waste and p99 latency as a safety issue. When in doubt,
favor correctness, least privilege, and predictable performance.

## Source of Truth
- Read `docs/ai-agent-review.md` before making changes. It consolidates current
  security, systems, and DB reliability findings.

## Project Structure
- Backend: `backend/` with domain apps under `backend/apps/`.
- Shared backend settings: `backend/hms_backend/`.
- Workflows and dashboards: `backend/workflows/`, `backend/dashboards/`.
- Frontend: `frontend/src/` with built assets in `frontend/public/`.

## Build, Test, and Development Commands
- `cd backend && python manage.py runserver` starts the Django API.
- `cd backend && pytest` runs backend tests (use `-k` or `apps.<app_name>` to scope).
- `cd backend && celery -A hms_backend worker --beat --loglevel=info` runs background tasks.
- `cd frontend && npm run dev` serves the React app; `npm run build` and `npm run lint` validate.

## Coding Style
- Python: PEP 8, 4-space indentation, business logic stays inside the owning app.
- React: PascalCase components, `use*` hooks, camelCase utilities.
- Keep Celery tasks small and pure. Prefer Tailwind utilities over inline styles.

## Security Rules (Non-Negotiable)
- Every endpoint that accepts a patient identifier MUST enforce access control
  at the queryset and object level (use `apps/core/security.py`).
- Never log PHI. Avoid logging request bodies and free-text clinical data.
- Use least-privilege serializers: list endpoints should not return full objects.
- Treat FHIR calls as external and unsafe; never block request threads on FHIR.

## Performance Rules (p99 < 200ms for clinical views)
- List endpoints must be O(1) queries per page. No N+1s.
- Avoid `prefetch_related` on large child tables unless explicitly requested.
- Use `select_related` and `annotate` for counts/exists instead of per-row queries.
- Defer or exclude large JSON/BLOB fields in list endpoints.
- Keep external I/O (FHIR, PDFs, emails) async via Celery.

## Database Reliability Rules
- Avoid table scans: no `DATE(column)` filters; use range predicates.
- For `icontains`, add trigram or FTS indexes.
- Avoid low-cardinality single-column indexes. Prefer composite/partial indexes.
- Partition time-series tables (`audit_logs`, `vital_signs`, `chart_entries`,
  `lab_results`) by time to keep indexes small.
- Beware write amplification: every index is a tax on inserts.

## Query Hygiene (Django ORM)
- Prefer `.select_related()` for FK joins and `.prefetch_related()` only when bounded.
- Use `.only()`/`.defer()` to avoid pulling large JSON blobs.
- Avoid per-row `.count()` or `.exists()` calls; annotate once in the queryset.

## Concurrency and Transactions
- Never keep a DB transaction open while waiting on network calls.
- Use optimistic flow: save locally, queue async work, update status later.
- Avoid read-modify-write patterns that require table scans (use sequences/counters).

## Testing and Migrations
- Backend tests live alongside modules (e.g., `backend/apps/users/tests.py`).
- Add tests for serializers, viewsets, Celery tasks, and access control.
- For migrations, include data backfill checks and index creation where needed.

## Commit and PR Notes
- Use Conventional Commits (`feat:`, `fix(scope):`, `Add ...`).
- PRs must note migrations, env var changes, and Celery schedule changes.
- Provide UI captures for visual changes.

## Security and Configuration Notes
- Never commit secrets. Use `backend/.env.example` and `frontend/.env.example`.
- Ignore `backend/credentials/` contents.
- Ensure Redis is available before launching Celery.
- Document new dependencies or IAM needs in `docs/`.
