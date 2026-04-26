# Deployment Feature Flags

HMS uses one codebase with deployment profiles that resolve to explicit feature
flags. The backend matrix in `backend/hms_backend/deployment.py` is the source
of truth; frontend code should consume `/api/settings/deployment-capabilities/`
instead of duplicating profile logic.

## Profiles

| Profile | Facility scope | Intended deployment |
| --- | --- | --- |
| `clinic` | Single facility | Lean outpatient clinic. Inpatient, wards, bed management, and roster requirements are off by default. |
| `hospital` | Single facility | Full single-hospital deployment. Rosters, inpatient, wards, billing, labs, pharmacy, and clinical workflows are on by default. |
| `hospital_network` | Network | Multi-facility hospital group. Enables facility switching, network admin access, cross-facility referrals, and record exchange by default. |

Legacy aliases are preserved: `small_clinic` maps to `clinic`, and
`single_hospital` maps to `hospital`.

## Configuration

Set the profile first:

```bash
DEPLOYMENT_PROFILE=clinic
```

Override individual flags only when a customer needs a non-standard package:

```bash
FEATURE_FLAG_OVERRIDES={"laboratory": false, "pharmacy": false}
```

The override parser also accepts comma-separated pairs:

```bash
FEATURE_FLAG_OVERRIDES=laboratory=false,pharmacy=false
```

## Compatibility

These existing env vars still work and override the equivalent flags:

| Env var | Feature |
| --- | --- |
| `FACILITY_CONTEXT_REQUIRED` | `facility_context_required` |
| `MULTI_FACILITY_MODE` | `multi_facility`, `facility_switcher` |
| `ALLOW_CROSS_FACILITY_ACCESS` | `cross_facility_access` |
| `PRACTITIONER_SCHEDULING_MODE` | `department_rosters` |
| `REQUIRE_OUTPATIENT_ACTIVE_CLINIC` | `outpatient_active_clinic_required` |

New backend code should use `hms_backend.deployment.feature_enabled()` for
branching, or declare `required_feature` with
`apps.core.security.FeatureRequiredPermission` when an endpoint should be
blocked for a deployment. New frontend code should use `useSystemCapabilities()`
and check the returned `features` object.

## Enforcement

Backend module prefixes are blocked in `FacilityContextMiddleware` using the
`API_FEATURE_PREFIXES` map. For example, `DEPLOYMENT_PROFILE=clinic` disables
`wards`, so `/api/wards/...` returns `404 feature_disabled` even if a user has
the right role.

Frontend route arrays are tagged with feature metadata in
`frontend/src/app/routes/featureRoutes.js`, and `FeatureBasedRoute` redirects
direct navigation to `/feature-unavailable` when a module is off. Sidebar groups
also check the same capability response before rendering module links.
