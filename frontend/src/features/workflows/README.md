# workflows feature

Status: compatibility/disabled in Rust V2 mode
Owner: Frontend/Workflow Platform
Last reviewed: 2026-06-01
Scope: historical guided ward-round and discharge workflow launchers.

## Current Role

The routes in this feature are registered with `rustV2Supported: false`.
Current Rust V2 clinical workflow entry points should launch from Patient
Chronicle, ward, admission, nursing, or discharge feature surfaces instead of
these standalone workflow routes.

## Routes

- `/workflows/ward-round` (Rust V2 unsupported)
- `/workflows/discharge` (Rust V2 unsupported)

## Backend Contracts

- Historical/compatibility workflow surfaces only.
- Use Patient Chronicle ward-round APIs and discharge feature APIs from their
  active feature modules when implementing Rust V2 work.

## Invariants

- Guided workflows should keep clinical context visible.
- Workflow state transitions are backend-authoritative.
- Do not duplicate discharge blocker or ward-round commit rules in UI-only state.
- Do not add new Rust V2 clinical work to these standalone routes unless the
  route support flag and product placement decision are changed together.
