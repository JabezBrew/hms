# appointments feature

Status: active
Owner: Frontend/Scheduling Workflow
Last reviewed: 2026-10-16
Scope: appointments, availability, schedule slots, and appointment forms.

## Routes

- `/appointments`
- `/appointments/create`
- `/appointments/new`
- `/appointments/:id`
- `/appointments/:id/edit`
- `/appointments/series/:id`
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

## Multiple appointments

The Rust create page supports explicit groups of real session-backed slots with
one atomic booking and a final review. Existing members link to their group;
future-only cancellation retains history and shows the actual saved result.
See [series/README.md](series/README.md) for contracts and regression coverage.
Recurring clinic-session templates create capacity, while typed patient recurrence
patterns remain a separate workflow.
