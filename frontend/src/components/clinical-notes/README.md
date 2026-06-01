# frontend/src/components/clinical-notes

Status: active
Owner: Frontend Clinical UI Engineering
Last reviewed: 2026-06-01
Scope: dynamic note forms, note templates, and template builder UI.

## Invariants

- Note text is PHI and must not appear in logs, telemetry, test names, or query
  keys.
- Note editing should remain anchored in Patient Chronicle workflow context.
