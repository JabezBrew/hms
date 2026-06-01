# frontend/src/hooks/websocket

Status: active
Owner: Frontend Realtime Engineering
Last reviewed: 2026-06-01
Scope: authenticated websocket token and notification socket hooks.

## Module Map

| File | Owns |
| --- | --- |
| `useAuthenticatedWebSocketToken.js` | websocket token acquisition helper. |
| `useNotificationSocketConnection.js` | notification socket connection behavior. |

## Invariants

- Backend channel authorization is authoritative.
- Do not infer patient/ward visibility in the browser.
- Channel names, logs, and telemetry must remain PHI-safe.
