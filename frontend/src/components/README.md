# frontend/src/components

Status: active
Owner: Frontend Platform/Product Engineering
Last reviewed: 2026-06-01
Scope: shared components, legacy product components, Chronicle components, and UI primitives.

## Component Areas

| Area | Purpose |
| --- | --- |
| `ui/` | reusable shadcn-style primitives, virtualized lists/tables, slide-over, date/time inputs. |
| `chronicle/` | Patient Chronicle hero, timeline, slide-overs, note/vitals/prescription/treatment/ward-round UI. |
| `layout/` | facility switcher, notification center, app layout, sidebar, breadcrumbs. |
| `auth/` | login, MFA, forced password change, password reset, route guards. |
| `admin/` | admin-facing audit and management UI. |
| `dashboard/` | role dashboard cards, widgets, charts, urgent banners. |
| `appointments/` | appointment detail/form/availability/calendar UI. |
| `billing/` | invoice, insurance, payment, receipt slide-over UI. |
| `inventory/` | items, stock, requisitions, procurement, expiry, transfer, controlled-substance UI. |
| `laboratory/` | lab order, specimen, result entry/viewer, catalog UI. |
| `nursing/` | vitals, treatment sheet, MAR, alerts, monitoring UI. |
| `wards/` | ward/bed/section/admission UI. |
| `encounters/` | encounter detail/form/workspace UI. |
| `encounter/` | encounter editor primitives such as smart notes and review of systems. |
| `patients/`, `patient/` | patient registry/detail/context/header components outside the Chronicle workspace. |
| `pharmacy/` | pharmacy queue and dispensing workflow UI. |
| `physician/` | physician-facing reusable workflow UI. |
| `visits/` | visit status, waiting room, triage assignment, and checkout UI. |
| `facilities/`, `organization/`, `staff/` | facility required panels, org/unit badges, staff forms, assignments, and activity views. |
| `reports/` | ward occupancy chart/report components. |
| `ordering/` | sentence-builder/order authoring primitives. |
| `settings/`, `session-timeout`, `readonly/` | account settings, timeout warning behavior, and read-only banners. |
| `interop/`, `consent/`, `referrals/` | record receipt, consent sharing, and referral UI. |
| `clinical-notes/`, `charts/`, `drug-safety/`, `registration/`, `workflow/` | domain-specific reusable UI. |
| `tests/`, `__tests__/` | component-level test support and specs. |

## Invariants

- Components should not fetch data directly when a feature hook owns the query.
- Clinical components must not expose PHI in logs, browser events, or test names.
- Large lists should use virtualization primitives from `ui/`.
- Heavy charts should be lazy/deferred when not needed for first useful view.
- Prefer shared primitives over duplicating controls inside features.
- Table pagination must match the endpoint contract: cursor-backed lists may
  show exact totals when supplied, but should only expose previous/next controls
  unless random page access is supported.
- Keep Patient Chronicle clinical-data actions in `chronicle/` or panels
  launched from Patient Chronicle; do not create standalone clinical patient
  data pages.
