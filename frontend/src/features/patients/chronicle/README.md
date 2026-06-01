# Patient Chronicle Feature Internals

Status: active
Owner: Frontend Clinical Workflow Engineering
Last reviewed: 2026-06-01
Scope: patient Chronicle page orchestration, timeline data, workspace routing, break-glass, and visit scope.

## Purpose

This directory owns the feature-level orchestration for `PatientChroniclePage`.
It is the frontend home for patient clinical data. The shared visual slide-overs
and timeline components live in `src/components/chronicle/`; this directory
connects them to route state, Rust V2 API hooks, workspace actions, and access
states.

## Module Map

| Module | Owns |
| --- | --- |
| `PatientChroniclePageContent.jsx` | page composition for identity, sidebar, timeline, and workspace host. |
| `ChronicleLoadingState.jsx`, `ChronicleErrorState.jsx`, `ChronicleAccessDeniedState.jsx` | route-level loading, error, and denied states. |
| `ChronicleTimelinePanel.jsx`, `ChronicleTimelineEntries.jsx` | timeline container and entry rendering orchestration. |
| `useChroniclePatientRecord.js` | patient record retrieval for Chronicle. |
| `useChronicleTimelineData.js`, `useChronicleTimelineExpansion.js`, `useChronicleTimelineViewModel.js` | timeline query/view-model behavior and expansion state. |
| `useChronicleSidebarData.js` | sidebar data assembly. |
| `useChronicleBreakGlassAccess.js` | emergency access workflow state. |
| `useChronicleVisitScope.js`, `visitScopeUtils.js` | active visit/admission scope resolution. |
| `useChronicleRouteState.js`, `useChronicleRouteActions.js` | route-derived state and route actions. |
| `useChronicleWorkspaceActions.js`, `useChronicleWorkspaceRouting.js`, `workspaceRegistry.js` | slide-over/workspace registry and URL-driven workspace behavior. |
| `useChronicleOnboardingEvents.js` | onboarding event integration for Chronicle. |
| `chronicleEncounterUtils.js` | encounter-specific Chronicle helpers. |
| `ward-round/` | ward-round mode inside Patient Chronicle. |

## Invariants

- Do not add standalone clinical patient-data pages. Patient clinical actions
  should remain here or in panels launched from this page.
- Query keys and browser events must not contain MRNs, names, raw URLs, or
  free-text clinical values.
- Break-glass and access-denied states must be explicit; do not silently fall
  back to partial clinical views.
- Heavy timeline or chart work should be deferred until the shell and identity
  context are useful.
- Preserve AbortSignal behavior through any list or timeline fetch helper.

## Verification

Run from `frontend/`:

```bash
npm run test -- PatientChroniclePage
npm run test -- workspaceRegistry visitScopeUtils
```
