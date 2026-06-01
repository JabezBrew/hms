# frontend/src/lib/observability

Status: active
Owner: Frontend/Observability Engineering
Last reviewed: 2026-06-01
Scope: browser runtime observability helpers.

## Module Map

| File | Owns |
| --- | --- |
| `rum.js` | browser RUM event creation and submission helpers. |

## Invariants

- RUM payloads must not include page text, form values, patient names, MRNs, raw
  URLs with identifiers, or clinical free text.
- Prefer route templates, timing buckets, status codes, and aggregate metadata.
- Observability failure must not break clinical workflows.
