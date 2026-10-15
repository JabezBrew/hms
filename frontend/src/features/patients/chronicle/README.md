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
- Native emergency access uses the generated patient-scoped grant/end endpoints,
  dedicated `patient.break_glass.invoke` permission, an audited category/reason,
  confirmation and fresh sign-in when the server requires it. Grant/end writes
  never automatically refresh authentication or retry. Denied clinical reads
  may fetch scoped demographics solely to identify the confirmation dialog.
- Grant expiry comes from the server; the local eviction timer is also bounded
  by the server's two-hour lifetime from request start using a monotonic clock.
  Expiry, end and failed verification discard clinical cache data before a fresh
  access check. Native startup requires a fresh read on mount; while open,
  access is rechecked every 30 seconds and on focus/visibility. After reload,
  the end control remains available without claiming a grant is active.
- Heavy timeline or chart work should be deferred until the shell and identity
  context are useful.
- Preserve AbortSignal behavior through any list or timeline fetch helper.
- URL workspace commands are consumed once per patient, requested encounter and
  navigation before opening stateful UI. Router cleanup can be deferred; an
  unstable callback must not replay the command and reset an in-progress note.
  Wait for authorized patient context and the requested encounter, and allow a
  later explicit navigation to request the same action again.

## Verification

Run from `frontend/`:

```bash
npm run test -- PatientChroniclePage
npm run test -- workspaceRegistry visitScopeUtils
```
