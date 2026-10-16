# hms-api

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 HTTP API server and workflow orchestration.

## Purpose

`hms-api` owns the `/api/v2` HTTP surface. It mounts Axum routes, extracts
request context, calls workflow service interfaces, maps responses into OpenAPI
contracts, and exposes runtime middleware for tracing, telemetry, and request
IDs.

## Internal Map

| Path | Owns |
| --- | --- |
| `src/main.rs` | API binary bootstrap. |
| `src/app.rs` | Axum app assembly. |
| `src/config.rs` | Runtime config and environment parsing. |
| `src/state.rs` | Runtime adapter/facade for pools, config, auth helpers, deployment capabilities, and service factories. |
| `src/routes/` | URL mounting only. |
| `src/handlers/` | HTTP extraction, service calls, response mapping. |
| `src/services/` | Workflow interfaces and orchestration. |
| `src/extractors.rs` | Authenticated session and `RequestContext` extraction. |
| `src/cursor_list.rs` | Shared bounded cursor-list parsing/response helpers. |
| `src/middleware/` | request ID, telemetry, and tracing middleware. |
| `src/openapi.rs` | utoipa/OpenAPI registration. |
| `src/bin/openapi.rs` | OpenAPI generation binary. |
| `tests/` | API and contract tests. |

## Route Groups

| Route module | HTTP area | Handler | Service |
| --- | --- | --- | --- |
| `routes/auth.rs` | login, refresh, logout, profile, password, sessions, MFA/passkeys | `handlers/auth.rs` | auth helpers and `hms-auth` |
| `routes/admin.rs` | staff, organization, positions, authority, permissions, features, committees, audit | `handlers/admin.rs` | `services/admin.rs` |
| `routes/patients.rs` | registry, context patients, Chronicle, ward rounds, break-glass | `handlers/patients.rs` | `services/patients.rs`, `services/ward_rounds.rs` |
| `routes/care.rs` | appointments, clinics, visits, triage, encounters | `handlers/care.rs` | `services/care.rs` |
| `routes/clinical.rs` | note templates, notes, problems, allergies, prescriptions, chart entries | `handlers/clinical.rs` | `services/clinical.rs` |
| `routes/ward.rs` | wards, sections, beds, admissions, discharges, nursing, ward stock | `handlers/ward.rs`, `handlers/ward_rounds.rs` | `services/ward/*` |
| `routes/laboratory.rs` | catalog, panels, orders, specimens, results | `handlers/laboratory.rs` | `services/laboratory/*` |
| `routes/inventory.rs` | items, locations, stock, requisitions, procurement, controlled substances, dispensing | `handlers/inventory.rs` | `services/inventory/*` |
| `routes/billing.rs` | service catalog, invoices, payments, receipts, cash sessions, NHIS | `handlers/billing.rs` | `services/billing/*` |
| `routes/referrals.rs` | referrals, SLA, clinic waitlist | `handlers/referrals.rs` | `services/referrals.rs` |
| `routes/scheduling.rs` | services, sessions, templates, availability, booking, exceptions | `handlers/scheduling.rs` | `services/scheduling.rs` |
| `routes/dashboard.rs` | dashboard snapshots, notifications, realtime subscriptions/ws | `handlers/dashboard.rs` | `services/dashboard.rs` |
| `routes/search.rs` | omni search | `handlers/search.rs` | `hms-db::search` |
| `routes/consent.rs` | consent grants and revocation | `handlers/consent.rs` | `services/consent.rs` |
| `routes/ops.rs` | ops dashboard snapshots and performance surfaces | `handlers/ops.rs` | `services/ops/*` |
| `routes/observability.rs` | browser RUM ingestion | `handlers/observability.rs` | observability helpers |
| `routes/health.rs` | alive/ready health | `handlers/health.rs` | pool/runtime checks |
| `routes/system.rs` | deployment capabilities | `handlers/system.rs` | state/deployment capability helpers |
| `routes/network.rs` | current connection decision and reviewed facility network policy | `handlers/network.rs` | `services/network.rs` |

## Handler Rules

Handlers may extract inputs, call guards/services, and map responses. They must
not own SQL, long workflow decisions, local patient-access shortcuts, or
unbounded list behavior.

## Service Rules

Service interfaces are the main API-layer seam. New complex workflows belong
under `src/services/<domain>/` when they coordinate access, domain policy,
repository calls, events, and response shape.

## Authentication Safety

Access tokens carry the original credential authentication time separately
from token issue time. Refresh rotation preserves the session family's
authentication time; it does not renew the fifteen-minute high-risk action
window. Tokens issued before this field was introduced may still authenticate
ordinary requests but do not provide fresh reauthentication evidence.

Login atomically reserves the persisted fifteen-minute budget before password
verification. Failed and in-flight attempts together cannot exceed ten for
that account across API instances. Successful verification releases its slot;
failed verification consumes it. Cancelled/abandoned reservations remain
closed until the original window expires, and stale completion cannot change
a newer window. Unresolved identities and invalid facility attempts have
separate atomic budgets. Rejections keep the ordinary generic login failure
response and never persist raw login input in limiter keys.

Apply migration `202610150001_auth_login_attempt_budgets.sql` before starting
this API version. It preserves active audited failure budgets and adds a table
without changing existing tables, so an older API binary can still run against
the migrated schema during code rollback.

## Trusted Network Access

Apply migration `202610160012_facility_network_policy.sql`. Unconfigured
facilities are read-only until an operator explicitly bootstraps reviewed onsite
CIDRs. Runtime `HMS_TRUSTED_PROXY_CIDRS` defaults to empty; forwarding headers
never establish trust without a matching real socket peer. The central route
guard shares its resolved context with handlers and reads the current facility
policy once per protected request. Credential freshness does not imply strong
MFA. See `docs/v2/2026-10-16-trusted-network-policy-scope.md` at the repository
root for exact operations, exceptions, deadlines, bootstrap, and verification.

## Staff Onboarding Delivery

Staff creation and forced password reset generate short-lived setup/reset
tokens server-side and require fresh high-risk admin reauthentication. In
tests, tokens are captured by an in-memory test sink. Outside tests, account
setup delivery must use a trusted webhook configured with
`HMS_ACCOUNT_SETUP_DELIVERY_MODE=webhook`,
`HMS_ACCOUNT_SETUP_DELIVERY_WEBHOOK_URL`, and `HMS_PUBLIC_APP_URL`. Forced
reset tokens are inactive until the reset finalization transaction commits
session revocation, audit, and token activation. Plaintext setup tokens must not
be stored in domain events, audit events, logs, or API responses.

## Contract Tests

Important contract tests include:

| Test | Covers |
| --- | --- |
| `tests/admin_contract.rs`, `tests/admin_authority_contract.rs` | staff, organization, authority, permissions, and admin access behavior. |
| `tests/auth_contract.rs` | login/session/auth contract. |
| `tests/baseline_contract.rs`, `tests/foundation_contract.rs` | deployment baseline and foundation API behavior. |
| `tests/patients_contract.rs` | patient registry, Chronicle, access, and patient-facing response shape. |
| `tests/care_contract.rs`, `tests/scheduling_contract.rs` | appointments, visits, triage, encounters, and scheduling flows. |
| `tests/clinical_contract.rs`, `tests/consent_contract.rs` | clinical notes/charts/problems/prescriptions and consent behavior. |
| `tests/ward_contract.rs`, `tests/nursing_contract.rs` | ward, bed, admission, discharge, nursing, MAR, and monitoring behavior. |
| `tests/billing_contract.rs` | billing, payments, receipts, cash sessions, and NHIS behavior. |
| `tests/laboratory_contract.rs` | lab catalog, orders, specimens, and results behavior. |
| `tests/inventory_contract.rs` | inventory, procurement, pharmacy, stock, and controlled substances behavior. |
| `tests/referrals_contract.rs`, `tests/dashboards_contract.rs`, `tests/dashboard_projection_contract.rs` | referral, dashboard, projection, and notification behavior. |
| `tests/ops_contract.rs`, `tests/telemetry.rs` | ops dashboard, metrics, and telemetry behavior. |
| `tests/api_contract/*` | shared HTTP contract fixtures/modules used by the higher-level contract specs. |

Run from `backend-rs/`:

```bash
cargo test -p hms-api
```
