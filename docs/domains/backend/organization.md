# Backend Domain: organization

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: API and operational notes for `backend/apps/organization`.

## API Surface

Base prefix: `/api/organization/`

Major route groups:

- unit configuration (`unit-types`, `leadership-roles`, `assignment-types`)
- clinical structures (`units`, `clinics`, `clinic-schedules`, `ward-allocations`)
- staffing and coverage (`staff-assignments`, `unit-members`, `cross-coverage`)
- department roster (`rotation-rules`, `roster`, `validation-rules`, `on-duty`)

## Security Notes

- Restrict organization and roster edits to authorized administrative roles.
- Validate department-level permissions for roster actions.

## Performance Notes

- Roster queries should avoid broad scans and repeated per-row computations.
- Bulk operations need bounded transaction scope.
