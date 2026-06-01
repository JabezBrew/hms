# frontend/src/config

Status: active
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: frontend configuration constants.

## Files

| File | Role |
| --- | --- |
| `shiftConfig.js` | shift-related frontend configuration. |

## Invariants

- Configuration here is build-time/source configuration, not private runtime
  secrets.
- Facility-specific runtime values should come from backend/runtime config.
