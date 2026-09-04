# Hospital Management System (HMS)

[![CI](https://github.com/JabezBrew/hms/actions/workflows/ci.yml/badge.svg)](https://github.com/JabezBrew/hms/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/backend-Rust%20%2F%20axum-orange.svg)](backend-rs/)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2F%20Vite-blue.svg)](frontend/)

HMS is an open-source, workflow-oriented hospital management system for
registration, triage, consultation, admission, ward care, discharge,
laboratory, pharmacy, inventory, billing, and administration.

It ships a **Rust (axum) API** (`backend-rs/`, `/api/v2`) and a
**React/Vite frontend** (`frontend/`), with PostgreSQL, Redis, background
workers, and single-VM Docker Compose operations.

> **Status:** active development. The Rust V2 backend and React frontend are
> the maintained path. The Django backend in `backend/` is legacy reference
> only (parity research / historical comparison).

## Highlights

- **Clinical workflows first** — registration → triage → consultation →
  admission → ward care → discharge, plus lab, pharmacy, inventory, billing.
- **Patient Chronicle** — the single product home for patient clinical data.
- **Secure by default** — facility scoping, patient-access guards, least-
  privilege DTOs, bounded cursor pagination, PHI-safe logging/keys.
- **Performant hot paths** — O(1) queries per list page, lightweight list
  projections, `p99 < 200 ms` budget on clinical lists (see
  `docs/performance/performance-budget.md`).
- **Contract-driven** — OpenAPI generated from Rust source
  (`backend-rs/openapi/hms-v2.openapi.json`), generated TS client, contract
  tests on both sides.
- **Operable** — single-VM Compose kit (`ops/compose-v2/`), migrator/worker
  binaries, health/readiness endpoints, Prometheus metrics.

## Screenshots

> Screenshots use synthetic demo data only — never real patient data.

| Patient Chronicle | Ward Board | Billing |
| --- | --- | --- |
| *Add screenshot* | *Add screenshot* | *Add screenshot* |

To contribute screenshots, seed the demo dataset (see
`docs/v2/rust-v2-demo-seed.md`), capture with demo patients, and open a PR.

## Quickstart (local dev)

### Prerequisites

- Rust stable toolchain
- Node.js 20+
- Docker (for local PostgreSQL + Redis)
- PostgreSQL client tools (`createdb` / `dropdb`) for Rust DB tests

### 1. Start dependencies

```bash
docker compose up -d postgres redis
```

### 2. Run the Rust API

```bash
cd backend-rs
cargo test --workspace        # runs fmt-gated unit + contract + db tests
HMS_DATABASE_URL="$HMS_LOCAL_DATABASE_URL" \
HMS_API_LISTEN_ADDR=127.0.0.1:8080 \
cargo run -p hms-api
```

Regenerate the OpenAPI document after HTTP contract changes:

```bash
cd backend-rs
cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json
```

### 3. Run the frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Defaults are Rust V2 mode (`VITE_HMS_API_MODE=rust-v2`,
`VITE_V2_API_BASE_URL=/api/v2`, proxy to `http://localhost:8080`).

Validate frontend integration:

```bash
cd frontend
npm run lint
npm run test:run
npm run api:v2:generate:check
npm run build
```

## Architecture

```text
Browser (React/Vite)
  -> Caddy / reverse proxy
    -> hms-api (axum) : routes/* -> handlers/* -> services/* -> hms-access -> hms-db
    -> hms-worker      : background jobs (never on hot request paths)
    -> hms-migrator    : SQL migrations + provisioning + demo seeding
  -> PostgreSQL + Redis
```

| Area | Path | Notes |
| --- | --- | --- |
| Rust API | `backend-rs/crates/hms-api/` | Routes mount URLs; handlers are thin; services own workflow. |
| Access control | `backend-rs/crates/hms-access/` | Facility / profile / permission / patient-visibility / reauth. |
| Persistence | `backend-rs/crates/hms-db/` + `backend-rs/migrations/` | SQL lives here, not in handlers. |
| Domain language | `backend-rs/crates/hms-domain/` | Typed DTOs, capabilities, product vocabulary. |
| Auth | `backend-rs/crates/hms-auth/` | JWT / sessions / password reset / passkeys. |
| Events / jobs | `backend-rs/crates/hms-events/` + `hms-worker` | Async contract payloads. |
| Observability | `backend-rs/crates/hms-observability/` | PHI-safe logging, tracing, metrics. |
| Frontend | `frontend/src/features/<domain>/` | Feature modules; thin `src/pages/` wrappers only. |
| API contract | `backend-rs/openapi/hms-v2.openapi.json` | Generated; do not hand-edit. |
| Deploy kit | `ops/compose-v2/` | Reusable single-VM Compose deployment. |
| Legacy | `backend/` | Django reference only. |

Source of truth order: code + tests → OpenAPI / migrations / generated
client → `docs/v2/rust-v2-backend-spec.md` → `docs/` maps → runbooks.
When older docs conflict with Rust V2 code or generated contracts, the newer
source wins. Start with [`CONTEXT.md`](CONTEXT.md) and
[`docs/README.md`](docs/README.md).

## Deployment

For a single-VM production-style deploy:

```bash
git clone https://github.com/JabezBrew/hms.git /opt/hms
cd /opt/hms
cp ops/compose-v2/env.example ops/compose-v2/.env
chmod 600 ops/compose-v2/.env
# fill every CHANGE_ME value, then:
ops/compose-v2/deploy.sh
```

Health check:

```text
https://<your-domain>/api/v2/health/ready
```

See [`ops/compose-v2/README.md`](ops/compose-v2/README.md) for profiles
(`clinic`, `hospital`, `district_hospital`, …), backups, and rollback.
`ops/gcp-staging/` documents one example staging topology with placeholder
values — replace them with your own project/network before use.

## Documentation map

- Product + architecture invariants: [`CONTEXT.md`](CONTEXT.md)
- Codebase map: [`docs/README.md`](docs/README.md)
- Backend spec: [`docs/v2/rust-v2-backend-spec.md`](docs/v2/rust-v2-backend-spec.md)
- Cutover scope: [`docs/v2/v2-cutover-scope.md`](docs/v2/v2-cutover-scope.md)
- API/access/realtime/persistence contracts: [`docs/contracts/README.md`](docs/contracts/README.md)
- Performance budgets: [`docs/performance/performance-budget.md`](docs/performance/performance-budget.md)
- Runbooks: [`docs/runbooks/README.md`](docs/runbooks/README.md)
- Contributor guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Security policy: [`SECURITY.md`](SECURITY.md)

## Security & PHI

HMS handles protected health information. Contributors must:

- Never commit PHI, credentials, tokens, private `.env` files, request/response
  bodies, MRNs, names, accessions, or production dumps.
- Never log PHI, free-text clinical data, or raw patient URLs; keep metric
  labels, cache keys, and query keys to opaque/sanitized scope values.
- Enforce patient-access checks on every endpoint that accepts a patient id.
- Keep FHIR/export/email/PDF work off hot request paths and out of open DB
  transactions.

See [`SECURITY.md`](SECURITY.md) for reporting vulnerabilities. **Do not open
public issues for suspected vulnerabilities.**

## Contributing

Contributions are welcome — bug reports, docs, tests, clinical-workflow UX,
performance work, and deployment improvements.

1. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
2. Open an issue first for anything beyond a trivial fix.
3. Keep changes surgical; add or update tests for behavior changes.
4. Run the relevant checks (`cargo fmt --check`, `cargo test`, `npm run lint`,
   `npm run test:run`, `npm run build`) before opening a PR.

## License

MIT — see [LICENSE](LICENSE).
