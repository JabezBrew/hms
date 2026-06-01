# inbox feature

Status: active
Owner: Frontend/Notifications Workflow
Last reviewed: 2026-06-01
Scope: user inbox and notification views.

## Routes

- `/inbox`

## Backend Contracts

- `/api/v2/notifications`
- `/api/v2/notifications/counts`
- `/api/v2/notifications/:id/read`

## Invariants

- Notification payloads must be minimal and PHI-safe.
- Read state is backend-authoritative.
- Realtime updates must use authorized subscription contracts.
