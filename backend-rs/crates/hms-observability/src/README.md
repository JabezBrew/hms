# hms-observability/src

Status: active
Owner: Backend/Observability Engineering
Last reviewed: 2026-06-01
Scope: logging, tracing, route normalization, and metrics helpers.

## Module Map

| File | Owns |
| --- | --- |
| `lib.rs` | public observability setup and helpers. |

## Invariants

- Logs and metric labels must use route templates and operational metadata.
- Do not emit PHI, secrets, request bodies, names, MRNs, or clinical free text.
- Observability setup must not make the API fail open on access errors.
