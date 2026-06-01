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

## Handler Rules

Handlers may extract inputs, call guards/services, and map responses. They must
not own SQL, long workflow decisions, local patient-access shortcuts, or
unbounded list behavior.

## Service Rules

Service interfaces are the main API-layer seam. New complex workflows belong
under `src/services/<domain>/` when they coordinate access, domain policy,
repository calls, events, and response shape.

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
