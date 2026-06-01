# frontend/src/hooks

Status: active
Owner: Frontend Platform/Product Engineering
Last reviewed: 2026-06-01
Scope: shared/domain hooks, query hooks, workflow hooks, and websocket hooks.

## Purpose

`src/hooks/` contains shared data/query hooks and workflow hooks that predate or
span feature modules. New feature-specific hooks should live under
`src/features/<domain>/hooks/` unless they are intentionally shared.

## Areas

| Path | Purpose |
| --- | --- |
| `__tests__/` | hook tests, including Rust V2 bridge and invalidation coverage. |
| `nursing/` | nursing-specific hooks that have not moved fully into `features/nursing`. |
| `websocket/` | websocket/realtime hooks. |
| `useAppointmentQueries.js`, `useVisitQueries.js`, `useEncounterQueries.js` | care/scheduling query helpers. |
| `usePatientQueries.js`, `useMyPatientsQueries.js`, `useChronicleContext.js`, `useTimelineQueries.js`, `useClinicalSummaryQueries.js` | patient registry and Patient Chronicle query helpers. |
| `useClinicalNotesQueries.js`, `useChartQueries.js`, `usePrescriptionMutations.js`, `useDrugSafetyQueries.js`, `useNoteWorkflow.js` | clinical notes, charts, prescription, and medication-safety hooks. |
| `useWardQueries.js`, `useNursingQueries.js`, `useWardRoundWorkflow.js`, `useDischargeWorkflow.js`, `nursing/*` | ward, nursing, ward-round, treatment, handoff, and discharge hooks. |
| `useInventoryQueries.js`, `useLabQueries.js`, `useBillingQueries.js`, `useReferralQueries.js` | fulfillment, inventory, lab, billing, and referral query hooks. |
| `useDashboardQueries.js`, `useDashboardActions.js`, `useDoctorDashboard.js`, `useInboxQueries.js`, `useInboxCount.js`, `useConsultationWorkflow.js` | dashboard, inbox, role landing, and consultation workflow hooks. |
| `useAuditLogs.js`, `useFacilityQueries.js`, `useOrganization.js`, `useStaffQueries.js`, `useSettingsQueries.js`, `useSystemQueries.js`, `useConsentQueries.js`, `useInteropQueries.js` | admin, settings, consent, and system hooks. |
| `useWebSocket.js`, `websocket/*` | realtime and notification socket hooks. |
| `usePaginatedQuery.js`, `useSearchQuery.js`, `useReceiptPrint.js`, `useInView.js`, `useLatest.js`, `useOnlineStatus.js`, `useSidebarState.js`, `useSlideOver.js`, `useWorkflow.js`, `useWorkflowQueries.js`, `workflowV2Guard.js`, `nursingQueriesV2Bridge.js`, `queries` | shared UI/query/workflow utilities and compatibility shims. |

## Invariants

- Hooks that fetch lists should use backend pagination and cancellation.
- Realtime hooks must rely on backend-authorized subscriptions; do not infer
  patient/ward visibility in the browser.
- Query keys must include scope that changes authorization.
- Prefer moving domain-specific hooks into `features/<domain>/hooks` when
  working in that feature.
- Preserve `AbortSignal` and `AbortError` through every list-fetching helper.
- Do not put MRNs, names, raw URLs, or free-text clinical values in query keys
  or browser telemetry.
