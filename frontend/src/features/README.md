# frontend/src/features

Status: active
Owner: Frontend/Product Engineering
Last reviewed: 2026-06-01
Scope: domain feature modules and route ownership.

## Feature Contract

Each feature should own its UI routes, feature API adapter, hooks, pages, and
domain-specific components. Shared primitives belong in `src/shared/` or
`src/components/`.

## Feature Catalog

| Feature | Routes / role | Backend area |
| --- | --- | --- |
| `admin` | `/admin/*`, staff/org/audit/admin authority | `/api/v2/admin/*`, `/api/v2/staff/directory` |
| `admissions` | `/admissions/*`, billing admission queue | `/api/v2/admissions/*`, `/api/v2/admissions/cases/*` |
| `appointments` | `/appointments/*`, `/practitioner-availability`, schedule slots | `/api/v2/appointments`, `/api/v2/scheduling/*` |
| `billing` | `/billing/*`, invoices, payments, cash, NHIS | `/api/v2/billing/*`, `/api/v2/nhis/*` |
| `care-areas` | `/care-areas/outpatient`, `/care-areas/inpatient`, `/care-areas/emergency` | scoped OPD/IPD/Emergency queues through clinics, ward board, triage, and `/api/v2/care-areas/my-work` |
| `charts` | `/charts/templates`, `/charts/builder` | `/api/v2/patients/:id/clinical/chart-entries` and clinical template APIs |
| `clinical-notes` | encounter note route and template admin | `/api/v2/clinical/*` |
| `clinics` | clinic waiting room | `/api/v2/clinics`, `/api/v2/visits` |
| `dashboards` | role dashboards and app root | `/api/v2/dashboards/*`, notifications, realtime |
| `discharge` | discharge feature helpers; routed through admissions, Ward Board, Chronicle, and billing flows | `/api/v2/discharges/*` |
| `encounters` | `/encounters/*` | `/api/v2/encounters/*` |
| `inbox` | `/inbox` | `/api/v2/notifications/*` |
| `inventory` | `/inventory/*` | `/api/v2/inventory/*`, controlled-substance APIs |
| `laboratory` | `/laboratory/*` | `/api/v2/laboratory/*` |
| `nursing` | no standalone routes; used by OPD, triage, Ward Board, and Chronicle surfaces | `/api/v2/nursing/*` |
| `onboarding` | onboarding support modules; no primary app route | deployment/setup APIs when enabled |
| `ops` | `/system/ops` | `/api/v2/ops/*`, observability summaries |
| `patients` | `/patients/*`, Chronicle, print, ward round | `/api/v2/patients/*`, Chronicle, break-glass |
| `pharmacy` | `/pharmacy/dispensing` | `/api/v2/pharmacy/*`, inventory dispense APIs |
| `problems` | problem support module; clinical placement is Chronicle | `/api/v2/clinical/problems/*` |
| `referrals` | `/referrals/inbox`, `/referrals/sent` | `/api/v2/referrals/*` |
| `settings` | `/settings/*` | auth/profile/session and feature entitlement APIs |
| `staff` | `/staff/*` | `/api/v2/admin/staff/*`, practitioners |
| `triage` | `/triage` | `/api/v2/triage/*` |
| `ward-board` | `/ward-board`, `/wards/:wardId/board` | `/api/v2/wards/board`, nursing task APIs |
| `wards` | `/wards/*` | `/api/v2/wards/*` |
| `workflows` | `/workflows/ward-round`, `/workflows/discharge` are compatibility routes with `rustV2Supported: false` | use Patient Chronicle, ward, admission, nursing, and discharge feature APIs for active Rust V2 work |

## Feature Invariants

- Patient clinical workflows launch from Chronicle or keep the patient context
  visible.
- Feature APIs preserve `AbortSignal` for list/search calls.
- Query keys include authorization-sensitive scope.
- Route features must match Rust V2 capability keys.
- Pages should use `PageShell`, `PageHeader`, and `PageState` unless the route
  intentionally uses a workflow/fullscreen shell.
