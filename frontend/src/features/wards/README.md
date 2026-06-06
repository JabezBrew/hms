# wards feature

Status: active
Owner: Frontend/Ward Administration
Last reviewed: 2026-06-06
Scope: wards, sections, beds, ward reports, and ward detail UI.

## Routes

- `/wards`
- `/wards/new`
- `/wards/reports`
- `/wards/:wardId/edit`
- `/wards/:wardId`

## Backend Contracts

- `/api/v2/wards`
- `/api/v2/wards/:id`
- `/api/v2/wards/:id/bed-map`
- `/api/v2/wards/:id/beds`
- `/api/v2/wards/:id/sections`
- `/api/v2/wards/:id/staff`
- `/api/v2/wards/staff-roles`
- `/api/v2/wards/staff-assignments`

## Invariants

- Ward/bed/section state is backend-authoritative.
- Bed availability must respect admission/discharge/cleaning state.
- Ward bed-map UI must use the complete `/api/v2/wards/:id/bed-map`
  operational snapshot. Do not stitch cursor pages from `/beds` to draw a map.
- Ward and section capacity summaries must use backend aggregate counters, not
  the currently loaded `/beds` page.
- Ward bed-grid UI is operational only. Tiles may include LOS for occupied beds,
  but patient names and clinical detail belong on the ward board or Patient
  Chronicle. Use `occupied_since` from the bed-map DTO for LOS, do not expose
  admission identifiers from bed DTOs, and do not hydrate ward-board patient
  rows for the bed grid.
- Ward bed-grid details should stay in tooltips unless a future workflow needs
  an explicit action panel. Available beds should sort first within each bay.
- Ward reports should use aggregate projections, not full clinical payloads.
- Ward staff assignments link wards to practitioner profiles. They drive
  ward-board default scope for clinical users, so assignment writes must remain
  admin-scoped, same-facility, and should not be replaced by ad hoc user fields.
