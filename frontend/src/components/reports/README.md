# frontend/src/components/reports

Status: active
Owner: Frontend Reporting Engineering
Last reviewed: 2026-06-04
Scope: ward occupancy charts and reports.

## Invariants

- Reports should use aggregate or least-privilege projections.
- Charts should not require PHI-bearing labels.
- Heavy report charts should be deferred.
- Rendered report graphs use the shared ECharts wrapper, not Recharts.
- Rust V2 ward reports currently expose a ward capacity snapshot only; do not
  fabricate historical occupancy, LOS, admissions, transfer, discharge, or
  revenue analytics from placeholder zeros.
