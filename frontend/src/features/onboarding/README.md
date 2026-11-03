# onboarding feature

Status: active support module
Owner: Frontend/Setup Workflow
Last reviewed: 2026-06-01
Scope: onboarding support APIs, hooks, components, events, and setup helpers.

## Routes

No primary app route is exported from this feature today.

## Backend Contracts

Uses setup/deployment APIs only when the deployment enables onboarding behavior.

Guided onboarding currently uses the legacy workflow API. Rust V2 has no guided
onboarding producer contract, so its optional startup runtime stays quiet and
does not request legacy flows, progress or event/step mutations. This does not
implement native Rust onboarding parity. Direct adapter calls fail unavailable
rather than synthesize an empty success or fall through to the legacy backend.

When transport or the current role becomes unavailable, pending flow/progress
reads consume cancellation signals and retained legacy data is not exposed by
the runtime. Current and stale callbacks recheck transport before acting.
Legacy authorized-role flows retain their existing start/skip/event behavior.
Broader actor/facility cache isolation within the supported legacy transport is
separate work; its existing role-based query keys are not represented as that
guarantee.

## Invariants

- Onboarding must not be assumed to exist in every deployment profile.
- First-admin/setup flows are security-sensitive and need explicit backend
  authority.
- Do not store setup secrets or credentials in frontend code.
