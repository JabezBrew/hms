# Deployment Feature Flags

HMS uses one codebase with deployment profiles that resolve to explicit feature
flags. The active backend is Rust V2 under `backend-rs/`; its source of truth is
`backend-rs/crates/hms-domain/src/deployment.rs` plus
`backend-rs/crates/hms-domain/src/capabilities.rs`.

Frontend code should consume `/api/v2/system/deployment-capabilities` in
`VITE_HMS_API_MODE=rust-v2` instead of duplicating profile logic. The older
Django implementation under `backend/` is legacy reference code only.

## Profiles

| Profile | Facility scope | Intended deployment |
| --- | --- | --- |
| `chps_compound` | Single facility | CHPS compound with core patient, encounter, pharmacy, inventory, referral, and dashboard workflows. |
| `health_center` | Single facility | Health center deployment with outpatient workflows, billing/NHIS, lab, pharmacy, inventory, referrals, dashboards, and admin. |
| `clinic` | Single facility | Lean outpatient clinic. Inpatient, wards, bed management, and roster requirements are off by default. |
| `hospital` | Single facility | Full single-hospital deployment. Rosters, inpatient, wards, billing, labs, pharmacy, and clinical workflows are on by default. |
| `district_hospital` | Single facility | Full hospital deployment tuned for district hospital operations. |
| `regional_hospital` | Single facility | Full hospital deployment tuned for regional hospital operations. |
| `teaching_hospital` | Single facility | Full hospital deployment tuned for teaching hospital operations. |
| `hospital_network` | Network | Multi-facility hospital group. Enables facility switching, network admin access, cross-facility referrals, and record exchange by default. |

## Configuration

Set the profile first:

```bash
HMS_DEPLOYMENT_PROFILE=clinic
```

Rust V2 reads feature defaults from the selected profile, seeds supported
profiles and default permissions through `hms-migrator`, and applies per-facility
runtime overrides from the `facility_feature_entitlements` table.

## Compatibility

These older Django env vars are legacy compatibility only and do not define the
active Rust V2 capability matrix:

| Env var | Feature |
| --- | --- |
| `FACILITY_CONTEXT_REQUIRED` | `facility_context_required` |
| `MULTI_FACILITY_MODE` | `multi_facility`, `facility_switcher` |
| `ALLOW_CROSS_FACILITY_ACCESS` | `cross_facility_access` |
| `PRACTITIONER_SCHEDULING_MODE` | `department_rosters` |
| `REQUIRE_OUTPATIENT_ACTIVE_CLINIC` | `outpatient_active_clinic_required` |

New Rust backend code should model profile, feature, permission, and navigation
changes in `hms-domain`, then enforce permissions and feature entitlement access
through `hms-access`. New frontend code should use `useSystemCapabilities()`
and check the returned `features`, `permissions`, and `navigation` objects.

## Enforcement

Backend feature metadata is declared in `backend-rs/crates/hms-domain`.
Profile defaults define the baseline feature matrix, then
`facility_feature_entitlements` can override features for a single facility.
Precedence is:

1. facility DB override
2. deployment profile default

Rust API handlers enforce capability-sensitive operations with explicit
permission checks and feature entitlement checks. Capability responses are gated
by `system.deployment_capabilities.view`.

Frontend route arrays are tagged with feature metadata in
`frontend/src/app/routes/featureRoutes.js`, and `FeatureBasedRoute` redirects
direct navigation to `/feature-unavailable` when a module is off. Sidebar groups
also check the same capability response before rendering module links.

Admins can inspect and manage runtime overrides at:

```text
/settings/feature-entitlements
/api/v2/admin/features
/api/v2/admin/features/{key}
```

The deployment capabilities endpoint includes effective features, feature
sources, the active facility code, and the feature manifest:

```text
/api/v2/system/deployment-capabilities
```
