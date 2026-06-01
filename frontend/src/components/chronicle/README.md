# Chronicle Components

Status: active
Owner: Frontend Clinical UI Engineering
Last reviewed: 2026-06-01
Scope: Patient Chronicle shared UI components and slide-over workflows.

## Purpose

`src/components/chronicle/` contains reusable Patient Chronicle UI: identity,
timeline entries, clinical sidebars, note and vitals slide-overs, medication
dialogs, treatment/ward-round panels, and workflow steps. Feature-level route
orchestration lives in `src/features/patients/chronicle/`.

## Component Map

| Area | Components |
| --- | --- |
| Identity and context | `PatientIdentityHero*`, `PatientChronicleCard*`, `PatientCareTeamCard`, `ClinicalSummarySidebar`. |
| Timeline | `TimelineEntry*`, `ChronicleNoteBody`, `DiffRenderer`, `timelineEntryFrameUtils.js`. |
| Notes and consultations | `AddNoteSlideOver*`, `EditNoteSlideOver`, `NoteDetailModal`, `NoteHistoryModal`, `CopyNoteModal`, `NoteTypeSelector`, `ConsultationSlideOver*`, `NoteWorkflowSteps`, `consultation-steps/*`. |
| Vitals and trends | `AddVitalsSlideOver*`, `TrendReviewSlideOver*`, `ClinicalTrendLineChart`. |
| Medications and treatment | `AddPrescriptionSlideOver*`, `PrescriptionActionsDialog*`, `MedicationHistorySlideOver`, `TreatmentSheetSlideOver`. |
| Ward and discharge | `WardRoundSlideOver*`, `ward-round-steps/*`, `DischargeSlideOver`, `discharge-steps/*`. |
| Billing/coverage inside Chronicle | `PatientInsuranceSlideOver*`. |
| Access and workflow primitives | `BreakGlassDialog`, `DynamicWorkflowStep`, `useAddNoteSlideOverController.js`, `chronicleNoteUtils.js`. |

## Invariants

- Components may render clinical data but should not fetch it directly when a
  feature hook owns the query.
- Do not put clinical text, names, MRNs, accessions, or raw URLs in logs,
  telemetry, test names, or query keys.
- Slide-overs should remain Patient Chronicle actions unless the product
  explicitly defines another clinical home.
- Components that render long lists or trends should use lazy/deferred rendering
  when they are not needed for first useful view.

## Verification

Run from `frontend/`:

```bash
npm run test -- chronicle
```
