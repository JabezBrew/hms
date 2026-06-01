# Patient Chronicle Ward Round

Status: active
Owner: Frontend Ward/Clinical Workflow Engineering
Last reviewed: 2026-06-01
Scope: ward-round mode inside Patient Chronicle.

## Purpose

`ward-round/` implements the ward-round workflow as a Patient Chronicle mode,
not as a separate clinical page. It coordinates round review, actions, and API
calls while keeping patient context anchored in Chronicle.

## Module Map

| Module | Owns |
| --- | --- |
| `WardRoundMode.jsx` | ward-round workspace mode. |
| `WardRoundActions.jsx` | action controls for round workflow steps. |
| `WardRoundReviewRail.jsx` | review rail and supporting context. |
| `useWardRoundMode.js` | ward-round state orchestration. |
| `api.js` | ward-round API adapter calls. |
| `__tests__/WardRoundMode.test.jsx` | UI behavior coverage. |
| `__tests__/api.test.js` | API adapter coverage. |

## Invariants

- Ward-round UI must be launched from Patient Chronicle context.
- It must preserve patient/visit scope and avoid route-local clinical access
  shortcuts.
- It must not log note text, patient names, MRNs, or free-text plan content.

## Verification

Run from `frontend/`:

```bash
npm run test -- WardRoundMode
npm run test -- ward-round/api
```
