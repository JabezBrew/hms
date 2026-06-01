# frontend/src/components/interop

Status: deferred/limited
Owner: Frontend Clinical Interop Engineering
Last reviewed: 2026-06-01
Scope: record receipt/interoperability UI.

## Invariants

- Interop/FHIR-style data is unsafe external I/O and must be projected to
  minimal safe fields before display.
- Do not expose raw external payloads in UI logs or telemetry.
