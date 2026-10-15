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

## Draft recovery

The editor loads the current ward round before accepting changes. Only a draft
for the active admission is restored; a signed round is never replayed as draft
orders. A failed lookup keeps the editor unavailable and offers retry, so an
empty browser state cannot replace an existing draft after a read failure.

Restored draft saves use the existing PATCH operation with `expected_version`
and retain the version returned after saving actions. Version conflicts preserve
local content and surface an error. Draft restoration retains note summary and
examination, prescription decisions, lab priorities, nursing due dates and
assignees, and discharge blockers. Partial medication work can be saved as a
draft; signing still requires complete valid actions.

The action replacement sequence continues to use separate existing resource
writes; it is not an atomic multi-resource save. A partial action-write failure
can require reloading the current draft before retrying.
