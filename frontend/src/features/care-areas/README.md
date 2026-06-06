# care-areas feature

Status: active
Owner: Frontend Clinical Workflow Engineering
Last reviewed: 2026-06-06
Scope: entry hubs for scoped patient access by care context.

## Routes

- `/care-areas/outpatient`
- `/care-areas/inpatient`
- `/care-areas/emergency`

## Backend Contracts

- My Work uses `/api/v2/care-areas/my-work` for a bounded, role/profile/facility
  scoped landing summary. It returns preview rows only; it is not a replacement
  for Patient Directory.
- My Work outpatient previews use `/api/v2/appointments` with `date=<today>`
  and `practitioner_user_id=<current user>` plus `/api/v2/visits` with
  `practitioner_user_id=<current user>` and `active_only=true`.
- Outpatient hub uses `/api/v2/clinics` for clinic metadata and links to
  `/clinics/:clinicId/waiting-room`. The embedded queue table calls
  `/api/v2/visits` with `clinic_id` and `active_only=true`.
- Inpatient hub uses `/api/v2/wards` and `/api/v2/wards/my-board-context` for
  assigned ward entry points. The actual inpatient patient table remains Ward
  Board.
- Emergency hub links to `/triage` and embeds `/api/v2/triage` with server-side
  status/assignment filters.
- Optional links, such as appointment scheduling, walk-in registration, and
  encounter lists, are shown only when their deployment modules are enabled.

## Screen Roles

- Outpatient is for clinic/session flow: checked-in patients, visit state,
  triage state, assigned clinician, and the next clinical action.
- Inpatient is for ward flow: assigned wards, Ward Board, admissions awaiting a
  bed or activation, and ward-based Chronicle handoff.
- Emergency is for triage flow: acuity, queue state, wait time, assignment,
  location/disposition, and urgent Chronicle entry.
- Patient Directory remains an administrative/global identity lookup and should
  not become the default clinical work queue.

## Invariants

- Care-area hubs are scoped workflow surfaces, not patient registries.
- Do not fetch broad patient queues on the hub pages just to show counts or
  local filters.
- Outpatient, Inpatient, and Emergency tables must use server-side filters and
  bounded pages. Do not sort/filter partial pages in the browser.
- Preserve the distinction between patient record status and encounter,
  admission, or triage status; the hubs route users to the relevant context
  instead of redefining those statuses.
- Chronicle links should include `visit=<encounter_id>` only when the row has a
  real encounter id. Raw visit ids are not Chronicle visit-scope ids.
- Ward Board links may include `admission=<admission_case_id>` so Chronicle opens
  in the inpatient context.
- Query keys for care-area summaries must not include names, MRNs, free-text
  clinical identifiers, or raw URLs.
