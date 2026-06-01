# HMS Runbooks

Status: active index
Owner: Operations
Last reviewed: 2026-06-01
Scope: operational entry points for deploys, rollback, smoke tests, performance evidence, and incidents.

## Environment Model

HMS currently uses GCP for staging and performance validation, with Hetzner kept
as rollback while GCP proves out.

| Environment | Current role | Primary docs |
| --- | --- | --- |
| Local dev | Developer loop with Docker Postgres/Redis | root `README.md`, `backend-rs/`, `frontend/` |
| GCP staging | Current staging and perf-lab direction | `ops/gcp-staging/README.md` |
| Single-VM Compose | Rollback/client VPS deployment shape | `ops/compose-v2/README.md` |
| Hetzner staging | Historical rollback environment | `ops/gcp-staging/README.md`, `ops/compose-v2/README.md` |
| Legacy Django VPS kit | Historical only | `ops/hetzner-client-vps/README.md` |

## Deploy Runbook Shape

Every deploy runbook should state:

- target environment
- current source branch and commit
- runtime image/tag
- private env source
- migration command
- deploy command
- health endpoint
- smoke checks
- rollback command
- evidence to capture
- evidence that must not be captured because of PHI risk

## Standard Smoke Checks

Minimum Rust V2 staging smoke:

1. `/api/v2/health/ready`
2. login
3. `/api/v2/auth/me`
4. dashboard snapshot or role dashboard route
5. patient list
6. one authorized Chronicle route
7. one operational workflow touched by the change
8. logout

Keep patient identifiers out of final reports unless they are sanitized fixture
IDs explicitly safe for that context.

## Performance Evidence

Use the maintained Rust V2 regression wrapper for backend and public-path
evidence:

```bash
tests/load/scripts/run-rust-v2-regression.sh
```

Use the maintained frontend runtime probe for browser-perceived route evidence:

```bash
cd frontend
node scripts/measure-runtime-perf.mjs
```

Separate these layers when diagnosing latency:

- local app execution
- local proxy
- direct origin
- public HTTPS and edge path
- frontend shell readiness
- API p99
- database query and pool pressure

Do not blame backend code for public-path latency until the layers are separated
with evidence.

## Incident Rules

During incidents:

- preserve PHI safety before collecting logs or screenshots
- check health, container status, restart count, CPU, memory, and disk first
- separate infrastructure pressure from code regressions
- inspect logs with route templates, not raw URLs containing identifiers
- prefer rollback when patient workflow safety is affected
- record the exact final health outcome

## Related Runbooks

- GCP staging: `ops/gcp-staging/README.md`
- Rust V2 single-VM Compose deployment: `ops/compose-v2/README.md`
- Load tests: `tests/load/README.md`
- Ops dashboard: `docs/performance/ops-dashboard.md`
- Performance budget: `docs/performance/performance-budget.md`
