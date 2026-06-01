# Legacy Django Backend

Status: legacy reference
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: historical Django/DRF/Celery backend under `backend/`.

## Current Role

`backend/` is not the active HMS backend. The active backend is Rust V2 under
`../backend-rs/`.

Use this directory only for:

- explicit legacy Django maintenance
- parity research against old behavior
- historical reference while implementing Rust V2 equivalents

Do not add new active backend behavior here unless the task explicitly says it
is legacy Django work.

## App Map

| Django app | Historical responsibility | Rust V2 equivalent |
| --- | --- | --- |
| `apps/core` | shared security, facility, base models, health, common APIs | `hms-access`, `hms-domain`, `hms-api` extractors/routes |
| `apps/users` | users, auth-facing user state | `hms-auth`, `hms-db::auth`, admin/staff Rust APIs |
| `apps/patients` | patient registry, patient search, validation, patient notes | `hms-domain::patients`, `hms-db::patients`, patient routes |
| `apps/appointments` | appointment scheduling | `hms-domain::care`, `hms-db::care`, scheduling routes |
| `apps/admissions` | admissions workflow | `hms-domain::ward`, `hms-db::ward`, admission-case routes |
| `apps/wards`, `apps/ward_board` | ward/bed/board workflows | `hms-db::ward`, ward routes, ward-board frontend |
| `apps/nursing` | nursing tasks, vitals, MAR, handoff, monitoring | `hms-db::ward/*`, ward/nursing routes |
| `apps/clinical_notes` | clinical notes and templates | `hms-domain::clinical`, clinical routes |
| `apps/encounters` | outpatient encounters and encounter workspace | `hms-domain::care`, encounter APIs |
| `apps/charts` | chart templates and entries | `hms-domain::clinical`, chart-entry APIs |
| `apps/problems` | problems and clinical problem seed data | `hms-domain::clinical`, problem APIs |
| `apps/laboratory` | lab catalog, orders, specimens, results | `hms-domain::laboratory`, `hms-db::laboratory` |
| `apps/inventory` | inventory, procurement, stock | `hms-db::inventory/*` |
| `apps/pharmacy` | pharmacy workflow | inventory/pharmacy Rust APIs |
| `apps/billing` | billing, claims, PSP integrations | `hms-domain::billing`, `hms-db::billing` |
| `apps/referrals` | referrals and templates | `hms-domain::referrals`, referral routes |
| `apps/consent`, `apps/interop`, `apps/fhir_client`, `apps/mpi` | consent, exchange, FHIR, MPI experiments | deferred or Rust V2 consent/referral subsets |
| `apps/dashboards`, `apps/notifications` | dashboards and notifications | `hms-domain::dashboard`, dashboard/realtime routes |
| `apps/organization` | org units and authority | Rust V2 admin/authority APIs |
| `apps/audit` | audit tables and views | Rust V2 audit/admin/observability paths |
| `apps/drug_safety`, `apps/ai`, `apps/setup`, `apps/workflows`, `apps/discharge` | historical support modules | Rust V2 domain-specific equivalents or deferred work |

## Legacy Runtime

Historical commands:

```bash
cd backend
source .venv/bin/activate
pytest -n auto
```

Historical health endpoints:

- `/api/health/alive/`
- `/api/health/started/`
- `/api/health/ready/`
- `/api/metrics/`

## Legacy Operations Appendix

Use these only when explicitly maintaining or comparing the Django backend.
They are not the active HMS runtime path.

| Area | Legacy entrypoint |
| --- | --- |
| Django settings | `hms_backend/settings.py` and `hms_backend/settings_test.py`. |
| URL routing | `hms_backend/urls.py`, `hms_backend/routing.py`, and app-level `urls.py` files. |
| ASGI/WSGI | `hms_backend/asgi.py`, `hms_backend/wsgi.py`. |
| Celery | `hms_backend/celery.py` plus task modules under `apps/*/tasks.py`. |
| Management commands | `apps/*/management/commands/`. |
| Startup scripts | scripts under `scripts/` and deployment references under legacy ops directories. |
| Migrations | Django migrations under each `apps/*/migrations/` directory. |

Common historical commands:

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver
celery -A hms_backend worker -l info
celery -A hms_backend beat -l info
```

Before using any legacy command, confirm the work is intentionally legacy and
that no secrets or PHI are being written to local logs, fixtures, or shell
history.

## Migration Notes

- Django serializers map to explicit Rust DTOs.
- Django ORM query hygiene maps to SQLx repository/query-plan hygiene.
- `apps/core/security.py` maps to `hms-access`.
- Celery tasks map to `hms-worker` jobs.
- Django migrations map to `backend-rs/migrations/` and `hms-migrator`.
- Legacy FHIR/interop code is unsafe external I/O reference only; do not put it
  on active request paths.

## Safety

Legacy docs and code can contain outdated assumptions. When they conflict with
Rust V2 contracts, Rust V2 wins.
