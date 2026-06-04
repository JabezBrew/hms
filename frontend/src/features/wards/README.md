# wards feature

Status: active
Owner: Frontend/Ward Administration
Last reviewed: 2026-06-01
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
- `/api/v2/wards/:id/beds`
- `/api/v2/wards/:id/sections`

## Invariants

- Ward/bed/section state is backend-authoritative.
- Bed availability must respect admission/discharge/cleaning state.
- Ward and section capacity summaries must use backend aggregate counters, not
  the currently loaded `/beds` page.
- Ward bed-grid UI is operational only. Tiles may include LOS for occupied beds,
  but patient names and clinical detail belong on the ward board or Patient
  Chronicle.
- Ward reports should use aggregate projections, not full clinical payloads.
