# appointments feature

Status: active
Owner: Frontend/Scheduling Workflow
Last reviewed: 2026-06-01
Scope: appointments, availability, schedule slots, and appointment forms.

## Routes

- `/appointments`
- `/appointments/create`
- `/appointments/new`
- `/appointments/:id`
- `/appointments/:id/edit`
- `/practitioner-availability`
- `/schedules/:id/slots`

## Backend Contracts

- `/api/v2/appointments`
- `/api/v2/appointment-types`
- `/api/v2/scheduling/*`

## Invariants

- Availability must come from backend query params, not client-only filtering.
- Appointment lists must preserve cancellation through `AbortSignal`.
- Overbooking and arrival rules are backend policy.
