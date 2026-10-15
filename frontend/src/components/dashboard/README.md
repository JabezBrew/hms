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
- CriticalAlertsMonitor uses real scoped nurse alert/overdue-medication sources.
  Rust doctor/admin dashboard payloads do not contain an urgent-alert aggregate,
  so their ineffective background dashboard polls are disabled. Legacy monitoring
  remains supported. Future Rust doctor/admin monitoring requires an explicitly
  permission-scoped alert aggregation source; an empty snapshot is not all-clear.
