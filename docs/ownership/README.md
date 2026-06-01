# HMS Ownership

Status: active
Owner: Engineering Leadership
Last reviewed: 2026-06-01
Scope: Module ownership, review routing, and escalation expectations.

## Ownership Model

Until named humans or teams are assigned, ownership is expressed by role. Review
should route to the role that owns the changed Interface.

## Path Ownership

| Path | Owner role | Review trigger |
| --- | --- | --- |
| `backend-rs/crates/hms-access/` | Security/backend owner | any access, permission, patient-visibility, or reauth change |
| `backend-rs/crates/hms-auth/` | Security/backend owner | any session, JWT, cookie, password reset, or WebAuthn change |
| `backend-rs/crates/hms-api/src/routes/` | Backend owner | route additions, removals, or mounted path changes |
| `backend-rs/crates/hms-api/src/handlers/` | Backend owner | HTTP contract, DTO, or error-mode changes |
| `backend-rs/crates/hms-api/src/services/` | Backend/product workflow owner | workflow orchestration or product invariant changes |
| Rust V2 WebSocket/realtime modules | Security/backend owner | connection auth, facility binding, channel join authorization, permission-version rechecks |
| `backend-rs/crates/hms-db/` | Database owner | SQL, repository Interface, transaction, index, or migration impact |
| `backend-rs/migrations/` | Database/operations owner | schema, seed, provisioning, restore, or rollback impact |
| `frontend/src/features/` | Frontend/product workflow owner | route, workflow, data-fetch, or user-visible state changes |
| `frontend/src/lib/api/v2/` | Frontend/backend integration owner | generated client, runtime config, session, or error mapping changes |
| `frontend/src/shared/` | Frontend platform owner | shared UI, query keys, page shells, shared APIs |
| `ops/` | Operations owner | deploy, domain, env, backup, restore, or rollback changes |
| `tests/load/` and `docs/performance/` | Performance owner | budgets, probes, load shape, or evidence interpretation |

When GitHub teams or named DRIs exist, mirror this table into `CODEOWNERS`.
Until then, this table is the review router and escalation map.

| Area | Primary owner role | Required review focus |
| --- | --- | --- |
| Patient access, permissions, reauth | Security/backend owner | least privilege, patient/facility scope, auditability |
| Auth/session/password reset/WebAuthn | Security/backend owner | session integrity, replay resistance, fail-closed behavior |
| Rust API handlers/services | Backend owner | thin handlers, service Interface depth, contract tests |
| SQL repositories/migrations | Database owner | bounded queries, indexes, transactions, rollback safety |
| Patient Chronicle and clinical UI | Frontend/clinical workflow owner | clinical data placement, workflow continuity, PHI safety |
| Feature API adapters and generated client | Frontend/backend integration owner | contract freshness, AbortSignal, error mapping |
| Realtime/WebSocket subscriptions | Security/backend owner | authenticated connections, PHI-safe channels, facility/patient/ward authorization |
| Performance budgets and load harnesses | Performance owner | p95/p99, query count, payload, pool wait, evidence quality |
| GCP/Hetzner deploys and rollback | Operations owner | health, logs, secrets, backups, rollback anchor |
| Billing/NHIS/cash workflows | Product/backend owner | ledger integrity, reversal rules, reauth, audit |
| Inventory/controlled substances | Product/backend owner | stock integrity, discrepancy audit, witness/reauth |

## Review Triggers

Require explicit security review when a change touches:

- patient identifier handling
- access decisions
- permissions or roles
- session/auth cookies or tokens
- realtime/WebSocket connection or channel authorization
- audit events
- PHI export, FHIR, AI, external integrations, or browser storage
- scoped cache keys or frontend query keys for authorization-sensitive data

Require explicit performance review when a change touches:

- hot clinical lists
- Patient Chronicle initial load
- dashboard snapshots
- ward board
- search
- frontend route shell behavior
- database indexes or query plans

Require operations review when a change touches:

- deploy scripts
- compose files
- env variables
- public domains
- Cloudflare/GCP/Hetzner routing
- backups or restore commands
- metrics/logging availability

## Escalation Rule

When safety and speed conflict, safety wins. For HMS, p99 latency, PHI safety,
and patient access enforcement are production safety concerns, not polish.
