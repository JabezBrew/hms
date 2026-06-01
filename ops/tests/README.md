# ops/tests

Status: active
Owner: Operations Engineering
Last reviewed: 2026-06-01
Scope: operations and deployment configuration tests.

## Test Map

| File | Covers |
| --- | --- |
| `test_backend_tracing_config.py` | backend tracing/observability configuration. |
| `test_caddy_routes.py` | Caddy route behavior. |
| `test_create_client_deployment.py` | client deployment generation behavior. |
| `test_deploy_script.py` | deploy script behavior. |
| `test_monitoring_config.py` | monitoring configuration behavior. |

## Invariants

- Tests must not require production secrets.
- Keep fixture output PHI-safe.
- Deploy/config tests should track the active GCP path and the Hetzner V2
  rollback path explicitly when they differ.
