# hms-api/tests

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: API contract and telemetry tests for Rust V2.

## Test Map

| Test group | Covers |
| --- | --- |
| `auth_contract.rs` | auth/session HTTP behavior. |
| `admin*_contract.rs` | admin, organization, authority, and permission behavior. |
| `patients_contract.rs` | patient registry, Chronicle, and patient access behavior. |
| `care_contract.rs`, `scheduling_contract.rs` | care and scheduling workflows. |
| `clinical_contract.rs`, `consent_contract.rs` | clinical and consent APIs. |
| `ward_contract.rs`, `nursing_contract.rs` | inpatient, ward, nursing, and monitoring APIs. |
| `billing_contract.rs`, `inventory_contract.rs`, `laboratory_contract.rs` | fulfillment and back-office APIs. |
| `referrals_contract.rs`, `dashboards_contract.rs`, `dashboard_projection_contract.rs` | referral and dashboard behavior. |
| `ops_contract.rs`, `telemetry.rs` | ops and telemetry surfaces. |
| `api_contract/` | shared contract fixtures and domain-specific helper modules. |
| `support/` | shared test support. |

## Invariants

- Contract tests should exercise the same interfaces production callers use.
- Fixtures and assertion names must remain PHI-safe.
- Access regressions should fail closed.

## Run

```bash
cargo test -p hms-api
```
