# Repository Guidelines

## Project Structure & Module Organization
Backend code lives in `backend/`, with domain apps under `backend/apps/` and shared settings in `backend/hms_backend/`. 
Workflows and dashboards keep helpers and tests inside `backend/workflows/` and `backend/dashboards/`. 
The React client resides in `frontend/src/` (components, pages, hooks, contexts) with compiled assets in `frontend/public/`, 
and deeper architecture notes remain in `docs/` and the supporting root-level guides.

## Build, Test, and Development Commands
- `cd backend && python manage.py runserver` starts the Django API with hot reload.
- `cd backend && pytest` runs the full backend test suite (pytest is configured via `backend/pytest.ini`); add `-k` or `apps.<app_name>` to scope runs.
- `cd backend && celery -A hms_backend worker --beat --loglevel=info` runs background tasks and the weekly slot scheduler in one process during development.
- `cd frontend && npm run dev` serves the Vite-powered React app; `npm run build` produces optimized assets and `npm run lint` enforces ESLint rules.

## Coding Style & Naming Conventions
Follow PEP 8 with 4-space indentation for Python and keep business logic inside the owning Django app. Use snake_case 
for module members, PascalCase for classes, and keep Celery tasks as small, pure functions. React files should keep PascalCase components,
`use*` hooks, and camelCase utilities; rely on Tailwind utility classes before inline styles.

## Testing Guidelines
Backend tests live next to their modules (for example, `backend/apps/users/tests.py`) and run through pytest;
mirror that layout when adding coverage. Exercise serializers, viewsets, and Celery tasks whenever they change,
and include migration assertions for data backfills. Frontend tests are sparse—add React Testing Library cases under
`frontend/src/__tests__/` or alongside the component when you introduce new logic, and explain any temporary gaps in the PR.

## Commit & Pull Request Guidelines
History favors Conventional Commits (`feat:`, `fix(scope):`, `Add ...`); keep messages imperative, scoped when helpful,
and under ~72 characters. PRs need a crisp summary, linked issue, and checklists for backend/frontend touches;
attach UI captures for visual work. Highlight migrations, env var deltas, or Celery schedule changes so reviewers can
apply them before approval.

## Security & Configuration Notes
Never commit secrets—start from `backend/.env.example` and `frontend/.env.example`, keep real values outside version
control, and ignore `backend/credentials/` contents. Ensure Redis is available before launching Celery and document new
external dependencies or IAM needs in `docs/` for future agents.
