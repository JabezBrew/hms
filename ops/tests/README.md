# ops/tests

Status: active
Owner: Operations Engineering
Last reviewed: 2026-10-13
Scope: operations and deployment configuration tests.

## Test Map

| File | Covers |
| --- | --- |
| `test_backend_tracing_config.py` | backend tracing/observability configuration. |
| `test_caddy_routes.py` | Caddy route behavior. |
| `test_create_client_deployment.py` | client deployment generation behavior. |
| `test_deploy_script.py` | deploy script behavior. |
| `test_monitoring_config.py` | monitoring configuration behavior. |
| `test_compose_deploy_readiness.py` | Compose deployment health/readiness gates. |
| `test_schema_compatibility_deploy.py` | copied-shell migration drain ordering, strict compatibility state, safe archive recovery and exact-project orphan migration cleanup with mocked Docker. |
| `test_deploy_lease.py` | actual local kernel lease inheritance/termination, unsafe-state rejection, six competing deployment entrypoints, and guarded recovery across a competing Compose attempt. |
| `test_free_testing_deploy.py` | private synthetic env generation, free-testing Compose overrides, Access preflight, explicit public authentication gates, tunnel readiness and local-only behavior. |

## Invariants

- Tests must not require production secrets.
- Keep fixture output PHI-safe.
- Deploy/config tests should distinguish the free synthetic-testing profile,
  retained GCP path and reusable single-VM Compose kit when they differ.
- Static configuration checks do not prove image builds, migrations or a live
  protected domain; those require the runtime checks in each deploy runbook.
