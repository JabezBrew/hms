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
- Bar and mixed bar/line charts should use item-triggered tooltips so empty
  plot hover does not select or visually mask the nearest ward/category.
- Bar emphasis styles should preserve the normal fill color and opacity so the
  active bar remains visible while its tooltip is open.
- Report filters should use compact toolbars when they contain only a few
  controls; avoid full-height filter cards that push charts below the fold.
- Rust V2 ward reports consume `/api/v2/wards/analytics` for typed aggregate
  rows. The frontend may adapt those rows into chart-friendly arrays, but must
  not fabricate unavailable measures from placeholder zeros.
- Report date filters are date-only (`yyyy-MM-dd`) so the selected calendar
  range is not shifted by browser timezone conversion.
- Ward transfer and ward-attributed revenue analytics remain unavailable until
  Rust V2 has a trustworthy transfer/revenue attribution contract.
