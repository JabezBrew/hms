# Backend Domain: encounters

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: API and operational notes for `backend/apps/encounters`.

## API Surface

Base prefix: `/api/encounters/`

Routes:

- `/api/encounters/visits/`
- `/api/encounters/triage/`
- `/api/encounters/` (encounter root viewset)

## Security Notes

- Encounter retrieval must enforce patient/facility scope.
- Avoid exposing broad encounter details in list endpoints.

## Performance Notes

- Optimize encounter workspace data loading.
- Use annotation/select_related patterns for counts and summaries.
