# triage feature

Status: active
Owner: Frontend/Triage Workflow
Last reviewed: 2026-06-01
Scope: triage queue and triage assessment UI.

## Routes

- `/triage`

## Backend Contracts

- `/api/v2/triage`
- `/api/v2/triage/:id/*`

## Invariants

- Triage assignment and assessment state is backend-authoritative.
- Queue views must be facility-scoped and role-scoped.
- Triage patient data must not become a standalone clinical record outside
  Chronicle.

## Assessment and staff assignment

Rust V2 assignment belongs to the assessment team: waiting entries may be
assigned, assigned entries remain visible and may be assessed or reassigned,
and assessment completes the triage entry. Completed entries cannot be assigned
or cancelled. Clinic appointment creation remains a separate legacy workflow.

The queue defaults to waiting entries and sends status/priority filters to the
server. Next/Previous controls traverse bounded cursor pages. Summary cards
explicitly describe the visible page instead of presenting partial page counts
as whole-queue totals. Patient links preserve real encounter context.

Staff selection uses the clinical `/api/v2/staff/directory` endpoint with bounded
cursor loading and authorization-scoped cache keys. It sends the selected
`user_id`; practitioner entity ids must not be sent as staff user ids.

Assessment and chart measurements use separate existing write APIs. If a
measurement fails, the dialog retains its original values and measurement time,
retries only failed measurements, and does not submit the saved assessment
again. Closing with unsaved measurements requires an explicit discard decision.
A transport failure after a server commit remains subject to the chart API's
existing write semantics; the UI cannot prove delivery of an unacknowledged
measurement.

Run focused regressions from `frontend/`:

```bash
npm run test:run -- src/features/triage src/components/visits/TriageQueueList.test.jsx src/components/visits/TriageAssignDialog.v2.test.jsx src/components/visits/TriageAssessmentDialog.test.jsx src/lib/api/__tests__/v2-visits-bridge.test.js
```
