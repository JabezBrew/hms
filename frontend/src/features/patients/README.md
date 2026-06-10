# patients feature

Status: active
Owner: Frontend/Patient Workflow
Last reviewed: 2026-06-06
Scope: Patient Directory, patient forms, Patient Chronicle, print, ward round, break-glass UI.

## Routes

- `/patients`
- `/patients/find-or-register`
- `/patients/create`
- `/patients/my-patients`
- `/patients/:id`
- `/patients/:id/profile`
- `/patients/:id/chronicle`
- `/patients/:id/chronicle/print`
- `/patients/:id/ward-round`
- `/patients/:id/edit`

## Internal Map

| Path/File | Owns |
| --- | --- |
| `api/` | patient feature API adapter exports. |
| `hooks/` | patient and my-patients query hooks plus Rust V2 bridge tests. |
| `pages/PatientChronicleListPage.jsx` | Patient Directory route for broad patient-record lookup. |
| `pages/FindOrRegisterPatientPage.jsx` | Shared identity resolution and guarded registration flow used by Patient Directory and care-area intake. |
| `pages/MyPatientsPage.jsx` | role-scoped patient list. |
| `pages/PatientChroniclePage.jsx` | main Patient Chronicle route. |
| `pages/PatientChroniclePrintPage.jsx` | print view for Chronicle. |
| `pages/PatientCreatePage.jsx`, `pages/PatientEditPage.jsx`, `pages/PatientDemographicsPage.jsx`, `pages/PatientPage.jsx` | patient create/edit/demographic/detail shells. |
| `chronicle/` | Patient Chronicle page internals, timeline data, workspace routing, break-glass, visit scope, ward-round mode. |
| `chronicle-list/` | directory header, search results, constants, and helper functions. |
| `components/` | Chronicle workspace host, Copilot panel/slide-over, and mobile workspace context dock. |
| `prefetch.js` | patient route prefetch behavior. |
| `utils/` | patient display-name and feature-local helpers. |
| `routes.js` | patient route definitions and route metadata. |

## Backend Contracts

- `/api/v2/patients`
- `/api/v2/patients/identity/lookup`
- `/api/v2/patients/identity/lookups/:lookup_id`
- `/api/v2/patients/context`
- `/api/v2/patients/:id/current-contexts`
- `/api/v2/patients/:id/chronicle`
- `/api/v2/patients/:id/break-glass`
- ward-round endpoints under `/api/v2/patients/:patient_id/chronicle/ward-rounds`

## Invariants

- Patient Chronicle is the product home for patient clinical data.
- Administrative patient profile access is separate from Chronicle access.
  Registration, front-desk, and billing users may confirm identity,
  demographics, insurance, and current care context without opening clinical
  notes, diagnoses, labs, medications, or the clinical timeline.
- Patient Directory and my-patients lists must stay lightweight and server-paginated.
- Patient Directory is broad patient-record lookup. It should default to search
  and bounded recent-registration discovery, not a global active-patient work
  queue.
- Find or Register Patient is the front door for new care intake. Users must
  resolve identity before registering a new record or starting OPD/IPD/Emergency
  care context.
- Before starting care-area intake for an existing record, the page checks
  current contexts and routes to an already-current OPD/IPD/Emergency workflow
  when one exists.
- Duplicate review is backend-enforced. The frontend may display candidates and
  collect a reason, but creation must send the backend lookup id and duplicate
  review decision; it must not rely on frontend-only duplicate checks.
- Lookup results may be restored by opaque `lookup_id` only. Do not put names,
  DOBs, MRNs, phone numbers, or other raw identity fields in URLs, query keys,
  logs, or browser storage.
- Scoped patient workflow lists live in care-area, clinic waiting-room, Ward
  Board, triage, My Work, and Chronicle surfaces.
- Patient administrative record status is independent from encounter, admission,
  discharge, triage, and visit status. Do not deactivate patient records because
  an encounter or admission was discharged.
- Use `record_status` and `vital_status` labels in Patient Directory:
  Registered record, Restricted, Entered in error, Merged record, and Vital
  status. Do not reintroduce Active/Inactive/Discharged patient-record tabs.
- Patient Directory location displays current admission ward/bed context; use
  `Not admitted` when no current admission location is present.
- Patient Directory ward filters default to current admissions
  (`admitted`/`discharge_pending`). Historical ward lookups require an explicit
  `admission_status` filter such as `discharged` or `cancelled`.
- Break-glass requires backend permission, fresh auth, grant expiry, and audit.
- Do not prefetch heavy Chronicle data unless performance budgets allow it.
- Patient identity fields must not appear in query keys, logs, browser events,
  or fixture names.
- Patient list and context-list React Query keys must sanitize free-text
  `query`/`search` values into opaque per-session scopes.
- Chronicle workflow handoff must use real context ids: `visit=<encounter_id>`
  for OPD/Emergency encounter context and `admission=<admission_case_id>` for
  inpatient context. Do not pass a raw visit id as the Chronicle visit scope.
