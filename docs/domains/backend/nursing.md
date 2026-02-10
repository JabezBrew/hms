# Backend Domain: nursing

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: API and operational notes for `backend/apps/nursing`.

## API Surface

Base prefix: `/api/nursing/`

Routes include:

- `vital-signs`
- `tasks`
- `alerts`
- `medications`
- `handoffs`
- `monitoring`
- `treatment-sheet`
- `supply-requests`
- `fluid-balance`

## Security Notes

- Nursing endpoints with patient identifiers require strict scope enforcement.
- Keep patient clinical data access aligned with chronicle constraints.

## Performance Notes

- High-frequency vital/task lists need pagination and efficient filtering.
- Avoid broad prefetch on large time-series tables.
