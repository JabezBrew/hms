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

- Outpatient hub uses `/api/v2/clinics` for clinic metadata and links to
  `/clinics/:clinicId/waiting-room`.
- Inpatient hub uses `/api/v2/wards` for ward metadata and links to
  `/wards/:wardId/board`.
- Emergency hub links to `/triage`.
- Optional links, such as appointment scheduling, walk-in registration, and
  encounter lists, are shown only when their deployment modules are enabled.

## Invariants

- Care-area hubs are routing surfaces, not patient registries.
- Patient rows remain inside scoped workflow screens such as clinic waiting
  room, ward board, triage, and Patient Chronicle.
- Do not fetch broad patient queues on the hub pages just to show counts.
- Preserve the distinction between patient record status and encounter,
  admission, or triage status; the hubs route users to the relevant context
  instead of redefining those statuses.
