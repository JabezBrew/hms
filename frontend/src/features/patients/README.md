# patients feature

Status: active
Owner: Frontend/Patient Workflow
Last reviewed: 2026-06-01
Scope: patient registry, patient forms, Patient Chronicle, print, ward round, break-glass UI.

## Routes

- `/patients`
- `/patients/create`
- `/patients/my-patients`
- `/patients/:id`
- `/patients/:id/demographics`
- `/patients/:id/chronicle/print`
- `/patients/:id/ward-round`
- `/patients/:id/edit`

## Internal Map

| Path/File | Owns |
| --- | --- |
| `api/` | patient feature API adapter exports. |
| `hooks/` | patient and my-patients query hooks plus Rust V2 bridge tests. |
| `pages/PatientChronicleListPage.jsx` | patient registry route. |
| `pages/MyPatientsPage.jsx` | role-scoped patient list. |
| `pages/PatientChroniclePage.jsx` | main Patient Chronicle route. |
| `pages/PatientChroniclePrintPage.jsx` | print view for Chronicle. |
| `pages/PatientCreatePage.jsx`, `pages/PatientEditPage.jsx`, `pages/PatientDemographicsPage.jsx`, `pages/PatientPage.jsx` | patient create/edit/demographic/detail shells. |
| `chronicle/` | Patient Chronicle page internals, timeline data, workspace routing, break-glass, visit scope, ward-round mode. |
| `chronicle-list/` | registry header, search results, registry constants, and helper functions. |
| `components/` | Chronicle workspace host, Copilot panel/slide-over, and mobile workspace context dock. |
| `prefetch.js` | patient route prefetch behavior. |
| `utils/` | patient display-name and feature-local helpers. |
| `routes.js` | patient route definitions and route metadata. |

## Backend Contracts

- `/api/v2/patients`
- `/api/v2/patients/context`
- `/api/v2/patients/:id/chronicle`
- `/api/v2/patients/:id/break-glass`
- ward-round endpoints under `/api/v2/patients/:patient_id/chronicle/ward-rounds`

## Invariants

- Patient Chronicle is the product home for patient clinical data.
- Registry and my-patients lists must stay lightweight and server-paginated.
- Break-glass requires backend permission, fresh auth, grant expiry, and audit.
- Do not prefetch heavy Chronicle data unless performance budgets allow it.
- Patient identity fields must not appear in query keys, logs, browser events,
  or fixture names.
