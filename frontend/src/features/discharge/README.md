# discharge feature

Status: active support module
Owner: Frontend/Inpatient Workflow
Last reviewed: 2026-10-14
Scope: discharge workflow components, hooks, pages, and API support.

## Routes

No primary route is exported from this feature today. Discharge UI is reached
through ward, admissions, nursing, and workflow routes.

In Rust V2, the patient drawer on `/wards/:wardId/board` hosts
`DischargeWorkflowPanel`. A `view=discharge&patient=<id>&case=<id>` link opens
only the row matching both patient and discharge case. The panel loads the
exact case with an authorization-scoped query instead of searching a discharge
list. `/ward-board` remains the assigned-ward resolver.

## Backend Contracts

- `/api/v2/discharges`
- `/api/v2/discharges/:id/*`
- `POST /api/v2/discharges/:id/nursing-release` accepts required `education`
  and `instructions`, each up to 2,000 characters, with `nursing.task.manage`.
- `POST /api/v2/discharges/:id/complete` requires `admission.manage` and no body.
- Summary clearance is backend-derived from a reviewed clinical note in the
  linked encounter: `doctor_note`, title `Discharge Summary`. Creating a draft
  alone does not clear it. The Chronicle preparation shortcut retains encounter
  scope; `DischargeSummaryReview` lists 25 notes at a time for that encounter,
  filters actual summary metadata, and loads full note detail only on selection.
  A clinician reads the content and explicitly acknowledges it before saving a
  reviewed version through the existing clinical note version API. This records
  a version and is not presented as a digital signature.

## Invariants

- Discharge blockers are backend-authoritative.
- Billing/pharmacy/nursing blockers must not be hidden by frontend state.
- Final completion requires the actual capability, current successfully loaded
  blockers, and explicit confirmation. Every blocking item must be `completed`
  or `overridden`; missing clearance data disables completion.
- Nursing release and completion do not retry automatically. Their controls
  reject duplicate pending submissions, retain failed nursing input, and await
  authoritative query refresh after both success and failure. A failed refresh
  keeps writes disabled even if a previous ready response remains cached.
- Blocker overrides require backend permission and recent reauthentication;
  this panel does not expose override controls.
- A requested discharge is awaiting clearance until actual blockers permit
  completion. Missing balance data is unavailable and never assumed to be zero.
- Summary review checks patient, encounter, type, title, body and version before
  writing. It re-reads the note and rejects a changed version/body. The existing
  version API does not provide an atomic expected-version condition; note history
  and the server's authorization remain authoritative. Review never auto-saves
  or retries, and failed refresh leaves cached content read-only.

## Verification

```bash
npx vitest run src/features/discharge src/features/ward-board/pages/__tests__/WardBoardPage.test.jsx
```
