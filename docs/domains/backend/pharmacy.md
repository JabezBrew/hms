# Backend Domain: pharmacy

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: API and operational notes for `backend/apps/pharmacy`.

## API Surface

Base prefix: `/api/pharmacy/`

Routes:

- `dispensing`
- `supply-requests`

## Security Notes

- Enforce dispensing visibility by facility and authorized role.
- Exclude sensitive payload fields from list responses.

## Performance Notes

- Queue-oriented lists should stay paginated and searchable.
- Prefer explicit projections over nested object responses.
