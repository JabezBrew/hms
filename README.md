# Hospital Management System (HMS)

HMS is a workflow-oriented hospital management system with an active Rust V2
backend and the maintained React/Vite frontend.

The active backend is `backend-rs/`. The old Django/DRF/Celery backend remains
in `backend/` as legacy reference code only. Do not add new backend behavior to
`backend/` unless the task explicitly says it is legacy Django maintenance.

## Architecture

- **Backend (active): Rust V2**
  - Source: `backend-rs/`
  - API base: `/api/v2`
  - Stack: Rust, axum, tokio, sqlx, PostgreSQL, Redis, utoipa/OpenAPI.
  - Runtime binaries: `hms-api`, `hms-worker`, `hms-migrator`, `hms-openapi`.
  - Architecture: `routes/*` mount URLs, `handlers/*` translate HTTP,
    `services/*` own workflow Interfaces, `hms-access` authorizes, and
    `hms-db` persists.
  - Source of truth: `docs/v2/rust-v2-backend-spec.md`.

- **Frontend (active): React/Vite**
  - Source: `frontend/`
  - The current product UI remains JavaScript/Vite.
  - Rust integration uses generated JavaScript helpers from the Rust OpenAPI
    document and runs in `rust-v2` API mode.
  - Source of truth: `docs/v2/v2-cutover-scope.md`.

- **Legacy backend reference**
  - Source: `backend/`
  - Historical Django implementation used for reference/parity only.
  - Legacy deployment/config files are retained only where they are explicitly
    labeled legacy.

## Getting Started

### Prerequisites

- Rust stable toolchain
- Node.js 20+
- Docker Desktop or another Docker daemon for local PostgreSQL/Redis
- PostgreSQL client tools if you want Rust tests to create isolated local test
  databases with `createdb`/`dropdb`

### Local Dependencies

Start PostgreSQL and Redis from the root dependency Compose file:

```bash
docker compose up -d postgres redis
```

### Rust Backend

Run checks and tests from `backend-rs/`:

```bash
cd backend-rs
cargo fmt --all --check
cargo test --workspace
```

Run the API locally:

```bash
cd backend-rs
HMS_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hms \
HMS_API_LISTEN_ADDR=127.0.0.1:8080 \
cargo run -p hms-api
```

Regenerate the OpenAPI document after backend contract changes:

```bash
cd backend-rs
cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json
```

### Frontend

Install dependencies and run the maintained UI:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

The frontend `.env.example` defaults to Rust V2 mode:

```text
VITE_HMS_API_MODE=rust-v2
VITE_V2_API_BASE_URL=/api/v2
VITE_V2_API_PROXY_TARGET=http://localhost:8080
```

Validate frontend integration:

```bash
cd frontend
npm run api:v2:generate:check
npm run build
```

## Deployment

The active Hetzner deployment path is the Rust V2 kit:

```text
ops/hetzner-v2/README.md
ops/hetzner-v2/compose.yml
```

It builds `backend-rs/`, runs `hms-migrator`, starts `hms-api` and
`hms-worker`, serves the React frontend in Rust V2 mode, and checks:

```text
https://<client-domain>/api/v2/health/ready
```

The older `ops/hetzner-client-vps/` kit is legacy Django deployment material.
Do not use it for new Rust V2 deploys.

## Project Structure

```text
backend-rs/
  crates/
    hms-api/             # Rust HTTP API server
    hms-worker/          # Rust background worker
    hms-migrator/        # SQL migrations and provisioning
    hms-domain/          # Domain types and policies
    hms-db/              # sqlx repositories and transactions
    hms-auth/            # Auth/session/password reset logic
    hms-access/          # Permissions and patient-access guards
    hms-events/          # Domain event and job contracts
    hms-observability/   # Logging, metrics, tracing helpers
  migrations/            # Rust V2 SQL migrations
  openapi/               # Generated Rust V2 OpenAPI document

frontend/
  src/                   # Maintained React/Vite UI
  scripts/               # Generated V2 API client tooling
  public/runtime-config.js

backend/
  apps/                  # Legacy Django apps for reference only
  hms_backend/           # Legacy Django settings
  manage.py              # Legacy Django management entry point
```

## Development Rules

- Default backend work belongs in `backend-rs/`.
- Default backend tests are `cargo fmt --all --check` and
  `cargo test --workspace` from `backend-rs/`.
- Add/modify frontend Rust integration through `frontend/src/lib/api/v2/*` and
  feature API adapters in `frontend/`.
- Keep patient clinical data workflows inside the Patient Chronicle UI.
- Keep PHI out of logs, metrics labels, query keys, and browser storage.
- Use bounded cursor lists for hot clinical endpoints.
- Preserve AbortSignal support in frontend list/search calls.

## Legacy Django

Use `backend/` only when the task explicitly says to inspect, compare, or
maintain legacy Django behavior. Legacy commands such as `python manage.py`,
`pytest`, DRF serializers, Django migrations, Celery tasks, and Django
deployment files do not define the active backend architecture.
