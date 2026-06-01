# frontend/src/components/dashboard

Status: active
Owner: Frontend Dashboard Engineering
Last reviewed: 2026-06-01
Scope: role dashboard cards, widgets, charts, and urgent banners.

## Invariants

- Dashboards should use cached/projection APIs, not broad request-path FHIR or
  clinical scans.
- Heavy widgets and charts should be deferred.
- Widget telemetry must remain aggregate and PHI-safe.
